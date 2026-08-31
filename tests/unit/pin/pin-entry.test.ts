// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/svelte';
import PinEntry from '$lib/components/PinEntry.svelte';

describe('PinEntry', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
		cleanup();
	});

	function renderPinEntry(props: {
		failedAttempts?: number;
		lockedUntil?: number;
	} = {}) {
		const onverify = vi.fn();
		const onlockout = vi.fn();
		const result = render(PinEntry, {
			props: {
				onverify,
				onlockout,
				failedAttempts: props.failedAttempts ?? 0,
				...('lockedUntil' in props ? { lockedUntil: props.lockedUntil } : {}),
			},
		});
		return { ...result, onverify, onlockout };
	}

	it('renders lock overlay with PIN input', () => {
		const { container } = renderPinEntry();
		const scope = within(container);
		expect(scope.getByText('Session Locked')).toBeTruthy();
		expect(scope.getByLabelText('Enter your PIN')).toBeTruthy();
	});

	it('input is enabled when not locked out', () => {
		const { container } = renderPinEntry();
		const input = container.querySelector('.pin-input') as HTMLInputElement;
		expect(input.disabled).toBe(false);
	});

	it('input is disabled during backoff lockout (failedAttempts >= 3)', async () => {
		// Start at 2 attempts, then increment to 3 to trigger backoff
		const { container, rerender } = renderPinEntry({ failedAttempts: 2 });
		const input = container.querySelector('.pin-input') as HTMLInputElement;
		expect(input.disabled).toBe(false);

		// Increment to 3 (threshold) — triggers 30s backoff
		await rerender({ onverify: vi.fn(), onlockout: vi.fn(), failedAttempts: 3 });

		// Need a tick for the $effect to fire
		await vi.advanceTimersByTimeAsync(200);
		expect(input.disabled).toBe(true);
	});

	it('input re-enables after backoff timer expires (#72)', async () => {
		const { container, rerender } = renderPinEntry({ failedAttempts: 2 });
		const input = container.querySelector('.pin-input') as HTMLInputElement;

		// Trigger backoff
		await rerender({ onverify: vi.fn(), onlockout: vi.fn(), failedAttempts: 3 });
		await vi.advanceTimersByTimeAsync(200);
		expect(input.disabled).toBe(true);

		// Advance past 30s backoff
		await vi.advanceTimersByTimeAsync(30_500);
		expect(input.disabled).toBe(false);
	});

	it('shows countdown during backoff', async () => {
		const { container, rerender } = renderPinEntry({ failedAttempts: 2 });

		await rerender({ onverify: vi.fn(), onlockout: vi.fn(), failedAttempts: 3 });
		await vi.advanceTimersByTimeAsync(200);

		const lockoutMsg = container.querySelector('.lockout-message');
		expect(lockoutMsg).toBeTruthy();
		expect(lockoutMsg!.textContent).toMatch(/Try again in \d+s/);
	});

	it('second backoff is 60s (exponential)', async () => {
		const { container, rerender } = renderPinEntry({ failedAttempts: 2 });
		const input = container.querySelector('.pin-input') as HTMLInputElement;

		// First backoff at 3 attempts
		await rerender({ onverify: vi.fn(), onlockout: vi.fn(), failedAttempts: 3 });
		await vi.advanceTimersByTimeAsync(200);
		expect(input.disabled).toBe(true);

		// Clear first backoff
		await vi.advanceTimersByTimeAsync(30_500);
		expect(input.disabled).toBe(false);

		// Second backoff at 4 attempts — should be 60s
		await rerender({ onverify: vi.fn(), onlockout: vi.fn(), failedAttempts: 4 });
		await vi.advanceTimersByTimeAsync(200);
		expect(input.disabled).toBe(true);

		// 30s is not enough
		await vi.advanceTimersByTimeAsync(30_500);
		expect(input.disabled).toBe(true);

		// 60s total should clear it
		await vi.advanceTimersByTimeAsync(30_500);
		expect(input.disabled).toBe(false);
	});

	it('calls onlockout at 10 failed attempts', async () => {
		const onlockout = vi.fn();
		const { rerender } = renderPinEntry({ failedAttempts: 9 });

		await rerender({ onverify: vi.fn(), onlockout, failedAttempts: 10 });
		await vi.advanceTimersByTimeAsync(200);

		expect(onlockout).toHaveBeenCalledOnce();
	});

	it('calls onverify when 6-digit PIN is entered', async () => {
		const { container, onverify } = renderPinEntry();
		const input = container.querySelector('.pin-input') as HTMLInputElement;

		// Type a 6-digit PIN
		await fireEvent.input(input, { target: { value: '123456' } });

		expect(onverify).toHaveBeenCalledWith('123456');
	});

	it('shows remaining attempts after failed attempt', async () => {
		const { container } = renderPinEntry({ failedAttempts: 1 });
		const scope = within(container);
		expect(scope.getByText(/9 attempts remaining/)).toBeTruthy();
	});
});
