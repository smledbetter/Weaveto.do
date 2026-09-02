import { describe, it, expect, beforeEach, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";

import {
  saveTaskSnapshot,
  saveEventQueue,
  loadTaskSnapshot,
  loadEventQueue,
  hasTaskSnapshot,
  hasEventQueue,
  clearTaskSnapshot,
  clearEventQueue,
} from "$lib/tasks/offline";
import type { Task, TaskEvent } from "$lib/tasks/types";

/**
 * "Nothing is stored" and "something is stored that will not open" are not the
 * same answer, and one function was giving both.
 *
 * `loadTaskSnapshot` and `loadEventQueue` return null on a missing record and
 * on a decryption failure. For their own callers that is right: both mean
 * there is no usable cache, and the caller wants data or nothing.
 *
 * It was wrong for `verifyRoomCleared`, which checks a burn by reading these
 * stores back and asks a different question: is anything still here. A record
 * that survived a burn and could no longer be decrypted read as null, and the
 * burn reported clean while the ciphertext sat on the disk.
 *
 * The offline store's key lives in localStorage. Clearing site data, or a
 * private window, mints a new one, so a record encrypted under the old key is
 * exactly the undecryptable-but-present case. It is not hypothetical.
 */

const DEVICE_KEY = "weave-offline-key";

function task(id: string): Task {
  return {
    id,
    title: `task ${id}`,
    status: "pending",
    createdAt: 0,
    updatedAt: 0,
  } as Task;
}

function taskEvent(id: string): TaskEvent {
  return {
    type: "task_created",
    taskId: id,
    task: task(id),
    timestamp: 0,
    actorId: "me",
  } as TaskEvent;
}

/**
 * Replace the device key, as clearing site data would.
 *
 * The module caches the key for the session, so this reloads it fresh to get
 * the behaviour a new page load would see against records written earlier.
 */
async function rotateDeviceKey() {
  localStorage.removeItem(DEVICE_KEY);
  vi.resetModules();
  return import("$lib/tasks/offline");
}

describe("presence and readability are different questions", () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
    localStorage.clear();
    vi.resetModules();
  });

  describe("when nothing was ever stored", () => {
    it("reports no snapshot", async () => {
      expect(await hasTaskSnapshot("room-1")).toBe(false);
    });

    it("reports no queue", async () => {
      expect(await hasEventQueue("room-1")).toBe(false);
    });
  });

  describe("when a record exists and opens normally", () => {
    it("both the loader and the existence check agree", async () => {
      await saveTaskSnapshot("room-1", [task("a")]);

      expect(await hasTaskSnapshot("room-1")).toBe(true);
      expect(await loadTaskSnapshot("room-1")).not.toBeNull();
    });

    it("the queue behaves the same way", async () => {
      await saveEventQueue("room-1", [taskEvent("a")]);

      expect(await hasEventQueue("room-1")).toBe(true);
      expect(await loadEventQueue("room-1")).not.toBeNull();
    });

    it("is scoped to the room it was written for", async () => {
      await saveTaskSnapshot("room-1", [task("a")]);
      expect(await hasTaskSnapshot("room-2")).toBe(false);
    });
  });

  describe("when a record exists but the key has changed", () => {
    it("the loader says null and the existence check says yes", async () => {
      // The case the burn verifier got wrong. Both answers are correct for
      // their own question, which is exactly why one cannot stand in for the
      // other.
      await saveTaskSnapshot("room-1", [task("a")]);
      const offline = await rotateDeviceKey();

      expect(await offline.loadTaskSnapshot("room-1")).toBeNull();
      expect(await offline.hasTaskSnapshot("room-1")).toBe(true);
    });

    it("the queue behaves the same way", async () => {
      await saveEventQueue("room-1", [taskEvent("a")]);
      const offline = await rotateDeviceKey();

      expect(await offline.loadEventQueue("room-1")).toBeNull();
      expect(await offline.hasEventQueue("room-1")).toBe(true);
    });
  });

  describe("after a successful clear", () => {
    it("the snapshot is gone by both measures", async () => {
      // The inverse. An existence check that always said true would satisfy
      // the case above and be useless.
      await saveTaskSnapshot("room-1", [task("a")]);
      await clearTaskSnapshot("room-1");

      expect(await hasTaskSnapshot("room-1")).toBe(false);
      expect(await loadTaskSnapshot("room-1")).toBeNull();
    });

    it("the queue is gone by both measures", async () => {
      await saveEventQueue("room-1", [taskEvent("a")]);
      await clearEventQueue("room-1");

      expect(await hasEventQueue("room-1")).toBe(false);
      expect(await loadEventQueue("room-1")).toBeNull();
    });

    it("clearing one store leaves the other alone", async () => {
      await saveTaskSnapshot("room-1", [task("a")]);
      await saveEventQueue("room-1", [taskEvent("a")]);

      await clearTaskSnapshot("room-1");

      expect(await hasTaskSnapshot("room-1")).toBe(false);
      expect(await hasEventQueue("room-1")).toBe(true);
    });
  });
});
