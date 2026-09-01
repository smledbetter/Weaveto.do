// @vitest-environment node
import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initPushDB,
  storePushSubscription,
  clearPushSubscription,
  countPushSubscriptions,
} from "$lib/notifications/push";

/**
 * Turning notifications off in one room must not turn them off everywhere.
 *
 * A browser has one push subscription per service worker registration, so
 * every room shares a single endpoint. `unsubscribeFromPush()` ends that
 * subscription, and the disable path called it unconditionally. Enable
 * notifications in two rooms, turn them off in one, and the other stopped
 * notifying with nothing to indicate why.
 *
 * The relay side was always per room, which is what made this invisible: the
 * relay dutifully forgot one room's endpoint while the browser quietly threw
 * away the endpoint the others were still using.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const page = readFileSync(
  resolve(ROOT, "src/routes/room/[id]/+page.svelte"),
  "utf8",
);

/** A PushSubscription is only read through toJSON here. */
function fakeSubscription(endpoint: string) {
  return {
    endpoint,
    toJSON: () => ({
      endpoint,
      keys: { p256dh: "p", auth: "a" },
    }),
  } as unknown as PushSubscription;
}

describe("counting the rooms that still want notifications", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it("is zero to start with", async () => {
    const db = await initPushDB();
    expect(await countPushSubscriptions(db)).toBe(0);
    db.close();
  });

  it("counts each room once", async () => {
    const db = await initPushDB();
    await storePushSubscription(db, "roomA", fakeSubscription("https://p/x"));
    await storePushSubscription(db, "roomB", fakeSubscription("https://p/x"));
    expect(await countPushSubscriptions(db)).toBe(2);
    db.close();
  });

  it("does not double count a room that re-enables", async () => {
    const db = await initPushDB();
    await storePushSubscription(db, "roomA", fakeSubscription("https://p/x"));
    await storePushSubscription(db, "roomA", fakeSubscription("https://p/y"));
    expect(await countPushSubscriptions(db)).toBe(1);
    db.close();
  });

  it("still sees the other room after one turns notifications off", async () => {
    // The case the bug got wrong. One room leaving is not everyone leaving.
    const db = await initPushDB();
    await storePushSubscription(db, "roomA", fakeSubscription("https://p/x"));
    await storePushSubscription(db, "roomB", fakeSubscription("https://p/x"));
    await clearPushSubscription(db, "roomA");
    expect(await countPushSubscriptions(db)).toBe(1);
    db.close();
  });

  it("reaches zero once the last room turns them off", async () => {
    const db = await initPushDB();
    await storePushSubscription(db, "roomA", fakeSubscription("https://p/x"));
    await clearPushSubscription(db, "roomA");
    expect(await countPushSubscriptions(db)).toBe(0);
    db.close();
  });
});

describe("the disable path uses the count before unsubscribing", () => {
  it("only unsubscribes the browser when no room wants notifications", () => {
    // A count that nothing consults would leave the bug in place while this
    // file looked correct.
    expect(page).toMatch(/countPushSubscriptions\(db\)/);
    expect(page).toMatch(/if \(stillWanted === 0\) await unsubscribeFromPush\(\)/);
  });

  it("clears this room's record before counting", () => {
    // Counting first would include the room being turned off, so the last
    // room would never reach zero and the browser subscription would leak.
    const clearAt = page.indexOf("await clearPushSubscription(db, roomId)");
    const countAt = page.indexOf("await countPushSubscriptions(db)");
    expect(clearAt).toBeGreaterThan(-1);
    expect(countAt).toBeGreaterThan(clearAt);
  });

  it("tells the relay to stop for this room either way", () => {
    // This is the part that actually stops the notifications, and it is per
    // room, so it must not depend on the browser-wide decision.
    expect(page).toMatch(/session\?\.sendPushUnsubscription\(\)/);
  });
});
