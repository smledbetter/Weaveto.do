# Project State

Last updated: 2026-02-15

## Current Milestone: M6 — Offline & Sync

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

### What's Next (M6 — Offline & Sync)

Offline-first task management with encrypted local storage and conflict-free sync.
- Encrypted local task cache (IndexedDB + AES-GCM)
- Offline task creation and editing
- Conflict-free sync on reconnect (CRDT-based merge)

See: `docs/milestones/M6-offline-sync/` (planned)

### Known Issues

- WASM timeout wrapper can't preempt synchronous execution (Web Worker deferred as C-2)
- Service worker notifications show generic body (no decrypted task titles)
- Agent-emitted events not validated against known taskIds (deferred M-4)

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
| M6 | Offline & Sync | Not Started |
| M7 | Multi-Device | Not Started |

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

### Tech Stack

- **Frontend**: SvelteKit 5, TypeScript, Svelte 5 runes ($state, $derived, $effect)
- **Crypto**: vodozemac WASM (Olm/Megolm), WebAuthn PRF, HKDF-SHA256
- **Agents**: Raw WebAssembly API, AES-256-GCM state encryption
- **Server**: Node.js WebSocket relay (ciphertext-only)
- **Testing**: Vitest (unit, 80%+ coverage), Playwright (E2E, Chromium)
- **Build**: Vite, fnm for Node version management
