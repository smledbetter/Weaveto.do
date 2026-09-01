# Project State

Last updated: 2026-09-01.

## Current Phase: shipped, hardened, not yet launched

All 21 numbered milestones are complete, M0 through M19. A further unnumbered phase of production hardening followed, covering roughly twenty pull requests. See `docs/ROADMAP.md` for that phase in detail.

The app is deployed and works. The relay runs on Fly and the client on Vercel. `weaveto.do` still serves a Coming Soon page, which is the last step and is tracked as issue #97.

### Snapshot

- **Git SHA**: `c6b5103` on `main`, CI green
- **Unit tests**: 1,064 across 64 files
- **E2E tests**: 261 across 34 files, 5 CI browser projects plus a production-build job
- **Coverage**: 60.7% lines, 46% branches
- **LOC**: 41,249 total. 15,795 client, 1,998 relay, 23,456 tests
- **Production dependencies**: 3
- **Issues**: 69 closed, 10 open
- **License**: MIT


### What's Done

**M0 — E2EE Room Core** (Complete)
- WebAuthn PRF identity (device-bound, zero accounts)
- vodozemac Olm/Megolm encryption (WASM)
- WebSocket relay server (ciphertext-only routing)
- Encrypted messaging with PKCS#7 padding
- 15 Playwright E2E tests passing
- See: `docs/milestones/M0-e2ee-room-core/`

**M1 — Task Management** (Complete)
- Event-sourced task store with conflict resolution (timestamp + actorId tiebreaker)
- Task creation via form modal and `/task` command shortcut
- Subtask support (1-level depth)
- Auto-assign agent (pure function, load balancing + recency weighting)
- In-tab reminders (setTimeout + Notification API)
- Collapsible task panel UI with mobile tab switching
- 50 unit tests, 15 E2E tests, 99%+ line coverage on `src/lib/tasks/`
- See: `docs/milestones/M1-task-management/`

**M2 — Task Intelligence** (Complete)
- Task dependencies with DAG validation (BFS cycle detection)
- Natural language due dates (hand-rolled parser: "tomorrow", "next friday", "in 3 hours", "30m")
- Service worker reminders (IndexedDB persistence, cross-tab broadcast, generic notifications)
- Progress visibility (room-level progress bar, per-parent subtask %, blocked indicators)
- Keyboard shortcuts (Cmd+T panel toggle, Cmd+K create task, Shift+? help)
- Inline task editing (click-to-edit title/due date, Enter saves, Escape cancels)
- Dependency dropdown in create modal (multi-select with removable tags)
- 119 unit tests, 30 E2E tests, 93%+ statement coverage
- See: `docs/milestones/M2-task-intelligence/`

**M3 — Agent Infrastructure** (Complete)
- WASM agent sandboxing via raw WebAssembly API (zero new dependencies)
- Agent module upload with manifest validation, hash verification, size limits
- Encrypted persistent state (AES-256-GCM, HKDF-derived per-agent keys)
- Host function imports: read tasks/members, emit events, persist state, logging
- Event dispatch (host-pull model) and 30s tick loop
- Circuit breaker (3 consecutive failures auto-deactivates)
- Memory isolation (host-provided memory, bounds checking)
- AgentPanel UI with activate/deactivate/delete controls
- Opus security audit completed: 7 findings fixed (2 critical, 4 high, 1 medium bonus)
- 207 unit tests, 36 E2E tests, 89%+ statement coverage
- See: `docs/milestones/M3-agent-infra/`

**M3.5 — Built-In Agents** (Complete)
- Hand-written WAT auto-balance agent (634 bytes compiled WASM)
- Hand-written WAT unblock agent (528 bytes) — flags blocker tasks as urgent when holding up 2+ other tasks
- New `task_urgency_changed` event type (narrow write surface for agents — only `urgent` flag)
- Binary host helpers (`host_get_assignment_data`, `host_emit_assignment`, `host_get_dependency_data`, `host_emit_urgency`)
- Built-in agent registry with parallel fetch and partial-failure safety
- Auto-activates on room join with localStorage-based enable/disable
- First-run disclosure toast (once per browser)
- AgentPanel: "Built-in" badge, no delete for built-ins, upload form behind "Advanced" toggle
- 389 unit tests, 40 E2E tests, 0 regressions
- See: `docs/milestones/M3.5-built-in-agent/`

