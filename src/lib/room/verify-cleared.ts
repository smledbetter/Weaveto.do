/**
 * Check whether a burned room actually left this device.
 *
 * Burn is the strongest claim this app makes. `cleanupRoom` runs ten steps and
 * the caller then tells the person their room is gone and sends them to the
 * homepage. Until now it told them that whether or not any of it worked.
 *
 * Every clear it depends on can fail and report success:
 *
 *   - `clearIdentitySeed` and `clearPinKey` reject inside the transaction and
 *     swallow it in an outer catch
 *   - `clearOfflineData` is `Promise.allSettled`, which by construction never
 *     rejects, so both deletions can fail and it still resolves
 *
 * Fixing each of those to propagate would work, and it would leave the promise
 * resting on every one of them keeping that habit forever. Reading the stores
 * back does not: it asks the question that actually matters, which is not "did
 * the delete return cleanly" but "is the data gone".
 *
 * What this cannot check is called out in `unverifiable` rather than left to
 * look like a pass. The PIN key needs the seed that unwraps it, and the seed
 * is destroyed earlier in the same cleanup, so by the time anyone could look
 * the means to look is gone. Saying so is better than reporting a clean sweep
 * that skipped a store.
 */

import { hasStoredIdentitySeed } from "$lib/identity/store";
import { loadTaskSnapshot, loadEventQueue } from "$lib/tasks/offline";

/** A store that still holds something for a room that was supposed to be gone. */
export type SurvivingStore =
  | "identity-seed"
  | "task-snapshot"
  | "event-queue";

export interface ClearedReport {
  /** Stores that still hold data for this room. Empty is the good case. */
  surviving: SurvivingStore[];
  /** Stores this cannot inspect, and why. Never counted as cleared. */
  unverifiable: string[];
  /** True only when every checkable store came back empty. */
  clean: boolean;
}

/**
 * Read back the stores a burn should have emptied.
 *
 * Never throws. A verifier that fails loudly during teardown would turn a
 * successful burn into an error, which is the opposite of the point. A store
 * that cannot be read is reported as unverifiable, not as clean: the whole
 * reason this exists is that "no error" was being mistaken for "no data".
 */
export async function verifyRoomCleared(
  roomId: string,
): Promise<ClearedReport> {
  const surviving: SurvivingStore[] = [];
  const unverifiable: string[] = [
    // Needs the identity seed to unwrap, and cleanupRoom destroys that seed
    // before this runs. Unverifiable by construction, not by omission.
    "pin-key",
  ];

  try {
    if (await hasStoredIdentitySeed(roomId)) surviving.push("identity-seed");
  } catch {
    unverifiable.push("identity-seed");
  }

  try {
    const snapshot = await loadTaskSnapshot(roomId);
    if (snapshot !== null) surviving.push("task-snapshot");
  } catch {
    unverifiable.push("task-snapshot");
  }

  try {
    const queue = await loadEventQueue(roomId);
    if (queue !== null) surviving.push("event-queue");
  } catch {
    unverifiable.push("event-queue");
  }

  return { surviving, unverifiable, clean: surviving.length === 0 };
}
