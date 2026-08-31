<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { isWebAuthnSupported } from '$lib/webauthn/prf';
	import PinPolicyToggle from '$lib/components/PinPolicyToggle.svelte';
	import { DEFAULT_PIN_POLICY } from '$lib/pin/types';
	import type { PinPolicy } from '$lib/pin/types';

	let webauthnSupported = $state(true);
	let creating = $state(false);
	let error = $state('');
	let ephemeralMode = $state(false);
	let showDeletedNotice = $state(false);
	let deletedReason = $state('');
	let pinPolicy: PinPolicy = $state({ ...DEFAULT_PIN_POLICY });

	$effect(() => {
		if (browser) {
			// When WebAuthn is bypassed the app derives a random seed instead and
			// works without it, so gating the only entry point on API presence
			// turned users away from a flow that would have worked. Browsers
			// without PublicKeyCredential — headless WebKit among them — saw the
			// unsupported notice and no way to create a room at all.
			const bypassed =
				import.meta.env.DEV || import.meta.env.VITE_WEBAUTHN_BYPASS === 'true';
			webauthnSupported = bypassed || isWebAuthnSupported();
		}
	});

	onMount(() => {
		const params = new URLSearchParams(window.location.search);
		const deleted = params.get('deleted');
		if (deleted) {
			showDeletedNotice = true;
			deletedReason = deleted === 'auto' ? 'Room auto-deleted after completion' : 'Room deleted';
			// Clean URL
			window.history.replaceState({}, '', '/');
			setTimeout(() => {
				showDeletedNotice = false;
			}, 5000);
		}
	});

	async function createRoom() {
		if (creating) return;
		creating = true;
		error = '';

		try {
			// Generate a cryptographically random room ID
			const bytes = crypto.getRandomValues(new Uint8Array(16));
			const roomId = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');

			let params = '?create=1';
			if (ephemeralMode) params += '&ephemeral=true';
			if (pinPolicy.required) params += `&pinRequired=true&pinTimeout=${pinPolicy.inactivityTimeout}`;
			await goto(`/room/${roomId}${params}`);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create room';
			creating = false;
		}
	}
</script>

<svelte:head>
	<title>weaveto.do — Private Task Coordination</title>
</svelte:head>