**M4 — Task Polish** (Complete)
- Task descriptions (plain text, encrypted, displayed below titles)
- Due date sorting (3-state toggle: creation → due-asc → due-desc)
- Quick-pick date buttons (Today / Tomorrow / Next Week) in create modal
- Urgent flag (binary toggle, text badge, sorts urgent-first)
- Room-scoped task search (real-time filter on title + description)
- `task_updated` event type for field updates on existing tasks
- Parser: `| urgent` and `| desc:` directives in `/task` command
- WCAG 2.1 AA: text badge (not color-only), aria-live search results, keyboard navigation
- 235 unit tests, 22 new E2E tests, 0 regressions
- See: `docs/milestones/M4-task-polish/`

**M5 — Burn-After-Use** (Complete)
- Auto-deletion: 24h grace period after all tasks complete (cancellable countdown banner)
- Manual burn: `/burn` command with type-to-confirm "DELETE" friction (creator-only)
- Ephemeral mode: checkbox on room creation, flame indicator, zero persistence, auto-purge on last disconnect
- Relay purge endpoint: creator identity verification, broadcast `room_destroyed`, delayed connection close
- Client cleanup orchestrator: 6 storage layers (session, sessionStorage, 3× IndexedDB, service worker)
- Session purge flow: `purgeInitiated` flag prevents double-processing of self-initiated purge
- Deleted room notices on homepage (auto-dismiss after 5s)
- 243 unit tests, 75 E2E tests (13 new burn tests), 0 regressions
- Ship-readiness audit: 10/10 security principles, 0 vulnerabilities
- See: `docs/milestones/M5-burn-after-use/`

**Invite Modal with QR Code** (Complete, post-M5)
- Zero-dependency QR code SVG encoder (byte mode, EC level L, versions 1-6, Reed-Solomon GF(256))
- InviteModal: QR code + copyable URL + member list + privacy footer
- SoloMemberBanner: persistent prompt when alone in room (dismissible, sessionStorage)
- Accent-styled Invite button replaces old Copy Link
- 23 new unit tests, 13 new E2E tests, 0 regressions

**M5.5 — UX Polish** (Complete)
- Deterministic 2-word room names from room ID hash (display-only, no server state)
- Homepage radio buttons: Standard vs Ephemeral with use-case descriptions
- Room name in header, page title, join page heading, invite modal
- Friendly onboarding copy for invited users ("You've been invited to a private, encrypted room")
- User's display name visible in room header ("You: Alice")
- Agent panel explainer text (what agents are, developer-only upload note)
- 299 unit tests (33 new), 102 E2E tests (14 new), 0 regressions
- See: `docs/milestones/M5.5-ux-polish/`
  
**M6 — Session Security** (Complete)
- Optional 6-digit PIN (creator can require for all members)
- PIN → PBKDF2-SHA256 (600K iterations) → 256-bit key (zero new dependencies)
- PIN key encrypted under PRF-derived HKDF wrapping key in IndexedDB
- Session lock with configurable inactivity timeout (5/15/30 min)
- Lock overlay with rate limiting (3 failures → exponential backoff, 10 → lockout)
- Megolm key rotation: lockSession() clears keys, unlockSession() restores
- Creator-forced /rotate command invalidates old sessions
- Shield indicator for PIN-protected rooms
- Cleanup orchestrator clears PIN keys on room destruction
- 342 unit tests (43 new PIN tests, 93% PIN coverage), 108 E2E tests (6 new), 0 regressions
- Ship-readiness audit: 10/10 security principles, 0 vulnerabilities
- See: `docs/milestones/M6-session-security/`

**M7 — Agent Hardening** (Complete)
- Web Worker agent execution with true preemption via `worker.terminate()`
- Worker protocol: typed postMessage API (InstantiateRequest, CallRequest, TerminateRequest, UpdateContextRequest)
- State encryption stays on main thread (CryptoKey not transferable to Workers)
- Ed25519 module signature verification via WebCrypto API
- `verifyManifestSignature()` in loader for optional signature checking
- Agent event validation: taskId existence checking against current task store
- `CREATES_NEW_TASK` set exempts `task_created`/`subtask_created` from taskId checks
- Structured clone fix: JSON.parse/stringify for manifest objects (JSON imports have non-clonable prototypes)
- Removed ArrayBuffer transfer list (prevents detachment on agent reactivation)
- No console.log/console.warn in agent runtime (security requirement)
- 372 unit tests (30 new), 119 E2E tests, 0 regressions
- Ship-readiness audit: TypeScript clean, no console violations, Worker isolation verified
- See: `docs/milestones/M7-agent-hardening/`

