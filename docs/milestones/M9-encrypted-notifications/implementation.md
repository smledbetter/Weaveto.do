# M9 Implementation Plan: Encrypted Notifications

## Context

After M8 (Penetration Testing) validates the existing notification infrastructure (service worker generic payloads, IndexedDB reminder storage), M9 expands notification coverage to task assignments and status changes, adds local user controls, and introduces Web Push API for closed-browser delivery. This is the first milestone that adds a feature to the relay server since M0.

Builds on: `src/lib/tasks/reminders.ts` (in-tab scheduler), `src/lib/tasks/sw-reminders.ts` (IndexedDB persistence), `src/service-worker.ts` (SW with generic notifications), `server/relay.ts` (WebSocket relay).

## must_haves

### truths (observable outcomes)
- Members receive notifications for task assignments and status changes (not just due dates)
- Notifications contain zero plaintext (generic messages with room name only)
- Per-room notification settings let members control what they receive
- Do Not Disturb mode suppresses all notifications with visual indicator
- Web Push delivers notifications even when browser is closed
- Push subscriptions are cleaned up when rooms are destroyed

### artifacts (files produced)
- `src/lib/notifications/events.ts` — notification event types and filtering logic
- `src/lib/notifications/rules.ts` — local rule engine (per-room toggle, urgency filter, DND)
- `src/lib/notifications/push.ts` — Web Push subscription management (VAPID, subscribe/unsubscribe)
- `src/lib/notifications/types.ts` — notification types, rule types, push subscription types
- `src/lib/components/NotificationSettings.svelte` — per-room notification settings UI
- `src/lib/components/DndIndicator.svelte` — moon icon for DND state
- `server/push.ts` — relay-side push delivery (VAPID signing, encrypted payload construction)
- `tests/unit/notifications/*.test.ts` — unit tests for events, rules, push
- `tests/e2e/notifications.spec.ts` — E2E tests for notification flows

### key_links (where breakage cascades)
- `session.ts` message handler must emit notification events for assignments and status changes
- `service-worker.ts` must handle new notification event types beyond reminders
- `relay.ts` must accept push subscription registration and send push on room events
- `cleanup.ts` must unregister push subscriptions on room destruction
- Room page must integrate NotificationSettings and DndIndicator

## Waves

### Wave 1: Expanded Service Worker Notifications
> No dependencies. Extends existing SW infrastructure.

**Task 1.1** (type: auto)
- **Files**: `src/lib/notifications/types.ts`
- **Action**: Define notification event types (`task_assigned`, `task_completed`, `task_due_soon`, `chat_activity`), notification rule types (`RoomNotificationRules`, `DndState`), push subscription types
- **Verify**: TypeScript compiles, types imported cleanly
- **Done**: Types cover all notification events and rule states

**Task 1.2** (type: auto)
- **Files**: `src/lib/notifications/events.ts`
- **Action**: Notification event processor. Takes a `TaskEvent` + context (my identity key, room name) and returns a `NotificationPayload | null`. Filters: no self-notifications, only relevant events (assignment to me, my task completed by another). Grouping: batch events within 10s window into single "N updates in [room-name]" notification.
- **Verify**: Unit tests for each event type, self-filtering, grouping window
- **Done**: All task events correctly mapped to generic notification payloads

**Task 1.3** (type: auto)
- **Files**: `src/service-worker.ts`, `src/lib/tasks/sw-reminders.ts`
- **Action**: Extend SW message handler to accept `NOTIFY_EVENT` messages (not just `SCHEDULE_REMINDER`). On receipt, show browser notification with generic text. Respect grouping window.
- **Verify**: SW receives event, fires generic notification, groups rapid events
- **Done**: SW handles all notification event types

**Task 1.4** (type: auto)
- **Files**: `src/lib/room/session.ts`, `src/routes/room/[id]/+page.svelte`
- **Action**: Wire notification events into the message handler. When a decrypted message contains a task event, run it through the notification event processor. Post qualifying events to the service worker.
- **Verify**: Assignment in background tab triggers notification
- **Done**: End-to-end flow from task event to browser notification

**Task 1.5** (type: auto)
- **Files**: `tests/unit/notifications/events.test.ts`
- **Action**: Unit tests for event processor: self-filtering, assignment detection, completion detection, grouping, generic payload content
- **Verify**: `npm run test:unit` passes
- **Done**: 90%+ coverage on events.ts

### Wave 2: Local Notification Rules
> Depends on: Wave 1 (notification events flow)

**Task 2.1** (type: auto)
- **Files**: `src/lib/notifications/rules.ts`
- **Action**: Local rule engine. Per-room settings stored in localStorage: enabled/disabled, urgency-only filter. DND state: off, 1h, until-tomorrow, custom timestamp. `shouldNotify(event, rules): boolean` filter function. DND persists across tab close.
- **Verify**: Unit tests for all rule combinations, DND expiry, persistence
- **Done**: Rules correctly filter notification events

**Task 2.2** (type: auto)
- **Files**: `src/lib/components/NotificationSettings.svelte`
- **Action**: Per-room notification settings panel (accessible from room settings area). Toggle: enable/disable notifications. Dropdown: all events / urgent only. DND: off / 1h / until tomorrow / custom. All controls use proper form labels and keyboard navigation.
- **Verify**: Visual check, settings persist on reload, accessible
- **Done**: Settings panel renders correctly, persists state

**Task 2.3** (type: auto)
- **Files**: `src/lib/components/DndIndicator.svelte`
- **Action**: Moon icon component shown in room header when DND is active. `aria-label="Do not disturb active"`. Tooltip shows DND expiry time.
- **Verify**: Icon visible when DND on, hidden when off, accessible
- **Done**: DND state visible in room header

