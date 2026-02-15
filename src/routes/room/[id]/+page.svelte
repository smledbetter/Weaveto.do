<script lang="ts">
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { RoomSession, type DecryptedMessage, type RoomMember } from '$lib/room/session';
	import { createCredential, assertWithPrf, getStoredCredentialId, WebAuthnUnsupportedError } from '$lib/webauthn/prf';
	import { isDark, toggleTheme } from '$lib/theme.svelte';
	import { createTaskStore } from '$lib/tasks/store.svelte';
	import { parseTaskCommand } from '$lib/tasks/parser';
	import { ReminderScheduler } from '$lib/tasks/reminders';
	import type { TaskEvent, Task } from '$lib/tasks/types';
	import TaskPanel from '$lib/components/TaskPanel.svelte';
	import { ShortcutManager } from '$lib/keyboard/shortcuts';

	let roomId = $derived($page.params.id ?? '');
	let isCreator = $derived($page.url.searchParams.has('create'));
	let session: RoomSession | null = $state(null);
	let messages: DecryptedMessage[] = $state([]);
	let members: Map<string, RoomMember> = $state(new Map());
	let connected = $state(false);
	let messageInput = $state('');
	let displayName = $state('');
	let phase: 'name' | 'auth' | 'connecting' | 'connected' | 'error' = $state('name');
	let error = $state('');
	let showKeyWarning = $state(false);
	let roomUrl = $derived(browser ? `${window.location.origin}/room/${roomId}` : '');
	let copied = $state(false);

	// Task management
	const taskStore = createTaskStore();
	let taskList = $state<Task[]>([]);
	let showTaskPanel = $state(false);
	let mobileTab: 'messages' | 'tasks' = $state('messages');
	let taskCount = $derived(taskList.filter((t) => t.status !== 'completed').length);
	let lastMessageTimes = $state<Map<string, number>>(new Map());
	let reminderNotice = $state('');

	// Keyboard shortcuts
	let shortcutManager: ShortcutManager | null = null;
	let showShortcutHelp = $state(false);

	// Reminder scheduler — fires 5 min before due, in-tab only
	const reminderScheduler = new ReminderScheduler((task) => {
		reminderNotice = `Reminder: "${task.title}" is due soon`;
		// Try browser Notification API
		if (browser && 'Notification' in window && Notification.permission === 'granted') {
			new Notification('Task Reminder', { body: `"${task.title}" is due soon` });
		}
		// Auto-dismiss after 8 seconds
		setTimeout(() => { if (reminderNotice) reminderNotice = ''; }, 8000);
	});

	// Register service worker for persistent reminders
	onMount(() => {
		if (browser && 'serviceWorker' in navigator) {
			navigator.serviceWorker.register('/service-worker.js').catch(() => {
				// Silent fail — service workers are optional
			});
		}
	});

	// Restore panel state from sessionStorage and set up keyboard shortcuts
	onMount(() => {
		if (browser) {
			const stored = sessionStorage.getItem('weave-task-panel-open');
			if (stored === 'true') showTaskPanel = true;

			// Initialize shortcuts
			shortcutManager = new ShortcutManager();

			shortcutManager.register({
				key: 't',
				modifiers: ['cmd'],
				handler: () => toggleTaskPanel(),
				description: 'Toggle task panel',
			});

			shortcutManager.register({
				key: 'k',
				modifiers: ['cmd'],
				handler: () => {
					const wasOpen = showTaskPanel;
					if (!wasOpen) toggleTaskPanel();
					// Delay event if panel just opened so TaskPanel has time to mount
					const dispatch = () => window.dispatchEvent(new CustomEvent('open-task-create-modal'));
					if (wasOpen) dispatch();
					else requestAnimationFrame(dispatch);
				},
				description: 'Open task create modal',
			});

			shortcutManager.register({
				key: '?',
				modifiers: ['shift'],
				handler: () => {
					showShortcutHelp = !showShortcutHelp;
				},
				description: 'Toggle shortcuts help',
			});

			shortcutManager.register({
				key: 'Escape',
				handler: () => {
					if (showShortcutHelp) showShortcutHelp = false;
				},
				description: 'Close help modal',
			});

			shortcutManager.attach();
		}
	});

	function refreshTaskList() {
		taskList = taskStore.getTasks();
	}

	function handleTaskEvent(event: TaskEvent) {
		if (!session || !connected) return;
		taskStore.applyEvent(event);
		refreshTaskList();
		session.sendTaskEvent(event);

		// Schedule/cancel reminders based on event
		if (event.type === 'task_created' || event.type === 'subtask_created') {
			const task = taskStore.getTask(event.taskId);
			if (task?.dueAt) {
				reminderScheduler.scheduleReminder(task);
				// Request notification permission on first task with due date
				if (browser && 'Notification' in window && Notification.permission === 'default') {
					Notification.requestPermission();
				}
			}
		} else if (event.type === 'task_status_changed' && event.task?.status === 'completed') {
			reminderScheduler.cancelReminder(event.taskId);
		}
	}

	function handleAutoAssign(events: TaskEvent[]) {
		for (const event of events) {
			handleTaskEvent(event);
		}
	}

	function toggleTaskPanel() {
		showTaskPanel = !showTaskPanel;
		if (browser) {
			sessionStorage.setItem('weave-task-panel-open', String(showTaskPanel));
		}
	}

	onMount(() => {
		// Show tab-close warning once
		const warned = sessionStorage.getItem('weave-key-warning-shown');
		if (!warned) {
			showKeyWarning = true;
		}
	});

	onDestroy(() => {
		session?.disconnect();
		taskStore.clear();
		reminderScheduler.clearAll();
		shortcutManager?.detach();
	});

	function dismissKeyWarning() {
		showKeyWarning = false;
		sessionStorage.setItem('weave-key-warning-shown', 'true');
	}

	async function joinRoom() {
		if (!displayName.trim()) return;
		phase = 'auth';
		error = '';

		try {
			// WebAuthn PRF ceremony: derive a device-bound seed for crypto identity.
			// In dev mode, skip WebAuthn — identity will be random per session.
			let prfSeed: Uint8Array | undefined;
			if (!import.meta.env.DEV) {
				const storedCred = getStoredCredentialId();
				let result;
				if (storedCred) {
					result = await assertWithPrf(storedCred);
				} else {
					result = await createCredential();
				}
				prfSeed = result.seed;
			}

			phase = 'connecting';

			// Create and connect room session
			const roomSession = new RoomSession(roomId, displayName.trim(), {
				prfSeed,
				isCreator,
			});

			roomSession.setMessageHandler((msg) => {
				// Process task events from decrypted messages
				if (msg.taskEvent) {
					taskStore.applyEvent(msg.taskEvent);
					refreshTaskList();
				}
				// Only show chat messages (non-empty text) in the message feed
				if (msg.plaintext || msg.decryptionFailed) {
					messages = [...messages, msg];
				}
				// Track last message times for agent recency weighting
				lastMessageTimes = new Map(roomSession.getLastMessageTimes());
			});

			roomSession.setMembersHandler((m) => {
				members = new Map(m);
			});

			roomSession.setErrorHandler((err) => {
				error = err;
				phase = 'error';
			});

			roomSession.setConnectionHandler((c) => {
				connected = c;
				if (c) {
					phase = 'connected';
				} else if (phase === 'connecting') {
					error = 'Could not connect to relay server. Make sure it is running (npm run relay).';
					phase = 'error';
				}
			});

			await roomSession.connect();
			session = roomSession;
		} catch (e) {
			if (e instanceof WebAuthnUnsupportedError) {
				error = e.message;
			} else {
				error = e instanceof Error ? e.message : 'Failed to join room';
			}
			phase = 'error';
		}
	}

	function sendMessage() {
		if (!messageInput.trim() || !session || !connected) return;

		// Intercept /task commands
		const parsed = parseTaskCommand(messageInput.trim(), session.getIdentityKey());
		if (parsed !== null) {
			if (parsed.error) {
				error = parsed.error;
				return;
			}
			for (const event of parsed.events) {
				handleTaskEvent(event);
			}
			messageInput = '';
			// Open the task panel to show the new task
			if (!showTaskPanel) toggleTaskPanel();
			return;
		}

		try {
			session.sendMessage(messageInput.trim());
			messageInput = '';
		} catch {
			// Send failed — connection may have dropped
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			sendMessage();
		}
	}

	async function copyRoomUrl() {
		try {
			await navigator.clipboard.writeText(roomUrl);
			copied = true;
			setTimeout(() => { copied = false; }, 2000);
		} catch {
			// Fallback
		}
	}

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}
</script>