**M8 — Vulnerability Scanning** (Complete)
- Security audit across all shipped milestones (M0-M7), ~3,500 lines, 5 audit areas
- 2 critical, 9 high, 18 medium, 24 low, 23 info findings identified
- All critical + high findings fixed (except 1 high deferred — no upload UI exists yet)
- Relay hardening: rate limiting (30 msg/sec), connection limits (10K rooms, 5K connections, 50/room, 10/IP)
- Relay security: sender identity verification, origin validation, identity key collision handling
- Agent validation: host helpers routed through validateEmittedEvent, main-thread re-validation
- Client cleanup: console.* removed (reminders, service worker, runtime), prfSeed cleared on disconnect
- Notification body changed to generic message (no plaintext task titles in browser notifications)
- 389 unit tests, 0 regressions
- See: `docs/milestones/M8-vulnerability-scanning/`

### What's Done, the Flowstate sprints

Summarised here, recorded in full in `docs/ROADMAP.md`, with per-milestone documents under `docs/milestones/`.

**A note on numbering.** Two schemes are in use and neither is going to be renumbered, because the milestone directories are named after one of them and the sprint record after the other. The GitHub milestones follow the ROADMAP scheme, so the directories are the odd one out, two systems to one. `docs/milestones/README.md` carries the full mapping.

- `docs/milestones/` and the record above number the early work `M0`, `M1`, `M2`, `M3`, `M3.5`, `M4`, `M5`, `M5.5`, `M6`, `M7`, `M8`.
- `docs/ROADMAP.md` collapses `M3.5` into `M4`, omits `M5.5`, and so runs one ahead from that point on. What it calls `M9: Vulnerability Scanning` is the `M8` entry above, and the directory is `M8-vulnerability-scanning`.

The two schemes agree again from `M11` onward, because the offset closes: the directories have an `M9` that ROADMAP does not, and ROADMAP has an `M10` that the directories do not. `M9-encrypted-notifications` planned notifications and Web Push as one milestone, and the work shipped split across `M14` and `M16`, so that directory is marked superseded. When a number is ambiguous, the directory name is the one to trust, because it is the name on disk.

**M10 — UX and Accessibility** (Complete) — Header decluttered, coach marks, ARIA fixes, focus-visible rings, connection status label.

**M11 — Reconnect and Hardening** (Complete) — Stale Olm session clearing on reconnect, re-establishment tracking, timestamp rejection outside a 5 minute future window, threshold-based OTK replenishment.

**M12 — Mobile UX** (Complete) — Banner consolidation into the walkthrough, bottom navigation for Chat, Tasks, and Auto.

**M13 — Mobile Identity Persistence** (Complete) — IndexedDB identity seed store with a PRF-first fallback chain. Later reworked: see the production phase below.

**M14 — Local Notifications** (Complete) — Contextual opt-in banner on the first due-date task, bell popover with a toggle and quiet hours, service worker quiet-hours enforcement. Silent `requestPermission` removed.

**M15 — Trust and Verification** (Complete) — Emoji key verification, five emoji per member pair derived from the sorted identity keys, ambient in room info with no verify button. Member revocation by room migration. Per-sender sequence counters inside the encrypted payload driving a delivery shield.

**M16 — Web Push** (Complete) — VAPID JWT signing with ES256, relay push dispatch, client push manager, service worker push handler. Zero new dependencies.

**M17 — Offline Task Store** (Complete) — Encrypted IndexedDB task snapshots and event queue, unified `ConnectionIndicator`, offline task creation with a sync dot, event replay on reconnect.

**M18 — Sync and Conflict Resolution** (Complete) — Task event log with a 24 hour sync window, sync over the Megolm channel, convergence under timestamp and actorId rules.

