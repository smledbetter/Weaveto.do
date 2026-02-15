import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "fake-indexeddb/auto";
import {
  initReminderDB,
  scheduleReminder,
  cancelReminder,
  getDueReminders,
  type ReminderRecord,
} from "$lib/tasks/sw-reminders";

describe("sw-reminders (IndexedDB layer)", () => {
  let db: IDBDatabase;

  beforeEach(async () => {
    // Clear any existing database
    indexedDB.deleteDatabase("weave-reminders");
    db = await initReminderDB();
  });

  afterEach(() => {
    db.close();
  });

  describe("initReminderDB", () => {
    it("creates the object store", async () => {
      expect(db.objectStoreNames.contains("reminders")).toBe(true);
    });

    it("creates the fireAt index", () => {
      const tx = db.transaction(["reminders"], "readonly");
      const store = tx.objectStore("reminders");
      expect(store.indexNames.contains("fireAt")).toBe(true);
    });
  });

  describe("scheduleReminder", () => {
    it("stores a reminder with correct fireAt (dueAt - 5min)", async () => {
      const now = Date.now();
      const dueAt = now + 10 * 60_000; // 10 minutes from now
      const taskId = "task-1";

      await scheduleReminder(db, taskId, dueAt);

      const tx = db.transaction(["reminders"], "readonly");
      const store = tx.objectStore("reminders");
      const request = store.get(taskId);

      const record: ReminderRecord = await new Promise((resolve, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });

      expect(record).toBeDefined();
      expect(record.taskId).toBe(taskId);
      expect(record.dueAt).toBe(dueAt);
      expect(record.fireAt).toBe(dueAt - 5 * 60_000);
      expect(record.fired).toBe(false);
    });

    it("does not schedule if already past due", async () => {
      const now = Date.now();
      const dueAt = now - 1_000; // Already past due
      const taskId = "task-past";

      await scheduleReminder(db, taskId, dueAt);

      const tx = db.transaction(["reminders"], "readonly");
      const store = tx.objectStore("reminders");
      const request = store.get(taskId);

      const record: ReminderRecord | undefined = await new Promise(
        (resolve, reject) => {
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        },
      );

      expect(record).toBeUndefined();
    });

    it("overwrites existing reminder when rescheduling", async () => {
      const now = Date.now();
      const taskId = "task-resched";

      // First schedule
      const dueAt1 = now + 10 * 60_000;
      await scheduleReminder(db, taskId, dueAt1);

      // Reschedule with new time
      const dueAt2 = now + 20 * 60_000;
      await scheduleReminder(db, taskId, dueAt2);

      const tx = db.transaction(["reminders"], "readonly");
      const store = tx.objectStore("reminders");
      const request = store.get(taskId);

      const record: ReminderRecord = await new Promise((resolve, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });

      expect(record.dueAt).toBe(dueAt2);
      expect(record.fireAt).toBe(dueAt2 - 5 * 60_000);
    });
  });

  describe("cancelReminder", () => {
    it("deletes the reminder record", async () => {
      const now = Date.now();
      const dueAt = now + 10 * 60_000;
      const taskId = "task-cancel";

      await scheduleReminder(db, taskId, dueAt);
      await cancelReminder(db, taskId);

      const tx = db.transaction(["reminders"], "readonly");
      const store = tx.objectStore("reminders");
      const request = store.get(taskId);

      const record: ReminderRecord | undefined = await new Promise(
        (resolve, reject) => {
          request.onerror = () => reject(request.error);
          request.onsuccess = () => resolve(request.result);
        },
      );

      expect(record).toBeUndefined();
    });

    it("handles canceling non-existent reminder gracefully", async () => {
      // Should not throw
      await expect(cancelReminder(db, "non-existent")).resolves.toBeUndefined();
    });
  });

  describe("getDueReminders", () => {
    it("returns reminders where fireAt <= now and not fired", async () => {
      const now = Date.now();

      // Schedule reminders with future due times
      const dueAt1 = now + 10 * 60_000; // fireAt = now + 5min
      const dueAt2 = now + 30 * 60_000; // fireAt = now + 25min (not due yet)
      const dueAt3 = now + 20 * 60_000; // fireAt = now + 15min

      await scheduleReminder(db, "task-1", dueAt1);
      await scheduleReminder(db, "task-2", dueAt2);
      await scheduleReminder(db, "task-3", dueAt3);

      // Query at a time when task-1 and task-3 are due
      const queryTime = now + 16 * 60_000;
      const dueReminders = await getDueReminders(db, queryTime);

      expect(dueReminders.length).toBe(2);
      expect(dueReminders.map((r) => r.taskId).sort()).toEqual([
        "task-1",
        "task-3",
      ]);
    });

    it("excludes fired reminders", async () => {
      const now = Date.now();
      const dueAt = now + 10 * 60_000;

      await scheduleReminder(db, "task-fired", dueAt);

      // Mark as fired
      const tx1 = db.transaction(["reminders"], "readwrite");
      const store1 = tx1.objectStore("reminders");
      const record = await new Promise<ReminderRecord>((resolve, reject) => {
        const req = store1.get("task-fired");
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
      });

      if (record) {
        record.fired = true;
        const tx2 = db.transaction(["reminders"], "readwrite");
        const store2 = tx2.objectStore("reminders");
        store2.put(record);

        await new Promise((resolve) => {
          tx2.oncomplete = () => resolve(undefined);
        });
      }

      // Now query for due reminders at fireAt time
      const fireAt = dueAt - 5 * 60_000;
      const dueReminders = await getDueReminders(db, fireAt + 1_000);
      expect(dueReminders.length).toBe(0);
    });

    it("returns empty array when no reminders are due", async () => {
      const now = Date.now();
      const dueAt = now + 10 * 60_000; // Future reminder

      await scheduleReminder(db, "task-future", dueAt);

      const dueReminders = await getDueReminders(db, now);
      expect(dueReminders.length).toBe(0);
    });

    it("returns multiple due reminders", async () => {
      const now = Date.now();

      const dueAt1 = now + 10 * 60_000; // fireAt = now + 5min
      const dueAt2 = now + 6 * 60_000; // fireAt = now + 1min
      const dueAt3 = now + 20 * 60_000; // fireAt = now + 15min

      await scheduleReminder(db, "task-1", dueAt1);
      await scheduleReminder(db, "task-2", dueAt2);
      await scheduleReminder(db, "task-3", dueAt3);

      const dueReminders = await getDueReminders(db, now + 6 * 60_000);

      expect(dueReminders.length).toBe(2); // Only task-2 and task-1 are due at this query time
      // Verify both task IDs are present (order may vary)
      const taskIds = dueReminders.map((r) => r.taskId).sort();
      expect(taskIds).toEqual(["task-1", "task-2"]);
    });
  });

  describe("integration: schedule, query, cancel", () => {
    it("full lifecycle: schedule -> query -> cancel", async () => {
      const now = Date.now();
      const dueAt = now + 10 * 60_000;

      // Initially no reminders
      let due = await getDueReminders(db, now);
      expect(due.length).toBe(0);

      // Schedule
      await scheduleReminder(db, "task-lifecycle", dueAt);

      // Query after scheduled but before due
      due = await getDueReminders(db, now);
      expect(due.length).toBe(0);

      // Query at due time (simulate time passing)
      const fireAt = dueAt - 5 * 60_000;
      due = await getDueReminders(db, fireAt + 1_000);
      expect(due.length).toBe(1);
      expect(due[0].taskId).toBe("task-lifecycle");

      // Cancel
      await cancelReminder(db, "task-lifecycle");

      // Verify cancelled
      due = await getDueReminders(db, fireAt + 1_000);
      expect(due.length).toBe(0);
    });
  });
});
