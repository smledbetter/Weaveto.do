import { describe, it, expect, vi, beforeEach } from "vitest";
// A real fake, not a hand-rolled one. The first version of this file stubbed
// indexedDB with an object whose onsuccess never fired, so cleanupRoom's
// agent-data step hung and all eight cases timed out at 5s.
import "fake-indexeddb/auto";

/**
 * Burn has to tell the truth about what it removed.
 *
 * It is the strongest claim this app makes. `cleanupRoom` runs ten teardown
 * steps and the caller then sends the person to the homepage with "Room
 * deleted". Until now it said that whether or not any step worked, because
 * every failure was swallowed and the function resolved regardless.
 *
 * Trusting the clears was never going to be enough. `clearIdentitySeed` and
 * `clearPinKey` reject inside their transaction and swallow it in an outer
 * catch, and `clearOfflineData` is `Promise.allSettled`, which by construction
 * cannot reject. So both deletions can fail and it still resolves cleanly.
 *
 * Two properties under test. A failing step must not stop the ones after it,
 * because burn should destroy everything it can reach. And the result must be
 * read back from the stores rather than inferred from the absence of an error.
 */

vi.mock("$lib/pin/store", () => ({ clearPinKey: vi.fn() }));
vi.mock("$lib/identity/store", () => ({
  clearIdentitySeed: vi.fn(),
  hasStoredIdentitySeed: vi.fn().mockResolvedValue(false),
}));
vi.mock("$lib/notifications/store", () => ({
  initNotificationPrefsDB: vi.fn().mockResolvedValue({ close: vi.fn() }),
  clearNotificationPrefs: vi.fn(),
}));
vi.mock("$lib/notifications/push", () => ({
  initPushDB: vi.fn().mockResolvedValue({ close: vi.fn() }),
  clearPushSubscription: vi.fn(),
}));
vi.mock("$lib/tasks/offline", () => ({
  clearOfflineData: vi.fn(),
  loadTaskSnapshot: vi.fn().mockResolvedValue(null),
  loadEventQueue: vi.fn().mockResolvedValue(null),
}));

globalThis.sessionStorage = {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn().mockReturnValue(null),
};

import { cleanupRoom } from "$lib/room/cleanup";
import { clearPinKey } from "$lib/pin/store";
import { clearIdentitySeed, hasStoredIdentitySeed } from "$lib/identity/store";
import { clearOfflineData, loadEventQueue } from "$lib/tasks/offline";
import { clearPushSubscription } from "$lib/notifications/push";

const mockPin = clearPinKey as ReturnType<typeof vi.fn>;
const mockSeed = clearIdentitySeed as ReturnType<typeof vi.fn>;
const mockHasSeed = hasStoredIdentitySeed as ReturnType<typeof vi.fn>;
const mockOffline = clearOfflineData as ReturnType<typeof vi.fn>;
const mockQueue = loadEventQueue as ReturnType<typeof vi.fn>;
const mockPush = clearPushSubscription as ReturnType<typeof vi.fn>;

/** A room session that tears down without complaint. */
const session = { disconnect: vi.fn() } as never;

describe("burn reports what it actually removed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks leaves implementations behind, so restore the clean state
    // every case starts from. Without this a rejection leaks into the next.
    mockPin.mockResolvedValue(undefined);
    mockSeed.mockResolvedValue(undefined);
    mockOffline.mockResolvedValue(undefined);
    mockPush.mockResolvedValue(undefined);
    mockHasSeed.mockResolvedValue(false);
    mockQueue.mockResolvedValue(null);
  });

  it("reports complete when every step works and the stores read back empty", () => {
    return expect(
      cleanupRoom("room-1", session).then((r) => r.complete),
    ).resolves.toBe(true);
  });

  describe("a step that throws", () => {
    it("is named in the result rather than swallowed", async () => {
      mockSeed.mockRejectedValue(new Error("IndexedDB gone"));

      const result = await cleanupRoom("room-1", session);

      expect(result.failed).toContain("identity-seed");
      expect(result.complete).toBe(false);
    });

    it("does not stop the steps after it", async () => {
      // Burn should remove everything it can reach. Aborting at the first
      // failure would leave later stores untouched for no reason.
      mockPin.mockRejectedValue(new Error("boom"));

      await cleanupRoom("room-1", session);

      expect(mockSeed).toHaveBeenCalled();
      expect(mockPush).toHaveBeenCalled();
      expect(mockOffline).toHaveBeenCalled();
    });

    it("names every step that failed, not just the first", async () => {
      mockPin.mockRejectedValue(new Error("boom"));
      mockOffline.mockRejectedValue(new Error("boom"));

      const result = await cleanupRoom("room-1", session);

      expect(result.failed).toEqual(
        expect.arrayContaining(["pin-key", "offline-tasks"]),
      );
    });
  });

  describe("a clear that fails silently", () => {
    it("is caught by reading the store back", async () => {
      // The case that motivated all of this. clearOfflineData resolves
      // cleanly because Promise.allSettled cannot reject, and the data is
      // still there. Nothing threw, so `failed` is empty and the old code
      // would have said "Room deleted".
      mockOffline.mockResolvedValue(undefined);
      mockQueue.mockResolvedValue([{ type: "task_created" }]);

      const result = await cleanupRoom("room-1", session);

      expect(result.failed).toEqual([]);
      expect(result.verified.surviving).toContain("event-queue");
      expect(result.complete).toBe(false);
    });

    it("catches a surviving identity seed the same way", async () => {
      mockSeed.mockResolvedValue(undefined);
      mockHasSeed.mockResolvedValue(true);

      const result = await cleanupRoom("room-1", session);

      expect(result.failed).toEqual([]);
      expect(result.verified.surviving).toContain("identity-seed");
      expect(result.complete).toBe(false);
    });
  });

  describe("what it cannot check", () => {
    it("reports the PIN key as unverifiable rather than clean", async () => {
      // It needs the identity seed to unwrap, and cleanup destroys that seed
      // first. Counting it as cleared would be the same mistake in a new place.
      const result = await cleanupRoom("room-1", session);
      expect(result.verified.unverifiable).toContain("pin-key");
    });

    it("still reports complete, since unverifiable is not evidence of failure", async () => {
      // The inverse. If unverifiable blocked completion, every burn would
      // report partial forever and the warning would mean nothing.
      const result = await cleanupRoom("room-1", session);
      expect(result.complete).toBe(true);
    });
  });
});
