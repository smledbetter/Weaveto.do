/**
 * Decide which cryptographic identity opens a room, and say where it came from.
 *
 * This is the highest-stakes decision the client makes. It settles whether you
 * are the same person you were last visit, whether anything is written to this
 * device, and whether the room should tell you your identity is temporary.
 *
 * It lived inside `joinRoom()` in the room page, which meant the only way to
 * exercise it was Playwright against a production build with WebAuthn patched
 * to throw. That is why `tests/e2e/identity-integration.spec.ts` exists and why
 * it is slow. Here it is an ordinary function with ordinary tests.
 *
 * The order is deliberate and is the whole policy:
 *
 *   1. A security key, when the device has one. Nothing is written down,
 *      because the seed is re-derived from the authenticator every session.
 *   2. Otherwise a seed saved on this device, but only if the person asked for
 *      one and supplied the PIN that unwraps it.
 *   3. Otherwise a fresh random seed for this session only, and the caller is
 *      told to say so.
 *
 * A wrong PIN lands on step 3 on purpose. The room still opens, as someone
 * new. That costs the identity, which is the stated trade for not keeping a
 * key that could open it without the PIN.
 */

import {
  assertWithPrf,
  createCredential,
  getStoredCredentialId,
} from "../webauthn/prf";
import { loadIdentitySeed } from "./store";

/** Where the seed came from. Useful to the UI, and to a reader of a test. */
export type IdentitySource =
  | "prf"
  | "stored"
  | "session"
  | "bypass";

export interface ResolvedIdentity {
  seed: Uint8Array;
  /** True when the seed lasts only for this session and the UI must say so. */
  temporary: boolean;
  source: IdentitySource;
}

export interface ResolveIdentityOptions {
  roomId: string;
  /**
   * Skip WebAuthn entirely. Set for dev and for the bypass flag, where a
   * ceremony cannot complete and a per-session identity is the intent.
   */
  bypassWebAuthn: boolean;
  /** Whether this room has a seed saved on this device. */
  hasStoredSeed: boolean;
  /** The PIN the person typed, if the join form asked for one. */
  pin: string | null;
}

/**
 * Derive a seed with no authenticator and nothing stored.
 *
 * Per room and per call: the room id fixes it to this room, and the nonce
 * makes a second visit a different person. That is the point, not a
 * limitation, and it is why `temporary` is true wherever this is used.
 */
export async function generateSessionSeed(roomId: string): Promise<Uint8Array> {
  const nonce = crypto.randomUUID();
  const material = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`dev-prf-seed-${roomId}-${nonce}`),
  );
  return new Uint8Array(material);
}

/**
 * Resolve the identity for a room join.
 *
 * Never throws. A room that will not open is worse than a room opened as
 * someone new, so every failure path ends at a session identity rather than
 * an error. The caller learns what happened from `temporary` and `source`.
 */
export async function resolveIdentity(
  opts: ResolveIdentityOptions,
): Promise<ResolvedIdentity> {
  const { roomId, bypassWebAuthn, hasStoredSeed, pin } = opts;

  if (bypassWebAuthn) {
    return {
      seed: await generateSessionSeed(roomId),
      temporary: false,
      source: "bypass",
    };
  }

  try {
    const credentialId = getStoredCredentialId();
    const result = credentialId
      ? await assertWithPrf(roomId, credentialId)
      : await createCredential(roomId);
    return { seed: result.seed, temporary: false, source: "prf" };
  } catch {
    // No security key on this device, or the person declined the prompt.
  }

  if (hasStoredSeed && pin) {
    try {
      const stored = await loadIdentitySeed(roomId, pin);
      if (stored) {
        return { seed: stored, temporary: false, source: "stored" };
      }
      // Falls through on a wrong PIN, which is deliberate. See the header.
    } catch {
      // loadIdentitySeed swallows its own failures and returns null today, so
      // this cannot currently fire. Depending on that is the coupling that
      // breaks quietly later: this function promises never to throw, and a
      // promise that relies on another module keeping an undocumented habit is
      // not a promise. Falls through to a session identity, as a wrong PIN does.
    }
  }

  return {
    seed: await generateSessionSeed(roomId),
    temporary: true,
    source: "session",
  };
}
