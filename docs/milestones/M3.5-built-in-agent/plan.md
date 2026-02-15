# M3.5 Plan: Built-In Agent & Developer Tooling

Status: **Not Started**

## Release Goal

Users get immediate value from agents — auto-balance assigns unassigned tasks fairly across room members, enabled by default. Developers get a reference implementation and template to build custom agents.

## Why This Milestone Exists

M3 shipped the WASM sandbox infrastructure but no agent binary. The PM identified this as zero user value — "a Ferrari engine with no car." M3.5 closes the gap by shipping a working agent and minimal developer tooling.

## Features

### 1. Built-In Auto-Balance Agent

Port the existing `autoAssign()` pure function (from `src/lib/tasks/agent.ts`) to a WASM module that runs inside the M3 sandbox.

**Behavior:**
- On each `on_tick()` (every 30s): scan for unassigned, unblocked tasks
- Assign to the member with the fewest pending tasks (load balancing)
- Tie-break by most recent activity (recency weighting)
- Skip blocked tasks (respect dependency DAG)
- Persist run count and last assignment map in encrypted state

**Implementation options (choose one):**
- **AssemblyScript** — familiar to JS/TS developers, compiles to WASM, good for reference
- **Rust** — smaller binary, better tooling, but higher barrier for contributors

**Shipping as built-in:**
- Pre-bundled with the app (not uploaded by users)
- Loaded automatically in every room via a "built-in agents" registry
- Enabled by default, user can toggle off in AgentPanel
- Distinct from user-uploaded agents in the UI (labeled "Built-in")

### 2. AgentPanel Enhancements

- Show "Built-in" badge on pre-bundled agents
- Agent activity log: "Auto-Balance assigned 'Buy groceries' to Alice (3 tasks → 4 tasks)"
- Toggle switch (not just activate/deactivate buttons) for built-in agents

### 3. Developer Tooling (Minimal)

- **Reference source**: Publish auto-balance agent source code in `agents/auto-balance/`
- **Agent template**: Minimal AssemblyScript project with build script, host import bindings, and README
- **Host import docs**: Document all host functions with code examples and expected behavior
- Agent template includes a working `build.sh` that produces a valid `.wasm` + `manifest.json`

## User Stories

### Auto-Balance Agent

**As a** room coordinator managing tasks across a small team,
**I want** unassigned tasks to be automatically distributed to the least-loaded member,
**So that** work is shared fairly without me manually assigning every task.

### Custom Agent Development

**As a** developer building automation for my team's workflow,
**I want** a working reference agent and build template,
**So that** I can write, compile, and upload custom agents without reverse-engineering the host API.

## Design Decisions

- **AssemblyScript over Rust** for the reference agent — lower barrier for the target audience (JS/TS developers). Rust agent example can come later.
- **Default-on** — auto-balance should work out of the box. Users who don't want it can disable it. The worst UX is a feature that exists but requires setup to discover.
- **Activity log, not notifications** — agents work silently. Users see results in the task list. The activity log is for transparency, not interruption.
- **No agent marketplace** — premature. Built-in + manual upload covers M3.5 scope.

## Files

### New Files
| File | Purpose |
|------|---------|
| `agents/auto-balance/src/index.ts` | AssemblyScript agent source |
| `agents/auto-balance/assembly/tsconfig.json` | AssemblyScript config |
| `agents/auto-balance/build.sh` | Compile to WASM + generate manifest |
| `agents/auto-balance/README.md` | How to build, modify, and upload |
| `src/lib/agents/builtin.ts` | Built-in agent registry (load pre-bundled agents) |
| `src/lib/agents/auto-balance.wasm` | Compiled WASM binary (committed) |
| `src/lib/agents/auto-balance.manifest.json` | Manifest for built-in agent |
| `docs/architecture/agents.md` | Host import API documentation |
| `tests/unit/agent-auto-balance.test.ts` | Auto-balance logic tests |
| `tests/e2e/agent-auto-balance.spec.ts` | E2E: agent assigns tasks automatically |

### Modified Files
| File | Change |
|------|--------|
| `src/lib/components/AgentPanel.svelte` | Built-in badge, activity log, toggle switch |
| `src/lib/agents/executor.ts` | Load built-in agents on room join |
| `src/routes/room/[id]/+page.svelte` | Auto-activate built-in agents |

## Prerequisites

- M3 complete (WASM sandbox, loader, executor, encrypted state)
- AssemblyScript compiler installed as dev dependency

## Estimated Complexity

Low-Medium. The auto-assign logic already exists as a tested TypeScript function. The main work is:
1. AssemblyScript port + WASM compilation (~1 day)
2. Built-in agent registry + auto-activation (~0.5 day)
3. AgentPanel enhancements (~0.5 day)
4. Developer template + docs (~1 day)
5. Tests + integration (~1 day)

## Quality Gates

- Auto-balance agent passes all existing `autoAssign` test scenarios (ported to WASM context)
- Built-in agent activates automatically in new rooms
- Agent assignment distribution variance <= 1 (existing gate)
- Developer template compiles to valid WASM with `build.sh`
- All M0-M3 regression tests pass
