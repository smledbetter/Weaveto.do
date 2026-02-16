# M5 Implementation Plan: Burn-After-Use

## Context

weaveto.do is privacy-first, E2E encrypted task coordination with zero accounts. M5 adds auto-deletion, manual burn commands, and ephemeral mode — positioning weaveto.do as the anti-Asana where privacy means data doesn't linger after the work is done.

**What's already built:**
- M0-M4 complete: E2EE rooms, task management, agent infrastructure, task polish
- Relay is in-memory only (Map-based room registry, no disk persistence)
- Client has event-sourced task store, IndexedDB for agent state, sessionStorage for Olm pickles, service worker for reminders
- Room creator identity is NOT currently tracked by the relay (this is new)

**What M5 delivers:**
- Rooms auto-delete 24h after all tasks complete (with cancellable grace period)
- Room creators can immediately destroy rooms with `/burn` command (type-to-confirm friction)
- Ephemeral mode: zero persistence, in-memory only, purges when last member leaves

## must_haves

### truths (observable outcomes)
- User completes last task → sees "Room will delete in 24h" banner with countdown
- User clicks "Keep Room" → countdown stops, room stays alive
- User clicks "Delete Now" or timer expires → room purges from relay, all clients redirect with "Room deleted" notice
- Room creator types `/burn` → confirmation modal with "type DELETE to confirm" friction
- Creator confirms `/burn` → room instantly purged, all members disconnected and redirected
- Non-creator tries `/burn` → sees "Only room creator can delete this room" error
- User creates room with "Ephemeral mode" checked → flame icon always visible, no IndexedDB/service worker writes
- Last member leaves ephemeral room → relay purges room immediately
- Rejoining purged room URL → sees "Room does not exist or has been deleted"
- All deletions clear: relay room Map, client messages/tasks, IndexedDB agents, sessionStorage Olm pickle, service worker reminders

### artifacts (files produced)
- `src/lib/room/types.ts` — burn event types, ephemeral flag
- `src/lib/room/cleanup.ts` — client-side cleanup orchestrator
- `server/relay.ts` — purge endpoint, creator tracking, room_destroyed broadcast
- `src/lib/components/BurnConfirmModal.svelte` — type-to-confirm UI for `/burn`
- `src/lib/components/AutoDeleteBanner.svelte` — grace period countdown, Keep/Delete Now buttons
- `src/routes/room/[id]/+page.svelte` — `/burn` command parsing, ephemeral indicator, completion detection
- `src/routes/+page.svelte` — ephemeral mode checkbox on room creation
- `tests/unit/room/cleanup.test.ts` — cleanup logic unit tests
- `tests/e2e/burn.spec.ts` — E2E tests for all 3 features
- `docs/milestones/M5-burn-after-use/acceptance.md` — Gherkin scenarios
- `docs/milestones/M5-burn-after-use/implementation.md` — this file

### key_links (where breakage cascades)
- **Relay purge endpoint** affects all clients in the room (broadcast + disconnect)
- **RoomSession** needs creator identity flag and ephemeral mode flag (affects session.ts, room page)
- **Cleanup logic** touches: RoomSession, TaskStore, AgentExecutor, IndexedDB, sessionStorage, service worker
- **Room creation flow** (homepage) needs ephemeral checkbox → affects relay join logic
- **E2E tests** depend on relay purge working correctly (test room cleanup is critical)

---

## Waves

### Wave 1: Foundation (Types + Relay Creator Tracking)
> No dependencies. All tasks run in parallel.

**Task 1.1** (type: auto, model: haiku)
- **Files**: `src/lib/room/types.ts`
- **Action**: Add burn-related types:
  - `BurnRequest` interface (roomId, creatorIdentityKey, signature)
  - `RoomDestroyedMessage` interface (type: 'room_destroyed', reason: 'manual' | 'auto_delete' | 'ephemeral')
  - `AutoDeleteState` interface (startedAt, expiresAt, cancelled)
  - Export `EphemeralMode` boolean flag type
- **Verify**: `npm run check` passes, no type errors
- **Done**: Types exist and are exported

**Task 1.2** (type: auto, model: sonnet)
- **Files**: `server/relay.ts`
- **Action**: Add room creator tracking and purge endpoint:
  - Add `creatorIdentityKey?: string` to `Room` interface
  - On `join` with `create: true`, store `msg.identityKey` as `room.creatorIdentityKey`
  - Add `ephemeral?: boolean` flag to `Room` interface
  - On `join` with `create: true`, store `msg.ephemeral` flag if present
  - On ephemeral room, track connected clients; when `room.clients.size` drops to 0, immediately delete room from `rooms` Map
  - Add new message type handler for `purge` (type: 'purge', roomId, identityKey)
  - Validate purge: check `room.creatorIdentityKey === msg.identityKey`
  - If valid: broadcast `{ type: 'room_destroyed', reason: 'manual' }` to all clients, then delete `rooms.get(roomId)`, disconnect all clients with code 4000
  - If invalid: respond to sender with `{ type: 'purge_unauthorized' }`, close sender with 4005
