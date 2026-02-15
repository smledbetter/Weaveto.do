# M2 Plan: Task Intelligence

Status: **Not Started**

## Scope

Smarten the task experience: natural language dates, dependency graphs, progress tracking, persistent reminders, and UX polish (keyboard shortcuts, inline editing). Zero relay changes. All task data remains E2E encrypted.

## Features (Priority Order)

### P1. Task Dependencies (blockedBy/blocks)
- `blockedBy: string[]` and `blocks: string[]` fields on Task type
- New event type: `task_dependency_added`
- DAG validation — reject circular dependencies client-side
- Derived `blocked` status (true if any blockedBy task is not completed)
- Completing a blocking task unblocks dependents
- Auto-assign skips blocked tasks
- Visual: greyed-out blocked tasks with chain icon, dependency count

### P2. Natural Language Due Dates
- Parse "tomorrow", "next friday", "in 3 hours", "next week"
- Preserve existing relative format ("30m", "2h", "1d")
- Show parsed date preview before committing
- Validation errors with helpful suggestions
- Works in both TaskCreateModal and `/task` command

### P3. Service Worker Reminders
- Persistent reminders that survive tab close
- Service worker registration and lifecycle management
- Cross-tab coordination via BroadcastChannel (no duplicate notifications)
- Encrypted reminder data in IndexedDB
- Graceful fallback to in-tab setTimeout if service worker unavailable

### P4. Progress Visibility
- Parent task completion % based on subtask completion
- Room-level progress in task panel header ("6/10 tasks complete (60%)")
- Progress bar/ring on parent task items
- Blocked tasks count as incomplete in progress calculations

### P5. Keyboard Shortcuts
- `Cmd/Ctrl+K` — open task create modal
- `Escape` — close modal/panel
- `Tab/Shift+Tab` — navigate task panel
- `Enter` on task — toggle complete
- Keyboard shortcut help accessible from panel

### P6. Inline Task Editing
- Click task title to edit inline
- Edit due date inline (reuses natural language parser)
- New event type: `task_updated`
- `Escape` to cancel, `Enter` to save

## Design Decisions

1. **Dependencies are event-sourced** — `task_dependency_added` event, same conflict resolution (timestamp + actorId tiebreaker)
2. **No external dependency for date parsing** — hand-roll a focused parser for the supported patterns (avoids adding chrono-node bundle weight to E2EE app)
3. **Service worker is additive** — enhances existing reminder system, doesn't replace it. Falls back gracefully.
4. **Progress is derived state** — computed from task store, not stored as events
5. **Inline editing reuses existing event types** — `task_status_changed` for completions, new `task_updated` for title/due changes

## Implementation Phases

### Phase 1: Task Dependencies (foundation)
- Extend types.ts with blockedBy/blocks and task_dependency_added event
- Extend store with dependency tracking, DAG validation, blocked status derivation
- Update auto-assign to skip blocked tasks
- UI: blocked indicators in TaskPanel, "Blocked by" field in TaskCreateModal
- TDD: dependency store tests, DAG cycle detection tests

### Phase 2: Natural Language Dates + Service Worker (parallel)
- **Stream A**: Natural language date parser, preview in modal/command, updated validation
- **Stream B**: Service worker registration, BroadcastChannel, encrypted IndexedDB storage
- TDD: parser tests for all date formats, service worker lifecycle tests

### Phase 3: Progress + Polish (parallel)
- **Stream A**: Progress derived state, parent task %, room-level progress bar
- **Stream B**: Keyboard shortcuts, inline task editing, task_updated event
- TDD: progress calculation tests, inline editing tests

### Phase 4: Integration & Quality
- Full E2E test suite (new tests + M0/M1 regression)
- Accessibility audit (axe-core on new UI)
- Security review (service worker, IndexedDB encryption)
- Performance benchmarks
