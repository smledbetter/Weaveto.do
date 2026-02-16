/**
 * Session lock manager for PIN-based endpoint compromise containment.
 * Manages inactivity timeout and visibility change detection.
 */

import type { PinState } from './types';
import { PIN_MAX_ATTEMPTS, PIN_INITIAL_BACKOFF_MS, PIN_BACKOFF_MULTIPLIER, PIN_LOCKOUT_THRESHOLD } from './types';

export interface GateCallbacks {
  onLock: () => void;       // Called when session should lock (clear Megolm keys)
  onLockout: () => void;    // Called when max attempts exceeded (clear session)
}

export class SessionGate {
  private timeoutMs: number;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private visibilityHiddenAt: number | null = null;
  private callbacks: GateCallbacks;
  private locked = false;
  private active = false;

  // Grace period for tab switches (60 seconds)
  private static readonly TAB_GRACE_MS = 60_000;

  constructor(timeoutMinutes: number, callbacks: GateCallbacks) {
    this.timeoutMs = timeoutMinutes * 60 * 1000;
    this.callbacks = callbacks;
  }

  /** Start monitoring for inactivity. Call after PIN is verified. */
  start(): void {
    this.active = true;
    this.locked = false;
    this.resetInactivityTimer();
    this.attachListeners();
  }

  /** Stop all monitoring. Call on disconnect/cleanup. */
  stop(): void {
    this.active = false;
    this.clearInactivityTimer();
    this.detachListeners();
  }

  /** Reset the inactivity timer (call on user activity). */
  resetInactivityTimer(): void {
    if (!this.active || this.locked) return;
    this.clearInactivityTimer();
    this.inactivityTimer = setTimeout(() => {
      this.lock();
    }, this.timeoutMs);
  }

  /** Lock the session (clears Megolm keys via callback). */
  lock(): void {
    if (this.locked) return;
    this.locked = true;
    this.clearInactivityTimer();
    this.callbacks.onLock();
  }

  /** Unlock the session (after successful PIN verification). */
  unlock(): void {
    this.locked = false;
    this.resetInactivityTimer();
  }

  /** Check if the session is currently locked. */
  isLocked(): boolean {
    return this.locked;
  }

  // --- Visibility change handling ---

  private handleVisibilityChange = (): void => {
    if (!this.active) return;

    if (document.hidden) {
      this.visibilityHiddenAt = Date.now();
    } else {
      // Tab became visible again
      if (this.visibilityHiddenAt) {
        const hiddenDuration = Date.now() - this.visibilityHiddenAt;
        this.visibilityHiddenAt = null;

        if (hiddenDuration > SessionGate.TAB_GRACE_MS) {
          this.lock();
        }
      }
    }
  };

  // --- User activity tracking ---

  private handleUserActivity = (): void => {
    if (!this.active || this.locked) return;
    this.resetInactivityTimer();
  };

  private attachListeners(): void {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    document.addEventListener('keydown', this.handleUserActivity);
    document.addEventListener('mousedown', this.handleUserActivity);
    document.addEventListener('touchstart', this.handleUserActivity);
  }

  private detachListeners(): void {
    if (typeof document === 'undefined') return;
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    document.removeEventListener('keydown', this.handleUserActivity);
    document.removeEventListener('mousedown', this.handleUserActivity);
    document.removeEventListener('touchstart', this.handleUserActivity);
  }

  private clearInactivityTimer(): void {
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
  }
}

// Export grace period for testing
export const TAB_GRACE_MS = 60_000;