**Task 2.4** (type: auto)
- **Files**: `src/routes/room/[id]/+page.svelte`
- **Action**: Wire rules into notification pipeline. Before posting to SW, check `shouldNotify()`. Add NotificationSettings to room UI (gear icon or settings area). Add DndIndicator to room header.
- **Verify**: DND suppresses notifications, urgency filter works
- **Done**: Rules integrate into end-to-end notification flow

**Task 2.5** (type: auto)
- **Files**: `tests/unit/notifications/rules.test.ts`
- **Action**: Unit tests for rules engine: per-room toggle, urgency filter, DND states, persistence, expiry
- **Verify**: `npm run test:unit` passes
- **Done**: 90%+ coverage on rules.ts

### Wave 3: Web Push API Integration
> Depends on: Wave 2 (notification rules). This is the first relay change since M0.

**Task 3.1** (type: auto)
- **Files**: `src/lib/notifications/push.ts`
- **Action**: Web Push subscription management. Generate VAPID key pair (WebCrypto ECDSA P-256). `subscribeToPush(roomId): Promise<PushSubscription>` — requests browser permission, creates subscription, sends endpoint to relay. `unsubscribeFromPush(roomId)` — removes subscription from browser and relay. Just-in-time permission prompt logic (show once, respect "not now", never nag).
- **Verify**: Subscription created, endpoint sent to relay, unsubscribe removes
- **Done**: Push subscription lifecycle works end-to-end

**Task 3.2** (type: auto)
- **Files**: `server/push.ts`
- **Action**: Relay-side push delivery. Store push subscription endpoints per room (in-memory Map, same as room registry). On room events that would trigger notifications, construct encrypted push payload (event type + room ID only, no content). Sign with VAPID key. Send via `fetch()` to push endpoint. Remove subscription on 410 Gone (expired).
- **Verify**: Relay sends push on room event, handles 410 cleanup
- **Done**: Relay delivers encrypted push notifications

**Task 3.3** (type: auto)
- **Files**: `server/relay.ts`
- **Action**: Integrate push subscription registration into relay. New message types: `push_subscribe` (client sends endpoint + room ID), `push_unsubscribe` (client removes subscription). On room destruction (purge/ephemeral), clean up all push subscriptions for that room.
- **Verify**: Subscribe/unsubscribe messages handled, cleanup on room destruction
- **Done**: Relay manages push subscription lifecycle

**Task 3.4** (type: auto)
- **Files**: `src/lib/room/cleanup.ts`
- **Action**: Extend cleanup orchestrator to unsubscribe from Web Push on room destruction (burn, auto-delete, ephemeral purge).
- **Verify**: After room cleanup, no push subscription remains
- **Done**: Push cleanup integrated into all room destruction paths

**Task 3.5** (type: auto)
- **Files**: `src/routes/room/[id]/+page.svelte`
- **Action**: Wire push subscription into room lifecycle. On join (if notifications enabled and permission granted), subscribe. On disconnect/destroy, unsubscribe. Respect DND and notification rules for push delivery.
- **Verify**: Full push flow: join → subscribe → receive push when browser closed → destroy → unsubscribe
- **Done**: Push integrated into room page

### Wave 4: Tests & Integration
> Depends on: Wave 3

**Task 4.1** (type: auto)
- **Files**: `tests/unit/notifications/*.test.ts`
- **Action**: Comprehensive unit tests: event processor (all event types, self-filter, grouping), rules engine (all combinations), push subscription lifecycle, push payload content verification (zero plaintext check)
- **Verify**: `npm run test:unit` — 80%+ coverage on all `src/lib/notifications/` files
- **Done**: All unit tests pass, coverage targets met

**Task 4.2** (type: auto)
- **Files**: `tests/e2e/notifications.spec.ts`
- **Action**: E2E tests: notification on assignment (background tab), DND suppression, urgency filter, notification settings persistence, push subscription cleanup on room destruction
- **Verify**: `npm run test:e2e` passes
- **Done**: All E2E scenarios from acceptance.md covered

### Final Wave: Ship-Readiness Gate
> Depends on: all prior waves. Must pass before shipping.

**Ship-Readiness Review** (type: checkpoint:gate)
- **Skills**: `production-engineer` + `security-auditor` (single agent, one pass)
- **Action**: Run quality gates (unit tests with coverage, E2E, type check, TDD conventions) AND 10-principle security audit with OWASP ASI Top 10 threat analysis on all changed files. Special focus on: zero plaintext in notification payloads, push subscription endpoint handling, relay push delivery (no content leakage), DND state not leaking to server.
- **Verify**: All gates pass, all 10 security principles pass. Fix any failures, re-run until clean.
- **Done**: 0 test failures, 80%+ coverage on new code, 0 type errors, 10/10 security principles, 0 vulnerabilities

## Agent Strategy

| Wave | Agent | Model | Tasks |
|------|-------|-------|-------|
| 1 | Solo | sonnet | 1.1-1.5 (types, events, SW, wiring, tests — sequential) |
| 2 | Worker A | haiku | 2.2, 2.3 (UI components — parallel) |
| 2 | Worker B | sonnet | 2.1, 2.4, 2.5 (rules logic, wiring, tests) |
| 3 | Solo | sonnet | 3.1-3.5 (push — critical, needs focus, first relay change) |
| 4 | Solo | sonnet | 4.1, 4.2 (tests) |
| Final | Ship-Readiness | sonnet | Quality gates + security audit |

## Estimated Tokens

| Wave | Est. Tokens |
|------|-------------|
| Wave 1: Expanded SW Notifications | ~20K |
| Wave 2: Local Notification Rules | ~20K |
| Wave 3: Web Push API Integration | ~40K |
| Wave 4: Tests & Integration | ~15K |
| Ship-Readiness Gate | ~10K |
| **Total** | **~105K** |
