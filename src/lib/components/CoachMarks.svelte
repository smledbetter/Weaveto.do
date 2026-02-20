<script lang="ts">
	import { browser } from '$app/environment';

	const STORAGE_KEY = 'weave-walkthrough-seen';

	let { active = $bindable(false) }: { active?: boolean } = $props();

	let currentStep = $state(0);
	let dismissed = $state(false);

	const seen = browser && sessionStorage.getItem(STORAGE_KEY) === 'true';
	if (seen) {
		dismissed = true;
	} else {
		active = true;
	}

	const steps = [
		{
			title: 'Your encrypted room',
			body: 'Messages and tasks are end-to-end encrypted. Only people with the room link can join.'
		},
		{
			title: 'Manage tasks',
			body: 'Open the Tasks panel to create, assign, and track work together.'
		},
		{
			title: 'Invite your team',
			body: 'Click Invite to share a link or QR code. No accounts needed.'
		}
	];

	function next() {
		if (currentStep < steps.length - 1) {
			currentStep++;
		} else {
			finish();
		}
	}

	function finish() {
		dismissed = true;
		active = false;
		if (browser) sessionStorage.setItem(STORAGE_KEY, 'true');
	}
</script>

{#if !dismissed}
	<div class="coach-overlay" role="dialog" aria-label="Welcome walkthrough">
		<div class="coach-card">
			<div class="step-indicator">
				{#each steps as _, i}
					<span class="step-dot" class:active={i === currentStep}></span>
				{/each}
			</div>
			<h3>{steps[currentStep].title}</h3>
			<p>{steps[currentStep].body}</p>
			<div class="coach-actions">
				<button class="skip-btn" onclick={finish}>Skip</button>
				<button class="next-btn" onclick={next}>
					{currentStep < steps.length - 1 ? 'Next' : 'Got it'}
				</button>
			</div>
		</div>
	</div>
{/if}

<style>
	.coach-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 200;
	}

	.coach-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 12px;
		padding: 1.5rem;
		max-width: 340px;
		width: 90%;
		text-align: center;
	}

	.step-indicator {
		display: flex;
		justify-content: center;
		gap: 0.5rem;
		margin-bottom: 1rem;
	}

	.step-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--border-default);
	}

	.step-dot.active {
		background: var(--accent-default);
	}

	h3 {
		margin: 0 0 0.5rem;
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	p {
		margin: 0 0 1.25rem;
		font-size: 0.9rem;
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.coach-actions {
		display: flex;
		justify-content: space-between;
	}

	.skip-btn {
		background: none;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		font-size: 0.85rem;
		padding: 0.4rem 0.75rem;
	}

	.skip-btn:hover { color: var(--text-secondary); }

	.next-btn {
		background: var(--accent-default);
		border: none;
		color: var(--text-inverse);
		padding: 0.4rem 1.25rem;
		border-radius: 6px;
		cursor: pointer;
		font-size: 0.85rem;
		font-weight: 500;
	}

	.next-btn:hover { background: var(--accent-strong); }

	.next-btn:focus-visible,
	.skip-btn:focus-visible {
		outline: 2px solid var(--accent-default);
		outline-offset: 2px;
	}
</style>
