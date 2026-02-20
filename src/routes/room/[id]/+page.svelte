<script lang="ts">
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { getRoomName } from '$lib/room/names';
	import { browser } from '$app/environment';
	import { RoomSession, type DecryptedMessage, type RoomMember } from '$lib/room/session';
	import { createCredential, assertWithPrf, getStoredCredentialId, WebAuthnUnsupportedError } from '$lib/webauthn/prf';
	import { isDark, toggleTheme } from '$lib/theme.svelte';
	import { createTaskStore } from '$lib/tasks/store.svelte';
	import { parseTaskCommand } from '$lib/tasks/parser';
	import { ReminderScheduler } from '$lib/tasks/reminders';
	import type { TaskEvent, Task } from '$lib/tasks/types';
	import TaskPanel from '$lib/components/TaskPanel.svelte';
	import AgentPanel from '$lib/components/AgentPanel.svelte';
	import CoachMarks from '$lib/components/CoachMarks.svelte';
	import { ShortcutManager } from '$lib/keyboard/shortcuts';
	import { AgentExecutor } from '$lib/agents/executor';
	import type { StoredAgentModule } from '$lib/agents/types';
	import {
		openModuleDB,
		listModules,
		deleteModule,
		setModuleActive,
	} from '$lib/agents/loader';
	import { getBuiltInAgents, isBuiltIn } from '$lib/agents/builtin';
	import BurnConfirmModal from '$lib/components/BurnConfirmModal.svelte';
	import AutoDeleteBanner from '$lib/components/AutoDeleteBanner.svelte';
	import EphemeralIndicator from '$lib/components/EphemeralIndicator.svelte';
	import InviteModal from '$lib/components/InviteModal.svelte';
	import SoloMemberBanner from '$lib/components/SoloMemberBanner.svelte';
	import { cleanupRoom } from '$lib/room/cleanup';
	import { autoDeleteKey } from '$lib/room/types';
	import type { AutoDeleteState } from '$lib/room/types';
	import PinSetup from '$lib/components/PinSetup.svelte';
	import PinEntry from '$lib/components/PinEntry.svelte';
	import type { PinState } from '$lib/pin/types';
	import { generatePinSalt, derivePinKey, derivePinKeyRaw, hashPinKey, verifyPin } from '$lib/pin/derive';
	import { storePinKey, loadPinKey, clearPinKey } from '$lib/pin/store';
	import { SessionGate } from '$lib/pin/gate';

	let roomId = $derived($page.params.id ?? '');
	let roomName = $derived(roomId ? getRoomName(roomId) : '');
	let isCreator = $derived($page.url.searchParams.has('create'));
	let isEphemeral = $derived($page.url.searchParams.has('ephemeral'));
	let session: RoomSession | null = $state(null);
	let messages: DecryptedMessage[] = $state([]);
	let members: Map<string, RoomMember> = $state(new Map());
	let connected = $state(false);
	let messageInput = $state('');
	let displayName = $state('');
	let phase: 'name' | 'auth' | 'connecting' | 'pin-setup' | 'connected' | 'error' = $state('name');
	let error = $state('');
	let showKeyWarning = $state(false);
	let roomUrl = $derived(browser ? `${window.location.origin}/room/${roomId}` : '');

	// PIN state
	let pinRequired = $derived($page.url.searchParams.has('pinRequired'));
	let pinTimeout = $derived(parseInt($page.url.searchParams.get('pinTimeout') ?? '15'));
	let pinState: PinState = $state({ status: 'unset' });
	let pinKey: CryptoKey | null = $state(null);
	let pinSalt: Uint8Array | null = $state(null);
	let pinKeyHash: Uint8Array | null = $state(null);
	let pinFailedAttempts = $state(0);
	let showPinSetup = $state(false);
	let prfSeedRef: Uint8Array | null = $state(null);
	let sessionGate: SessionGate | null = $state(null);

	// Task management
	const taskStore = createTaskStore();
	let taskList = $state<Task[]>([]);
	let showTaskPanel = $state(false);
	let mobileTab: 'messages' | 'tasks' | 'agents' = $state('messages');
	let taskCount = $derived(taskList.filter((t) => t.status !== 'completed').length);
	let lastMessageTimes = $state<Map<string, number>>(new Map());
	let reminderNotice = $state('');

	// Keyboard shortcuts
	let shortcutManager: ShortcutManager | null = null;
	let showShortcutHelp = $state(false);

	// Agent infrastructure
	let showAgentPanel = $state(false);
	let agentModules = $state<StoredAgentModule[]>([]);
	let agentExecutor: AgentExecutor | null = $state(null);
	let activeAgentIds = $state<string[]>([]);
	let agentPrfSeed: Uint8Array | undefined = undefined;
	let agentToast = $state('');

	// Invite modal
	let showRoomInfo = $state(false);
	let roomInfoPopoverEl: HTMLDivElement | undefined = $state();
	let roomInfoBtnEl: HTMLButtonElement | undefined = $state();
	let showInviteModal = $state(false);
	let inviteBannerDismissed = $state(false);
	let isSoloMember = $derived(members.size === 0);
	let coachMarksActive = $state(false);

	// M5 burn features
	let showBurnModal = $state(false);
	let autoDeleteExpiresAt = $state<number | null>(null);
	let autoDeleteCancelled = $state(false);
	let burnError = $state('');
	let roomDeleted = $state(false);

	// Reminder scheduler — fires 5 min before due, in-tab only
	const reminderScheduler = new ReminderScheduler((task) => {
		reminderNotice = `Reminder: "${task.title}" is due soon`;
		// Try browser Notification API
		if (browser && 'Notification' in window && Notification.permission === 'granted') {
			new Notification('Task Reminder', { body: 'A task is due soon — open Weave to view details' });
		}
		// Auto-dismiss after 8 seconds
		setTimeout(() => { if (reminderNotice) reminderNotice = ''; }, 8000);
	});

	// SvelteKit handles service worker registration automatically in production builds.
	// No manual registration needed — the SW from src/service-worker.ts is compiled
	// and served by the framework.

	// Restore panel state from sessionStorage and set up keyboard shortcuts
	onMount(() => {
		if (browser) {
			const stored = sessionStorage.getItem('weave-task-panel-open');
			showTaskPanel = stored !== 'false';

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
		// Keep agent executor context in sync
		if (agentExecutor) {
			agentExecutor.updateContext(taskList, members);
		}
	}

	function handleTaskEvent(event: TaskEvent) {
		if (!session || !connected) return;
		taskStore.applyEvent(event);
		refreshTaskList();
		session.sendTaskEvent(event);

		// Dispatch to active agents (they may react to task changes)
		agentExecutor?.dispatchTaskEvent(event);

		// Schedule/cancel reminders based on event (skip for ephemeral rooms)
		if (!session?.getEphemeralMode()) {
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

	function toggleAgentPanel() {
		showAgentPanel = !showAgentPanel;
	}

	async function refreshAgentModules() {
		try {
			const db = await openModuleDB();
			agentModules = await listModules(db, roomId);
			db.close();
		} catch {
			// Silent fail — IndexedDB may be unavailable
		}
	}

	async function initAgentExecutor(prfSeed?: Uint8Array) {
		agentPrfSeed = prfSeed;
		agentExecutor = new AgentExecutor(roomId, prfSeed ?? null, (event) => {
			// Agent-emitted events flow through the same E2EE path
			handleTaskEvent(event);
		});
		await refreshAgentModules();

		// Load built-in agents and merge with user-uploaded
		const builtIns = await getBuiltInAgents(roomId);
		for (const builtin of builtIns) {
			// Check localStorage for explicit disable; default is active
			const key = `weave-agent-disabled:${builtin.id}`;
			const disabled = browser && localStorage.getItem(key) === 'true';
			builtin.active = !disabled;
			// Add to modules list if not already present
			if (!agentModules.some((m) => m.id === builtin.id)) {
				agentModules = [...agentModules, builtin];
			}
		}

		// Auto-activate previously active agents
		for (const mod of agentModules) {
			if (mod.active) {
				try {
					await agentExecutor.activate(mod);
				} catch {
					// Failed to activate — skip
				}
			}
		}
		activeAgentIds = agentExecutor.getActiveAgents();

		// First-run toast: show once per browser when built-in agent activates
		if (browser && builtIns.length > 0 && activeAgentIds.some((id) => isBuiltIn(id))) {
			const toastKey = 'weave-agent-first-run-shown';
			if (!localStorage.getItem(toastKey)) {
				localStorage.setItem(toastKey, 'true');
				agentToast = 'Auto-balance agent is active. It assigns unassigned tasks to the least-busy member every 30s. You can disable it in the Automation panel.';
				setTimeout(() => { agentToast = ''; }, 10000);
			}
		}
	}

	async function handleAgentActivate(moduleId: string) {
		if (!agentExecutor) return;
		const mod = agentModules.find((m) => m.id === moduleId);
		if (!mod) return;

		try {
			await agentExecutor.activate(mod);
			if (isBuiltIn(moduleId)) {
				// Built-ins: remove disable flag from localStorage
				localStorage.removeItem(`weave-agent-disabled:${moduleId}`);
			} else {
				const db = await openModuleDB();
				await setModuleActive(db, moduleId, true);
				db.close();
			}
			activeAgentIds = agentExecutor.getActiveAgents();
		} catch (e) {
			error = `Failed to activate agent: ${e instanceof Error ? e.message : String(e)}`;
		}
	}

	async function handleAgentDeactivate(moduleId: string) {
		if (!agentExecutor) return;

		await agentExecutor.deactivate(moduleId);
		if (isBuiltIn(moduleId)) {
			// Built-ins: set disable flag in localStorage
			localStorage.setItem(`weave-agent-disabled:${moduleId}`, 'true');
		} else {
			const db = await openModuleDB();
			await setModuleActive(db, moduleId, false);
			db.close();
		}
		activeAgentIds = agentExecutor.getActiveAgents();
	}

	async function handleAgentDelete(moduleId: string) {
		// Built-in agents cannot be deleted
		if (isBuiltIn(moduleId)) return;

		// Deactivate first if active
		if (agentExecutor?.isActive(moduleId)) {
			await agentExecutor.deactivate(moduleId);
		}

		const db = await openModuleDB();
		await deleteModule(db, moduleId);
		db.close();
		await refreshAgentModules();
		activeAgentIds = agentExecutor?.getActiveAgents() ?? [];
	}

	onMount(() => {
		// Show tab-close warning once
		const warned = sessionStorage.getItem('weave-key-warning-shown');
		if (!warned) {
			showKeyWarning = true;
		}

		// Restore invite banner dismissed state
		if (browser) {
			const dismissed = sessionStorage.getItem(`weave-invite-dismissed:${roomId}`);
			if (dismissed === 'true') inviteBannerDismissed = true;
		}

		// Check for existing auto-delete state
		if (browser) {
			const stored = sessionStorage.getItem(autoDeleteKey(roomId));
			if (stored) {
				try {
					const state: AutoDeleteState = JSON.parse(stored);
					if (!state.cancelled) {
						if (state.expiresAt < Date.now()) {
							// Expired while away — trigger cleanup
							if (session) {
								cleanupRoom(roomId, session);
							}
							window.location.href = '/?deleted=auto';
						} else {
							autoDeleteExpiresAt = state.expiresAt;
						}
					}
				} catch {
					// ignore invalid stored state
				}
			}
		}
	});

	onDestroy(() => {
		session?.disconnect();
		taskStore.clear();
		reminderScheduler.clearAll();
		shortcutManager?.detach();
		agentExecutor?.shutdown();
		sessionGate?.stop();
	});

	async function handlePinCreate(pin: string) {
		const salt = generatePinSalt();
		const key = await derivePinKey(pin, salt);
		const rawKey = await derivePinKeyRaw(pin, salt);
		const hash = await hashPinKey(rawKey);

		if (prfSeedRef) {
			await storePinKey(roomId, key, salt, hash, prfSeedRef);
		}

		pinKey = key;
		pinSalt = salt;
		pinKeyHash = hash;
		pinState = { status: 'set' };
		showPinSetup = false;
		phase = 'connected';
		startSessionGate();
	}

	async function handlePinVerify(pin: string) {
		if (!pinSalt || !pinKeyHash) return;
		const key = await verifyPin(pin, pinSalt, pinKeyHash);
		if (key) {
			pinKey = key;
			pinState = { status: 'set' };
			pinFailedAttempts = 0;
			session?.unlockSession();
			sessionGate?.unlock();
		} else {
			pinFailedAttempts += 1;
		}
	}

	function handlePinLockout() {
		pinState = { status: 'cleared' };
		session?.disconnect();
		if (prfSeedRef) clearPinKey(roomId);
		sessionGate?.stop();
		window.location.href = '/';
	}

	function startSessionGate() {
		if (!pinRequired) return;
		sessionGate = new SessionGate(pinTimeout, {
			onLock: () => {
				pinState = { status: 'locked', failedAttempts: 0 };
				session?.lockSession();
			},
			onLockout: () => {
				handlePinLockout();
			},
		});
		sessionGate.start();
	}

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
			if (import.meta.env.DEV) {
				// Dev mode: use a deterministic seed so PIN flow works for testing
				const encoder = new TextEncoder();
				const seedMaterial = await crypto.subtle.digest('SHA-256', encoder.encode(`dev-prf-seed-${roomId}`));
				prfSeed = new Uint8Array(seedMaterial);
			} else {
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
				ephemeral: isEphemeral,
			});

			roomSession.setMessageHandler((msg) => {
				// Process task events from decrypted messages
				if (msg.taskEvent) {
					taskStore.applyEvent(msg.taskEvent);
					refreshTaskList();
					// Dispatch remote task events to active agents
					agentExecutor?.dispatchTaskEvent(msg.taskEvent);
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
				if (err === 'This room has been deleted.') {
					roomDeleted = true;
					cleanupRoom(roomId, roomSession);
					setTimeout(() => { window.location.href = '/?deleted=true'; }, 3000);
					return;
				}
				error = err;
				phase = 'error';
			});

			roomSession.setConnectionHandler((c) => {
				connected = c;
				if (!c && phase === 'connecting') {
					error = 'Could not connect to relay server. Make sure it is running (npm run relay).';
					phase = 'error';
				}
			});

			await roomSession.connect();
			session = roomSession;

			// Initialize agent executor after room connection
			await initAgentExecutor(prfSeed);

			// Store PRF seed for PIN key storage
			prfSeedRef = prfSeed ?? null;

			// PIN setup: check if PIN is required
			if (pinRequired) {
				// Try to load existing PIN key
				if (prfSeed) {
					const storedPin = await loadPinKey(roomId, prfSeed);
					if (storedPin) {
						pinKey = storedPin.pinKey;
						pinSalt = storedPin.salt;
						pinKeyHash = storedPin.keyHash;
						pinState = { status: 'set' };
						phase = 'connected';
						startSessionGate();
					} else {
						// No stored PIN key, show setup
						showPinSetup = true;
						phase = 'pin-setup';
					}
				} else {
					// Dev mode, no PRF seed — skip PIN setup
					phase = 'connected';
				}
			} else {
				// PIN not required, proceed to connected
				phase = 'connected';
			}
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

		// Intercept /rotate command (creator-only, PIN-protected rooms)
		if (messageInput.trim() === '/rotate') {
			if (!session?.getIsCreator()) {
				error = 'Only the room creator can rotate encryption keys.';
				messageInput = '';
				return;
			}
			if (!pinRequired) {
				error = 'Key rotation is only available in PIN-protected rooms.';
				messageInput = '';
				return;
			}
			try {
				session.rotateGroupSession();
				messageInput = '';
			} catch {
				error = 'Failed to rotate encryption keys.';
			}
			return;
		}

		// Intercept /burn command
		if (messageInput.trim() === '/burn') {
			showBurnModal = true;
			messageInput = '';
			return;
		}

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

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}

	async function handleBurnConfirm() {
		showBurnModal = false;
		burnError = '';
		try {
			if (session) {
				await session.sendPurgeRequest();
				await cleanupRoom(roomId, session);
			}
			window.location.href = '/?deleted=true';
		} catch (e: unknown) {
			burnError = e instanceof Error ? e.message : 'Failed to delete room';
		}
	}

	function handleKeepRoom() {
		autoDeleteExpiresAt = null;
		autoDeleteCancelled = true;
		if (browser) {
			sessionStorage.setItem(autoDeleteKey(roomId), JSON.stringify({ expiresAt: 0, cancelled: true }));
		}
	}

	async function handleDeleteNow() {
		burnError = '';
		try {
			if (session) {
				await session.sendPurgeRequest();
				await cleanupRoom(roomId, session);
			}
			window.location.href = '/?deleted=auto';
		} catch (e: unknown) {
			burnError = e instanceof Error ? e.message : 'Failed to delete room';
		}
	}

	// Auto-delete detection: when all tasks are complete, start 24h countdown
	$effect(() => {
		if (!browser || taskList.length === 0) return;
		const allComplete = taskList.every(t => t.status === 'completed');

		if (allComplete && !autoDeleteExpiresAt && !autoDeleteCancelled) {
			// Start 24h countdown
			const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
			autoDeleteExpiresAt = expiresAt;
			sessionStorage.setItem(autoDeleteKey(roomId), JSON.stringify({ expiresAt, cancelled: false }));
		} else if (!allComplete && (autoDeleteExpiresAt || autoDeleteCancelled)) {
			// Tasks were un-completed, reset auto-delete state
			autoDeleteExpiresAt = null;
			autoDeleteCancelled = false;
			sessionStorage.removeItem(autoDeleteKey(roomId));
		}
	});
</script>

<svelte:head>
	<title>{roomName || 'Room'} — weaveto.do</title>
</svelte:head>

<svelte:window
	onkeydown={(e) => {
		if (e.key === 'Escape' && showRoomInfo) { roomInfoPopoverEl?.hidePopover(); showRoomInfo = false; }
	}}
/>

<main>
	{#if showKeyWarning && phase !== 'connected' && phase !== 'error'}
		<div class="warning-banner" role="alert">
			<p>Your encryption keys live only in this tab. If you close it, you'll need to rejoin.</p>
			<button onclick={dismissKeyWarning}>Got it</button>
		</div>
	{/if}

	{#if phase === 'name'}
		<div class="center-card">
			<h2>Join Room</h2>
			{#if roomName}<p class="room-name-label">{roomName}</p>{/if}
			<p class="subtitle">You've been invited to a private, encrypted room. Pick a name so others know who you are.</p>
			<input
				type="text"
				bind:value={displayName}
				placeholder="What should we call you?"
				maxlength="32"
				onkeydown={(e) => e.key === 'Enter' && joinRoom()}
			/>
			<button onclick={joinRoom} disabled={!displayName.trim()} class="primary-btn">
				Join Securely
			</button>
			<p class="auth-note">We'll use your device to generate an encryption key. No account, no password, nothing stored.</p>
		</div>

	{:else if phase === 'auth'}
		<div class="center-card">
			<div class="spinner"></div>
			<p>Confirm with your device to join securely</p>
			<p class="auth-note">This generates your encryption key. Nothing leaves your device.</p>
		</div>

	{:else if phase === 'connecting'}
		<div class="center-card">
			<div class="spinner"></div>
			<p>Establishing secure connection...</p>
		</div>

	{:else if phase === 'pin-setup'}
		<PinSetup
			oncreate={handlePinCreate}
			oncancel={() => { session?.disconnect(); phase = 'name'; }}
		/>

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

		{#if agentToast}
			<div class="agent-toast" role="status">
				<span>{agentToast}</span>
				<button onclick={() => { agentToast = ''; }} aria-label="Dismiss">&times;</button>
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
			{#if showKeyWarning && !coachMarksActive}
				<div class="warning-banner" role="alert">
					<p>Your encryption keys live only in this tab. If you close it, you'll need to rejoin.</p>
					<button onclick={dismissKeyWarning}>Got it</button>
				</div>
			{/if}
			<header>
				<div class="room-info">
					<h2>{roomName || 'Room'}</h2>
					<span class="encryption-badge">&#128274; End-to-end encrypted</span>
					{#if pinRequired || pinState.status === 'set'}
						<span class="shield-badge" title="PIN-protected room">&#128737; PIN protected</span>
					{/if}
					{#if session?.getEphemeralMode()}
						<EphemeralIndicator memberCount={members.size + 1} />
					{/if}
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
					<button
						class="agents-toggle"
						class:active={showAgentPanel}
						onclick={toggleAgentPanel}
						aria-label="Toggle agent panel"
						aria-expanded={showAgentPanel}
					>
						Automation{#if activeAgentIds.length > 0} ({activeAgentIds.length}){/if}
					</button>
					<button class="invite-btn" onclick={() => { showInviteModal = true; }}>
						Invite
					</button>
					<div class="room-info-dropdown-wrapper">
						<button
							bind:this={roomInfoBtnEl}
							class="room-info-btn"
							onclick={() => {
								if (roomInfoPopoverEl) {
									if (showRoomInfo) {
										roomInfoPopoverEl.hidePopover();
										showRoomInfo = false;
									} else {
										if (roomInfoBtnEl) {
											const rect = roomInfoBtnEl.getBoundingClientRect();
											roomInfoPopoverEl.style.top = (rect.bottom + 4) + 'px';
											roomInfoPopoverEl.style.right = (window.innerWidth - rect.right) + 'px';
										}
										roomInfoPopoverEl.showPopover();
										showRoomInfo = true;
									}
								}
							}}
							onkeydown={(e) => { if (e.key === 'Escape' && showRoomInfo) { showRoomInfo = false; roomInfoPopoverEl?.hidePopover(); e.stopPropagation(); } }}
							aria-expanded={showRoomInfo}
							aria-label="Room info"
						>
							<span
								class="connection-dot"
								class:online={connected}
							></span>
							{members.size + 1}
						</button>
					</div>
				</div>
			</header>

			<!-- Mobile tab bar (visible <768px when panel is open) -->
			{#if showTaskPanel || showAgentPanel}
				<div class="mobile-tabs" role="tablist" aria-label="Room sections">
					<button
						role="tab"
						aria-selected={mobileTab === 'messages'}
						class:active={mobileTab === 'messages'}
						onclick={() => { mobileTab = 'messages'; }}
					>Messages</button>
					{#if showTaskPanel}
						<button
							role="tab"
							aria-selected={mobileTab === 'tasks'}
							class:active={mobileTab === 'tasks'}
							onclick={() => { mobileTab = 'tasks'; }}
						>Tasks{#if taskCount > 0} ({taskCount}){/if}</button>
					{/if}
					{#if showAgentPanel}
						<button
							role="tab"
							aria-selected={mobileTab === 'agents'}
							class:active={mobileTab === 'agents'}
							onclick={() => { mobileTab = 'agents'; }}
						>Automation</button>
					{/if}
				</div>
			{/if}


			{#if autoDeleteExpiresAt}
				<div class="auto-delete-container">
					<AutoDeleteBanner
						expiresAt={autoDeleteExpiresAt}
						isCreator={session?.getIsCreator() ?? false}
						onKeepRoom={handleKeepRoom}
						onDeleteNow={handleDeleteNow}
					/>
				</div>
			{/if}

			{#if isSoloMember && !inviteBannerDismissed && !coachMarksActive}
				<div class="invite-banner-container">
					<SoloMemberBanner
						onInvite={() => { showInviteModal = true; }}
						onDismiss={() => {
							inviteBannerDismissed = true;
							if (browser) {
								sessionStorage.setItem(`weave-invite-dismissed:${roomId}`, 'true');
							}
						}}
					/>
				</div>
			{/if}

			<div class="room-body">
				<div class="messages-col" class:mobile-hidden={(showTaskPanel && mobileTab === 'tasks') || (showAgentPanel && mobileTab === 'agents')}>
					<div class="messages">
						{#if messages.length === 0}
							<p class="empty-hint">This room is end-to-end encrypted. Click Invite to share it.</p>
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
					<div class="tasks-col" class:mobile-hidden={mobileTab !== 'tasks'}>
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

				{#if showAgentPanel}
					<div class="agents-col" class:mobile-hidden={mobileTab !== 'agents'}>
						<AgentPanel
							modules={agentModules}
							activeAgents={activeAgentIds}
							onActivate={handleAgentActivate}
							onDeactivate={handleAgentDeactivate}
							onDelete={handleAgentDelete}
							onClose={toggleAgentPanel}
						/>
					</div>
				{/if}
			</div>
		</div>

		{#if pinState.status === 'locked'}
			<PinEntry
				onverify={handlePinVerify}
				onlockout={handlePinLockout}
				failedAttempts={pinFailedAttempts}
			/>
		{/if}

		{#if showBurnModal}
			<BurnConfirmModal onConfirm={handleBurnConfirm} onCancel={() => { showBurnModal = false; }} />
		{/if}

		{#if showInviteModal}
			<InviteModal
				{roomUrl}
				{members}
				myIdentityKey={session?.getIdentityKey() ?? ''}
				{displayName}
				onClose={() => { showInviteModal = false; }}
			/>
		{/if}

		{#if roomDeleted}
			<div class="modal-backdrop" role="dialog" aria-modal="true" aria-label="Room deleted">
				<div class="modal-content">
					<h3>Room Deleted</h3>
					<p>This room has been deleted by the creator. You will be redirected shortly.</p>
				</div>
			</div>
		{/if}

		{#if burnError}
			<div class="burn-error" role="alert">{burnError}</div>
		{/if}

		<CoachMarks bind:active={coachMarksActive} />
	{/if}

</main>

<div
	bind:this={roomInfoPopoverEl}
	class="room-info-popover"
	role="menu"
	popover="auto"
	ontoggle={(e) => { if (e.newState === 'closed') showRoomInfo = false; }}
>
	<div class="dropdown-header">
		<span class="dropdown-title">Room info</span>
		<button class="dropdown-close" onclick={() => { roomInfoPopoverEl?.hidePopover(); }} aria-label="Close room info">&times;</button>
	</div>
	<div class="dropdown-item info-item">
		<span class="connection-dot" class:online={connected}></span>
		<span>{connected ? 'Connected' : 'Reconnecting...'}</span>
	</div>
	<div class="dropdown-item info-item">
		<span>{members.size + 1} {members.size + 1 === 1 ? 'member' : 'members'}</span>
	</div>
	{#if displayName}
		<div class="dropdown-item info-item">
			<span>You: {displayName}</span>
		</div>
	{/if}
	<div class="dropdown-item">
		<button class="dropdown-action" onclick={toggleTheme} aria-label="Toggle light/dark mode">
			{isDark() ? '\u2600 Light mode' : '\u263E Dark mode'}
			</button>
	</div>
</div>

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
		flex-shrink: 0;
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

	.room-name-label {
		font-size: 1.1rem;
		font-weight: 500;
		color: var(--accent-default);
		margin: 0.25rem 0 0.75rem;
		letter-spacing: 0.02em;
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

	header button:focus-visible,
	.room-info-btn:focus-visible,
	.room-info-popover .dropdown-action:focus-visible {
		outline: 2px solid var(--accent-default);
		outline-offset: 2px;
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

	.shield-badge {
		font-size: 0.75rem;
		color: var(--status-success);
		background: var(--status-success-bg);
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		border: 1px solid var(--status-success-border);
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

	.agents-toggle {
		background: none;
		border: 1px solid var(--border-default);
		color: var(--btn-secondary-text);
		padding: 0.3rem 0.75rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.8rem;
	}

	.agents-toggle:hover { border-color: var(--border-strong); color: var(--btn-secondary-hover-text); }
	.agents-toggle.active { border-color: var(--accent-default); color: var(--accent-default); background: var(--accent-muted); }

	.invite-btn {
		background: var(--accent-default);
		border: none;
		color: var(--text-inverse);
		padding: 0.3rem 0.75rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.8rem;
		font-weight: 500;
	}

	.invite-btn:hover { background: var(--accent-strong); }

	.connection-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: transparent;
		border: 2px solid var(--text-muted);
		box-sizing: border-box;
	}

	.connection-dot.online {
		background: var(--accent-default);
		border-color: var(--accent-default);
		animation: pulse 2s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}

.room-info-dropdown-wrapper {
		position: relative;
	}

	.room-info-btn {
		background: none;
		border: 1px solid var(--border-default);
		color: var(--btn-secondary-text);
		padding: 0.3rem 0.75rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.8rem;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.room-info-btn:hover { border-color: var(--border-strong); color: var(--btn-secondary-hover-text); }

	.room-info-popover {
		position: fixed;
		margin: 0;
		padding: 0.25rem 0;
		border: 1px solid var(--border-default);
		border-radius: 6px;
		background: var(--bg-surface);
		box-shadow: 0 4px 12px rgba(0,0,0,0.15);
		min-width: 180px;
		inset: auto;
	}

	.dropdown-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0.4rem 0.75rem;
		border-bottom: 1px solid var(--border-subtle);
		margin-bottom: 0.25rem;
	}

	.dropdown-title {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.dropdown-close {
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		font-size: 1.1rem;
		padding: 0;
		line-height: 1;
	}

	.dropdown-close:hover { color: var(--text-primary); }

	.dropdown-item {
		padding: 0.5rem 0.75rem;
	}

	.dropdown-item.info-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.8rem;
		color: var(--text-secondary);
	}

	.dropdown-action {
		background: none;
		border: none;
		color: var(--text-primary);
		cursor: pointer;
		font-size: 0.8rem;
		padding: 0;
		width: 100%;
		text-align: left;
	}

	.dropdown-action:hover { color: var(--accent-default); }

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

	.agents-col {
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

		.tasks-col,
		.agents-col {
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

	/* Agent first-run toast */
	.agent-toast {
		position: fixed;
		bottom: 1rem;
		left: 50%;
		transform: translateX(-50%);
		background: var(--accent-muted);
		border: 1px solid var(--accent-border);
		color: var(--text-primary);
		padding: 0.6rem 1rem;
		border-radius: 6px;
		font-size: 0.85rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		z-index: 300;
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
		max-width: 500px;
	}

	.agent-toast button {
		background: none;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 1.1rem;
		line-height: 1;
		padding: 0;
		flex-shrink: 0;
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

	/* Auto-delete banner container */
	.auto-delete-container {
		padding: 0 1rem;
		flex-shrink: 0;
	}

	/* Invite banner container */
	.invite-banner-container {
		padding: 0 1rem;
		flex-shrink: 0;
	}

	/* Burn error toast */
	.burn-error {
		position: fixed;
		bottom: 1rem;
		left: 50%;
		transform: translateX(-50%);
		background: var(--status-urgent-bg);
		color: var(--status-urgent);
		border: 1px solid var(--status-urgent);
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-size: 0.85rem;
		z-index: 300;
	}

	/* Room deleted modal (reusing modal styles from BurnConfirmModal) */
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 200;
	}

	.modal-content {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		padding: 1.5rem;
		width: 100%;
		max-width: 420px;
		text-align: center;
	}

	.modal-content h3 {
		margin: 0 0 1rem;
		font-weight: 500;
		font-size: 1.1rem;
		color: var(--text-heading);
	}

	.modal-content p {
		margin: 0;
		color: var(--text-secondary);
		line-height: 1.4;
	}

</style>
