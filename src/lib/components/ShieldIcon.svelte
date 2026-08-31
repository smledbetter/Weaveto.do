<script lang="ts">
	interface Props {
		healthy: boolean;
		onclick?: () => void;
	}

	let { healthy, onclick }: Props = $props();

	let label = $derived(healthy ? 'All messages received' : 'Some messages may have been missed');
</script>

<button
	class="shield-icon"
	class:healthy
	class:warning={!healthy}
	{onclick}
	aria-label={label}
	title={label}
>
	<svg width="16" height="18" viewBox="0 0 16 18" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
		<path
			d="M8 1L1 4V8.5C1 12.64 4.01 16.49 8 17.5C11.99 16.49 15 12.64 15 8.5V4L8 1Z"
			fill="currentColor"
			stroke="currentColor"
			stroke-width="1"
			stroke-linejoin="round"
		/>
		{#if healthy}
			<path d="M5 9L7 11L11 7" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
		{:else}
			<text x="8" y="12" text-anchor="middle" fill="white" font-size="10" font-weight="bold">!</text>
		{/if}
	</svg>
</button>

<style>
	.shield-icon {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0.25rem;
		border-radius: 4px;
		transition: color 0.2s;
	}

	.shield-icon:focus-visible {
		outline: 2px solid var(--color-focus, #4a90d9);
		outline-offset: 2px;
	}

	.healthy {
		color: #22c55e;
	}

	.warning {
		color: #f59e0b;
	}

	:global(.dark) .healthy {
		color: #4ade80;
	}

	:global(.dark) .warning {
		color: #fbbf24;
	}
</style>
