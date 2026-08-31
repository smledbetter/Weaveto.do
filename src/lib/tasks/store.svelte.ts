import type { Task, TaskEvent, TaskId } from "./types";

/**
 * Event-sourced task store with conflict resolution.
 *
 * Conflict rules:
 * - Reject update events with timestamp older than task's updatedAt
 * - Ties broken by actorId lexicographic order (higher wins)
 * - Duplicate detection: skip events matching taskId + type + timestamp + actorId
 * - Reject events with timestamps too far in the future (clock skew protection)
 */

const MAX_FUTURE_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

type EventKey = string;

function eventKey(e: TaskEvent): EventKey {
  return `${e.taskId}:${e.type}:${e.timestamp}:${e.actorId}`;
}

class TaskStore {
  private tasksMap = new Map<TaskId, Task>();
  private seenEvents = new Set<EventKey>();
  private lastActorByTask = new Map<TaskId, string>();
  private appliedEvents: TaskEvent[] = [];

  applyEvent(event: TaskEvent): void {
    // Reject events with timestamps too far in the future
    if (event.timestamp > Date.now() + MAX_FUTURE_DRIFT_MS) return;

    const key = eventKey(event);

    if (this.seenEvents.has(key)) return;
    this.seenEvents.add(key);
    this.appliedEvents.push(event);

    switch (event.type) {
      case "task_created":
      case "subtask_created":
        this.handleCreate(event);
        break;
      case "task_assigned":
      case "task_status_changed":
      case "task_dependencies_changed":
      case "task_updated":
      case "task_urgency_changed":
        this.handleUpdate(event);
        break;
    }
  }

  private handleCreate(event: TaskEvent): void {
    if (!event.task) return;

    const task: Task = {
      id: event.taskId,
      title: event.task.title ?? "",
      status: event.task.status ?? "pending",
      createdBy: event.task.createdBy ?? event.actorId,
      createdAt: event.task.createdAt ?? event.timestamp,
      updatedAt: event.timestamp,
      ...(event.task.assignee !== undefined && {
        assignee: event.task.assignee,
      }),
      ...(event.task.parentId !== undefined && {
        parentId: event.task.parentId,
      }),
      ...(event.task.dueAt !== undefined && { dueAt: event.task.dueAt }),
      ...(event.task.description !== undefined && {
        description: event.task.description,
      }),
      ...(event.task.urgent !== undefined && { urgent: event.task.urgent }),
    };

    // Validate blockedBy on create
    if (event.task.blockedBy !== undefined) {
      task.blockedBy = this.validateDependencies(
        event.taskId,
        event.task.blockedBy,
      );
    }

    this.tasksMap.set(event.taskId, task);
    this.lastActorByTask.set(event.taskId, event.actorId);
  }

  private handleUpdate(event: TaskEvent): void {
    const existing = this.tasksMap.get(event.taskId);
    if (!existing || !event.task) return;

    if (event.timestamp < existing.updatedAt) return;

    if (event.timestamp === existing.updatedAt) {
      const prevActor = this.lastActorByTask.get(event.taskId) ?? "";
      if (event.actorId <= prevActor) return;
    }

    const updated: Task = {
      ...existing,
      ...event.task,
      updatedAt: event.timestamp,
    };

    // Validate dependencies if changed
    if (event.task.blockedBy !== undefined) {
      updated.blockedBy = this.validateDependencies(
        event.taskId,
        event.task.blockedBy,
      );
    }

    if (
      event.type === "task_assigned" &&
      event.task.assignee &&
      updated.status === "pending"
    ) {
      updated.status = "in_progress";
    }

    this.tasksMap.set(event.taskId, updated);
    this.lastActorByTask.set(event.taskId, event.actorId);
  }

  /**
   * Validate dependencies: filter out self-references, non-existent tasks,
   * and cycle-creating dependencies.
   */
  private validateDependencies(taskId: TaskId, blockedBy: TaskId[]): TaskId[] {
    return blockedBy.filter((depId) => {
      if (depId === taskId) return false;
      if (!this.tasksMap.has(depId)) return false;
      return this.isValidDependency(taskId, depId);
    });
  }

