<script lang="ts">
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { RoomSession, type DecryptedMessage, type RoomMember } from '$lib/room/session';
	import { createCredential, assertWithPrf, getStoredCredentialId, WebAuthnUnsupportedError } from '$lib/webauthn/prf';

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

	onMount(() => {
		// Show tab-close warning once
		const warned = sessionStorage.getItem('weave-key-warning-shown');
		if (!warned) {
			showKeyWarning = true;
		}
	});

	onDestroy(() => {
		session?.disconnect();
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
				messages = [...messages, msg];
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
		<div class="room">
			<header>
				<div class="room-info">
					<h2>Room</h2>
					<span class="encryption-badge">&#128274; End-to-end encrypted</span>
				</div>
				<div class="room-meta">
					<button class="copy-link" onclick={copyRoomUrl}>
						{copied ? 'Copied!' : 'Copy Link'}
					</button>
					<span class="member-count">{members.size + 1} {members.size + 1 === 1 ? 'member' : 'members'}</span>
					<span class="connection-dot" class:online={connected}></span>
				</div>
			</header>

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
					placeholder={connected ? "Type a message..." : "Reconnecting..."}
					onkeydown={handleKeydown}
				/>
				<button onclick={sendMessage} disabled={!connected || !messageInput.trim()}>Send</button>
			</div>
		</div>
	{/if}
</main>

<style>
	main {
		font-family: system-ui, -apple-system, sans-serif;
		color: #e0e0e0;
		background: #0a0a0a;
		min-height: 100vh;
	}

	.warning-banner {
		background: #1a1a00;
		border-bottom: 1px solid #444400;
		padding: 0.75rem 1rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 0.85rem;
		color: #cccc66;
	}

	.warning-banner p { margin: 0; }
	.warning-banner button {
		background: none;
		border: 1px solid #666600;
		color: #cccc66;
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
		color: #888;
		font-size: 0.9rem;
		margin: 0 0 1.5rem;
	}

	.center-card input {
		width: 100%;
		padding: 0.75rem 1rem;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 6px;
		color: #e0e0e0;
		font-size: 1rem;
		margin-bottom: 1rem;
		outline: none;
	}

	.center-card input:focus {
		border-color: #555;
	}

	.primary-btn {
		padding: 0.75rem 2rem;
		font-size: 1rem;
		color: #0a0a0a;
		background: #e0e0e0;
		border: none;
		border-radius: 6px;
		cursor: pointer;
		transition: background 0.15s;
	}

	.primary-btn:hover:not(:disabled) { background: #ffffff; }
	.primary-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.auth-note {
		color: #666;
		font-size: 0.8rem;
		margin-top: 1rem;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid #333;
		border-top-color: #e0e0e0;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		margin-bottom: 1rem;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	.error {
		color: #e55;
		margin-bottom: 1rem;
	}

	.back-link {
		color: #888;
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
		border-bottom: 1px solid #1a1a1a;
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
		color: #6a6;
		background: #0a1a0a;
		padding: 0.2rem 0.5rem;
		border-radius: 4px;
		border: 1px solid #1a3a1a;
	}

	.room-meta {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}

	.copy-link {
		background: none;
		border: 1px solid #333;
		color: #aaa;
		padding: 0.3rem 0.75rem;
		border-radius: 4px;
		cursor: pointer;
		font-size: 0.8rem;
	}

	.copy-link:hover { border-color: #555; color: #e0e0e0; }

	.member-count {
		font-size: 0.8rem;
		color: #888;
	}

	.connection-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #555;
	}

	.connection-dot.online { background: #6a6; }

	/* Messages */
	.messages {
		flex: 1;
		overflow-y: auto;
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.empty-hint {
		color: #555;
		text-align: center;
		margin-top: 2rem;
		font-size: 0.9rem;
	}

	.message {
		max-width: 70%;
		padding: 0.5rem 0.75rem;
		background: #1a1a1a;
		border-radius: 8px;
	}

	.message.own {
		align-self: flex-end;
		background: #1a1a2a;
	}

	.message.failed {
		background: #1a1010;
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
		color: #aaa;
	}

	.msg-time {
		font-size: 0.7rem;
		color: #555;
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
		color: #888;
		font-style: italic;
		font-size: 0.85rem;
	}

	/* Composer */
	.composer {
		display: flex;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-top: 1px solid #1a1a1a;
		flex-shrink: 0;
	}

	.composer input {
		flex: 1;
		padding: 0.6rem 0.75rem;
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 6px;
		color: #e0e0e0;
		font-size: 0.95rem;
		outline: none;
	}

	.composer input:focus { border-color: #555; }

	.composer button {
		padding: 0.6rem 1.25rem;
		background: #e0e0e0;
		color: #0a0a0a;
		border: none;
		border-radius: 6px;
		font-weight: 500;
		cursor: pointer;
	}

	.composer button:hover:not(:disabled) { background: #ffffff; }
	.composer button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
