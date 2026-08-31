# M14 — Local Notifications: Implementation Plan

## must_haves

### truths
- Contextual opt-in prompt appears below first due-date task (never on page load)
- Bell icon in task panel header only visible after notification permission granted
- Bell popover has on/off toggle + quiet hours time range (08:00–22:00 default)
- Notifications fire for: assignment to me, status change on my task, due date approaching
- All notification bodies are generic (no task content, room names, or user names)
- Quiet hours enforced in service worker (not just UI)
- No notifications in ephemeral rooms
- No notifications when tab is focused

### artifacts
- `src/lib/notifications/types.ts` — NotificationPrefs interface, message types
- `src/lib/notifications/store.ts` — IndexedDB preferences store (shared with SW)
- `src/lib/notifications/triggers.ts` — notification trigger logic (assignment, status, due date)
- `src/lib/components/NotificationOptIn.svelte` — contextual opt-in inline prompt
- `src/lib/components/NotificationBell.svelte` — bell icon + popover
- `src/service-worker.ts` — quiet hours check before showNotification
- `tests/unit/notification-store.test.ts` — prefs store unit tests
- `tests/unit/notification-triggers.test.ts` — trigger logic unit tests
- `tests/e2e/notifications.spec.ts` — E2E tests

### key_links
- `NotificationOptIn` rendered inside `TaskPanel.svelte` (below progress bar, above task list)
- `NotificationBell` rendered inside `TaskPanel.svelte` panel-actions div
- Triggers called from `+page.svelte` `handleTaskEvent()` and remote event handler
- SW reads prefs from same IndexedDB store as main thread writes
- Prefs store uses `weave-reminders` DB (existing) with new `notification-prefs` object store

## Wave Plan

### Wave 1: Foundation (types + stores + SW quiet hours)
**Files**: `src/lib/notifications/types.ts`, `src/lib/notifications/store.ts`, `src/service-worker.ts`, `src/lib/tasks/sw-reminders.ts`
**Agent**: sonnet (logic-heavy IndexedDB + SW integration)
**Dependencies**: None

Tasks:
1. Create `src/lib/notifications/types.ts`:
   - `NotificationPrefs` interface: `{ enabled: boolean, quietStart: string, quietEnd: string, roomId: string }`
   - SW message types: `UPDATE_NOTIFICATION_PREFS`, `NOTIFY`
2. Create `src/lib/notifications/store.ts`:
   - Uses existing `weave-reminders` IDB but upgrades to v2 with `notification-prefs` object store
   - `saveNotificationPrefs(roomId, prefs)` / `loadNotificationPrefs(roomId)` / `clearNotificationPrefs(roomId)`
   - Shared between main thread and SW (both can read/write IDB)
3. Update `src/lib/tasks/sw-reminders.ts`:
   - Bump DB_VERSION to 2, add `notification-prefs` store in `onupgradeneeded`
   - Export `loadNotificationPrefsFromDB(db, roomId)` for SW use
4. Update `src/service-worker.ts`:
   - Before `showNotification`, read prefs from IDB
   - If `enabled === false`, skip
   - If current time is within quiet hours, skip
   - Handle `NOTIFY` message type for assignment/status notifications
   - Handle `UPDATE_NOTIFICATION_PREFS` message type to sync prefs

**Commit**: `feat(M14): notification types, preferences store, SW quiet hours`

### Wave 2: UI Components (opt-in + bell)
**Files**: `src/lib/components/NotificationOptIn.svelte`, `src/lib/components/NotificationBell.svelte`, `src/lib/components/TaskPanel.svelte`
**Agent**: sonnet (Svelte 5 component logic)
**Dependencies**: Wave 1 (uses types + store)

Tasks:
1. Create `NotificationOptIn.svelte`:
   - Inline prompt: "Get reminded when this is due. [Turn on] [×]"
   - On "Turn on": `await Notification.requestPermission()`, if granted save prefs + hide
   - On dismiss: hide for session (sessionStorage flag)
   - Only render when: `Notification.permission === 'default'` AND has due-date tasks