- **Verify**: Start relay, manually send test purge messages, verify creator-only enforcement
- **Done**: Relay purge endpoint works, creator auth enforced, ephemeral rooms auto-purge on last disconnect

**Task 1.3** (type: auto, model: haiku)
- **Files**: `src/lib/room/session.ts`
- **Action**: Add ephemeral flag to RoomSession constructor options and join message:
  - Add `ephemeral?: boolean` to constructor options
  - Store as `private isEphemeral = false`
  - In join message, include `ephemeral: this.isEphemeral` if `isCreator && isEphemeral`
  - Export getter `getEphemeralMode(): boolean { return this.isEphemeral; }`
- **Verify**: `npm run check` passes
- **Done**: RoomSession can be created in ephemeral mode

---

### Wave 2: Client-Side Cleanup Logic
> Depends on: Wave 1 (types exist, relay supports purge)

**Task 2.1** (type: auto, model: sonnet)
- **Files**: `src/lib/room/cleanup.ts`
- **Action**: Create cleanup orchestrator function:
  - Export `async function cleanupRoom(roomId: string, session: RoomSession | null): Promise<void>`
  - Clear in-memory: call `session?.disconnect()`, `taskStore.clear()`, `reminderScheduler.clearAll()`
  - Clear sessionStorage: remove `weave-olm-pickle`, `weave-key-warning-shown`, `weave-task-panel-open`
  - Clear IndexedDB: open agent module DB, delete all modules for `roomId`, delete agent state
  - Clear service worker: broadcast `{ type: 'clear-room-reminders', roomId }` via `navigator.serviceWorker.controller.postMessage`
  - No `console.log` — use comment to document each cleanup step
- **Verify**: Unit test calling `cleanupRoom` with mock session, verify all cleanup calls made
- **Done**: Cleanup function is complete and tested

**Task 2.2** (type: auto, model: haiku)
- **Files**: `src/lib/room/session.ts`
- **Action**: Add `sendPurgeRequest()` method to RoomSession:
  - Verify `this.ws` is open
  - Send `{ type: 'purge', roomId: this.roomId, identityKey: this.identityKey }`
  - Return a Promise that resolves on `room_destroyed` message or rejects on `purge_unauthorized` / disconnect
- **Verify**: `npm run check` passes, method signature correct
- **Done**: RoomSession can request purge from relay

---

### Wave 3: UI Components
> Depends on: Wave 2 (cleanup logic exists)

**Task 3.1** (type: auto, model: haiku)
- **Files**: `src/lib/components/BurnConfirmModal.svelte`
- **Action**: Create burn confirmation modal:
  - Props: `onConfirm: () => void`, `onCancel: () => void`
  - Modal backdrop (click outside to cancel, Escape key to cancel)
  - Title: "Permanently Delete Room"
  - Warning text: "This action cannot be undone. All messages, tasks, and member access will be destroyed immediately."
  - Input field with placeholder "Type DELETE to confirm"
  - Bind input value, compare with "DELETE" (case-sensitive exact match)
  - "Cancel" button (always enabled) and "Delete Room" button (disabled until input === "DELETE")
  - ARIA: role="dialog", aria-modal="true", aria-labelledby for title
  - Styles: high contrast, focus indicators, mobile-friendly
- **Verify**: Visual check in Storybook or browser
- **Done**: Component renders, type-to-confirm works, accessible

**Task 3.2** (type: auto, model: haiku)
- **Files**: `src/lib/components/AutoDeleteBanner.svelte`
- **Action**: Create auto-delete countdown banner:
  - Props: `expiresAt: number`, `onKeepRoom: () => void`, `onDeleteNow: () => void`
  - Banner displays: "All tasks complete. Room will auto-delete in [time remaining]."
  - Countdown updates every minute (use `setInterval` in `$effect`)
  - Format time as "Xh Ym" (e.g., "23h 45m remaining")
  - Two buttons: "Keep Room" (secondary style) and "Delete Now" (danger style, red)
  - ARIA: role="alert" for banner, aria-live="polite" for countdown
  - Cleanup interval on component destroy
  - Styles: persistent banner at top of room, high contrast
