# Project State

Last updated: 2026-02-15

## Current Milestone: M3 — Agent Infrastructure

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

### What's Next (M3 — Agent Infrastructure)

See: `docs/milestones/M3-agent-infra/`

### Known Issues

- No WASM sandboxing for agents yet — agents run as pure functions in-tab
- Service worker notifications show generic body (no decrypted task titles)

### Milestone Roadmap

| Milestone | Name | Status |
|-----------|------|--------|
| M0 | E2EE Room Core | Complete |
| M1 | Task Management | Complete |
| M2 | Task Intelligence | Complete |
| M3 | Agent Infrastructure | Not Started |
| M4 | Task Polish | Not Started |
| M5 | Burn-After-Use | Not Started |

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
- **Server**: Node.js WebSocket relay (ciphertext-only)
- **Testing**: Vitest (unit, 80%+ coverage), Playwright (E2E, Chromium)
- **Build**: Vite, fnm for Node version management
