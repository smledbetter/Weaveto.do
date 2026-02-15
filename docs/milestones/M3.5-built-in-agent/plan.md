# M3.5 Plan: Built-In Auto-Balance Agent

Status: **Not Started**

## Release Goal

Users get immediate value from agents — auto-balance assigns unassigned tasks fairly across room members, enabled by default. No setup, no configuration.

## Why This Milestone Exists

M3 shipped the WASM sandbox infrastructure but no agent binary. The PM identified this as zero user value. M3.5 closes the gap by shipping a working built-in agent that proves the platform delivers real outcomes.

## Advisory Consensus

The architect, PM, and UX designer reviewed the original plan and agreed on scope cuts:

| Decision | Rationale |
|----------|-----------|
| Hand-written WAT over AssemblyScript | Zero dependencies, JSON parsing in raw WASM is impractical — use binary helper import instead |
| Cut activity log | Users see assignments in task list; first-run toast covers discovery. Add log in M3.6 if users report confusion |
| Cut developer tooling | No demand signal. Ship upload UI + AS template + docs together in M3.6 |
| Hide upload form | Promising capability without docs is a dark pattern (PM). Show only built-in agents |
| Add first-run toast | UX + PM agree: users need disclosure when agent first activates |
| Add agent description card | Badge alone doesn't explain what the agent does or when it runs |
| Single session delivery | Serial dependency chain (WAT → tests → UI), no parallel streams |

## Features

### 1. Built-In Auto-Balance Agent (WAT)

Port the existing `autoAssign()` pure function (from `src/lib/tasks/agent.ts`) to a hand-written WebAssembly Text format module.

**Behavior:**
- On each `on_tick()` (every 30s): scan for unassigned, unblocked tasks
- Assign to the member with the fewest pending tasks (load balancing)
- Tie-break by most recent activity (recency weighting)
- Skip blocked tasks (respect dependency DAG)
- Persist last-run timestamp in encrypted state (prevent double-assignment on fast refresh)

**Implementation: Hand-Written WAT + Binary Helper Import**

JSON parsing in raw WASM is impractical. Instead, add a `host_get_assignment_data` helper import that returns a compact binary format:

```
[u32 unassignedTaskCount]
[u32 memberCount]
For each unassigned task:
  [32 bytes: taskId (UTF-8, zero-padded)]
  [u8: isBlocked (0 or 1)]
For each member:
  [32 bytes: identityKey (UTF-8, zero-padded)]
  [u32: pendingTaskCount]
  [u32: lastActiveTimestamp]
```

The WAT agent reads this via simple offset math, finds the best assignment, and emits `task_assigned` events via `host_emit_event` (JSON string with hardcoded format).

The existing `host_get_tasks` and `host_get_members` JSON imports remain available for future AssemblyScript-based agents.

**Shipping as built-in:**
- Pre-bundled with the app via Vite import (`?arraybuffer`)
- Loaded from `src/lib/agents/builtin.ts` registry on executor init
- Bypasses IndexedDB (not uploaded, not user-deletable)
- Enabled by default, user can toggle off in AgentPanel
- Preference persisted in localStorage (`weave:builtin-agent-prefs`)

### 2. First-Run Disclosure Toast

On the first agent activation (per browser, stored in localStorage):

```
┌──────────────────────────────────────────────┐
│  Auto-Balance is now active                  │
│  Unassigned tasks will be distributed fairly │
│  across room members every 30 seconds.       │
│                                              │
│  [Manage Agents]              [Got it]       │
└──────────────────────────────────────────────┘
```

- Dismissible via "Got it" button or auto-dismiss after 10 seconds
- "Manage Agents" opens AgentPanel with auto-balance highlighted
- Shown once per browser (`localStorage: weave:seen-auto-balance-notice`)

### 3. AgentPanel Enhancements

**Agent description card** for built-in agents:

```
┌─────────────────────────────────────────────┐
│ ● Auto-Balance              Built-in   [⚙]  │
│   Assigns unassigned tasks to the member    │
│   with the fewest pending tasks.            │
│   Runs every 30 seconds.                    │
│                                             │
│   Last run: 12s ago                         │
│   [Deactivate]                              │
└─────────────────────────────────────────────┘
```

- Static description (1-2 sentences, what it does)
- Run frequency ("every 30 seconds")
- Last-run timestamp (live feedback that agent is working)
- "Built-in" badge (not deletable, only toggle-able)
- No activity log (deferred to M3.6)

