# Roadmap

## Current State

- **Git SHA**: ee96a72
- **Unit tests**: 524 (Vitest, jsdom)
- **E2E tests**: 213 (Playwright, Chromium) — ~46 pre-existing CSP nonce failures
- **Coverage**: ~58% lines (overall), 100% on new components
- **Lint**: clean (`npm run check` passes, 0 errors, 26 warnings)
- **Build**: clean (`npm run build` passes)
- **Milestones complete**: M0-M15 (17 milestones shipped)
- **LOC**: ~18.8K (src/ + tests/ + server/)

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
- ~~M12: Mobile UX Improvements~~ ✅ (Sprint 4) — Banner consolidation into CoachMarks walkthrough, MobileNav bottom navigation (Chat/Tasks/Auto), background color fix. +22 unit tests. 1 dev dependency added (@testing-library/svelte).
- ~~M13: Mobile Identity Persistence~~ ✅ (Sprint 5) — IndexedDB-encrypted identity seed store (AES-GCM-256 via HKDF), PRF-first fallback chain in joinRoom(), cleanup integration, PIN compatibility for IDB-persisted seeds. +16 unit, +11 E2E tests. Production integration test suite.
- ~~M14: Local Notifications~~ ✅ (Sprint 6) — Contextual opt-in banner, NotificationBell popover with toggle + quiet hours, SW quiet-hours enforcement, notification triggers (assignment, status change), IndexedDB prefs store, cleanup integration. Removed silent requestPermission (H7 violation). +48 unit, +7 E2E tests. Delegation ratio improved 4.9% → 43.0%.
- ~~M15: Trust & Verification~~ ✅ (Sprint 7) — Emoji key verification (SHA-256 sorted keys → 5 emoji per member pair, ambient in room info). Member revocation via room migration (kick → new room, task state preserved, banner shown). Message delivery confirmation (per-sender sequence counters inside encrypted payload, shield icon green/amber). +19 unit, +13 E2E tests. Gates first pass. Delegation ratio 58.6%.

---

## Upcoming

### M16 — Web Push

Add VAPID-based push notifications via the relay server.

- Web Push API integration (VAPID key pair, subscription management)
- Relay push endpoint (encrypted push payloads, generic notification bodies)
- Push subscription cleanup on room destruction (burn/auto-delete/ephemeral purge)

**Done when**: Push notifications arrive when browser is closed. All payloads are generic (no task content). Subscriptions cleaned up on room destruction.

### M17 — Offline Task Store

IndexedDB-backed offline storage for tasks.

- IndexedDB task store (encrypted, mirrors event-sourced in-memory store)
- **Unified connection status line** (replaces separate offline banner): existing connection dot changes state — Connected: filled dot, no label. Disconnected: empty dot, "Reconnecting..." Offline: empty dot, "Offline". Offline with pending: empty dot, "Offline · N pending".
- Queue outbound events while offline
- Task creation works offline — offline-created tasks show a pale sync dot on the task row (tap for tooltip: *"Will sync when reconnected"*)

**Done when**: Tasks persist across page reloads without network. Connection status unified into single indicator. Events queued for sync. Tasks can be created while offline.

### M18 — Sync and Conflict Resolution

Reconnect and merge offline changes.

- Conflict resolution on reconnect (event-sourced merge with existing timestamp+actorId rules)
- Optimistic UI updates (show pending changes before server confirmation)
- Sync status indicator

**Done when**: Two users can edit tasks offline, reconnect, and see merged state. No data loss. E2E test covers offline-edit-reconnect flow.

### M19 — Multi-Room Tabs

Securely participate in multiple rooms across multiple browser tabs simultaneously.

- Shared crypto identity across tabs via `BroadcastChannel` or `SharedWorker` (PRF seed derived once, shared read-only)
- Per-tab Olm/Megolm session isolation (each tab manages its own room session independently)
- Tab-aware cleanup: closing one tab only cleans up that tab's room, not other tabs' sessions
- No cross-tab state leaks: one room's key material never accessible to another tab's room
- Graceful handling of PRF re-authentication when multiple tabs request it simultaneously (queue or deduplicate)

**Done when**: User can open 3+ rooms in separate tabs, send/receive messages in each independently. Closing one tab does not disrupt others. PIN lock in one tab locks all tabs. E2E tests cover multi-tab room isolation.

### M20 — Tor Hidden Service (deployment)

Run the relay as an optional .onion hidden service alongside the normal endpoint. Closes the IP metadata gap for users who need metadata protection without affecting the default experience.

- Tor hidden service configuration for the relay (deployment-only)
- .onion hostname serves identical client pre-configured for the .onion relay — navigate to it in Tor Browser and it just works, no settings field
- Self-hosters: `?relay=wss://custom.example` URL parameter for custom relay endpoints (no UI surface, documented in self-hosting docs)
- Documentation for self-hosters to enable .onion alongside clearnet

**Done when**: Relay is reachable via .onion address. .onion client auto-configures without user input. Self-hosting docs cover Tor setup and `?relay=` parameter.
