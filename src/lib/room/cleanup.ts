/**
 * Client-side cleanup orchestrator for room destruction.
 * Clears all traces of a room from the client: in-memory state,
 * sessionStorage, IndexedDB (agent modules/state), service worker reminders.
 */

import type { RoomSession } from "./session";
import { autoDeleteKey } from "./types";
import { clearPinKey } from "$lib/pin/store";

/**
 * Clean up all client-side state for a destroyed room.
 * Called on manual burn, auto-delete expiry, or room_destroyed from relay.
 */
export async function cleanupRoom(
  roomId: string,
  session: RoomSession | null,
): Promise<void> {
  // 1. Disconnect WebSocket session
  session?.disconnect();

  // 2. Clear sessionStorage keys for this room
  sessionStorage.removeItem("weave-olm-pickle");
  sessionStorage.removeItem("weave-key-warning-shown");
  sessionStorage.removeItem("weave-task-panel-open");
  sessionStorage.removeItem(autoDeleteKey(roomId));

  // 3. Clear IndexedDB agent data for this room
  await clearAgentData(roomId);

  // 4. Clear service worker reminders for this room
  await clearServiceWorkerReminders(roomId);

  // 5. Clear PIN key from IndexedDB
  await clearPinKey(roomId);
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
