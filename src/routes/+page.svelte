<script lang="ts">
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { isWebAuthnSupported } from '$lib/webauthn/prf';

	let webauthnSupported = $state(true);
	let creating = $state(false);
	let error = $state('');

	$effect(() => {
		if (browser) {
			webauthnSupported = isWebAuthnSupported();
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

			await goto(`/room/${roomId}?create=1`);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create room';
			creating = false;
		}
	}
</script>

<svelte:head>
	<title>Weave.us — Private Task Coordination</title>
</svelte:head>

<main>
	<div class="hero">
		<h1>weave.us</h1>
		<p class="tagline">Private, encrypted coordination. No accounts. No tracking.</p>

		{#if webauthnSupported}
			<button onclick={createRoom} disabled={creating} class="create-btn">
				{creating ? 'Creating...' : 'New Room'}
			</button>
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
		color: #e0e0e0;
		background: #0a0a0a;
		padding: 2rem;
	}

	.hero {
		text-align: center;
		max-width: 480px;
	}

	h1 {
		font-size: 3rem;
		font-weight: 300;
		letter-spacing: 0.1em;
		margin: 0 0 0.5rem;
		color: #ffffff;
	}

	.tagline {
		font-size: 1.1rem;
		color: #888;
		margin: 0 0 2.5rem;
	}

	.create-btn {
		display: inline-block;
		padding: 1rem 2.5rem;
		font-size: 1.1rem;
		font-weight: 500;
		color: #0a0a0a;
		background: #e0e0e0;
		border: none;
		border-radius: 8px;
		cursor: pointer;
		transition: background 0.15s, transform 0.1s;
	}

	.create-btn:hover:not(:disabled) {
		background: #ffffff;
		transform: translateY(-1px);
	}

	.create-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.hint {
		margin-top: 1rem;
		font-size: 0.85rem;
		color: #666;
	}

	.unsupported {
		background: #1a1a1a;
		border: 1px solid #333;
		border-radius: 8px;
		padding: 1.5rem;
		margin-top: 1rem;
	}

	.unsupported p {
		margin: 0.5rem 0;
		color: #999;
	}

	.error {
		color: #e55;
		margin-top: 1rem;
	}

	footer {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		text-align: center;
		padding: 1rem;
		font-size: 0.8rem;
		color: #555;
		background: #0a0a0a;
	}

	.lock {
		font-size: 0.9rem;
	}
</style>