  /**
   * BFS cycle detection: check if adding depId as a dependency of taskId
   * would create a cycle. Returns true if safe (no cycle).
   */
  private isValidDependency(taskId: TaskId, depId: TaskId): boolean {
    const visited = new Set<TaskId>();
    const queue = [depId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      if (current === taskId) return false;
      if (visited.has(current)) continue;
      visited.add(current);

      const task = this.tasksMap.get(current);
      if (task?.blockedBy) {
        queue.push(...task.blockedBy);
      }
    }

    return true;
  }

  /**
   * Check if a task is blocked by incomplete dependencies.
   */
  isBlocked(taskId: TaskId): boolean {
    const task = this.tasksMap.get(taskId);
    if (!task?.blockedBy || task.blockedBy.length === 0) return false;

    return task.blockedBy.some((depId) => {
      const dep = this.tasksMap.get(depId);
      return dep && dep.status !== "completed";
    });
  }

  /**
   * Get incomplete tasks that block the given task.
   */
  getBlockingTasks(taskId: TaskId): Task[] {
    const task = this.tasksMap.get(taskId);
    if (!task?.blockedBy) return [];

    return task.blockedBy
      .map((depId) => this.tasksMap.get(depId))
      .filter(
        (dep): dep is Task => dep !== undefined && dep.status !== "completed",
      );
  }

  /**
   * Subtask completion percentage for a parent task.
   * Returns null if task has no subtasks.
   */
  getTaskProgress(taskId: TaskId): number | null {
    const subtasks = this.getTasksByParent(taskId);
    if (subtasks.length === 0) return null;

    const completed = subtasks.filter((t) => t.status === "completed").length;
    return Math.round((completed / subtasks.length) * 100);
  }

  /**
   * Room-level progress statistics.
   */
  getRoomProgress(): {
    total: number;
    completed: number;
    inProgress: number;
    pending: number;
    blocked: number;
  } {
    const tasks = this.getTasks();
    let blocked = 0;
    for (const task of tasks) {
      if (task.status !== "completed" && this.isBlocked(task.id)) {
        blocked++;
      }
    }

    return {
      total: tasks.length,
      completed: tasks.filter((t) => t.status === "completed").length,
      inProgress: tasks.filter((t) => t.status === "in_progress").length,
      pending: tasks.filter((t) => t.status === "pending").length,
      blocked,
    };
  }

  getTask(id: TaskId): Task | undefined {
    return this.tasksMap.get(id);
  }

  getTasks(): Task[] {
    return Array.from(this.tasksMap.values());
  }

  getPendingTasks(): Task[] {
    return this.getTasks().filter((t) => t.status !== "completed");
  }

  getTasksByParent(parentId: TaskId): Task[] {
    return this.getTasks().filter((t) => t.parentId === parentId);
  }

  getTaskCount(): number {
    return this.tasksMap.size;
  }

  /**
   * Return a serializable snapshot of all tasks.
   * Used for offline persistence — the returned objects are plain (no Proxy).
   */
  getSnapshot(): Task[] {
    return this.getTasks().map(t => ({ ...t }));
  }

  /**
   * Return events applied within the last `windowMs` milliseconds.
   * Used for sync on reconnect — sends recent event history to peers.
   */
  getRecentEvents(windowMs: number = 24 * 60 * 60 * 1000): TaskEvent[] {
    const cutoff = Date.now() - windowMs;
    return this.appliedEvents
      .filter(e => e.timestamp >= cutoff)
      .map(e => ({ ...e, task: e.task ? { ...e.task } : undefined }));
  }

  /**
   * Clear the event log. Called on room cleanup.
   */
  clearEventLog(): void {
    this.appliedEvents = [];
  }

  /**
   * Load tasks from an offline snapshot. Existing tasks are preserved;
   * snapshot tasks are only added if not already present (online data wins).
   */
  loadSnapshot(tasks: Task[]): void {
    for (const task of tasks) {
      if (!this.tasksMap.has(task.id)) {
        this.tasksMap.set(task.id, { ...task });
      }
    }
  }

  clear(): void {
    this.tasksMap.clear();
    this.seenEvents.clear();
    this.lastActorByTask.clear();
    this.appliedEvents = [];
  }
}

export function createTaskStore(): TaskStore {
  return new TaskStore();
}
