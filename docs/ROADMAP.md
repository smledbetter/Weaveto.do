# Roadmap

## Current State

- **Git SHA**: 140481f
- **Unit tests**: 372 (Vitest, jsdom)
- **E2E tests**: 119 (Playwright, Chromium) — 24 pre-existing failures (PIN, task intelligence, task polish)
- **Coverage**: 75%+ lines, 73%+ functions/branches
- **Lint**: clean (`npm run check` passes)
- **Build**: clean (`npm run build` passes)
- **Milestones complete**: M0-M7 (8 milestones shipped)
- **LOC**: ~12K (src/ + tests/ + server/)

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

## Phase 1: M8 — Vulnerability Scanning (hardening)

Security audit across all shipped milestones. This is a review/hardening sprint, not a feature sprint.

- E2EE protocol audit (Olm/Megolm key exchange, ratchet correctness)
- WebAuthn PRF identity testing (credential lifecycle, cross-device)
- WASM sandbox escape testing (memory bounds, host function abuse)
- Relay server hardening (rate limiting, payload validation, connection limits)
- Client-side crypto review (key derivation, HKDF parameters, AES-GCM nonce reuse)

**Done when**: Security report produced with findings rated critical/high/medium/low. All critical and high findings fixed. Gate: all existing tests still pass.

## Phase 2: M9 Phase 1 — Local Notifications

Expand service worker notifications without external push infrastructure.

- Expanded notification triggers (assignment, status change, due date approaching)
- Local notification rules (per-room toggle, urgency filter, do-not-disturb)
- Notification grouping (batch multiple events into single notification)

**Done when**: Notifications fire for assignments and due dates when tab is backgrounded. Rules UI works. E2E tests cover notification triggers.

## Phase 3: M9 Phase 2 — Web Push

Add VAPID-based push notifications via the relay server.

- Web Push API integration (VAPID key pair, subscription management)
- Relay push endpoint (encrypted push payloads, generic notification bodies)
- Push subscription cleanup on room destruction (burn/auto-delete/ephemeral purge)

**Done when**: Push notifications arrive when browser is closed. All payloads are generic (no task content). Subscriptions cleaned up on room destruction.

## Phase 4: M10 Phase 1 — Offline Task Store

IndexedDB-backed offline storage for tasks.

- IndexedDB task store (encrypted, mirrors event-sourced in-memory store)
- Offline detection and UI indicator
- Queue outbound events while offline

**Done when**: Tasks persist across page reloads without network. Offline indicator shown. Events queued for sync.

## Phase 5: M10 Phase 2 — Sync and Conflict Resolution

Reconnect and merge offline changes.

- Conflict resolution on reconnect (event-sourced merge with existing timestamp+actorId rules)
- Optimistic UI updates (show pending changes before server confirmation)
- Sync status indicator

**Done when**: Two users can edit tasks offline, reconnect, and see merged state. No data loss. E2E test covers offline-edit-reconnect flow.
