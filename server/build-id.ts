/**
 * A fingerprint of the relay's own source, computed from disk.
 *
 * The relay has no hot reload. A process started before an edit keeps serving
 * the old code for every later run against it. That is not theoretical: a
 * change to the relay's rate limiting broke bulk task creation, and the full
 * local E2E suite passed 270 tests against a relay that had been started
 * before the change. CI caught it only because CI always starts fresh.
 *
 * A green run that measured the wrong binary is worse than a red one, so the
 * relay reports which source it loaded. It computes this value once at boot
 * and returns it on every HTTP response. The test run computes it again from
 * the working tree and refuses to start when the two disagree. See
 * tests/e2e/utils/relay-build.ts and tests/e2e/global-setup.ts.
 *
 * Scope: the TypeScript files in this directory, which are the only files the
 * relay process loads from the repository. A dependency upgrade is outside it,
 * because installing one already restarts nothing and the failure this guards
 * against is an edit to code the developer is holding in their head.
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The response header that carries the fingerprint.
 *
 * A header rather than a body change. tests/e2e/relay-restart.spec.ts polls
 * GET / for liveness, and scripts/verify-relay-container.mjs asserts on the
 * exact body of GET /vapid-key to detect a stale container image. A header
 * adds the fingerprint to both paths without touching either assertion.
 */
export const RELAY_BUILD_HEADER = "x-relay-build";

/** The directory holding every source file the relay loads. */
export const RELAY_SOURCE_DIR = resolve(dirname(fileURLToPath(import.meta.url)));

/**
 * Every TypeScript file in the relay source directory, sorted by name.
 *
 * Scanned rather than listed. A hand-written list is one more thing that goes
 * stale, and a file missing from it is a blind spot that reports green. A scan
 * can only err toward asking for a restart that was not needed, never toward
 * missing one that was.
 */
export function relaySourceFiles(): string[] {
  return readdirSync(RELAY_SOURCE_DIR)
    .filter((name) => name.endsWith(".ts"))
    .sort();
}

/**
 * SHA-256 over the name and the bytes of every covered file.
 *
 * Names are hashed as well as contents, so a rename changes the fingerprint.
 * Contents alone would call a renamed file identical. Both parts are
 * terminated, so no rearrangement of the same bytes across files can produce
 * the same digest.
 */
export function computeRelayBuildId(): string {
  const hash = createHash("sha256");
  for (const name of relaySourceFiles()) {
    hash.update(name);
    hash.update("\0");
    hash.update(readFileSync(join(RELAY_SOURCE_DIR, name)));
    hash.update("\0");
  }
  return hash.digest("hex");
}