- **Verify**: Visual check with mock `expiresAt` timestamp
- **Done**: Component renders, countdown updates, buttons fire callbacks

**Task 3.3** (type: auto, model: haiku)
- **Files**: `src/lib/components/EphemeralIndicator.svelte`
- **Action**: Create ephemeral mode indicator:
  - Props: `memberCount: number`
  - Display flame icon (unicode 🔥 or SVG) with text "Ephemeral" in room header
  - Tooltip on hover: "This room will be deleted when all members leave"
  - If `memberCount === 1`, show warning icon next to member count with tooltip: "Closing this tab will delete the room"
  - ARIA: aria-label="Ephemeral room: no data persistence" on flame icon
  - Styles: high contrast (meets WCAG AA 3:1), visible in both light/dark themes
- **Verify**: Visual check with different member counts
- **Done**: Component renders, accessible, tooltips work

---

### Wave 4: Room Page Integration
> Depends on: Wave 3 (UI components exist)

**Task 4.1** (type: auto, model: sonnet)
- **Files**: `src/routes/room/[id]/+page.svelte`
- **Action**: Wire burn command and auto-delete detection:
  - Parse `/burn` in message input (before `sendMessage`): if `messageInput.trim() === '/burn'`, set `showBurnModal = true`, clear input, return early
  - Add `showBurnModal` state, render `<BurnConfirmModal>` if true
  - On burn confirm: call `session.sendPurgeRequest()`, on success call `cleanupRoom(roomId, session)`, redirect to `/` with query param `?deleted=true`
  - On purge unauthorized: show error "Only room creator can delete this room", close modal
  - Handle incoming `room_destroyed` message: call `cleanupRoom`, show modal "This room has been deleted by the creator", redirect after 3s
  - Detect completion: `$effect` watches `taskList`, if all tasks complete and `taskList.length > 0`, start auto-delete timer (24h from now)
  - Store auto-delete state in `sessionStorage` (key: `weave-auto-delete:${roomId}`, value: JSON with `expiresAt` timestamp)
  - Render `<AutoDeleteBanner>` if auto-delete active
  - On "Keep Room": remove sessionStorage key, hide banner
  - On "Delete Now": creator-only check, call `session.sendPurgeRequest()`, cleanup, redirect
  - Check sessionStorage on mount: if auto-delete expired, call cleanup + redirect
- **Verify**: Manual testing: complete all tasks, see banner, click Keep/Delete Now, try `/burn`
- **Done**: All burn and auto-delete flows work in room page

**Task 4.2** (type: auto, model: haiku)
- **Files**: `src/routes/room/[id]/+page.svelte`
- **Action**: Add ephemeral mode indicator:
  - Pass `session?.getEphemeralMode()` to determine if room is ephemeral
  - If ephemeral, render `<EphemeralIndicator memberCount={members.size + 1} />` in room header
  - Disable service worker reminder registration when `session.getEphemeralMode()` is true (wrap existing service worker setup in `if (!session.getEphemeralMode())`)
- **Verify**: Create ephemeral room, verify flame icon shows, service worker not registered
- **Done**: Ephemeral indicator displays, service worker disabled for ephemeral rooms

---

### Wave 5: Homepage Integration (Ephemeral Checkbox)
> Depends on: Wave 1 (relay supports ephemeral flag)

**Task 5.1** (type: auto, model: haiku)
- **Files**: `src/routes/+page.svelte`
- **Action**: Add ephemeral mode checkbox to room creation:
  - Add `ephemeralMode` state (default false)
  - In room creation UI (if it exists), add checkbox: "Ephemeral mode (no persistence)"
  - Tooltip/help text: "Messages and tasks exist only while tabs are open. Closing all tabs deletes the room."
  - If room creation is just a link (no form), add a "Create Room" button that opens a modal with ephemeral checkbox
  - Pass `ephemeralMode` flag to room creation logic: append `&ephemeral=true` to room URL if checked
  - Update room page to read `$page.url.searchParams.has('ephemeral')` and pass to RoomSession constructor
- **Verify**: Create room with ephemeral checked, verify URL param, room session initialized correctly
- **Done**: Homepage allows ephemeral room creation

**Task 5.2** (type: auto, model: haiku)
- **Files**: `src/routes/+page.svelte`
- **Action**: Add deleted room notice:
  - Check for `$page.url.searchParams.get('deleted')` on mount
  - If present, show dismissible banner: "Room deleted" (or "Room auto-deleted after completion" if `deleted=auto`)
  - Auto-dismiss after 5 seconds or user clicks close
- **Verify**: Navigate to `/?deleted=true`, see notice
- **Done**: Deleted room notice displays

---

