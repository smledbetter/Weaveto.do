/**
 * Tests for SessionGate (session lock manager).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SessionGate, TAB_GRACE_MS } from "$lib/pin/gate";

describe("SessionGate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires onLock after inactivity timeout expires", () => {
    const onLock = vi.fn();
    const onLockout = vi.fn();
    const gate = new SessionGate(1, { onLock, onLockout }); // 1 minute timeout

    gate.start();
    expect(onLock).not.toHaveBeenCalled();

    // Advance 30 seconds — should not lock yet
    vi.advanceTimersByTime(30_000);
    expect(onLock).not.toHaveBeenCalled();

    // Advance another 30 seconds (total 60s = 1 minute) — should lock now
    vi.advanceTimersByTime(30_000);
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(gate.isLocked()).toBe(true);
  });

  it("resets timer on activity and does not lock prematurely", () => {
    const onLock = vi.fn();
    const onLockout = vi.fn();
    const gate = new SessionGate(1, { onLock, onLockout }); // 1 minute timeout

    gate.start();

    // Advance 30 seconds
    vi.advanceTimersByTime(30_000);
    expect(onLock).not.toHaveBeenCalled();

    // Reset timer (user activity)
    gate.resetInactivityTimer();

    // Advance another 30 seconds — should NOT lock (timer was reset)
    vi.advanceTimersByTime(30_000);
    expect(onLock).not.toHaveBeenCalled();

    // Advance full timeout (60s) — should lock now
    vi.advanceTimersByTime(60_000);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("locks when tab is hidden beyond grace period", () => {
    const onLock = vi.fn();
    const onLockout = vi.fn();
    const gate = new SessionGate(15, { onLock, onLockout }); // 15 minute timeout

    gate.start();

    // Simulate tab hidden
    Object.defineProperty(document, "hidden", {
      writable: true,
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Advance past grace period (60s + 1s)
    vi.advanceTimersByTime(TAB_GRACE_MS + 1000);

    // Tab becomes visible again
    Object.defineProperty(document, "hidden", {
      writable: true,
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Should have locked
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(gate.isLocked()).toBe(true);
  });

  it("does not lock when tab is hidden under grace period", () => {
    const onLock = vi.fn();
    const onLockout = vi.fn();
    const gate = new SessionGate(15, { onLock, onLockout }); // 15 minute timeout

    gate.start();

    // Simulate tab hidden
    Object.defineProperty(document, "hidden", {
      writable: true,
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Advance 30 seconds (under grace period)
    vi.advanceTimersByTime(30_000);

    // Tab becomes visible again
    Object.defineProperty(document, "hidden", {
      writable: true,
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));

    // Should NOT have locked
    expect(onLock).not.toHaveBeenCalled();
    expect(gate.isLocked()).toBe(false);
  });

  it("allows manual lock and unlock", () => {
    const onLock = vi.fn();
    const onLockout = vi.fn();
    const gate = new SessionGate(15, { onLock, onLockout });

    gate.start();

    // Manual lock
    gate.lock();
    expect(onLock).toHaveBeenCalledTimes(1);
    expect(gate.isLocked()).toBe(true);

    // Manual unlock
    gate.unlock();
    expect(gate.isLocked()).toBe(false);
  });

  it("does not fire onLock twice when already locked", () => {
    const onLock = vi.fn();
    const onLockout = vi.fn();
    const gate = new SessionGate(1, { onLock, onLockout });

    gate.start();

    // Manual lock
    gate.lock();
    expect(onLock).toHaveBeenCalledTimes(1);

    // Try to lock again
    gate.lock();
    expect(onLock).toHaveBeenCalledTimes(1); // Should still be 1, not 2
  });

  it("stops all monitoring and does not fire onLock after stop", () => {
    const onLock = vi.fn();
    const onLockout = vi.fn();
    const gate = new SessionGate(1, { onLock, onLockout }); // 1 minute timeout

    gate.start();

    // Stop immediately
    gate.stop();

    // Advance past timeout
    vi.advanceTimersByTime(60_000);

    // Should NOT have locked
    expect(onLock).not.toHaveBeenCalled();
    expect(gate.isLocked()).toBe(false);
  });

  it("does not reset timer when locked", () => {
    const onLock = vi.fn();
    const onLockout = vi.fn();
    const gate = new SessionGate(1, { onLock, onLockout });

    gate.start();
    gate.lock();
    expect(gate.isLocked()).toBe(true);

    // Try to reset timer while locked
    gate.resetInactivityTimer();

    // Timer should not be active, so advancing time should not unlock or cause issues
    vi.advanceTimersByTime(120_000);

    // Should still be locked
    expect(gate.isLocked()).toBe(true);
  });

  it("does not reset timer when inactive", () => {
    const onLock = vi.fn();
    const onLockout = vi.fn();
    const gate = new SessionGate(1, { onLock, onLockout });

    // Do not start the gate
    gate.resetInactivityTimer();

    // Advance time — should not cause any locks
    vi.advanceTimersByTime(120_000);
    expect(onLock).not.toHaveBeenCalled();
  });

  it("attaches and detaches event listeners correctly", () => {
    const onLock = vi.fn();
    const onLockout = vi.fn();
    const gate = new SessionGate(1, { onLock, onLockout });

    const addListenerSpy = vi.spyOn(document, "addEventListener");
    const removeListenerSpy = vi.spyOn(document, "removeEventListener");

    gate.start();
    expect(addListenerSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    expect(addListenerSpy).toHaveBeenCalledWith(
      "keydown",
      expect.any(Function),
    );
    expect(addListenerSpy).toHaveBeenCalledWith(
      "mousedown",
      expect.any(Function),
    );
    expect(addListenerSpy).toHaveBeenCalledWith(
      "touchstart",
      expect.any(Function),
    );

    gate.stop();
    expect(removeListenerSpy).toHaveBeenCalledWith(
      "visibilitychange",
      expect.any(Function),
    );
    expect(removeListenerSpy).toHaveBeenCalledWith(
      "keydown",
      expect.any(Function),
    );
    expect(removeListenerSpy).toHaveBeenCalledWith(
      "mousedown",
      expect.any(Function),
    );
    expect(removeListenerSpy).toHaveBeenCalledWith(
      "touchstart",
      expect.any(Function),
    );

    addListenerSpy.mockRestore();
    removeListenerSpy.mockRestore();
  });

  it("handles user activity events (keydown, mousedown, touchstart)", () => {
    const onLock = vi.fn();
    const onLockout = vi.fn();
    const gate = new SessionGate(1, { onLock, onLockout }); // 1 minute timeout

    gate.start();

    // Advance 30 seconds
    vi.advanceTimersByTime(30_000);

    // Simulate user keydown
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a" }));

    // Advance another 30 seconds — should NOT lock (timer was reset by keydown)
    vi.advanceTimersByTime(30_000);
    expect(onLock).not.toHaveBeenCalled();

    // Advance another 20 seconds (total 50s from last reset)
    vi.advanceTimersByTime(20_000);

    // Simulate mousedown
    document.dispatchEvent(new MouseEvent("mousedown"));

    // Advance another 30 seconds — should NOT lock (timer was reset by mousedown)
    vi.advanceTimersByTime(30_000);
    expect(onLock).not.toHaveBeenCalled();

    // Advance full timeout — should lock now
    vi.advanceTimersByTime(30_000);
    expect(onLock).toHaveBeenCalledTimes(1);
  });

  it("unlock resets inactivity timer", () => {
    const onLock = vi.fn();
    const onLockout = vi.fn();
    const gate = new SessionGate(1, { onLock, onLockout }); // 1 minute timeout

    gate.start();
    gate.lock();
    expect(gate.isLocked()).toBe(true);

    // Unlock
    gate.unlock();
    expect(gate.isLocked()).toBe(false);

    // Timer should be reset, so advancing 30s should not lock
    vi.advanceTimersByTime(30_000);
    expect(onLock).toHaveBeenCalledTimes(1); // Only the initial lock, not a new one

    // Advance full timeout from unlock — should lock again
    vi.advanceTimersByTime(30_000);
    expect(onLock).toHaveBeenCalledTimes(2); // Second lock after timeout
  });
});
