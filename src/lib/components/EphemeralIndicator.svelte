<script lang="ts">
	interface Props {
		memberCount: number;
	}

	let { memberCount }: Props = $props();

	let showWarning = $derived(memberCount === 1);
</script>

<span
	class="indicator"
	aria-label="Ephemeral room: no data persistence"
	title="This room will be deleted when all members leave"
>
	<svg
		class="flame-icon"
		width="12"
		height="14"
		viewBox="0 0 12 14"
		fill="none"
		xmlns="http://www.w3.org/2000/svg"
		aria-hidden="true"
	>
		<path
			d="M6 0C6 0 4 3 4 5.5C4 7.5 5 9 6 9C7 9 8 7.5 8 5.5C8 3 6 0 6 0Z"
			fill="currentColor"
		/>
		<path
			d="M6 9C6 9 3 10 3 11.5C3 13 4.5 14 6 14C7.5 14 9 13 9 11.5C9 10 6 9 6 9Z"
			fill="currentColor"
		/>
	</svg>
	<span class="text">Ephemeral</span>
	{#if showWarning}
		<span class="warning-text">Last member — closing tab deletes room</span>
	{/if}
</span>

<style>
	.indicator {
		display: inline-flex;
		align-items: center;
		gap: 0.25rem;
		color: var(--status-urgent);
		font-size: 0.75rem;
		font-weight: 500;
	}

	.flame-icon {
		flex-shrink: 0;
	}

	.text {
		white-space: nowrap;
	}

	.warning-text {
		margin-left: 0.25rem;
		padding-left: 0.5rem;
		border-left: 1px solid var(--status-urgent);
		font-weight: 400;
		font-size: 0.7rem;
	}
</style>
