import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  ReminderScheduler,
  REMINDER_LEAD_TIME,
  type ReminderHandler,
} from "$lib/tasks/reminders";
import type { Task } from "$lib/tasks/types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: crypto.randomUUID(),
    title: "Test task",
    status: "pending",
    createdBy: "creator",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("ReminderScheduler", () => {
  let scheduler: ReminderScheduler;
  let handler: ReminderHandler;

  beforeEach(() => {
    vi.useFakeTimers();
    handler = vi.fn() as unknown as ReminderHandler;
    scheduler = new ReminderScheduler(handler);
  });

  afterEach(() => {
    scheduler.clearAll();
    vi.useRealTimers();
  });

  it("scheduleReminder sets timer for dueAt minus lead time", () => {
    const now = Date.now();
    const dueAt = now + 10 * 60_000; // 10 min from now
    const task = makeTask({ dueAt });

    scheduler.scheduleReminder(task);

    // Advance to just before the reminder should fire (5 min lead = fires at 5 min)
    vi.advanceTimersByTime(5 * 60_000 - 100);
    expect(handler).not.toHaveBeenCalled();

    // Advance past the trigger point
    vi.advanceTimersByTime(200);
    expect(handler).toHaveBeenCalledWith(task);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("cancelReminder clears the timer", () => {
    const now = Date.now();
    const task = makeTask({ dueAt: now + 10 * 60_000 });

    scheduler.scheduleReminder(task);
    scheduler.cancelReminder(task.id);

    vi.advanceTimersByTime(15 * 60_000);
    expect(handler).not.toHaveBeenCalled();
  });

  it("clearAll clears all timers", () => {
    const now = Date.now();
    const task1 = makeTask({ dueAt: now + 10 * 60_000 });
    const task2 = makeTask({ dueAt: now + 20 * 60_000 });

    scheduler.scheduleReminder(task1);
    scheduler.scheduleReminder(task2);
    scheduler.clearAll();

    vi.advanceTimersByTime(25 * 60_000);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not schedule reminders for tasks without dueAt", () => {
    const task = makeTask(); // no dueAt
    scheduler.scheduleReminder(task);

    vi.advanceTimersByTime(60 * 60_000);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not schedule reminders for past due tasks", () => {
    const now = Date.now();
    const task = makeTask({ dueAt: now - 60_000 }); // 1 min ago

    scheduler.scheduleReminder(task);

    vi.advanceTimersByTime(60 * 60_000);
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not schedule reminders for completed tasks", () => {
    const now = Date.now();
    const task = makeTask({ dueAt: now + 10 * 60_000, status: "completed" });

    scheduler.scheduleReminder(task);

    vi.advanceTimersByTime(15 * 60_000);
    expect(handler).not.toHaveBeenCalled();
  });

  it("fires immediately when due time is within lead time", () => {
    const now = Date.now();
    // Due in 2 minutes — less than 5 min lead time, so fire immediately (delay ~0)
    const task = makeTask({ dueAt: now + 2 * 60_000 });

    scheduler.scheduleReminder(task);

    // Should fire almost immediately (next tick)
    vi.advanceTimersByTime(50);
    expect(handler).toHaveBeenCalledWith(task);
  });

  it("replaces existing reminder when rescheduled", () => {
    const now = Date.now();
    const task = makeTask({ dueAt: now + 10 * 60_000 });

    scheduler.scheduleReminder(task);

    // Reschedule with a later due time
    const updated = { ...task, dueAt: now + 20 * 60_000 };
    scheduler.scheduleReminder(updated);

    // Original fire time (5 min) should not trigger
    vi.advanceTimersByTime(5 * 60_000 + 100);
    expect(handler).not.toHaveBeenCalled();

    // New fire time (15 min) should trigger
    vi.advanceTimersByTime(10 * 60_000);
    expect(handler).toHaveBeenCalledWith(updated);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("exports REMINDER_LEAD_TIME as 5 minutes", () => {
    expect(REMINDER_LEAD_TIME).toBe(5 * 60_000);
  });
});
