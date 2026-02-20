<script lang="ts">
	import { onMount } from 'svelte';
	import { tick } from 'svelte';
	import {
		PIN_MAX_ATTEMPTS,
		PIN_INITIAL_BACKOFF_MS,
		PIN_BACKOFF_MULTIPLIER,
		PIN_LOCKOUT_THRESHOLD
	} from '$lib/pin/types';

	interface Props {
		onverify: (pin: string) => void;
		onlockout: () => void;
		failedAttempts?: number;
		lockedUntil?: number;
	}

	let { onverify, onlockout, failedAttempts = 0, lockedUntil = undefined }: Props = $props();

	let pin = $state('');
	let lockoutEnd = $state(lockedUntil);
	// Track failedAttempts reactively from parent prop
	let prevAttempts = $state(failedAttempts);

	// When parent increments failedAttempts, apply rate limiting
	$effect(() => {
		if (failedAttempts > prevAttempts) {
			prevAttempts = failedAttempts;

			if (failedAttempts >= PIN_MAX_ATTEMPTS) {
				lockoutEnd = undefined;
				onlockout();
				return;
			}

			if (failedAttempts >= PIN_LOCKOUT_THRESHOLD) {
				const backoffAttempts = failedAttempts - PIN_LOCKOUT_THRESHOLD;
				const backoffMs = PIN_INITIAL_BACKOFF_MS * Math.pow(PIN_BACKOFF_MULTIPLIER, backoffAttempts);
				lockoutEnd = Date.now() + backoffMs;
			}
		}
	});
	let secondsRemaining = $state(0);
	let inputElement: HTMLInputElement | undefined = $state();
	let countdownInterval: ReturnType<typeof setInterval> | undefined = $state();

	const pinDots = $derived(Array.from({ length: 6 }, (_, i) => i < pin.length));

	const isLockedOut = $derived(lockoutEnd !== undefined && lockoutEnd > Date.now());

	const showError = $derived(failedAttempts > 0);

	const remainingAttempts = $derived(PIN_MAX_ATTEMPTS - failedAttempts);

	// Update countdown timer
	$effect(() => {
		if (isLockedOut && lockoutEnd) {
			const updateCountdown = () => {
				const now = Date.now();
				const remaining = Math.ceil((lockoutEnd! - now) / 1000);
				secondsRemaining = Math.max(0, remaining);

				if (secondsRemaining === 0) {
					lockoutEnd = undefined;
					if (countdownInterval) {
						clearInterval(countdownInterval);
						countdownInterval = undefined;
					}
				}
			};

			updateCountdown();

			if (countdownInterval) clearInterval(countdownInterval);
			countdownInterval = setInterval(updateCountdown, 100);

			return () => {
				if (countdownInterval) {
					clearInterval(countdownInterval);
					countdownInterval = undefined;
				}
			};
		}
	});

	function handlePinInput(e: Event) {
		const input = e.target as HTMLInputElement;
		let value = input.value.replace(/[^0-9]/g, '');

		if (value.length > 6) {
			value = value.slice(0, 6);
		}

		pin = value;

		if (value.length === 6) {
			submitPin();
		}
	}

	function submitPin() {
		if (pin.length !== 6 || isLockedOut) return;

		// PIN verification is done by the parent component
		// Here we just emit the PIN and let the caller verify it
		onverify(pin);

		// Reset input for retry
		pin = '';
		if (inputElement) {
			inputElement.focus();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			// Allow Escape to close (handled by parent if needed)
			return;
		} else if (e.key === 'Enter' && pin.length === 6 && !isLockedOut) {
			e.preventDefault();
			submitPin();
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		// Prevent closing on backdrop click for security reasons
		if (e.target === e.currentTarget) {
			e.preventDefault();
		}
	}

	function handleGlobalKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			// Trap Escape key within overlay for security
			e.preventDefault();
		}
	}

	onMount(() => {
		tick().then(() => inputElement?.focus());

		return () => {
			if (countdownInterval) {
				clearInterval(countdownInterval);
			}
		};
	});
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	class="lock-overlay"
	role="dialog"
	aria-modal="true"
	aria-label="Session locked"
	onclick={handleBackdropClick}
>
	<div class="lock-card">
		<div class="lock-icon">
			🔒
		</div>

		<h2 class="lock-title">Session Locked</h2>

		<p class="lock-subtitle">Enter your PIN to continue</p>

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
				placeholder="······"
				bind:this={inputElement}
				value={pin}
				oninput={handlePinInput}
				onkeydown={handleKeydown}
				aria-label="Enter your PIN"
				class="pin-input"
				disabled={isLockedOut}
			/>
		</div>

		{#if showError && !isLockedOut}
			<div class="error-message" role="status" aria-live="polite">
				Incorrect PIN. {remainingAttempts} {remainingAttempts === 1 ? 'attempt' : 'attempts'} remaining.
			</div>
		{:else if isLockedOut}
			<div class="lockout-message" role="status" aria-live="polite">
				Try again in {secondsRemaining}s
			</div>
		{/if}

		{#if failedAttempts >= PIN_MAX_ATTEMPTS}
			<div class="session-cleared-message" role="alert">
				Session cleared. Redirecting...
			</div>
		{/if}
	</div>
</div>

<style>
	.lock-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.7);
		backdrop-filter: blur(8px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 500;
	}

	.lock-card {
		background: var(--bg-surface);
		border: 1px solid var(--border-default);
		border-radius: 8px;
		padding: 2rem;
		width: 100%;
		max-width: 400px;
		text-align: center;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
	}

	.lock-icon {
		font-size: 3rem;
		margin-bottom: 1rem;
		opacity: 0.9;
	}

	.lock-title {
		margin: 0 0 0.5rem;
		font-weight: 600;
		font-size: 1.25rem;
		color: var(--text-heading);
	}

	.lock-subtitle {
		margin: 0 0 1.5rem;
		font-size: 0.95rem;
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
		transition: border-color 0.2s ease;
	}

	.pin-input:focus {
		border-color: var(--border-strong);
		background: var(--bg-base);
	}

	.pin-input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
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
		text-align: center;
		line-height: 1.4;
	}

	.lockout-message {
		background: var(--status-caution-bg);
		border: 1px solid var(--status-caution);
		border-radius: 6px;
		padding: 0.75rem;
		font-size: 0.85rem;
		color: var(--status-caution);
		text-align: center;
		line-height: 1.4;
	}

	.session-cleared-message {
		background: var(--status-urgent-bg);
		border: 1px solid var(--status-urgent);
		border-radius: 6px;
		padding: 0.75rem;
		font-size: 0.85rem;
		color: var(--status-urgent);
		text-align: center;
		line-height: 1.4;
		font-weight: 500;
	}
</style>
