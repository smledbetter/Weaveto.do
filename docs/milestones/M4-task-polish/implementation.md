# M4 Implementation Plan: Task Polish

## Context

M4 adds task descriptions, due date sorting, quick-pick date buttons, urgent flags, and room-scoped search. All features are additive UI + small schema changes on top of the event-sourced task store from M1-M3.5. No architectural shifts, no relay changes, no crypto changes.

## must_haves

### truths (observable outcomes)
- User can add a text description when creating a task
- User can see task descriptions displayed below titles in the task panel
- User can toggle sort order: creation → due-asc → due-desc
- User can click Today/Tomorrow/Next Week buttons to set due dates quickly
- User can mark a task as urgent with a visible text badge
- Urgent tasks sort above non-urgent in all sort modes
- User can search tasks by title or description within the current room
- All new fields are encrypted (zero plaintext on relay)

### artifacts (files produced)
- `src/lib/tasks/types.ts` — updated Task interface (description, urgent)
- `src/lib/tasks/store.svelte.ts` — updated handleCreate for new fields
- `src/lib/tasks/parser.ts` — updated with `urgent` and `desc:` directives
- `src/lib/components/TaskCreateModal.svelte` — description textarea, urgent checkbox, quick-pick buttons
- `src/lib/components/TaskPanel.svelte` — sort toggle, search input, urgent badge, description display
- `src/routes/room/[id]/+page.svelte` — pass new fields through handleTaskEvent
- `src/theme.css` — add `--status-urgent` token
- `tests/unit/task-store.test.ts` — new field tests
- `tests/unit/task-parser.test.ts` — new directive tests
- `tests/e2e/task-polish.spec.ts` — M4 E2E tests

### key_links (where breakage cascades)
- `Task` interface changes affect: store, parser, TaskPanel, TaskCreateModal, agent.ts, E2E tests
- `onCreateTask` callback signature changes in: TaskCreateModal → room page → session
- Sort/filter logic in TaskPanel affects: task display, auto-assign preview, progress bar

## Deferred (per UX consensus)
- Description inline editing (M4.5)
- Quick-pick buttons in inline due date editing (M4.5)
- Description expand/collapse toggle (use scrollable max-height instead)

## Waves

### Wave 1: Schema + Theme
> No dependencies. Foundation for all other waves.

**Task 1.1** (type: auto)
- **Files**: `src/lib/tasks/types.ts`
- **Action**: Add `description?: string` and `urgent?: boolean` to Task interface
- **Verify**: `npm run check` passes
- **Done**: Types compile, no regressions

