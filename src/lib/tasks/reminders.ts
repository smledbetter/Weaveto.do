import type { Task, TaskId } from "./types";

/** Reminders fire 5 minutes before the due time. */
export const REMINDER_LEAD_TIME = 5 * 60_000;

export type ReminderHandler = (task: Task) => void;

/**
 * In-tab reminder scheduler using setTimeout + Notification API.
 * Also integrates with service worker for persistent reminders.
 *
 * When a service worker is available, reminders are also sent to it
 * for cross-tab persistence. Graceful fallback: if no SW available,
 * setTimeout logic works exactly as before.
 */
export class ReminderScheduler {
  private timers = new Map<TaskId, ReturnType<typeof setTimeout>>();
  private handler: ReminderHandler;
  private swController: ServiceWorkerContainer | null = null;

  constructor(handler: ReminderHandler) {
    this.handler = handler;

    // Initialize service worker listener if available
    if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      this.swController = navigator.serviceWorker;
      this.setupSWListener();
    }
  }

  /**
   * Listen for REMINDER_FIRED messages from the service worker.
   */
  private setupSWListener() {
    if (!this.swController) return;

    this.swController.addEventListener("message", (event) => {
      if (event.data?.type === "REMINDER_FIRED") {
        // Note: We don't have the full task object from SW,
        // but in the real app the component will update from the socket.
        // This is mainly to ensure UI responsiveness.
        console.log("Reminder fired from service worker:", event.data.taskId);
      }
    });
  }

  /**
   * Send a message to the service worker.
   */
  private async postToServiceWorker(message: Record<string, unknown>) {
    if (!this.swController?.controller) return;

    try {
      this.swController.controller.postMessage(message);
    } catch (err) {
      console.error("Failed to post to service worker:", err);
    }
  }

  scheduleReminder(task: Task): void {
    // Don't schedule if no due time, already completed, or past due
    if (!task.dueAt || task.status === "completed") return;

    const fireAt = task.dueAt - REMINDER_LEAD_TIME;
    const delay = fireAt - Date.now();

    if (delay < 0 && task.dueAt < Date.now()) {
      // Task is already past due — don't schedule
      return;
    }

    // Cancel existing timer for this task (if rescheduling)
    this.cancelReminder(task.id);

    const timer = setTimeout(
      () => {
        this.timers.delete(task.id);
        this.handler(task);
      },
      Math.max(0, delay),
    );

    this.timers.set(task.id, timer);

    // Also schedule in service worker if available
    this.postToServiceWorker({
      type: "SCHEDULE_REMINDER",
      taskId: task.id,
      dueAt: task.dueAt,
    });
  }

  cancelReminder(taskId: TaskId): void {
    const timer = this.timers.get(taskId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }

    // Also cancel in service worker if available
    this.postToServiceWorker({
      type: "CANCEL_REMINDER",
      taskId,
    });
  }

  clearAll(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
