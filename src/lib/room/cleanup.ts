/**
 * Client-side cleanup orchestrator for room destruction.
 * Clears all traces of a room from the client: in-memory state,
 * sessionStorage, IndexedDB (agent modules/state), service worker reminders.
 */

import type { RoomSession } from "./session";
import type { TabSync } from "./tab-sync";
import { autoDeleteKey } from "./types";
import { clearPinKey } from "$lib/pin/store";
import { clearIdentitySeed } from "$lib/identity/store";
import { initNotificationPrefsDB, clearNotificationPrefs } from "$lib/notifications/store";
import { initPushDB, clearPushSubscription } from "$lib/notifications/push";
import { clearOfflineData } from "$lib/tasks/offline";
import { verifyRoomCleared, type ClearedReport } from "./verify-cleared";

/** A named teardown step, for reporting which ones did not finish. */
export type CleanupStep =
  | "disconnect"
  | "session-storage"
  | "agent-data"
  | "reminders"
  | "pin-key"
  | "identity-seed"
  | "notification-prefs"
  | "push-subscription"
  | "offline-tasks"
  | "tab-sync";

export interface CleanupResult {
  /** Steps that threw. The room is not fully gone from this device. */
  failed: CleanupStep[];
  /** What a read-back of the stores found. See verifyRoomCleared. */
  verified: ClearedReport;
  /** True when every step finished and every checkable store came back empty. */
  complete: boolean;
}

/**
 * Clean up all client-side state for a destroyed room.
 * Called on manual burn, auto-delete expiry, or room_destroyed from the relay.
 *
 * Two rules, both learned the hard way.
 *
 * A failing step must not stop the others. Burn should destroy as much as it
 * can reach, so every step runs even when an earlier one threw, and the caller
 * is told afterwards rather than the sequence aborting half done.
 *
 * And the result must be checked, not assumed. This used to swallow every step
 * and resolve, and the caller then told the person their room was gone. Some
 * of the clears it calls cannot report failure even in principle, so the
 * stores are read back at the end. See verifyRoomCleared.
 */
export async function cleanupRoom(
  roomId: string,
  session: RoomSession | null,
  tabSync?: TabSync,
): Promise<CleanupResult> {
  const failed: CleanupStep[] = [];

  const steps: Array<[CleanupStep, () => void | Promise<unknown>]> = [
    ["disconnect", () => session?.disconnect()],
    [
      "session-storage",
      () => {
        sessionStorage.removeItem("weave-olm-pickle");
        sessionStorage.removeItem("weave-key-warning-shown");
        sessionStorage.removeItem("weave-task-panel-open");
        sessionStorage.removeItem(autoDeleteKey(roomId));
      },
    ],
    ["agent-data", () => clearAgentData(roomId)],
    ["reminders", () => clearServiceWorkerReminders(roomId)],
    ["pin-key", () => clearPinKey(roomId)],
    ["identity-seed", () => clearIdentitySeed(roomId)],
    [
      "notification-prefs",
      async () => {
        const db = await initNotificationPrefsDB();
        await clearNotificationPrefs(db, roomId);
        db.close();
      },
    ],
    [
      "push-subscription",
      async () => {
        const db = await initPushDB();
        await clearPushSubscription(db, roomId);
        db.close();
      },
    ],
    ["offline-tasks", () => clearOfflineData(roomId)],
    // Last: it closes the BroadcastChannel this tab coordinates on.
    ["tab-sync", () => tabSync?.destroy()],
  ];

  for (const [name, run] of steps) {
    try {
      await run();
    } catch {
      // Recorded, not rethrown. The next step still has data to remove.
      failed.push(name);
    }
  }

  const verified = await verifyRoomCleared(roomId);
  return {
    failed,
    verified,
    complete: failed.length === 0 && verified.clean,
  };
}

/**
 * Clear agent modules and state from IndexedDB.
 */
async function clearAgentData(roomId: string): Promise<void> {
  // Clear agent modules database (weave-agent-modules)
  try {
    const modulesDB = await openDB("weave-agent-modules", 1);
    if (modulesDB) {
      await deleteRoomModules(modulesDB, roomId);
      modulesDB.close();
    }
  } catch {
    // IndexedDB not available or error opening — skip
  }

  // Clear agent state database (weave-agent-state)
  try {
    const stateDB = await openDB("weave-agent-state", 1);
    if (stateDB) {
      await deleteRoomStates(stateDB, roomId);
      stateDB.close();
    }
  } catch {
    // IndexedDB not available or error opening — skip
  }
}

/**
 * Open an IndexedDB database.
 */
function openDB(name: string, version: number): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(name, version);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Delete all agent modules for a room from weave-agent-modules.
 */
function deleteRoomModules(db: IDBDatabase, roomId: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(["modules"], "readwrite");
      const store = tx.objectStore("modules");
      const index = store.index("roomId");
      const request = index.openCursor(IDBKeyRange.only(roomId));

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Delete all agent state for a room from weave-agent-state.
 */
function deleteRoomStates(db: IDBDatabase, roomId: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(["states"], "readwrite");
      const store = tx.objectStore("states");
      const request = store.openCursor();

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          if (
            typeof cursor.key === "string" &&
            cursor.key.startsWith(`${roomId}:`)
          ) {
            cursor.delete();
          }
          cursor.continue();
        }
      };

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Tell service worker to clear reminders for this room.
 * Also clears reminder records from weave-reminders IndexedDB.
 */
async function clearServiceWorkerReminders(roomId: string): Promise<void> {
  // Post message to service worker (if available)
  try {
    navigator.serviceWorker?.controller?.postMessage({
      type: "clear-room-reminders",
      roomId,
    });
  } catch {
    // Service worker not available — skip
  }

  // Also directly clear reminder records from IndexedDB
  try {
    const remindersDB = await openDB("weave-reminders", 1);
    if (remindersDB) {
      await deleteRoomReminders(remindersDB, roomId);
      remindersDB.close();
    }
  } catch {
    // IndexedDB not available or error opening — skip
  }
}

/**
 * Delete all reminder records for tasks in a room.
 * Note: taskIds don't contain roomId, so we need to delete all reminders
 * when a room is destroyed (the service worker doesn't know which tasks
 * belong to which room). In practice, this is acceptable since reminders
 * are only meaningful within an active room session.
 */
function deleteRoomReminders(db: IDBDatabase, _roomId: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(["reminders"], "readwrite");
      const store = tx.objectStore("reminders");
      // Clear all reminders (can't distinguish by room without task metadata)
      store.clear();

      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