2. Create `NotificationBell.svelte`:
   - Bell icon button in panel-actions (filled when on, unfilled when off)
   - Popover with: toggle switch + quiet hours start/end time inputs
   - Default quiet hours: 22:00–08:00
   - Saves prefs to IDB on change, posts `UPDATE_NOTIFICATION_PREFS` to SW
   - Only render when: `Notification.permission === 'granted'`
3. Update `TaskPanel.svelte`:
   - Add `NotificationBell` to panel-actions (between sort and new-task)
   - Add `NotificationOptIn` after progress bar (inside panel-body)
   - New props: `notificationsEnabled: boolean`, `hasDueDateTasks: boolean`, `roomId: string`
   - Callbacks: `onNotificationOptIn`, `onNotificationPrefsChange`

**Commit**: `feat(M14): notification opt-in prompt and bell icon with popover`

### Wave 3: Triggers + Integration
**Files**: `src/lib/notifications/triggers.ts`, `src/routes/room/[id]/+page.svelte`
**Agent**: sonnet (cross-file integration)
**Dependencies**: Wave 1 + 2 (uses store, types, UI components)

Tasks:
1. Create `src/lib/notifications/triggers.ts`:
   - `shouldNotify(event, myIdentityKey, tasks, tabFocused)` — returns boolean
   - Trigger conditions:
     - `task_assigned` where new assignee === myIdentityKey (and actor !== me)
     - `task_status_changed` where task.assignee === myIdentityKey (and actor !== me)
     - Due date reminders (existing, no change needed)
   - Checks: tab not focused, not ephemeral room, notifications enabled
   - `getNotificationPayload()` — returns `{ title: string, body: string }` (always generic)
2. Update `+page.svelte`:
   - Remove silent `Notification.requestPermission()` call (line 212-214)
   - Add notification state: `notificationsEnabled`, `notificationPrefs`
   - On mount: load prefs from IDB, check `Notification.permission`
   - In remote event handler: call `shouldNotify()`, if true post `NOTIFY` to SW
   - Wire `NotificationOptIn` and `NotificationBell` props to TaskPanel
   - Track tab visibility via `document.visibilityState`

**Commit**: `feat(M14): notification triggers for assignment, status change, due date`

### Wave 4: Tests
**Files**: `tests/unit/notification-store.test.ts`, `tests/unit/notification-triggers.test.ts`, `tests/e2e/notifications.spec.ts`
**Agent**: sonnet (test writing)
**Dependencies**: Wave 1-3

Tasks:
1. Unit tests for `store.ts`:
   - save/load/clear prefs
   - DB upgrade from v1 to v2 preserves reminders
   - Default quiet hours
2. Unit tests for `triggers.ts`:
   - Assignment to me → notify
   - Assignment by me → no notify
   - Status change on my task → notify
   - Tab focused → no notify
   - Ephemeral room → no notify
3. E2E tests:
   - Opt-in prompt appears on first due-date task
   - Bell icon visible after granting permission
   - Bell popover toggles notifications
   - No opt-in prompt when permission already granted/denied
   - Notifications have generic body (check SW showNotification call)

**Commit**: `test(M14): unit and E2E tests for local notifications`

## Agent Model Selection

| Wave | Agent | Model | Rationale |
|------|-------|-------|-----------|
| 1 | Foundation | sonnet | IndexedDB upgrade + SW logic |
| 2 | UI | sonnet | Svelte 5 components with reactive state |
| 3 | Integration | sonnet | Cross-file wiring, event handler logic |
| 4 | Tests | sonnet | Test writing with mocking |

No crypto changes → no opus needed for implementation. Opus stays orchestrator-only.

## Verification

- Automated: `npm run check && npm run test:unit -- --coverage && npm run test:e2e && npm run build`
- Manual: Create room → create task with due date → see opt-in → grant permission → see bell → check popover → verify notification fires with generic body
