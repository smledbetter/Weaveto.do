<script lang="ts">
	interface Props {
		visible: boolean;
		onDismiss: () => void;
	}

	let { visible, onDismiss }: Props = $props();
</script>

{#if visible}
	<div class="migration-banner" role="alert">
		<span class="migration-text">This room was recreated — your tasks have been carried over.</span>
		<button class="dismiss-btn" onclick={onDismiss} aria-label="Dismiss migration notice">×</button>
	</div>
{/if}

<style>
	.migration-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.625rem 1rem;
		background: var(--color-warning-bg, #fef3cd);
		border: 1px solid var(--color-warning-border, #ffc107);
		border-radius: 0.5rem;
		margin-bottom: 0.5rem;
		gap: 0.5rem;
	}

	:global(.dark) .migration-banner {
		background: #3d3200;
		border-color: #665500;
	}

	.migration-text {
		font-size: 0.875rem;
		color: var(--color-text, #333);
		line-height: 1.4;
	}

	.dismiss-btn {
		background: none;
		border: none;
		cursor: pointer;
		font-size: 1.25rem;
		color: var(--color-text-muted, #666);
		padding: 0 0.25rem;
		flex-shrink: 0;
		line-height: 1;
	}

	.dismiss-btn:hover {
		color: var(--color-text, #333);
	}

	.dismiss-btn:focus-visible {
		outline: 2px solid var(--color-focus, #4a90d9);
		outline-offset: 2px;
		border-radius: 2px;
	}
</style>
