/**
 * PIN-based endpoint compromise containment types.
 * The PIN is a knowledge factor on top of WebAuthn (device factor).
 */

/** PIN policy set by room creator */
export interface PinPolicy {
  required: boolean;          // Whether PIN is required for all members
  inactivityTimeout: number;  // Minutes before auto-lock (5, 15, or 30)
}

/** PIN state for a member in a room */
export type PinState =
  | { status: 'unset' }              // No PIN configured
  | { status: 'set'; lockedAt?: number }  // PIN set, optionally locked
  | { status: 'locked'; failedAttempts: number; lockedUntil?: number }  // Locked out
  | { status: 'cleared' };           // Session cleared after too many failures

/** Stored PIN key material in IndexedDB */
export interface StoredPinKey {
  roomId: string;
  salt: Uint8Array;          // PBKDF2 salt
  encryptedKey: Uint8Array;  // PIN key encrypted under PRF-derived wrapping key
  iv: Uint8Array;            // AES-GCM IV for the encryption
  keyHash: Uint8Array;       // Hash of derived PIN key for verification without full derivation
}

/** Default PIN policy */
export const DEFAULT_PIN_POLICY: PinPolicy = {
  required: false,
  inactivityTimeout: 15,
};

/** Valid inactivity timeout options in minutes */
export const TIMEOUT_OPTIONS = [5, 15, 30] as const;

/** Rate limiting constants */
export const PIN_MAX_ATTEMPTS = 10;
export const PIN_INITIAL_BACKOFF_MS = 30_000; // 30 seconds
export const PIN_BACKOFF_MULTIPLIER = 2;
export const PIN_LOCKOUT_THRESHOLD = 3; // Start backoff after this many failures
