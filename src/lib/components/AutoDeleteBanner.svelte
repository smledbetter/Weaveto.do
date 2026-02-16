<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		expiresAt: number;
		isCreator: boolean;
		onKeepRoom: () => void;
		onDeleteNow: () => void;
	}

	let { expiresAt, isCreator, onKeepRoom, onDeleteNow }: Props = $props();

	let timeRemaining = $state('');

	function updateCountdown() {
		const diff = expiresAt - Date.now();
		if (diff <= 0) {
			timeRemaining = 'now';
			return;
		}
		const hours = Math.floor(diff / 3_600_000);
		const minutes = Math.floor((diff % 3_600_000) / 60_000);
		timeRemaining = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
	}

	onMount(() => {
		updateCountdown();
		const interval = setInterval(updateCountdown, 60_000);
		return () => clearInterval(interval);
	});
</script>

<div class="banner" role="alert" aria-live="polite">
	<span class="message">All tasks complete. Room will auto-delete in {timeRemaining}.</span>
	<div class="actions">
		<button class="keep-btn" onclick={onKeepRoom}>Keep Room</button>
		{#if isCreator}
			<button class="delete-now-btn" onclick={onDeleteNow}>Delete Now</button>
		{/if}
	</div>
</div>

<style>
	.banner {
		background: var(--status-urgent-bg);
		border: 1px solid var(--status-urgent);
		border-radius: 6px;
		padding: 0.75rem 1rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		margin-bottom: 1rem;
	}

	.message {
		color: var(--status-urgent);
		font-size: 0.85rem;
		font-weight: 500;
	}

	.actions {
		display: flex;
		gap: 0.5rem;
	}

	.keep-btn {
		padding: 0.4rem 0.75rem;
		background: none;
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-secondary);
		cursor: pointer;
		font-size: 0.8rem;
		white-space: nowrap;
	}

	.keep-btn:hover {
		border-color: var(--border-strong);
		color: var(--text-primary);
	}

	.keep-btn:focus-visible {
		outline: 2px solid var(--border-strong);
		outline-offset: 2px;
	}

	.delete-now-btn {
		padding: 0.4rem 0.75rem;
		background: var(--status-urgent);
		border: none;
		border-radius: 4px;
		color: var(--text-inverse);
		cursor: pointer;
		font-size: 0.8rem;
		font-weight: 500;
		white-space: nowrap;
	}

	.delete-now-btn:hover {
		background: var(--status-error);
	}

	.delete-now-btn:focus-visible {
		outline: 2px solid var(--status-urgent);
		outline-offset: 2px;
	}
</style>