**Task 1.2** (type: auto)
- **Files**: `src/theme.css`
- **Action**: Add `--status-urgent` and `--status-urgent-bg` tokens (dark: #d87878/#1a1014, light: #c03030/#f5e0e0)
- **Verify**: Visual inspection
- **Done**: Tokens available in both themes

### Wave 2: Store + Parser
> Depends on: Wave 1 (types)

**Task 2.1** (type: auto)
- **Files**: `src/lib/tasks/store.svelte.ts`, `tests/unit/task-store.test.ts`
- **Action**: Add conditional spreads for `description` and `urgent` in `handleCreate()`. Write tests for: create with description, create with urgent, update urgent toggle, conflict resolution on new fields
- **Verify**: `npm run test:unit` passes, coverage >= 80%
- **Done**: Store handles description + urgent in events

**Task 2.2** (type: auto)
- **Files**: `src/lib/tasks/parser.ts`, `tests/unit/task-parser.test.ts`
- **Action**: Add `urgent` directive (boolean flag) and `desc: text` directive to parseTaskCommand(). Write tests for: `/task Title | urgent`, `/task Title | desc: details`, `/task Title | urgent | desc: details | due: tomorrow`
- **Verify**: `npm run test:unit` passes
- **Done**: Parser handles new directives

### Wave 3: TaskCreateModal
> Depends on: Wave 1 (types)

**Task 3.1** (type: auto)
- **Files**: `src/lib/components/TaskCreateModal.svelte`
- **Action**: Add description textarea after title, urgent checkbox after due date, quick-pick date buttons (Today/Tomorrow/Next Week) above due date text input. Update `onCreateTask` callback to include `description` and `urgent` params. Ensure keyboard tab order: Title → Description → Assignee → Quick-picks → Due input → Urgent → Blocked by → Subtasks
- **Verify**: `npm run check` passes
- **Done**: Modal creates tasks with all new fields

### Wave 4: TaskPanel + Room Page
> Depends on: Wave 2 (store), Wave 3 (modal callback)

**Task 4.1** (type: auto)
- **Files**: `src/lib/components/TaskPanel.svelte`
- **Action**:
  - Add `sortMode` state cycling: creation → due-asc → due-desc
  - Add sort toggle button in header with aria-label and aria-live announcement
  - Add search input below header with `type="search"` and aria-label
  - Add `filteredTasks` derived state (case-insensitive match on title + description)
  - Add `sortedTasks` derived state (sort by mode, urgent first as secondary key)
  - Add urgent text badge (consistent with existing "Blocked" badge pattern)
  - Add description display below title (plain text, `max-height: 4em; overflow-y: auto; white-space: pre-wrap`)
  - Add result count aria-live region for search
- **Verify**: `npm run check` passes
- **Done**: Panel displays all new features with full a11y

**Task 4.2** (type: auto)
- **Files**: `src/routes/room/[id]/+page.svelte`
- **Action**: Update `onCreateTask` handler to pass `description` and `urgent` to TaskEvent. Update `handleTaskEvent` to include new fields in event payload.
- **Verify**: `npm run check` passes
- **Done**: Room page wires new fields through E2EE pipeline

### Wave 5: Tests + Verification
> Depends on: Wave 4

**Task 5.1** (type: auto)
- **Files**: `tests/e2e/task-polish.spec.ts`
- **Action**: Write E2E tests covering:
  - Create task with description and urgent flag
  - Sort toggle cycles through 3 modes
  - Quick-pick buttons populate due date
  - Search filters tasks by title and description
  - Search shows empty state for no matches
  - Urgent badge visible on urgent tasks
  - All existing E2E tests still pass (regression)
- **Verify**: `npm run test:e2e` passes
- **Done**: All acceptance scenarios covered

**Task 5.2** (type: auto)
- **Files**: All
- **Action**: Run full verification suite: `npm run test:unit && npm run test:e2e && npm run check`
- **Verify**: Zero failures, coverage targets met
- **Done**: Quality gates pass

## Agent Strategy

| Wave | Agent | Model | Tasks |
|------|-------|-------|-------|
| 1 | Worker A | haiku | 1.1 (types) |
| 1 | Worker B | haiku | 1.2 (theme) |
| 2 | Worker C | sonnet | 2.1 (store + tests) |
| 2 | Worker D | sonnet | 2.2 (parser + tests) |
| 3 | Worker E | sonnet | 3.1 (create modal) |
| 4 | Worker F | sonnet | 4.1 (task panel) |
| 4 | Worker G | haiku | 4.2 (room page wiring) |
| 5 | Worker H | sonnet | 5.1 (E2E tests) |
| 5 | Lead | sonnet | 5.2 (verification) |

## Commit Strategy

```
feat(M4): add description and urgent fields to Task type
feat(M4): add --status-urgent theme tokens
feat(M4): store handles description and urgent in events
feat(M4): parser supports urgent and desc: directives
feat(M4): description, urgent, and quick-pick dates in create modal
feat(M4): sort toggle, search, urgent badge, descriptions in task panel
feat(M4): wire new task fields through room page
test(M4): E2E tests for task polish features
```

## Verification

### Automated
```bash
npm run test:unit    # 80%+ coverage on new/modified modules
npm run test:e2e     # 0 regressions + new M4 tests
npm run check        # svelte-check passes
```

### Manual
1. Create task with description + urgent flag via modal
2. Verify description displays below title in panel
3. Click sort toggle — cycles through 3 modes correctly
4. Click Today/Tomorrow/Next Week — due date populates
5. Type in search box — tasks filter in real-time
6. Verify urgent badge is text (not color alone)
7. Open in second browser tab — verify encrypted fields sync
