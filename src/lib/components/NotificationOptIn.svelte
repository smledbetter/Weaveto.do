<script lang="ts">
	interface Props {
		onOptIn: () => void;
		onDismiss: () => void;
	}

	let { onOptIn, onDismiss }: Props = $props();
</script>

<div class="opt-in-banner" role="status" aria-label="Notification opt-in prompt">
	<p class="opt-in-text">Get reminded when tasks are due.</p>
	<div class="opt-in-actions">
		<button
			class="opt-in-btn"
			onclick={onOptIn}
			aria-label="Turn on task notifications"
		>Turn on</button>
		<button
			class="dismiss-btn"
			onclick={onDismiss}
			aria-label="Dismiss notification prompt"
		>&times;</button>
	</div>
</div>

<style>
	.opt-in-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		background: var(--surface-2, #f5f5f5);
		border-radius: 8px;
		padding: 0.75rem 1rem;
		margin-bottom: 0.75rem;
	}

	:global(body.dark) .opt-in-banner {
		background: var(--surface-2, #2a2a2a);
	}

	.opt-in-text {
		margin: 0;
		font-size: 0.82rem;
		color: var(--text-secondary, #555);
		flex: 1;
	}

	:global(body.dark) .opt-in-text {
		color: var(--text-secondary, #aaa);
	}

	.opt-in-actions {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
	}

	.opt-in-btn {
		background: none;
		border: none;
		color: var(--accent-default, #3b82f6);
		cursor: pointer;
		font-size: 0.82rem;
		font-weight: 500;
		padding: 0.2rem 0.4rem;
		border-radius: 3px;
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.opt-in-btn:hover {
		color: var(--accent-hover, #2563eb);
	}

	.opt-in-btn:focus-visible {
		outline: 2px solid var(--accent-default, #3b82f6);
		outline-offset: 2px;
	}

	.dismiss-btn {
		background: none;
		border: none;
		color: var(--text-muted, #999);
		cursor: pointer;
		font-size: 1rem;
		line-height: 1;
		padding: 0.1rem 0.25rem;
		border-radius: 3px;
	}

	.dismiss-btn:hover {
		color: var(--text-secondary, #555);
	}

	.dismiss-btn:focus-visible {
		outline: 2px solid var(--accent-default, #3b82f6);
		outline-offset: 2px;
	}
</style>
