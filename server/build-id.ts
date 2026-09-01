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
 * Scope: the source files in this directory, which are the only files the
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
 * Extensions the relay can be loaded from.
 *
 * TypeScript today, under tsx. server/Dockerfile contemplates dropping tsx and
 * shipping compiled JavaScript, so the compiled forms are covered too. That
 * change must not decide whether the relay can be fingerprinted.
 *
 * One limit follows. A precompiled relay fingerprints its .js files and a
 * working tree fingerprints its .ts files, so the two forms never match. The
 * digest compares relays of the same form only. That holds today, because the
 * run compares against a relay it spawned from this tree. Anything that later
 * checks a built image against a locally computed digest has to account for
 * it, or every precompiled image will read as stale.
 */
export const SOURCE_EXTENSIONS = [".ts", ".js", ".mjs", ".cjs"];

/**
 * Pick the source files out of a directory listing, sorted by name.
 *
 * Separate from the directory read so the empty case below can be tested
 * without emptying the real directory.
 */
export function selectSourceFiles(names: string[]): string[] {
  const files = names
    .filter((name) => SOURCE_EXTENSIONS.some((ext) => name.endsWith(ext)))
    .sort();

  // A digest over no files is the digest of the empty input, and it is the
  // same constant everywhere. Both sides would compute it, both sides would
  // agree, and the guard would pass against every relay including the stale
  // one it exists to catch. Refusing to produce a fingerprint is the only
  // safe answer, so this is the one case where the scan does not err toward a
  // needless restart and has to fail instead.
  if (files.length === 0) {
    throw new Error(
      `No relay sources in ${RELAY_SOURCE_DIR}. Cannot fingerprint the relay, ` +
        "and a fingerprint over nothing would match every relay.",
    );
  }
  return files;
}

/**
 * Every source file in the relay source directory, sorted by name.
 *
 * Scanned rather than listed. A hand-written list is one more thing that goes
 * stale, and a file missing from it is a blind spot that reports green. Apart
 * from the empty case above, a scan can only err toward asking for a restart
 * that was not needed, never toward missing one that was.
 */
export function relaySourceFiles(): string[] {
  return selectSourceFiles(readdirSync(RELAY_SOURCE_DIR));
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
