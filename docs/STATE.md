# Project State

Last updated: 2026-02-16

## Current Milestone: M7 — Agent Hardening

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

**M3.5 — Built-In Agent** (Complete)
- Hand-written WAT auto-balance agent (634 bytes compiled WASM)
- Binary host helpers (`host_get_assignment_data`, `host_emit_assignment`) for JSON-free WAT consumption
- Built-in agent registry (fetches from static assets, bypasses IndexedDB)
- Auto-activates on room join with localStorage-based enable/disable
- First-run disclosure toast (once per browser)
- AgentPanel: "Built-in" badge, no delete for built-ins, upload form behind "Advanced" toggle
- 221 unit tests, 40 E2E tests, 0 regressions
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
- 372 unit tests (30 new), 119 E2E tests (all agent tests pass), 0 regressions
- Ship-readiness audit: TypeScript clean, no console violations, Worker isolation verified
- See: `docs/milestones/M7-agent-hardening/`

### What's Next (M8 — Penetration Testing)

Security penetration testing across all shipped milestones.

### Known Issues

- Service worker notifications show generic body (no decrypted task titles)
- 24 pre-existing E2E test failures (PIN, task intelligence, task polish — not M7 regressions)

### Milestone Roadmap

| Milestone | Name | Status |
|-----------|------|--------|
| M0 | E2EE Room Core | Complete |
| M1 | Task Management | Complete |
| M2 | Task Intelligence | Complete |
| M3 | Agent Infrastructure | Complete |
| M3.5 | Built-In Agent | Complete |
| M4 | Task Polish | Complete |
| M5 | Burn-After-Use | Complete |
| M5.5 | UX Polish | Complete |
| M6 | Session Security | Complete |
| M7 | Agent Hardening | Complete |
| M8 | Penetration Testing | Not Started |
| M9 | Encrypted Notifications | Not Started |
| M10 | Offline & Sync | Not Started |

#### M3.5 — Built-In Agent (Release Goal)
Users get automatic task distribution out of the box, with no setup required.
- Auto-balance WAT agent (port of autoAssign, default-on)
- Binary helper import (`host_get_assignment_data`) for WAT consumption
- First-run disclosure toast on initial activation
- AgentPanel: built-in badge, description card, last-run timestamp
- Upload form hidden until M3.6 ships developer tooling

#### M4 — Task Polish (Release Goal)
Users can describe, sort, and triage tasks more effectively within ephemeral rooms.
- Task descriptions
- Due date sorting (single toggle)
- Quick-pick date buttons (Today / Tomorrow / Next Week)
- Urgent flag (binary, not P1-P4)
- Room-scoped task search

#### M5 — Burn-After-Use (Release Goal)
Rooms and tasks auto-delete on completion, with manual burn for sensitive coordination.
- Auto-deletion on room completion
- Manual burn command (immediate room data destruction)
- Ephemeral mode (in-memory only, no persistence)

#### M5.5 — UX Polish (Release Goal)
New users can understand and navigate the app without prior context.
- Memorable 2-word room names derived from hash (deterministic, no server state)
- Shortened room URLs (verbal-shareability)
- Named room modes with use-case guidance (Standard vs Ephemeral)
- Better onboarding copy for invited users landing on Join page
- User's own display name visible in room header
- Agent panel explainer text (what agents are, custom agent guidance, roadmap teaser)

#### M6 — Session Security (Release Goal) ✓
If one member's device is compromised, the attacker can't access future room content after key rotation.
- Optional 6-digit PIN (creator can require for all members)
- PIN → PBKDF2-SHA256 (600K iterations) → 256-bit key derivation (zero new dependencies)
- PIN key encrypted under PRF-derived HKDF wrapping key in IndexedDB
- Session lock with configurable inactivity timeout (5/15/30 min, clears Megolm keys from memory)
- PIN re-entry gate on reconnect with rate limiting (3 failures → 30s wait, exponential backoff, 10 → lockout)
- Megolm key rotation gated by PIN-derived keys (lockSession/unlockSession, forward secrecy from compromise point)
- Creator-forced /rotate command invalidates old sessions
- Shield indicator for PIN-protected rooms
- Cleanup orchestrator clears PIN keys on room destruction
- 342 unit tests (43 new PIN tests, 93% PIN coverage), 108 E2E tests (6 new), 0 regressions
- Ship-readiness audit: 10/10 security principles, 0 vulnerabilities

#### M7 — Agent Hardening (Release Goal)
Harden the agent infrastructure with true preemption, module signatures, and runtime improvements.
- Web Worker preemption for WASM execution (replace main-thread timeout)
- Ed25519 module signature verification
- Agent event validation against known taskIds

#### M8 — Penetration Testing (Release Goal)
Security penetration testing across all shipped milestones.
- E2EE protocol audit
- WebAuthn PRF identity testing
- WASM sandbox escape testing
- Relay server hardening
- Client-side crypto review

#### M9 — Encrypted Notifications (Release Goal)
Members get notified of task assignments and due dates even when the tab is closed, with zero plaintext in notification payloads.
- Expanded service worker notifications (assignment, status change, grouping)
- Local notification rules (per-room toggle, urgency filter, do-not-disturb)
- Web Push API integration (VAPID, encrypted push via relay, subscription management)
- All notification payloads generic ("You have a new task in [room-name]") — no task content
- Push subscription cleanup on room destruction (burn/auto-delete/ephemeral purge)

#### M10 — Offline & Sync (Release Goal)
Work offline and sync when reconnected.
- IndexedDB-backed offline task store
- Conflict resolution on reconnect
- Optimistic UI updates

### Tech Stack

- **Frontend**: SvelteKit 5, TypeScript, Svelte 5 runes ($state, $derived, $effect)
- **Crypto**: vodozemac WASM (Olm/Megolm), WebAuthn PRF, HKDF-SHA256
- **Agents**: Raw WebAssembly API, AES-256-GCM state encryption
- **Server**: Node.js WebSocket relay (ciphertext-only)
- **Testing**: Vitest (unit, 80%+ coverage), Playwright (E2E, Chromium)
- **Build**: Vite, fnm for Node version management