### Wave 6: Tests
> Depends on: Wave 5 (all features implemented)

**Task 6.1** (type: auto, model: sonnet)
- **Files**: `tests/unit/room/cleanup.test.ts`
- **Action**: Unit tests for cleanup logic:
  - Mock RoomSession, TaskStore, AgentExecutor, IndexedDB, sessionStorage, service worker
  - Test `cleanupRoom` calls all expected cleanup methods
  - Test sessionStorage keys removed
  - Test IndexedDB deletion (spy on `deleteModule`)
  - Test service worker broadcast message sent
  - Aim for 90%+ coverage on `cleanup.ts`
- **Verify**: `npm run test:unit -- cleanup.test.ts` passes, coverage target met
- **Done**: Cleanup unit tests pass

**Task 6.2** (type: auto, model: sonnet)
- **Files**: `tests/e2e/burn.spec.ts`
- **Action**: E2E tests for burn features:
  - Test auto-delete: create room, complete all tasks, verify banner shows, click "Keep Room", verify banner hides
  - Test manual burn: create room as creator, type `/burn`, verify modal, type "DELETE", verify room destroyed
  - Test burn unauthorized: join room as non-creator, try `/burn`, verify error
  - Test ephemeral mode: create ephemeral room, verify flame icon, close tab, reopen URL, verify "room not found"
  - Test rejoin purged room: burn room, navigate to URL again, verify error message
  - Each test creates a fresh room, cleans up after
- **Verify**: `npm run test:e2e` passes all burn tests
- **Done**: E2E tests pass, no regressions

**Task 6.3** (type: auto, model: sonnet)
- **Files**: `tests/e2e/room.spec.ts` (existing E2E tests)
- **Action**: Regression check:
  - Run all existing E2E tests to ensure no breakage from relay changes or room session updates
  - Fix any failures caused by new relay message types or session behavior
- **Verify**: `npm run test:e2e` passes with 0 regressions
- **Done**: Existing tests still pass

---

### Final Wave: Ship-Readiness Gate
> Depends on: all prior waves. Must pass before shipping.

**Ship-Readiness Review** (type: checkpoint:gate, model: sonnet)
- **Skills**: `production-engineer` + `security-auditor` (single agent, one pass)
- **Action**: Run quality gates (unit tests with coverage, E2E, type check, TDD conventions) AND 10-principle security audit with OWASP ASI Top 10 threat analysis on all changed files:
  - Quality gates: `npm run test:unit && npm run test:e2e && npm run check && npm run build`
  - Security audit: review `server/relay.ts` (purge auth), `src/lib/room/cleanup.ts` (state clearing), `src/lib/room/session.ts` (creator identity), all UI components (XSS, CSRF, input validation)
  - Threat model: unauthorized purge, replay attacks, client-side state leakage, incomplete cleanup
  - OWASP ASI Top 10: LLM01-LLM10 + traditional web app security (CSP, CORS, input sanitization)
- **Verify**: All gates pass, all 10 security principles pass. Fix any failures, re-run until clean.
- **Done**: 0 test failures, 80%+ coverage on new code, 0 type errors, 10/10 security principles, 0 vulnerabilities

---

## Agent Strategy

| Wave | Agent | Model | Tasks |
|------|-------|-------|-------|
| 1 | Solo | sonnet | 1.1 (haiku fallback), 1.2, 1.3 (haiku fallback) |
| 2 | Solo | sonnet | 2.1, 2.2 (haiku fallback) |
| 3 | Worker A | haiku | 3.1, 3.2, 3.3 (parallel) |
| 4 | Lead | sonnet | 4.1, 4.2 |
| 5 | Worker B | haiku | 5.1, 5.2 (parallel) |
| 6 | Solo | sonnet | 6.1, 6.2, 6.3 |
| Final | Ship-Readiness | sonnet | Quality gates + security audit |

**Rationale:**
- Wave 1 (relay + types): **sonnet** — relay auth logic is security-critical, types are simple but foundational
- Wave 2 (cleanup): **sonnet** — cleanup touches many subsystems, needs careful orchestration
- Wave 3 (UI components): **haiku** — mechanical Svelte components with clear specs
- Wave 4 (room integration): **sonnet** — complex state management, command parsing, completion detection
- Wave 5 (homepage): **haiku** — simple form additions
- Wave 6 (tests): **sonnet** — E2E tests require understanding full user flows
- Final (ship-readiness): **sonnet** — security audit requires deep reasoning about attack vectors

---

## Implementation Notes

