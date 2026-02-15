# M1 Plan: Task Management & Agent Orchestration

Status: **Complete**

## Scope

Task creation, assignment, and reminders — all encrypted, riding the existing `encrypted` message type. Zero relay server changes.

## Key Design Decisions

1. **Tasks ride existing `encrypted` message type** — JSON payload gains optional `taskEvent` field alongside `text`. Relay sees no difference.
2. **Event sourcing** — task state derived from TaskEvent stream. Conflict resolution: highest timestamp wins, actorId lexicographic tiebreaker.
3. **No new runtime dependencies** — uses `crypto.randomUUID()` (built-in).
4. **Agent is a pure function** — `autoAssign(tasks, members, key, times)` returns assignment events. No background process.
5. **Reminders are in-tab only** — setTimeout + Notification API. Lost on tab close. Persistent reminders deferred to M2.
6. **1-level subtask depth** — parent -> children only.
7. **Form-based creation primary UX** — modal with title, assignee, due date, subtasks. `/task` command as power-user shortcut.
8. **Collapsible task panel** — messages default to full width. Panel slides out on demand.

## Files Created

| File | Purpose |
|------|---------|
| `src/lib/tasks/types.ts` | Task, TaskEvent, TaskStatus type definitions |
| `src/lib/tasks/store.svelte.ts` | Event-sourced task store with conflict resolution |
| `src/lib/tasks/parser.ts` | Parse `/task` commands (power-user shortcut) |
| `src/lib/tasks/agent.ts` | autoAssign() — load balancer with recency weighting |
| `src/lib/tasks/reminders.ts` | ReminderScheduler — setTimeout + Notification API |
| `src/lib/components/TaskPanel.svelte` | Collapsible task list panel |
| `src/lib/components/TaskCreateModal.svelte` | Form-based task creation modal |
| `tests/unit/task-store.test.ts` | Store unit tests |
| `tests/unit/task-parser.test.ts` | Parser unit tests |
| `tests/unit/task-agent.test.ts` | Agent unit tests |
| `tests/unit/task-reminders.test.ts` | Reminder unit tests |

## Files Modified

| File | Change |
|------|--------|
| `src/lib/room/session.ts` | Extended DecryptedMessage with taskEvent, added sendTaskEvent(), lastMessageTime tracking |
| `src/routes/room/[id]/+page.svelte` | Task panel integration, /task interception, reminder wiring, mobile tabs |
| `src/theme.css` | Task panel, modal, and task item styles |
| `package.json` | Added vitest devDep, test:unit script |
| `vitest.config.ts` | Vitest config with 80% coverage thresholds |

## Implementation Phases

1. **Test infra + Foundation** — Vitest setup, types, store (TDD), session extensions
2. **Parser (TDD)** — /task command parsing, composer interception
3. **Task Panel + Modal UI** — collapsible panel, form-based creation, mobile tabs
4. **Assignment Agent (TDD)** — autoAssign pure function, preview modal
5. **Reminders (TDD)** — ReminderScheduler, Notification API, toast UI
6. **Polish** — accessibility, security validation, performance, M0 regression tests
