# Roadmap

## Current State

- **Git SHA**: b3c0fee
- **Unit tests**: 419 (Vitest, jsdom)
- **E2E tests**: 181 (Playwright, Chromium) — 46 pre-existing failures
- **Coverage**: 75%+ lines, 73%+ functions/branches
- **Lint**: clean (`npm run check` passes)
- **Build**: clean (`npm run build` passes)
- **Milestones complete**: M0-M11 (13 milestones shipped)
- **LOC**: ~14K (src/ + tests/ + server/)

## Completed Milestones

### Pre-Flowstate

- ~~M0: E2EE Room Core~~ — WebAuthn PRF, vodozemac Olm/Megolm, WebSocket relay
- ~~M1: Task Management~~ — Event-sourced store, auto-assign, subtasks, reminders
- ~~M2: Task Intelligence~~ — Dependencies, natural language dates, keyboard shortcuts
- ~~M3: Agent Infrastructure~~ — WASM sandbox, encrypted state, host functions, circuit breaker
- ~~M4: Built-In Agents~~ — WAT auto-balance agent, built-in registry
- ~~M5: Task Polish~~ — Descriptions, sorting, urgent flag, search
- ~~M6: Burn-After-Use~~ — Auto-deletion, manual burn, ephemeral mode, relay purge
- ~~M7: Session Security~~ — PIN gate, PBKDF2, session lock, key rotation
- ~~M8: Agent Hardening~~ — Web Worker preemption, Ed25519 signatures, event validation

### Flowstate Sprints

- ~~M9: Vulnerability Scanning~~ ✅ (Sprint 1) — Security audit across all shipped milestones. 2 critical, 9 high, 18 medium findings. All critical + high fixed. Security report: `docs/milestones/M8-vulnerability-scanning/SECURITY-REPORT.md`
- ~~M10: UX & Accessibility~~ ✅ (Sprint 2) — Header decluttered, coach marks, ARIA fixes, focus-visible rings, connection status label, task empty-state prompt. +13 unit tests.
- ~~M11: Reconnect & Hardening~~ ✅ (Sprint 3) — Stale Olm session clearing on reconnect, re-establishment tracking with UI indicator, timestamp clamping (5-min future window), OTK replenishment (threshold-based). +27 unit tests.

---

## Upcoming

### M12 — Mobile Identity Persistence

Replace the temporary random-seed fallback with IndexedDB-persisted crypto identity for devices without WebAuthn PRF support (iOS Safari, Android Chrome, most mobile browsers).

- Generate crypto seed on first visit, encrypt and store in IndexedDB
- On return visits, retrieve and decrypt the stored seed (same identity across sessions)
- Migration path: detect existing PRF users, don't interfere with their flow
- PIN protection support for persisted-seed users (derive PIN key from stored seed)
- Clear stored identity on room destruction / burn / ephemeral purge
- Remove "Using temporary identity" banner when persistent identity is active

**Future consideration (post user feedback)**: Optional passphrase-based seed derivation for cross-device identity recovery. Only pursue if users report losing identity as a pain point.

**Done when**: Mobile users get a persistent crypto identity across sessions. PIN-protected rooms work on mobile. E2E encryption unchanged. PRF users unaffected.

### M13 — Local Notifications

Expand service worker notifications without external push infrastructure.

- Expanded notification triggers (assignment, status change, due date approaching)
- **Contextual opt-in**: When the first task with a due date is created, show inline below it: *"Get reminded when this is due. [Turn on]"* — one sentence, one button, positioned where the user is already looking. No auto-requesting permission.
- **Bell icon in task panel header**: Appears after opt-in. Filled/unfilled state (on/off). Tapping shows a single popover with two controls only: on/off toggle + quiet hours time range (08:00–22:00 default, editable).
- Notification grouping happens automatically and silently (no toggle)
- No urgency filter, no DND setting, no rules UI — defer to post-feedback if users request granularity

**Done when**: Notifications fire for assignments and due dates when tab is backgrounded. Contextual opt-in prompt appears on first due-date task. Bell popover controls on/off + quiet hours. E2E tests cover notification triggers.

### M14 — Trust & Verification