{#if showDeletedNotice}
	<div class="deleted-notice" role="status">
		<span>{deletedReason}</span>
		<button onclick={() => (showDeletedNotice = false)} aria-label="Dismiss">&times;</button>
	</div>
{/if}

<main>
	<div class="hero">
		<h1 class="brand">weave<span class="brand-accent">to.do</span></h1>
		<p class="tagline">Private, encrypted coordination. No accounts. No tracking.</p>

		{#if webauthnSupported}
			<button onclick={createRoom} disabled={creating} class="create-btn">
				{creating ? 'Creating...' : 'New Room'}
			</button>

			<div class="room-mode-group" role="radiogroup" aria-label="Room mode">
				<div class="room-mode-option">
					<input
						type="radio"
						id="mode-standard"
						name="roomMode"
						value="standard"
						checked={!ephemeralMode}
						onchange={() => (ephemeralMode = false)}
					/>
					<label for="mode-standard" class="mode-label">
						<span class="mode-title">Standard</span>
						<span class="mode-description">Tasks persist until completed or deleted. Best for ongoing projects.</span>
					</label>
				</div>

				<div class="room-mode-option">
					<input
						type="radio"
						id="mode-ephemeral"
						name="roomMode"
						value="ephemeral"
						checked={ephemeralMode}
						onchange={() => (ephemeralMode = true)}
					/>
					<label for="mode-ephemeral" class="mode-label">
						<span class="mode-title">Ephemeral</span>
						<span class="mode-description">Nothing saved. Room disappears when everyone leaves. Best for one-time coordination.</span>
					</label>
				</div>
			</div>

			<details class="advanced-toggle">
				<summary>Advanced settings</summary>
				<div class="advanced-content">
					<PinPolicyToggle
						policy={pinPolicy}
						onchange={(newPolicy) => { pinPolicy = newPolicy; }}
					/>
				</div>
			</details>

			<p class="hint">Create a private, encrypted space to coordinate with your team. No account needed.</p>
		{:else}
			<div class="unsupported">
				<p>Your browser does not support WebAuthn, which is required for secure identity.</p>
				<p>Try <strong>Chrome 120+</strong> or <strong>Edge</strong> on a device with a fingerprint reader or security key.</p>
			</div>
		{/if}

		{#if error}
			<p class="error">{error}</p>
		{/if}
	</div>

	<footer>
		<span class="lock">&#128274;</span> End-to-end encrypted. Your data never leaves your device unencrypted.
	</footer>
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		font-family: system-ui, -apple-system, sans-serif;
		color: var(--text-primary);
		background: var(--bg-base);
		/* 2rem each side left 256px of the 320px iPhone SE viewport, which is
		   less than the brand needs on a wide font stack. Narrow screens get
		   half the horizontal padding. */
		padding: 2rem 1rem;
	}

	@media (min-width: 480px) {
		main {
			padding: 2rem;
		}
	}

	.hero {
		text-align: center;
		max-width: 480px;
		/* Without this the hero can exceed a narrow viewport, since max-width
		   alone sets no upper bound relative to the parent. */
		width: 100%;
	}

	h1 {
		/* Scales with the viewport instead of sitting at a fixed 3rem. At a fixed
		   size the brand fit a 320px screen only under macOS system-ui metrics;
		   Linux WebKit renders the same string wider and it spilled 5px past the
		   body, which is what CI caught. Type that scales does not depend on
		   which font the platform resolves system-ui to. */
		font-size: clamp(2rem, 10vw, 3rem);
		font-weight: 300;
		letter-spacing: 0.1em;
		margin: 0 0 0.5rem;
		color: var(--text-heading);
	}

	.brand-accent {
		color: var(--accent-default);
	}

	.tagline {
		font-size: 1.1rem;
		color: var(--text-secondary);
		margin: 0 0 2.5rem;
	}

	.create-btn {
		display: inline-block;
		padding: 1rem 2.5rem;
		font-size: 1.1rem;
		font-weight: 500;
		color: var(--text-inverse);
		background: var(--btn-primary-bg);
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: background 0.15s, transform 0.1s;
	}

	.create-btn:hover:not(:disabled) {
		background: var(--btn-primary-hover);
		transform: translateY(-1px);
	}

	.create-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.room-mode-group {
		margin-top: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.room-mode-option {
		position: relative;
		display: grid;
		grid-template-columns: 1.25rem 1fr 1.25rem;
		gap: 0.75rem;
		align-items: center;
		padding: 1rem;
		background: var(--bg-surface);
		border: 2px solid var(--border-default);
		border-radius: 6px;
		cursor: pointer;
		transition: all 0.15s;
	}

	.room-mode-option input[type='radio'] {
		cursor: pointer;
		width: 1.25rem;
		height: 1.25rem;
		flex-shrink: 0;
		accent-color: var(--accent-default);
	}

	.room-mode-option input[type='radio']:checked ~ .mode-label {
		color: var(--text-primary);
	}

	.room-mode-option input[type='radio']:checked {
		accent-color: var(--accent-default);
	}

	.room-mode-option:has(input[type='radio']:checked) {
		border-color: var(--accent-default);
		background: var(--bg-surface);
	}

	.room-mode-option:hover {
		border-color: var(--border-active);
	}

	.room-mode-option:focus-within {
		outline: 2px solid var(--accent-default);
		outline-offset: 0;
	}

	.mode-label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		cursor: pointer;
		margin: 0;
		flex: 1;
		text-align: center;
	}

	.mode-title {
		font-weight: 600;
		color: var(--text-primary);
		font-size: 0.95rem;
	}

	.mode-description {
		font-size: 0.8rem;
		color: var(--text-muted);
		line-height: 1.4;
	}

	.hint {
		margin-top: 1rem;
		font-size: 0.85rem;
		color: var(--text-muted);
	}

	.advanced-toggle {
		margin-top: 1rem;
		width: 100%;
		border: 1px solid var(--border-default);
		border-radius: 6px;
		transition: border-color 0.15s;
	}

	.advanced-toggle:hover {
		border-color: var(--border-strong);
	}

	.advanced-toggle[open] {
		border-color: var(--border-strong);
	}

	.advanced-toggle summary {
		font-size: 0.8rem;
		color: var(--text-secondary);
		cursor: pointer;
		text-align: center;
		list-style: none;
		padding: 0.5rem 1rem;
		transition: color 0.15s;
	}

	.advanced-toggle summary:hover {
		color: var(--text-primary);
	}

	.advanced-toggle summary::-webkit-details-marker {
		display: none;
	}

	.advanced-toggle summary::after {
		content: ' \25BE';
		font-size: 0.7rem;
	}

	.advanced-toggle[open] summary {
		color: var(--text-primary);
		border-bottom: 1px solid var(--border-default);
		padding-bottom: 0.5rem;
	}

	.advanced-toggle[open] summary::after {
		content: ' \25B4';
	}

	.advanced-content {
		padding: 0.75rem 1rem;
	}

	.unsupported {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		padding: 1.5rem;
		margin-top: 1rem;
	}

	.unsupported p {
		margin: 0.5rem 0;
		color: var(--text-secondary);
	}

	.error {
		color: var(--status-error);
		margin-top: 1rem;
	}

	.deleted-notice {
		position: fixed;
		top: 1rem;
		left: 50%;
		transform: translateX(-50%);
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		padding: 0.5rem 1rem;
		border-radius: 6px;
		font-size: 0.85rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		z-index: 100;
		color: var(--text-primary);
	}

	.deleted-notice button {
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		padding: 0;
		font-size: 1.25rem;
		line-height: 1;
		transition: color 0.15s;
	}

	.deleted-notice button:hover {
		color: var(--text-primary);
	}

	footer {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		text-align: center;
		padding: 1rem;
		font-size: 0.8rem;
		color: var(--text-muted);
		background: var(--bg-base);
	}

	.lock {
		font-size: 0.9rem;
	}
</style>
