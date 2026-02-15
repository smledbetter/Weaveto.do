import type { Task, TaskEvent } from "./types";
import type { RoomMember } from "$lib/room/session";

/**
 * Auto-assign unassigned pending tasks to members with lowest load.
 * Weights by task count + last-message recency.
 *
 * Returns task_assigned events (not yet sent — returned for preview).
 */
export function autoAssign(
  tasks: Task[],
  members: Map<string, RoomMember>,
  myIdentityKey: string,
  lastMessageTimes: Map<string, number>,
): TaskEvent[] {
  // Build lookup for blocked-status check
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  const unassigned = tasks.filter(
    (t) =>
      t.status === "pending" &&
      !t.assignee &&
      !t.blockedBy?.some((depId) => {
        const dep = taskMap.get(depId);
        return dep && dep.status !== "completed";
      }),
  );
  if (unassigned.length === 0) return [];

  // Build member list including self
  const allMembers = [myIdentityKey, ...Array.from(members.keys())];
  if (allMembers.length === 0) return [];

  // Count active (non-completed) tasks per member
  const load = new Map<string, number>();
  for (const key of allMembers) {
    load.set(
      key,
      tasks.filter((t) => t.assignee === key && t.status !== "completed")
        .length,
    );
  }

  const now = Date.now();
  const events: TaskEvent[] = [];

  for (const task of unassigned) {
    // Find member(s) with lowest load
    let minLoad = Infinity;
    for (const key of allMembers) {
      const l = load.get(key) ?? 0;
      if (l < minLoad) minLoad = l;
    }

    const candidates = allMembers.filter(
      (key) => (load.get(key) ?? 0) === minLoad,
    );

    // Tie-break by recency: most recently active member gets priority
    let chosen = candidates[0];
    if (candidates.length > 1) {
      let bestTime = -1;
      for (const key of candidates) {
        const t = lastMessageTimes.get(key) ?? 0;
        const recency = now - t < 600_000 ? t : 0; // 10 min window
        if (recency > bestTime) {
          bestTime = recency;
          chosen = key;
        }
      }
    }

    events.push({
      type: "task_assigned",
      taskId: task.id,
      task: { assignee: chosen },
      timestamp: now,
      actorId: myIdentityKey,
    });

    // Update local load count for next iteration
    load.set(chosen, (load.get(chosen) ?? 0) + 1);
  }

  return events;
}
