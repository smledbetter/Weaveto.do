# M3 Plan: Agent Infrastructure

Status: **Complete**

## Release Goal

Room members can upload, activate, and run sandboxed WASM agent modules that automate task coordination — without exposing plaintext, room keys, or host APIs.

## What Shipped

### 1. Agent Types & API Contract (`src/lib/agents/types.ts`)
- `AgentManifest` — name, version, description, author, wasmHash (SHA-256), permissions
- `AgentExports` — `init()`, `on_task_event()`, `on_tick()`, `memory`
- `AgentHostImports` — `host_get_tasks`, `host_get_members`, `host_get_now`, `host_emit_event`, `host_get_event`, `host_get_state`, `host_set_state`, `host_log`
- Capability permissions: `read_tasks`, `read_members`, `emit_events`, `persist_state`
- Constants: `MAX_MEMORY_PAGES` (160 = 10MB), `MAX_STATE_SIZE` (1MB), `CALL_TIMEOUT_MS` (5s), `TICK_INTERVAL_MS` (30s)

### 2. WASM Runtime (`src/lib/agents/runtime.ts`)
- Raw WebAssembly API (no Extism — zero new dependencies)
- Host-provided memory (agent-exported memory ignored)
- SHA-256 hash verification at instantiation time (TOCTOU defense)
- Bounds checking on all memory read/write operations
- Permission-gated host functions (denied permissions return stubs)
- Host-pull event model: agent reads events via `host_get_event`, not host writing to offset 0
- Event validation: only allowed event types, forced `agent:` actorId prefix
- State persistence: AES-256-GCM encrypted, HKDF-derived per-agent keys

### 3. Agent Loader (`src/lib/agents/loader.ts`)
- Manifest validation (required fields, semver, permissions)
- WASM binary validation: `WebAssembly.validate()`, size limit (500KB), hash verification
- IndexedDB storage (manifest + binary, keyed by `roomId:name`)
- CRUD operations: store, get, list, delete modules per room

### 4. Encrypted State (`src/lib/agents/state.ts`)
- HKDF-SHA256 key derivation: `agentStateKey = HKDF(prfSeed, "weave-agent-state-v1", "agent-state:" + moduleId)`
- AES-256-GCM encryption with random 12-byte IV per write
- IndexedDB persistence: `weave-agent-state` database, `states` store
- State loaded on activation, flushed after each tick/event cycle

### 5. Agent Executor (`src/lib/agents/executor.ts`)
- Activation: instantiate WASM, load encrypted state, call `init()`
- Event dispatch: `on_task_event()` via host-pull pattern
- 30s tick loop: `on_tick()` for periodic work
- 5s timeout wrapper per call (note: sync WASM blocks event loop; true preemption deferred to C-2)
- Circuit breaker: 3 consecutive tick failures auto-deactivates agent
- Eager key derivation: CryptoKey derived at activation, raw prfSeed never stored in context
- State flush after each event/tick cycle

### 6. AgentPanel UI (`src/lib/components/AgentPanel.svelte`)
- Agent list with status (active/inactive)
- Upload form (manifest JSON + WASM binary)
- Activate/deactivate/delete controls
- Integrated into room page with toggle button, mobile tab support

## Technology Decision: Raw WASM (not Extism)

| Factor | Extism | Raw WASM (chosen) |
|--------|--------|-----|
| Bundle size | ~200KB + runtime | 0 (built-in browser API) |
| SharedArrayBuffer | Required | Not required |
| crossOriginIsolated | Required (COOP/COEP headers) | Not required |
| Dependencies | `@extism/extism` | Zero |
| Control | Opinionated plugin format | Full control over imports |

Key reason: Extism requires `crossOriginIsolated` for background threads, which needs COOP/COEP headers that complicate deployment. Our agents respond to events, not run continuously — main-thread WASM is sufficient.

## Security

### Hardened (opus security audit, S4)

| Threat | Mitigation |
|--------|-----------|
| Offset-0 memory write (C-1) | Host-pull event model via `host_get_event` |
| Key material exposure (H-1) | Pre-derived CryptoKey, no raw prfSeed in contexts |
| TOCTOU hash bypass (H-2) | SHA-256 re-verification at instantiation |
| Agent memory bypass (H-3) | Host-provided memory only, agent exports ignored |
| Runaway agent DoS (H-4) | Circuit breaker: 3 strikes auto-deactivate |
| State size bomb (M-1) | MAX_STATE_SIZE (1MB) enforced on write |
| Memory corruption (M-2) | boundsCheck() on all read/write operations |

### Deferred

| Item | Reason |
|------|--------|
| C-2: Web Worker wrapper | True WASM preemption needs significant complexity; current timeout adequate for cooperative agents |
| M-3: Deep-clone shared context | Performance vs. safety tradeoff; agents are trusted-by-room-member |
| M-4: Schema validation on emitted events | Validate taskId against known tasks |
| L-1/L-2/L-3: HKDF salt/separator hardening | Low risk, address if federation introduces cross-room concerns |

## Files

### Created (9)
- `src/lib/agents/types.ts`
- `src/lib/agents/runtime.ts`
- `src/lib/agents/loader.ts`
- `src/lib/agents/state.ts`
- `src/lib/agents/executor.ts`
- `src/lib/components/AgentPanel.svelte`
- `tests/unit/agent-runtime.test.ts`
- `tests/unit/agent-state.test.ts`
- `tests/unit/agent-loader.test.ts`

### Created (integration/E2E)
- `tests/unit/agent-executor.test.ts`
- `tests/unit/agent-integration.test.ts`
- `tests/e2e/agent-infra.spec.ts`

### Modified
- `src/lib/tasks/types.ts` — AgentTaskEvent wrapper
- `src/lib/room/session.ts` — sendAgentTaskEvent()
- `src/routes/room/[id]/+page.svelte` — AgentPanel wiring, executor lifecycle

## Test Coverage

- 207 unit tests (all passing), 89%+ statement coverage
- 36 E2E tests (15 M0+M1, 15 M2, 6 M3)
- 0 svelte-check errors

## Sessions

- S1: Types, encrypted state, runtime (solo sonnet)
- S2: Loader, executor, AgentPanel (sonnet lead + 2 haiku agents)
- S3: Integration wiring, room page, E2E tests (solo sonnet)
- S4: Security hardening from opus audit (solo opus)