**M19 — Multi-Room Tabs** (Complete) — BroadcastChannel cross-tab coordination, cross-tab PIN lock, tab-aware cleanup. Per-tab Olm and Megolm isolation.

### What's Done, production hardening

No milestone number, because it was not feature work. Two halves.

**Making it survive production.** The relay became stateless by design, so a deploy stops destroying every live room. Fan-out gained backpressure, taking delivery at 5,000 connections from 63% to 100% and p95 latency from 9,468 ms to 1,544 ms. A three-member decryption bug was traced to every member claiming the same single-use one-time key, and is now covered by a full-mesh suite over 2, 3, 4, and 5 members. The relay container builds, boots, and is probed in CI. Capacity is measured rather than estimated, in `docs/CAPACITY.md`.

**Making the claims true.** The README was audited line by line against the code. Display names moved off the wire and into the Olm payload. Identity became per-room, so the relay cannot correlate two rooms to one device. A blind SSRF in push endpoint handling was closed. Identity seed storage was reworked: it is now opt-in and wrapped by a key derived from a PIN that is never stored, replacing a scheme that kept the wrapping key in localStorage beside the data it wrapped. Custom agent upload left the interface, because the control existed and nothing behind it worked.

### Known Issues

- **#69, mobile pinch-zoom ejects the user from the room.** The auto-zoom that triggers it is fixed and tested. The ejection has no diagnosis that held up. It cannot be reproduced in CI, because Playwright's WebKit is not iOS Safari. Needs a physical device with Safari remote debugging.
- **The per-address connection cap is a fixed number.** It binds even when the relay is nearly empty, which costs groups behind one shared address. Tracked as #94.
- **A node is one process.** Rooms live in its memory, so a second machine splits rooms rather than adding capacity. Tracked as #92.
- **`npm run check` reports 25 warnings.** Svelte 5 type inference and a11y advisories. 0 errors. Accepted baseline for the gate.

### Milestone Status

| Milestone | Name | Status |
|-----------|------|--------|
| M0 | E2EE Room Core | Complete |
| M1 | Task Management | Complete |
| M2 | Task Intelligence | Complete |
| M3 | Agent Infrastructure | Complete |
| M3.5 | Built-In Agents | Complete |
| M4 | Task Polish | Complete |
| M5 | Burn-After-Use | Complete |
| M5.5 | UX Polish | Complete |
| M6 | Session Security | Complete |
| M7 | Agent Hardening | Complete |
| M8 | Vulnerability Scanning | Complete |

The sprints, numbered as `docs/ROADMAP.md` numbers them. Sprint 1 is the same work as `M8` above.

| Milestone | Name | Sprint | Status |
|-----------|------|--------|--------|
| M9 | Vulnerability Scanning | 1 | Complete, see `M8` above |
| M10 | UX and Accessibility | 2 | Complete |
| M11 | Reconnect and Hardening | 3 | Complete |
| M12 | Mobile UX | 4 | Complete |
| M13 | Mobile Identity Persistence | 5 | Complete |
| M14 | Local Notifications | 6 | Complete |
| M15 | Trust and Verification | 7 | Complete |
| M16 | Web Push | 8 | Complete |
| M17 | Offline Task Store | 9 | Complete |
| M18 | Sync and Conflict Resolution | 10 | Complete |
| M19 | Multi-Room Tabs | 11 | Complete |
| — | Production hardening | — | Complete |
| M20 | Tor Hidden Service | — | Not started, see issues #37, #38, #39 |

This file used to carry a second set of per-milestone specifications under "Release Goal" headings. They described work as it was planned rather than as it shipped, and several of them contradicted the record above. They are removed. `docs/milestones/` holds the per-milestone documents, and `docs/ROADMAP.md` holds the summaries.

### Tech Stack

- **Frontend**: SvelteKit 5, TypeScript, Svelte 5 runes
- **Crypto**: vodozemac WASM for Olm and Megolm, WebAuthn PRF, HKDF-SHA256, PBKDF2-SHA256 at 600,000 iterations for PIN-derived keys
- **Agents**: raw WebAssembly API in a Web Worker, AES-256-GCM state encryption
- **Server**: Node.js WebSocket relay, ciphertext only, no disk
- **Testing**: Vitest for unit, Playwright for E2E
- **Deployment**: relay on Fly, client on Vercel
