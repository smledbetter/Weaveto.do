<script lang="ts">
	import { onMount } from 'svelte';
	import { tick } from 'svelte';

	interface Props {
		oncreate: (pin: string) => void;
		oncancel?: () => void;
	}

	let { oncreate, oncancel }: Props = $props();

	let step: 'enter' | 'confirm' = $state('enter');
	let pin = $state('');
	let confirmPin = $state('');
	let error = $state('');
	let inputElement: HTMLInputElement | undefined = $state();

	const pinDots = $derived(Array.from({ length: 6 }, (_, i) => i < pin.length || i < confirmPin.length));

	function handleGlobalKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			oncancel?.();
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) {
			oncancel?.();
		}
	}

	function handlePinInput(e: Event) {
		const input = e.target as HTMLInputElement;
		let value = input.value.replace(/[^0-9]/g, '');

		if (value.length > 6) {
			value = value.slice(0, 6);
		}

		if (step === 'enter') {
			pin = value;
			if (value.length === 6) {
				moveToConfirm();
			}
		} else {
			confirmPin = value;
			if (value.length === 6) {
				validateAndCreate();
			}
		}
	}

	async function moveToConfirm() {
		step = 'confirm';
		error = '';
		confirmPin = '';
		await tick();
		inputElement?.focus();
	}

	function validateAndCreate() {
		if (pin !== confirmPin) {
			error = "PINs don't match. Try again.";
			pin = '';
			confirmPin = '';
			step = 'enter';
			inputElement?.focus();
			return;
		}
		oncreate(pin);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && (step === 'enter' ? pin.length === 6 : confirmPin.length === 6)) {
			e.preventDefault();
			if (step === 'enter') {
				moveToConfirm();
			} else {
				validateAndCreate();
			}
		} else if (e.key === 'Backspace' && step === 'confirm' && confirmPin.length === 0) {
			e.preventDefault();
			step = 'enter';
			pin = '';
			inputElement?.focus();
		}
	}

	function handleCancel() {
		oncancel?.();
	}

	onMount(async () => {
		await tick();
		inputElement?.focus();
	});
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="modal-backdrop"
	role="dialog"
	aria-modal="true"
	aria-labelledby="pin-setup-title"
	onclick={handleBackdropClick}
>
	<div class="modal-content">
		<h3 id="pin-setup-title">{step === 'enter' ? 'Set a PIN' : 'Confirm your PIN'}</h3>

		<p class="subtitle">
			This PIN protects your session. You'll need it to unlock the room after inactivity.
		</p>

		<div class="pin-input-group">
			<div class="pin-dots">
				{#each pinDots as filled}
					<div class="dot" class:filled></div>
				{/each}
			</div>

			<input
				type="password"
				inputmode="numeric"
				pattern="[0-9]*"
				maxlength="6"
				placeholder="••••••"
				bind:this={inputElement}
				value={step === 'enter' ? pin : confirmPin}
				oninput={handlePinInput}
				onkeydown={handleKeydown}
				aria-label={step === 'enter' ? 'Enter PIN' : 'Confirm PIN'}
				class="pin-input"
			/>
		</div>

		{#if error}
			<div class="error-message" role="status">
				{error}
			</div>
		{/if}

		<div class="actions">
			<button class="primary-btn" onclick={handleCancel}>Cancel</button>
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 200;
	}

	.modal-content {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		padding: 1.5rem;
		width: 100%;
		max-width: 400px;
		max-height: 80vh;
		overflow-y: auto;
	}

	h3 {
		margin: 0 0 0.5rem;
		font-weight: 500;
		font-size: 1.1rem;
		color: var(--text-primary);
	}

	.subtitle {
		margin: 0 0 1.5rem;
		font-size: 0.85rem;
		color: var(--text-secondary);
		line-height: 1.4;
	}

	.pin-input-group {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
		margin-bottom: 1.5rem;
	}

	.pin-dots {
		display: flex;
		gap: 0.75rem;
		justify-content: center;
	}

	.dot {
		width: 16px;
		height: 16px;
		border-radius: 50%;
		border: 2px solid var(--border-default);
		background: transparent;
		transition: all 0.15s ease;
	}

	.dot.filled {
		background: var(--accent-default);
		border-color: var(--accent-default);
	}

	.pin-input {
		width: 200px;
		padding: 0.5rem 0.6rem;
		background: var(--bg-base);
		border: 1px solid var(--border-default);
		border-radius: 4px;
		color: var(--text-primary);
		font-size: 1rem;
		text-align: center;
		letter-spacing: 0.5rem;
		outline: none;
		font-family: system-ui, -apple-system, sans-serif;
	}

	.pin-input:focus {
		border-color: var(--border-strong);
		background: var(--bg-base);
	}

	.pin-input::placeholder {
		color: var(--text-muted);
		letter-spacing: 0.5rem;
	}

	.error-message {
		background: var(--status-error-bg);
		border: 1px solid var(--status-error);
		border-radius: 6px;
		padding: 0.75rem;
		font-size: 0.85rem;
		color: var(--status-error);
		margin-bottom: 1rem;
		text-align: center;
		line-height: 1.4;
	}

	.actions {
		display: flex;
		gap: 0.75rem;
	}

	.primary-btn {
		flex: 1;
		padding: 0.6rem 1rem;
		background: none;
		border: 1px solid var(--border-default);
		border-radius: 6px;
		color: var(--text-secondary);
		font-weight: 500;
		cursor: pointer;
		font-size: 0.9rem;
	}

	.primary-btn:hover {
		border-color: var(--border-strong);
		color: var(--text-primary);
	}

	.primary-btn:focus-visible {
		outline: 2px solid var(--border-strong);
		outline-offset: 2px;
	}
</style>