**Upload form hidden** — remove or hide the upload UI until M3.6 ships developer tooling alongside it.

## User Story

**As a** room coordinator managing tasks across a small team,
**I want** unassigned tasks to be automatically distributed to the least-loaded member,
**So that** work is shared fairly without me manually assigning every task.

## User Flow

1. Alice creates a room, adds 3 unassigned tasks
2. 30 seconds pass → agent tick fires
3. Toast appears (first time only): "Auto-Balance is now active..."
4. All 3 tasks assigned to Alice (only member)
5. Alice invites Bob to the room
6. Alice creates a new unassigned task
7. Next tick → task assigned to Bob (lower load)
8. Alice opens AgentPanel, sees Auto-Balance card with "Last run: 5s ago"
9. No confusion — the toast explained what happened, the panel shows it's working

## Design Decisions

- **WAT over AssemblyScript** — the autoAssign logic is ~50 lines. WAT avoids toolchain dependencies. AS can be added in M3.6 for developer tooling.
- **Binary helper import over JSON** — `host_get_assignment_data` returns structured binary that WAT can consume. Keeps `host_get_tasks` JSON API for future AS agents.
- **Default-on with disclosure** — immediate value, but first-run toast prevents surprise. High-stakes (task ownership) warrants just-in-time explanation.
- **No activity log** — PM + architect agree: task list shows the outcome. Toast covers discovery. Add log in M3.6 if users report confusion about who assigned their tasks.
- **Hide upload UI** — PM flagged: showing "Upload Agent" with no docs/tooling is a dark pattern. Ship upload + tooling together in M3.6.
- **No agent marketplace** — premature. Built-in only for M3.5.

## Files

### New Files

| File | Purpose |
|------|---------|
| `src/lib/agents/auto-balance.wat` | Hand-written WAT source (auditable reference) |
| `src/lib/agents/auto-balance.wasm` | Compiled binary (committed, matches .wat) |
| `src/lib/agents/auto-balance.manifest.json` | Manifest with SHA-256 hash and permissions |
| `src/lib/agents/builtin.ts` | Built-in agent registry (imports .wasm, loads on init) |
| `tests/unit/agent-auto-balance.test.ts` | Port of existing autoAssign test vectors |
| `tests/e2e/agent-auto-balance.spec.ts` | E2E: built-in agent assigns tasks on room join |

### Modified Files

| File | Change |
|------|--------|
| `src/lib/agents/runtime.ts` | Add `host_get_assignment_data` binary helper import |
| `src/lib/agents/executor.ts` | Load built-in agents from registry on init, track last-run timestamp |
| `src/lib/components/AgentPanel.svelte` | Description card, built-in badge, last-run, hide upload form |
| `src/routes/room/[id]/+page.svelte` | Auto-activate built-ins (check localStorage prefs), first-run toast |

## Session Plan (Single Session, Solo Sonnet)

Serial dependency chain — no parallelizable streams:

1. Add `host_get_assignment_data` to runtime.ts host imports
2. Write `auto-balance.wat` (reference existing TS test vectors)
3. Compile to `.wasm`, write manifest with SHA-256 hash
4. Create `builtin.ts` registry (import .wasm via Vite, load on executor init)
5. Wire auto-activation in room page (check localStorage prefs)
6. Update AgentPanel: description card, built-in badge, last-run timestamp, hide upload
7. Add first-run toast component
8. Port 11 unit tests to WASM agent context
9. Add E2E test: built-in agent assigns task after room join
10. Run full test suite + svelte-check

## Prerequisites

- M3 complete (WASM sandbox, loader, executor, encrypted state)
- `wat2wasm` from WABT toolkit (one-time compile, not a runtime dependency)

## Quality Gates

- Auto-balance WASM matches existing `autoAssign` test coverage (11 test vectors)
- Assignment distribution variance <= 1 (existing gate)
- Built-in agent activates on room join (unless user disabled via localStorage)
- User can toggle off, preference persists across sessions
- First-run toast shown once, dismissible
- All M0-M3 regression tests pass (207 unit, 36 E2E)
- Zero svelte-check errors

## Deferred to M3.6

| Feature | Reason |
|---------|--------|
| Activity log | PM + architect: task list shows outcomes. Add if users report confusion |
| Upload Agent UI | PM: dark pattern without docs. Ship with tooling |
| AssemblyScript template | No demand signal. Add when developer interest emerges |
| Developer docs (agents.md) | Ship with AS template and upload UI as a package |
| Host import API reference | Inline comments in runtime.ts sufficient for now |