### Relay Purge Authentication
- Room creator identity stored in-memory only (no disk persistence)
- Creator is whoever sent `join` with `create: true` first
- Purge request must include sender's identity key
- Relay compares `msg.identityKey === room.creatorIdentityKey`
- If match: broadcast `room_destroyed`, purge room, disconnect all
- If mismatch: reject with `purge_unauthorized`, close sender connection

### Auto-Delete State Management
- Client-side only (relay is stateless)
- Stored in sessionStorage per room: `weave-auto-delete:${roomId}`
- Format: `{ expiresAt: number, cancelled: boolean }`
- On task completion, check if all tasks complete → start 24h timer
- Timer stored as `expiresAt = Date.now() + 24 * 60 * 60 * 1000`
- Banner polls sessionStorage every minute, updates countdown
- On "Keep Room": set `cancelled: true`, hide banner
- On "Delete Now": creator calls purge endpoint (same as manual burn)
- On mount: check if `expiresAt < Date.now()` → trigger cleanup + redirect

### Ephemeral Mode Constraints
- Can ONLY be set at room creation time (checkbox on homepage)
- Cannot convert existing room to ephemeral
- Relay tracks `room.ephemeral` flag (boolean)
- On last client disconnect, if `room.ephemeral && room.clients.size === 0`, delete room
- Client disables IndexedDB writes for agent state (check `session.getEphemeralMode()` before storing)
- Client disables service worker reminders (check before calling `navigator.serviceWorker.register`)

### Client Cleanup Checklist
When `cleanupRoom(roomId, session)` is called:
1. Disconnect session: `session?.disconnect()`
2. Clear stores: `taskStore.clear()`, `reminderScheduler.clearAll()`
3. Clear sessionStorage: `weave-olm-pickle`, `weave-key-warning-shown`, `weave-task-panel-open`, `weave-auto-delete:${roomId}`
4. Clear IndexedDB: agent modules for roomId, agent state for roomId
5. Clear service worker: postMessage `{ type: 'clear-room-reminders', roomId }`
6. Shutdown agents: `agentExecutor?.shutdown()`
7. Redirect: `window.location.href = '/?deleted=true'` (or `deleted=auto` for auto-delete)

### UX Friction for Irreversible Actions
- Manual burn (`/burn`): type "DELETE" (exact match, case-sensitive) to enable submit button
- Auto-delete "Delete Now": no extra friction (already in grace period, user chose to accelerate)
- Ephemeral mode: one-time checkbox confirmation at creation (no ongoing friction)

### Accessibility Requirements (WCAG 2.1 AA)
- BurnConfirmModal: role="dialog", aria-modal="true", aria-labelledby, Escape key closes
- AutoDeleteBanner: role="alert", aria-live="polite" for countdown updates
- EphemeralIndicator: aria-label on flame icon, high contrast 3:1 for icon/text
- All buttons: visible focus indicators, keyboard navigable
- Type-to-confirm input: clear label, error state if input doesn't match
- Modal backdrop: click outside closes, visible focus trap

### Service Worker Changes (Deferred)
- Service worker needs to handle `clear-room-reminders` message (deletes all reminders for roomId)
- This is a NEW message type — existing service worker code doesn't support it
- Add message handler in `public/service-worker.js` (or create it if it doesn't exist)
- Unit test service worker message handling separately

### Error Handling
- Purge fails (relay down): show error "Cannot delete room while disconnected", keep modal open
- Purge unauthorized: show error "Only room creator can delete this room", close modal
- Auto-delete expires while offline: on reconnect, check sessionStorage, trigger cleanup
- Rejoining deleted room: relay responds `room_not_found`, show "Room has been deleted" notice, clear local state
- Incomplete cleanup: log errors silently (no console.log in production), but don't block redirect

### Testing Strategy
- Unit tests: cleanup logic, auto-delete state, timer formatting
- E2E tests: full flows (create → complete → auto-delete → cleanup), burn command, ephemeral mode
- Accessibility tests: keyboard nav, ARIA attributes, focus management (axe-core in E2E)
- Regression tests: existing E2E suite must pass (no breakage from relay changes)

### Performance Considerations
- Countdown updates every 60s (not 1s) to reduce DOM churn
- Cleanup is async (IndexedDB operations), show loading state during redirect
- Relay purge is synchronous (in-memory Map delete), <10ms
- Service worker broadcast is fire-and-forget (don't await response)

### Security Considerations
- No plaintext inspection on relay (purge request only includes roomId + identityKey, no message content)
- Creator identity key stored in-memory only (no disk, no logs)
- Purge authentication prevents non-creators from griefing
- Cleanup must be complete (no partial state leakage in IndexedDB/sessionStorage)
- Ephemeral mode blocks persistence APIs (IndexedDB, service worker) to prevent accidental leaks
