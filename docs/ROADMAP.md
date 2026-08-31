# Roadmap

## Current State

- **Git SHA**: c06a06e
- **Unit tests**: 647 (Vitest, jsdom)
- **E2E tests**: 246 (Playwright, Chromium) — ~53 pre-existing CSP nonce failures
- **Coverage**: ~60% lines (overall), 100% on new components
- **Lint**: clean (`npm run check` passes, 0 errors, 26 warnings)
- **Build**: clean (`npm run build` passes)
- **Milestones complete**: M0-M19 (21 milestones shipped)
- **LOC**: ~23.5K (src/ + tests/ + server/)

## Completed Milestones

### Pre-Flowstate

- ~~M0: E2EE Room Core~~ — WebAuthn PRF, vodozemac Olm/Megolm, WebSocket relay
- ~~M1: Task Management~~ — Event-sourced store, auto-assign, subtasks, reminders
- ~~M2: Task Intelligence~~ — Dependencies, natural language dates, keyboard shortcuts
- ~~M3: Agent Infrastructure~~ — WASM sandbox, encrypted state, host functions, circuit breaker
- ~~M4: Built-In Agents~~ — WAT auto-balance agent, built-in registry
- ~~M5: Task Polish~~ — Descriptions, sorting, urgent flag, search
- ~~M6: Burn-After-Use~~ — Auto-deletion, manual burn, ephemeral mode. The relay purge step was removed when the relay became stateless, and burn became an encrypted message between members.
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
- ~~M16: Web Push~~ ✅ (Sprint 8) — VAPID JWT signing (ES256 via Node.js crypto, env-configured keys), relay push dispatch (in-memory subscription store, /vapid-key endpoint, push to offline clients), client push manager (IDB subscription store, subscribeToPush/unsubscribe), SW push handler (quiet hours, generic body), push toggle in NotificationBell, cleanup integration. Zero new dependencies. +38 unit, +6 E2E tests. Gates first pass. Delegation ratio 64.4%.
- ~~M17: Offline Task Store~~ ✅ (Sprint 9) — Encrypted IDB task snapshots + event queue (AES-GCM-256 via HKDF), unified ConnectionIndicator (Connected/Reconnecting/Offline/Offline·N pending), offline task creation with sync dot indicator, event replay on reconnect, TaskStore snapshot/loadSnapshot methods, cleanup integration. +30 unit, +7 E2E tests. Gates first pass. Delegation ratio 46.9%.
- ~~M18: Sync and Conflict Resolution~~ ✅ (Sprint 10) — TaskStore event log with 24h sync window, session sync methods (sendSyncEvents via Megolm channel), reconnect sync flow (send history → wait → replay pending), ConnectionIndicator "Syncing..." state, conflict convergence (timestamp+actorId rules). +19 unit, +10 E2E tests. Gates first pass. Fastest sprint (4m 59s). Delegation ratio 51.7%.
- ~~M19: Multi-Room Tabs~~ ✅ (Sprint 11) — TabSync BroadcastChannel module for cross-tab coordination, cross-tab PIN lock broadcast with infinite-loop prevention, tab-aware cleanup (deregister on destroy), room page integration (TabSync lifecycle). Per-tab Olm/Megolm isolation (no cross-tab key sharing). Zero new dependencies. +36 unit, +6 E2E tests. Gates first pass. Delegation ratio 28.0%.

---

## Upcoming

### M20 — Tor Hidden Service (deployment)

Run the relay as an optional .onion hidden service alongside the normal endpoint. Closes the IP metadata gap for users who need metadata protection without affecting the default experience.

- Tor hidden service configuration for the relay (deployment-only)
- .onion hostname serves identical client pre-configured for the .onion relay — navigate to it in Tor Browser and it just works, no settings field
- Self-hosters: `?relay=wss://custom.example` URL parameter for custom relay endpoints (no UI surface, documented in self-hosting docs)
- Documentation for self-hosters to enable .onion alongside clearnet

**Done when**: Relay is reachable via .onion address. .onion client auto-configures without user input. Self-hosting docs cover Tor setup and `?relay=` parameter.