Close the open gaps in the threat model (see `docs/THREAT-MODEL.md`).

- **Emoji key verification (ambient display)**: In room info popover, add a "Security" section. Each member shows 5 emoji derived from `SHA-256(sorted(identityKeyA, identityKeyB))` — always visible, no "Verify" button. One line of text: *"Ask members to confirm these match on their screen."* Passive — users who care will use it, others ignore it.
- **Member revocation via room migration**: Creator kicks a member → client creates a new room, migrates task state, sends remaining members a redirect with dismissible banner: *"This room was recreated — your tasks have been carried over."* Old room destroyed. Clean cryptographic break.
- **Message delivery confirmation (room-level)**: Per-sender sequential counters inside encrypted payload. Shield icon in room header turns green→amber when any gap is detected. Tapping shows: *"Some messages may have been missed."* No per-message warnings, no named members. Resets on reconnect.
- **Reproducible relay builds** (stretch): Nix-based reproducible builds, publish hashes to transparency log. Community can verify relay matches source.

**Done when**: Emoji strings visible in room info for all members. Room migration on kick creates new room with task state preserved and banner shown. Shield icon reflects delivery health. E2E tests cover verification display and room migration.

### M15 — Web Push

Add VAPID-based push notifications via the relay server.

- Web Push API integration (VAPID key pair, subscription management)
- Relay push endpoint (encrypted push payloads, generic notification bodies)
- Push subscription cleanup on room destruction (burn/auto-delete/ephemeral purge)

**Done when**: Push notifications arrive when browser is closed. All payloads are generic (no task content). Subscriptions cleaned up on room destruction.

### M16 — Offline Task Store

IndexedDB-backed offline storage for tasks.

- IndexedDB task store (encrypted, mirrors event-sourced in-memory store)
- **Unified connection status line** (replaces separate offline banner): existing connection dot changes state — Connected: filled dot, no label. Disconnected: empty dot, "Reconnecting..." Offline: empty dot, "Offline". Offline with pending: empty dot, "Offline · N pending".
- Queue outbound events while offline
- Task creation works offline — offline-created tasks show a pale sync dot on the task row (tap for tooltip: *"Will sync when reconnected"*)

**Done when**: Tasks persist across page reloads without network. Connection status unified into single indicator. Events queued for sync. Tasks can be created while offline.

### M17 — Sync and Conflict Resolution

Reconnect and merge offline changes.

- Conflict resolution on reconnect (event-sourced merge with existing timestamp+actorId rules)
- Optimistic UI updates (show pending changes before server confirmation)
- Sync status indicator

**Done when**: Two users can edit tasks offline, reconnect, and see merged state. No data loss. E2E test covers offline-edit-reconnect flow.

### M18 — Multi-Room Tabs

Securely participate in multiple rooms across multiple browser tabs simultaneously.

- Shared crypto identity across tabs via `BroadcastChannel` or `SharedWorker` (PRF seed derived once, shared read-only)
- Per-tab Olm/Megolm session isolation (each tab manages its own room session independently)
- Tab-aware cleanup: closing one tab only cleans up that tab's room, not other tabs' sessions
- No cross-tab state leaks: one room's key material never accessible to another tab's room
- Graceful handling of PRF re-authentication when multiple tabs request it simultaneously (queue or deduplicate)

**Done when**: User can open 3+ rooms in separate tabs, send/receive messages in each independently. Closing one tab does not disrupt others. PIN lock in one tab locks all tabs. E2E tests cover multi-tab room isolation.

### M19 — Tor Hidden Service (deployment)

Run the relay as an optional .onion hidden service alongside the normal endpoint. Closes the IP metadata gap for users who need metadata protection without affecting the default experience.

- Tor hidden service configuration for the relay (deployment-only)
- .onion hostname serves identical client pre-configured for the .onion relay — navigate to it in Tor Browser and it just works, no settings field
- Self-hosters: `?relay=wss://custom.example` URL parameter for custom relay endpoints (no UI surface, documented in self-hosting docs)
- Documentation for self-hosters to enable .onion alongside clearnet

**Done when**: Relay is reachable via .onion address. .onion client auto-configures without user input. Self-hosting docs cover Tor setup and `?relay=` parameter.
