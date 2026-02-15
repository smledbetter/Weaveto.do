export type TaskId = string;
export type TaskStatus = "pending" | "in_progress" | "completed";

export interface Task {
  id: TaskId;
  title: string;
  status: TaskStatus;
  assignee?: string; // identityKey
  parentId?: TaskId;
  createdBy: string; // identityKey
  createdAt: number;
  updatedAt: number;
  dueAt?: number;
  blockedBy?: TaskId[]; // tasks that must complete before this one
}

export type TaskEventType =
  | "task_created"
  | "subtask_created"
  | "task_assigned"
  | "task_status_changed"
  | "task_dependencies_changed";

export interface TaskEvent {
  type: TaskEventType;
  taskId: TaskId;
  task?: Partial<Task>;
  timestamp: number;
  actorId: string; // identityKey — for conflict resolution tiebreaker
}
