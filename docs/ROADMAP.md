# Roadmap

## Current State

- **Git SHA**: 7f904bf
- **Unit tests**: 403 (Vitest, jsdom)
- **E2E tests**: 119 (Playwright, Chromium) — 28 pre-existing failures (PIN, task intelligence, task polish, agent-infra, burn)
- **Coverage**: 75%+ lines, 73%+ functions/branches
- **Lint**: clean (`npm run check` passes)
- **Build**: clean (`npm run build` passes)
- **Milestones complete**: M0-M8.5 (10 milestones shipped)
- **LOC**: ~13K (src/ + tests/ + server/)

## Completed Phases (pre-Flowstate)

These milestones were completed before Flowstate tracking. Listed for context.

- ~~M0: E2EE Room Core~~ — WebAuthn PRF, vodozemac Olm/Megolm, WebSocket relay
- ~~M1: Task Management~~ — Event-sourced store, auto-assign, subtasks, reminders
- ~~M2: Task Intelligence~~ — Dependencies, natural language dates, keyboard shortcuts
- ~~M3: Agent Infrastructure~~ — WASM sandbox, encrypted state, host functions, circuit breaker
- ~~M3.5: Built-In Agent~~ — WAT auto-balance agent, built-in registry
- ~~M4: Task Polish~~ — Descriptions, sorting, urgent flag, search
- ~~M5: Burn-After-Use~~ — Auto-deletion, manual burn, ephemeral mode, relay purge
- ~~M5.5: UX Polish~~ — Room names, onboarding, agent explainer
- ~~M6: Session Security~~ — PIN gate, PBKDF2, session lock, key rotation
- ~~M7: Agent Hardening~~ — Web Worker preemption, Ed25519 signatures, event validation

## ~~Phase 1: M8 — Vulnerability Scanning~~ ✅ (Sprint 1)

Security audit across all shipped milestones. 2 critical, 9 high, 18 medium findings. All critical + high fixed (1 high deferred — no upload UI). Security report: `docs/milestones/M8-vulnerability-scanning/SECURITY-REPORT.md`

## ~~Phase 2: M8.5 — UX & Accessibility Pass~~ ✅ (Sprint 2)

Header decluttered (4 controls max, info dropdown). First-use coach marks. ARIA fixes (PinSetup, AutoDeleteBanner, SoloMemberBanner, assignee dropdown). Focus-visible rings. "Agent Modules" → "Automation". Connection status text label. Task empty-state prompt. +13 unit tests, E2E fixtures for coach marks.

## Phase 3: M9 Phase 1 — Local Notifications

Expand service worker notifications without external push infrastructure.

- Expanded notification triggers (assignment, status change, due date approaching)
- Local notification rules (per-room toggle, urgency filter, do-not-disturb)
- Notification grouping (batch multiple events into single notification)
- Explicit notification opt-in: pill in task panel "Enable reminders — [Turn on]" (no auto-requesting permission)
- Notification status indicator: bell toggle in task panel header showing subscription state

**Done when**: Notifications fire for assignments and due dates when tab is backgrounded. Rules UI works. Notification permission is opt-in only. E2E tests cover notification triggers.

## Phase 4: M9 Phase 2 — Web Push

Add VAPID-based push notifications via the relay server.

- Web Push API integration (VAPID key pair, subscription management)
- Relay push endpoint (encrypted push payloads, generic notification bodies)
- Push subscription cleanup on room destruction (burn/auto-delete/ephemeral purge)

**Done when**: Push notifications arrive when browser is closed. All payloads are generic (no task content). Subscriptions cleaned up on room destruction.

## Phase 5: M10 Phase 1 — Offline Task Store

IndexedDB-backed offline storage for tasks.

- IndexedDB task store (encrypted, mirrors event-sourced in-memory store)
- Offline detection and UI indicator: cloud-with-slash icon + text "Offline — changes will sync when reconnected" (distinct from disconnected state)
- Queue outbound events while offline
- Task creation works offline with clear local-storage indicator

**Done when**: Tasks persist across page reloads without network. Offline indicator shown (distinct from disconnected). Events queued for sync. Tasks can be created while offline.

## Phase 6: M10 Phase 2 — Sync and Conflict Resolution

Reconnect and merge offline changes.

- Conflict resolution on reconnect (event-sourced merge with existing timestamp+actorId rules)
- Optimistic UI updates (show pending changes before server confirmation)
- Sync status indicator

**Done when**: Two users can edit tasks offline, reconnect, and see merged state. No data loss. E2E test covers offline-edit-reconnect flow.

## Phase 7: M11 — Custom Agent Upload

Re-enable the custom WASM agent upload UI (removed in M8.5). Includes file picker, manifest form (name, version, author, permissions), SHA-256 hash verification, and IndexedDB storage. Code preserved in git history at commit 4f7f872.

- Upload form UI in Automation panel (file select, manifest fields, permissions grid)
- WASM binary validation and hash verification
- Agent marketplace / discovery (stretch)

**Done when**: Users can upload, activate, and delete custom WASM agents from the Automation panel. Upload validates .wasm files and computes SHA-256 hash.

## Phase 8: M12 — Tor Hidden Service (deployment)

Run the relay as an optional .onion hidden service alongside the normal endpoint. Closes the IP metadata gap for high-risk users (journalists, activists) without affecting the default experience.

- Tor hidden service configuration for the relay (deployment-only, no app code changes)
- Documentation for self-hosters to enable .onion alongside clearnet
- Client-side relay URL configuration (allow users to specify a .onion endpoint)

**Done when**: Relay is reachable via .onion address. Existing clearnet endpoint unaffected. Self-hosting docs cover Tor setup.
