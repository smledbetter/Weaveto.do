<script lang="ts">
	interface Props {
		onInvite: () => void;
		onDismiss: () => void;
	}

	let { onInvite, onDismiss }: Props = $props();
</script>

<div class="solo-banner" role="status">
	<span>You're the only one here — <button class="invite-link" onclick={onInvite}>invite someone</button> to start collaborating.</span>
	<button class="dismiss-btn" onclick={onDismiss} aria-label="Dismiss">&times;</button>
</div>

<style>
	.solo-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		padding: 0.6rem 1rem;
		background: var(--accent-muted);
		border: 1px solid var(--accent-border);
		border-radius: 6px;
		font-size: 0.85rem;
		color: var(--text-primary);
	}

	.invite-link {
		background: none;
		border: none;
		color: var(--accent-default);
		cursor: pointer;
		padding: 0;
		font-size: inherit;
		font-weight: 500;
		text-decoration: underline;
	}

	.invite-link:hover {
		color: var(--accent-strong);
	}

	.dismiss-btn {
		background: none;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 1.1rem;
		line-height: 1;
		padding: 0;
		flex-shrink: 0;
	}

	.dismiss-btn:hover {
		color: var(--text-primary);
	}
</style>