<svelte:head>
	<title>Room — Weave.us</title>
</svelte:head>

<main>
	{#if showKeyWarning}
		<div class="warning-banner" role="alert">
			<p>Your encryption keys live only in this tab. If you close it, you'll need to rejoin.</p>
			<button onclick={dismissKeyWarning}>Got it</button>
		</div>
	{/if}

	{#if phase === 'name'}
		<div class="center-card">
			<h2>Join Room</h2>
			<p class="subtitle">Choose a display name for this session. It's not an account — just a label.</p>
			<input
				type="text"
				bind:value={displayName}
				placeholder="Your name"
				maxlength="32"
				onkeydown={(e) => e.key === 'Enter' && joinRoom()}
			/>
			<button onclick={joinRoom} disabled={!displayName.trim()} class="primary-btn">
				Join Securely
			</button>
			<p class="auth-note">You'll use your fingerprint or security key to create a secure identity.</p>
		</div>

	{:else if phase === 'auth'}
		<div class="center-card">
			<div class="spinner"></div>
			<p>Use your fingerprint to join securely</p>
			<p class="auth-note">Your identity is generated on this device. Nothing is sent to our servers.</p>
		</div>

	{:else if phase === 'connecting'}
		<div class="center-card">
			<div class="spinner"></div>
			<p>Establishing secure connection...</p>
		</div>

	{:else if phase === 'error'}
		<div class="center-card">
			<p class="error">{error}</p>
			<button onclick={() => { phase = 'name'; error = ''; }} class="primary-btn">Try Again</button>
			<a href="/" class="back-link">Back to homepage</a>
		</div>

	{:else if phase === 'connected'}
		{#if reminderNotice}
			<div class="reminder-toast" role="alert">
				<span>{reminderNotice}</span>
				<button onclick={() => { reminderNotice = ''; }} aria-label="Dismiss reminder">&times;</button>
			</div>
		{/if}

		{#if showShortcutHelp}
			<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
			<div class="shortcuts-help-backdrop" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts help" onkeydown={(e) => e.key === 'Escape' && (showShortcutHelp = false)} onclick={(e) => e.target === e.currentTarget && (showShortcutHelp = false)}>
				<div class="shortcuts-help-modal">
					<div class="shortcuts-help-header">
						<h3>Keyboard Shortcuts</h3>
						<button class="close-shortcuts-btn" onclick={() => { showShortcutHelp = false; }} aria-label="Close help">&times;</button>
					</div>
					<div class="shortcuts-help-list">
						{#if shortcutManager}
							{#each shortcutManager.getShortcuts() as shortcut}
								<div class="shortcut-row">
									<div class="shortcut-keys">
										{#each shortcut.modifiers || [] as modifier}
											<kbd class="shortcut-key">{modifier === 'cmd' ? '⌘' : modifier === 'ctrl' ? 'Ctrl' : modifier === 'shift' ? 'Shift' : 'Alt'}</kbd>
										{/each}
										<kbd class="shortcut-key">{shortcut.key === '?' ? 'Shift+?' : shortcut.key.toUpperCase()}</kbd>
									</div>
									<span class="shortcut-description">{shortcut.description}</span>
								</div>
							{/each}
						{/if}
					</div>
				</div>
			</div>
		{/if}

		<div class="room" class:panel-open={showTaskPanel}>
			<header>
				<div class="room-info">
					<h2>Room</h2>
					<span class="encryption-badge">&#128274; End-to-end encrypted</span>
				</div>
				<div class="room-meta">
					<button
						class="tasks-toggle"
						class:active={showTaskPanel}
						onclick={toggleTaskPanel}
						aria-label="Toggle task panel"
						aria-expanded={showTaskPanel}
					>
						Tasks{#if taskCount > 0} ({taskCount}){/if}
					</button>
					<button class="copy-link" onclick={copyRoomUrl}>
						{copied ? 'Copied!' : 'Copy Link'}
					</button>
					<span class="member-count">{members.size + 1} {members.size + 1 === 1 ? 'member' : 'members'}</span>
					<span class="connection-dot" class:online={connected}></span>
					<button class="theme-toggle-btn" onclick={toggleTheme} aria-label="Toggle light/dark mode" title="Toggle light/dark mode">
						{isDark() ? '\u2600' : '\u263E'}
					</button>
				</div>
			</header>

			<!-- Mobile tab bar (visible <768px when panel is open) -->
			{#if showTaskPanel}
				<div class="mobile-tabs" role="tablist" aria-label="Room sections">
					<button
						role="tab"
						aria-selected={mobileTab === 'messages'}
						class:active={mobileTab === 'messages'}
						onclick={() => { mobileTab = 'messages'; }}
					>Messages</button>
					<button
						role="tab"
						aria-selected={mobileTab === 'tasks'}
						class:active={mobileTab === 'tasks'}
						onclick={() => { mobileTab = 'tasks'; }}
					>Tasks{#if taskCount > 0} ({taskCount}){/if}</button>
				</div>
			{/if}

			<div class="room-body">
				<div class="messages-col" class:mobile-hidden={showTaskPanel && mobileTab === 'tasks'}>
					<div class="messages">
						{#if messages.length === 0}
							<p class="empty-hint">Share the link above to invite others. Only people with the link can join.</p>
						{/if}

						{#each messages as msg}
							<div class="message" class:own={msg.senderId === session?.getIdentityKey()} class:failed={msg.decryptionFailed}>
								{#if msg.decryptionFailed}
									<div class="msg-content undecryptable">Unable to decrypt this message</div>
								{:else}
									<div class="msg-header">
										<span class="sender-name">{msg.senderId === session?.getIdentityKey() ? 'You' : msg.senderName}</span>
										<span class="msg-time">{formatTime(msg.timestamp)}</span>
										<span class="msg-lock" title="Encrypted">&#128274;</span>
									</div>
									<div class="msg-content">{msg.plaintext}</div>
								{/if}
							</div>
						{/each}
					</div>

					<div class="composer">
						<input
							type="text"
							bind:value={messageInput}
							placeholder={connected ? "Type a message or /task..." : "Reconnecting..."}
							onkeydown={handleKeydown}
						/>
						<button onclick={sendMessage} disabled={!connected || !messageInput.trim()}>Send</button>
					</div>
				</div>

				{#if showTaskPanel}
					<div class="tasks-col" class:mobile-hidden={mobileTab === 'messages'}>
						<TaskPanel
							tasks={taskList}
							{members}
							myIdentityKey={session?.getIdentityKey() ?? ''}
							{lastMessageTimes}
							onTaskEvent={handleTaskEvent}
							onAutoAssign={handleAutoAssign}
							onClose={toggleTaskPanel}
						/>
					</div>
				{/if}
			</div>
		</div>
	{/if}
</main>

<style>
	main {
		font-family: system-ui, -apple-system, sans-serif;
		color: var(--text-primary);
		background: var(--bg-base);
		min-height: 100vh;
	}

	.warning-banner {
		background: var(--status-caution-bg);
		border-bottom: 1px solid var(--status-caution-border);
		padding: 0.75rem 1rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.85rem;
		color: var(--status-caution);
	}

	.warning-banner p { margin: 0; }
	.warning-banner button {
		background: none;
		border: 1px solid var(--status-caution-btn-border);
		color: var(--status-caution);
		padding: 0.25rem 0.75rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.8rem;
	}

	.center-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		text-align: center;
		max-width: 400px;
		margin: 0 auto;
		padding: 2rem;
	}

	.center-card h2 {
		font-weight: 400;
		margin: 0 0 0.5rem;
	}

	.subtitle {
		color: var(--text-secondary);
		font-size: 0.9rem;
		margin: 0 0 1.5rem;
	}

	.center-card input {
		width: 100%;
		padding: 0.75rem 1rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--text-primary);
		font-size: 1rem;
		margin-bottom: 1rem;
		outline: none;
	}

	.center-card input:focus {
		border-color: var(--border-strong);
	}

	.primary-btn {
		padding: 0.75rem 2rem;
		font-size: 1rem;
		color: var(--text-inverse);
		background: var(--btn-primary-bg);
		border: none;
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.15s;
	}

	.primary-btn:hover:not(:disabled) { background: var(--btn-primary-hover); }
	.primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.auth-note {
		color: var(--text-muted);
		font-size: 0.8rem;
		margin-top: 1rem;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid var(--border-default);
		border-top-color: var(--text-primary);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		margin-bottom: 1rem;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	.error {
		color: var(--status-error);
		margin-bottom: 1rem;
	}

	.back-link {
		color: var(--text-secondary);
		font-size: 0.85rem;
		margin-top: 1rem;
	}

	/* Room layout */
	.room {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}

	.room-info {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.room-info h2 {
		font-size: 1rem;
		font-weight: 500;
		margin: 0;
	}

	.encryption-badge {
		font-size: 0.75rem;
		color: var(--accent-default);
		background: var(--accent-muted);
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		border: 1px solid var(--accent-border);
	}

	.room-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.tasks-toggle {
		background: none;
		border: 1px solid var(--border-default);
		color: var(--btn-secondary-text);
		padding: 0.3rem 0.75rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.8rem;
	}

	.tasks-toggle:hover { border-color: var(--border-strong); color: var(--btn-secondary-hover-text); }
	.tasks-toggle.active { border-color: var(--accent-default); color: var(--accent-default); background: var(--accent-muted); }

	.copy-link {
		background: none;
		border: 1px solid var(--border-default);
		color: var(--btn-secondary-text);
		padding: 0.3rem 0.75rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.8rem;
	}

	.copy-link:hover { border-color: var(--border-strong); color: var(--btn-secondary-hover-text); }

	.member-count {
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.connection-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--text-muted);
	}

	.connection-dot.online { background: var(--accent-default); }

	.theme-toggle-btn {
		background: none;
		border: 1px solid var(--border-default);
		color: var(--text-secondary);
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.85rem;
		line-height: 1;
		padding: 0;
	}

	.theme-toggle-btn:hover { border-color: var(--border-strong); color: var(--text-primary); }

	/* Mobile tab bar */
	.mobile-tabs {
		display: none;
		border-bottom: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}

	.mobile-tabs button {
		flex: 1;
		padding: 0.5rem;
		background: none;
		border: none;
		border-bottom: 2px solid transparent;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 0.85rem;
	}

	.mobile-tabs button.active {
		color: var(--text-primary);
		border-bottom-color: var(--accent-default);
	}

	/* Room body: messages + optional task panel */
	.room-body {
		flex: 1;
		display: flex;
		overflow: hidden;
	}

	.messages-col {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.tasks-col {
		width: 40%;
		min-width: 280px;
		max-width: 420px;
		flex-shrink: 0;
	}

	/* Messages */
	.messages {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	/* Mobile layout */
	@media (max-width: 767px) {
		.mobile-tabs {
			display: flex;
		}

		.tasks-col {
			width: 100%;
			max-width: none;
		}

		.mobile-hidden {
			display: none;
		}
	}

	.empty-hint {
		color: var(--text-muted);
		text-align: center;
		margin-top: 2rem;
		font-size: 0.9rem;
	}

	.message {
		max-width: 70%;
		padding: 0.5rem 0.75rem;
		background: var(--bg-surface);
		border-radius: 8px;
	}

	.message.own {
		align-self: flex-end;
		background: var(--bg-raised);
	}

	.message.failed {
		background: var(--status-error-bg);
	}

	.msg-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.25rem;
	}

	.sender-name {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--btn-secondary-text);
	}

	.msg-time {
		font-size: 0.7rem;
		color: var(--text-muted);
	}

	.msg-lock {
		font-size: 0.65rem;
		opacity: 0.4;
	}

	.msg-content {
		font-size: 0.95rem;
		line-height: 1.4;
		word-break: break-word;
	}

	.undecryptable {
		color: var(--text-secondary);
		font-style: italic;
		font-size: 0.85rem;
	}

	/* Composer */
	.composer {
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--border-subtle);
		flex-shrink: 0;
	}

	.composer input {
		flex: 1;
		padding: 0.6rem 0.75rem;
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--text-primary);
		font-size: 0.95rem;
		outline: none;
	}

	.composer input:focus { border-color: var(--border-strong); }

	.composer button {
		padding: 0.6rem 1.25rem;
		background: var(--btn-primary-bg);
		color: var(--text-inverse);
		border: none;
		border-radius: 6px;
		font-weight: 500;
		cursor: pointer;
	}

	.composer button:hover:not(:disabled) { background: var(--btn-primary-hover); }
	.composer button:disabled { opacity: 0.4; cursor: not-allowed; }

	/* Reminder toast */
	.reminder-toast {
		position: fixed;
		top: 1rem;
		left: 50%;
		transform: translateX(-50%);
		background: var(--status-caution-bg);
		border: 1px solid var(--status-caution-border);
		color: var(--status-caution);
		padding: 0.6rem 1rem;
		border-radius: 6px;
		font-size: 0.85rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		z-index: 300;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
	}

	.reminder-toast button {
		background: none;
		border: none;
		color: var(--status-caution);
		cursor: pointer;
		font-size: 1.1rem;
		line-height: 1;
		padding: 0;
	}

	/* Shortcuts help modal */
	.shortcuts-help-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 200;
	}

	.shortcuts-help-modal {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		padding: 1.5rem;
		width: 100%;
		max-width: 480px;
		max-height: 80vh;
		overflow-y: auto;
	}

	.shortcuts-help-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 1.25rem;
		border-bottom: 1px solid var(--border-subtle);
		padding-bottom: 0.75rem;
	}

	.shortcuts-help-header h3 {
		margin: 0;
		font-weight: 500;
		font-size: 1.1rem;
	}

	.close-shortcuts-btn {
		background: none;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 1.2rem;
		padding: 0;
		line-height: 1;
	}

	.close-shortcuts-btn:hover {
		color: var(--text-primary);
	}

	.shortcuts-help-list {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.shortcut-row {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.shortcut-keys {
		display: flex;
		gap: 0.25rem;
		min-width: 120px;
		align-items: center;
	}

	.shortcut-key {
		background: var(--bg-raised);
		border: 1px solid var(--border-default);
		border-radius: 3px;
		padding: 0.3rem 0.5rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-primary);
		display: inline-block;
		min-width: 28px;
		text-align: center;
	}

	.shortcut-description {
		flex: 1;
		font-size: 0.9rem;
		color: var(--text-secondary);
	}
</style>
