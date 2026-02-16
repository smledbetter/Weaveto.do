import type { TaskEvent } from "./types";
import { parseNaturalDate } from "./date-parser";

export interface ParseResult {
  events: TaskEvent[];
  error?: string;
}

/**
 * Parse /task commands from composer input.
 *
 * Syntax:
 * - /task Title
 * - /task Title | split into: A, B, C
 * - /task Title | due: 2h
 *
 * Returns null for non-task messages (pass through to normal chat).
 * Returns { events: [], error } for invalid task commands.
 */
export function parseTaskCommand(
  text: string,
  actorId: string,
): ParseResult | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/task")) return null;

  const content = trimmed.slice(5).trim();
  if (!content) {
    return { events: [], error: "Task title is required." };
  }

  // Split on pipe to separate title from directives
  const parts = content.split("|").map((p) => p.trim());
  const title = parts[0];

  if (!title) {
    return { events: [], error: "Task title is required." };
  }

  const now = Date.now();
  let dueAt: number | undefined;
  let subtaskTitles: string[] | undefined;
  let description: string | undefined;
  let urgent = false;

  // Parse directives
  for (let i = 1; i < parts.length; i++) {
    const directive = parts[i];

    // Split into: A, B, C
    const splitMatch = directive.match(/^split\s+into:\s*(.+)$/i);
    if (splitMatch) {
      subtaskTitles = splitMatch[1]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      continue;
    }

    // due: tomorrow / next friday / 2h / 30m / 1d
    const dueMatch = directive.match(/^due:\s*(.+)$/i);
    if (dueMatch) {
      const parsed = parseNaturalDate(dueMatch[1].trim());
      if (parsed === null) {
        return {
          events: [],
          error:
            "Could not parse date. Try: tomorrow, next friday, in 3 hours, 30m",
        };
      }
      dueAt = parsed.timestamp;
      continue;
    }

    // desc: description text
    const descMatch = directive.match(/^desc:\s*(.+)$/i);
    if (descMatch) {
      description = descMatch[1];
      continue;
    }

    // urgent
    if (directive.match(/^urgent$/i)) {
      urgent = true;
      continue;
    }
  }

  const events: TaskEvent[] = [];
  const parentId = crypto.randomUUID();

  // Parent task
  events.push({
    type: "task_created",
    taskId: parentId,
    task: {
      title,
      status: "pending",
      createdBy: actorId,
      ...(dueAt !== undefined && { dueAt }),
      ...(description && { description }),
      ...(urgent && { urgent }),
    },
    timestamp: now,
    actorId,
  });

  // Subtasks
  if (subtaskTitles) {
    for (const subtaskTitle of subtaskTitles) {
      events.push({
        type: "subtask_created",
        taskId: crypto.randomUUID(),
        task: {
          title: subtaskTitle,
          status: "pending",
          parentId,
          createdBy: actorId,
        },
        timestamp: now,
        actorId,
      });
    }
  }

  return { events };
}
