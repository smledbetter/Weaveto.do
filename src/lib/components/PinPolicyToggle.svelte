<script lang="ts">
	import type { PinPolicy } from '$lib/pin/types';
	import { TIMEOUT_OPTIONS } from '$lib/pin/types';

	interface Props {
		policy: PinPolicy;
		onchange: (policy: PinPolicy) => void;
	}

	let { policy, onchange }: Props = $props();

	function handleCheckboxChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const newPolicy: PinPolicy = {
			...policy,
			required: input.checked,
		};
		onchange(newPolicy);
	}

	function handleTimeoutChange(e: Event) {
		const select = e.target as HTMLSelectElement;
		const newPolicy: PinPolicy = {
			...policy,
			inactivityTimeout: parseInt(select.value, 10),
		};
		onchange(newPolicy);
	}
</script>

<div class="pin-policy-container">
	<div class="pin-checkbox-group">
		<div class="checkbox-wrapper">
			<input
				type="checkbox"
				id="pin-required"
				checked={policy.required}
				onchange={handleCheckboxChange}
				aria-label="Require PIN for all members"
			/>
			<label for="pin-required" class="checkbox-label">
				<span class="shield-icon">🛡️</span>
				<span class="label-text">Require PIN for all members</span>
			</label>
		</div>
		<p class="checkbox-description">
			Members set a 6-digit PIN to lock their session. If a device is lost or stolen, the PIN keeps your room secure.
		</p>
	</div>

	{#if policy.required}
		<div class="timeout-group">
			<label for="inactivity-timeout" class="timeout-label">Lock after inactivity</label>
			<select
				id="inactivity-timeout"
				value={policy.inactivityTimeout.toString()}
				onchange={handleTimeoutChange}
				class="timeout-select"
			>
				{#each TIMEOUT_OPTIONS as option}
					<option value={option.toString()}>{option} minute{option === 1 ? '' : 's'}</option>
				{/each}
			</select>
		</div>
	{/if}
</div>

<style>
	.pin-policy-container {
		border: 1px solid var(--border-default);
		border-radius: 6px;
		padding: 1rem;
		background: var(--bg-surface);
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.pin-checkbox-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.checkbox-wrapper {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		cursor: pointer;
	}

	input[type='checkbox'] {
		width: 1.25rem;
		height: 1.25rem;
		margin-top: 0.125rem;
		flex-shrink: 0;
		cursor: pointer;
		accent-color: var(--accent-default);
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		cursor: pointer;
		margin: 0;
	}

	.shield-icon {
		font-size: 1.1rem;
		line-height: 1;
	}

	.label-text {
		color: var(--text-primary);
		font-weight: 500;
		font-size: 0.95rem;
	}

	.checkbox-description {
		margin: 0;
		margin-left: 2rem;
		font-size: 0.8rem;
		color: var(--text-muted);
		line-height: 1.5;
	}

	.timeout-group {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding-left: 2rem;
		padding-top: 0.5rem;
		border-left: 2px solid var(--border-default);
	}

	.timeout-label {
		font-size: 0.9rem;
		color: var(--text-secondary);
		font-weight: 500;
	}

	.timeout-select {
		padding: 0.5rem 0.75rem;
		background: var(--bg-base);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-primary);
		font-size: 0.9rem;
		cursor: pointer;
		outline: none;
		transition: border-color 0.15s;
	}

	.timeout-select:hover {
		border-color: var(--border-active);
	}

	.timeout-select:focus {
		border-color: var(--border-strong);
		background: var(--bg-base);
	}
</style>
