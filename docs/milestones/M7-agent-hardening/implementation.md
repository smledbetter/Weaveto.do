# M7 Implementation Plan: Agent Hardening

## Context

M3/M3.5 established the WASM agent infrastructure with sandboxed execution, encrypted state, and the built-in auto-balance agent. M7 adds three hardening layers:

1. **Web Worker preemption** — Move WASM execution off the main thread so runaway agents can be truly terminated without blocking the UI
2. **Ed25519 signatures** — Optional cryptographic verification for custom modules (built-in agents remain hash-only)
3. **Event validation** — Prevent agents from emitting events for non-existent tasks

Builds on: `src/lib/agents/runtime.ts` (instantiation, host imports, timeout), `src/lib/agents/executor.ts` (lifecycle, tick loop), `src/lib/agents/loader.ts` (validation, storage), `src/lib/crypto/engine.ts` (vodozemac wrapper).

## must_haves

### truths (observable outcomes)
- Agents run in dedicated Web Workers — main thread never blocks on agent calls
- Infinite loops or long-running agent functions can be forcibly terminated after 5s
- Custom modules can include Ed25519 signatures in manifest; loader verifies before storage
- Built-in agents continue to work without signature checks
- Agents cannot emit events for taskIds that don't exist in the current room (except task_created)
- Zero new npm dependencies (Web Worker API native, Ed25519 via vodozemac or WebCrypto)

### artifacts (files produced)
- `src/lib/agents/worker.ts` — Web Worker entry point (receives WASM bytes, instantiates, executes)
- `src/lib/agents/worker-protocol.ts` — Message protocol types for main↔worker communication
- `src/lib/agents/signature.ts` — Ed25519 signature verification (manifest signature field)
- Modified `src/lib/agents/types.ts` — Add optional `signature` field to AgentManifest
- Modified `src/lib/agents/runtime.ts` — Remove direct instantiation (now happens in worker)
- Modified `src/lib/agents/executor.ts` — Proxy that sends commands to worker via postMessage
- Modified `src/lib/agents/loader.ts` — Add signature verification step (optional)
- `tests/unit/agent-worker.test.ts` — Unit tests for worker protocol
- `tests/unit/agent-signature.test.ts` — Unit tests for Ed25519 verification
- `tests/unit/agent-validation.test.ts` — Unit tests for event taskId validation
- `tests/e2e/agent-preemption.spec.ts` — E2E test for timeout/termination

### key_links (where breakage cascades)
- `executor.ts` becomes a thin proxy — all agent calls route through worker postMessage
- Worker must load its own vodozemac WASM (can't share main thread instance)
- `buildHostImports()` must serialize responses into Uint8Array for postMessage transfer
- Event validation in `validateEmittedEvent()` requires access to current task store
- Built-in auto-balance agent must continue to work (no signature, worker-compatible WAT)
- All existing agent tests must pass without modification

## Waves

### Wave 1: Worker Protocol Types
> No dependencies. Foundation for worker communication.

**Task 1.1** (type: auto)
- **Files**: `src/lib/agents/worker-protocol.ts`
- **Action**: Define message protocol types for main↔worker. Commands: `InstantiateRequest`, `CallRequest` (init/on_tick/on_task_event), `TerminateRequest`. Responses: `InstantiateResponse`, `CallResponse`, `ErrorResponse`. Include transferable ArrayBuffer fields for WASM bytes and context data.
- **Verify**: TypeScript compiles, types are discriminated unions with `type` field
- **Done**: Protocol covers all agent lifecycle operations

**Task 1.2** (type: auto)
- **Files**: `src/lib/agents/types.ts`
- **Action**: Add optional `signature?: string` field to `AgentManifest`. Signature is base64-encoded Ed25519 signature of the `wasmHash` field. Update manifest validation in `loader.ts` to allow optional signature field.
- **Verify**: TypeScript compiles, existing manifests without signature still valid
- **Done**: Manifest type supports optional signature

### Wave 2: Web Worker Implementation
> Depends on: Wave 1 (protocol types)

**Task 2.1** (type: auto)
- **Files**: `src/lib/agents/worker.ts`
- **Action**: Web Worker entry point. Listens for postMessage commands. On `InstantiateRequest`: imports vodozemac WASM (worker-local instance), calls `instantiateAgent()` from runtime.ts, stores exports in worker-local state. On `CallRequest`: executes the requested function (init/on_tick/on_task_event) with timeout, responds with success/error. On `TerminateRequest`: closes worker via `self.close()`. Host imports must serialize responses into Uint8Array for transfer.
- **Verify**: Worker can instantiate a simple WASM module and execute exported functions
- **Done**: Worker handles all command types, vodozemac initializes successfully

**Task 2.2** (type: auto)
- **Files**: `src/lib/agents/executor.ts`
- **Action**: Convert `AgentExecutor.activate()` to spawn a Web Worker (`new Worker(new URL('./worker.ts', import.meta.url))`). Send `InstantiateRequest` with WASM bytes via postMessage (transferable). Convert `dispatchTaskEvent()` and tick loop to send `CallRequest` messages. Add timeout handling: if worker doesn't respond within `CALL_TIMEOUT_MS`, terminate the worker and log error. Replace direct WASM calls with async postMessage round-trips.
- **Verify**: Existing agent tests pass with worker-based execution
- **Done**: Executor is a thin proxy, all WASM runs in worker

**Task 2.3** (type: auto)
- **Files**: `src/lib/agents/runtime.ts`
- **Action**: Extract `buildHostImports()` and memory helpers into worker-compatible functions. Host imports must now serialize responses into Uint8Array that can be transferred back to main thread (avoid sharing references). `HostContext` must be serializable for postMessage (convert Map to plain object, convert CryptoKey to raw bytes if needed for transfer).
- **Verify**: Unit tests confirm host imports work when serialized across worker boundary
- **Done**: All host functions serialize correctly for postMessage

**Task 2.4** (type: auto)
- **Files**: `tests/unit/agent-worker.test.ts`
- **Action**: Unit tests for worker protocol. Mock worker with manual postMessage simulation. Test: instantiate succeeds, init call succeeds, on_tick call succeeds, timeout triggers termination, worker termination cleans up resources.
- **Verify**: `npm run test:unit` passes
- **Done**: 80%+ coverage on worker.ts

### Wave 3: Ed25519 Signature Verification
> Depends on: Wave 1 (manifest signature field). Can run in parallel with Wave 2.

**Task 3.1** (type: auto)
- **Files**: `src/lib/agents/signature.ts`
- **Action**: Implement `verifyModuleSignature(wasmHash: string, signature: string, publicKey: string): Promise<boolean>`. First check if vodozemac exposes standalone Ed25519 verification. If not, use WebCrypto Ed25519 (`crypto.subtle.verify` with `Ed25519` algorithm). Signature is base64-encoded, wasmHash is hex string, publicKey is base64-encoded Ed25519 public key (32 bytes). Convert hex hash to bytes, decode signature, verify.
- **Verify**: Unit tests with known Ed25519 test vectors (sign with known private key, verify with public key)
- **Done**: Verification works with both valid and invalid signatures

**Task 3.2** (type: auto)
- **Files**: `src/lib/agents/loader.ts`
- **Action**: Add signature verification to `validateWasmBinary()`. If manifest has `signature` field, call `verifyModuleSignature(manifest.wasmHash, manifest.signature, trustedPublicKey)`. `trustedPublicKey` passed as parameter (from room policy or global config). If verification fails, return error. If `signature` field is missing and signatures are optional (default), skip verification. Built-in agents bypass this step (checked via built-in registry).
- **Verify**: Upload succeeds with valid signature, fails with invalid signature, succeeds without signature if optional
- **Done**: Signature verification integrated into loader flow

**Task 3.3** (type: auto)
- **Files**: `tests/unit/agent-signature.test.ts`
- **Action**: Unit tests for signature verification. Generate Ed25519 keypair (WebCrypto or vodozemac), sign a WASM hash, verify it. Test invalid signature (wrong key), tampered hash, missing signature field (optional mode), signature required mode (rejects unsigned).
- **Verify**: `npm run test:unit` passes
- **Done**: 90%+ coverage on signature.ts

### Wave 4: Event Validation (taskId Checking)
> Depends on: Wave 2 (executor refactor). Needs access to task store in validation context.

**Task 4.1** (type: auto)
- **Files**: `src/lib/agents/runtime.ts`
- **Action**: Modify `validateEmittedEvent()` to accept an additional parameter: `currentTasks: Task[]`. Check that `event.taskId` exists in `currentTasks` (by ID). Exception: `task_created` and `subtask_created` events are allowed to reference new taskIds (task doesn't exist yet). All other event types must reference existing tasks. If validation fails, throw error with message "Agent emitted event for unknown taskId: {taskId}".
- **Verify**: Unit tests confirm validation passes for existing tasks, fails for unknown taskIds, allows task_created
- **Done**: TaskId validation integrated into validateEmittedEvent

**Task 4.2** (type: auto)
- **Files**: `src/lib/agents/executor.ts`, `src/lib/agents/worker.ts`
- **Action**: Pass current task list to worker when sending `CallRequest` for `on_task_event`. Worker must include tasks in HostContext for validation. Main thread `dispatchTaskEvent()` already has access to tasks via `updateContext()` — ensure tasks are serialized and sent to worker before each agent call.
- **Verify**: Worker receives current task list, validateEmittedEvent has access to it
- **Done**: Task store accessible during event validation in worker

**Task 4.3** (type: auto)
- **Files**: `tests/unit/agent-validation.test.ts`
- **Action**: Unit tests for event validation. Mock task store with 3 tasks. Test: emit event for existing task (passes), emit event for unknown task (fails), emit task_created for new ID (passes), emit task_assigned for deleted task (fails).
- **Verify**: `npm run test:unit` passes
- **Done**: 90%+ coverage on validation logic

### Wave 5: Integration Tests & E2E
> Depends on: Waves 2, 3, 4

**Task 5.1** (type: auto)
- **Files**: `tests/e2e/agent-preemption.spec.ts`
- **Action**: E2E test for worker preemption. Create a custom agent with an infinite loop in on_tick (or sleep for 10 seconds). Activate it. Verify UI remains responsive (can type in task input). Verify agent is terminated after 5s timeout. Verify circuit breaker increments failure count.
- **Verify**: `npm run test:e2e` passes
- **Done**: E2E test confirms timeout/termination works

**Task 5.2** (type: auto)
- **Files**: `tests/e2e/agent.spec.ts` (existing)
- **Action**: Add E2E test for signed module upload. Generate Ed25519 keypair, sign the auto-balance WASM hash, upload with signature. Verify activation succeeds. Upload with invalid signature, verify rejection. Ensure all existing agent E2E tests still pass (built-in agent, custom module upload, activation/deactivation).
- **Verify**: `npm run test:e2e` passes
- **Done**: All agent E2E scenarios pass

**Task 5.3** (type: auto)
- **Files**: All unit test files
- **Action**: Run full test suite. Verify all 342+ unit tests pass. Check coverage: 75%+ lines on new files (worker.ts, signature.ts, worker-protocol.ts), 73%+ functions/branches. Fix any regressions in existing tests (especially auto-balance agent tests).
- **Verify**: `npm run test:unit && npm run test:e2e`
- **Done**: 0 test failures, coverage gates met

### Final Wave: Ship-Readiness Gate
> Depends on: all prior waves. Must pass before shipping.

**Ship-Readiness Review** (type: checkpoint:gate)
- **Skills**: `production-engineer` + `security-auditor` (single agent, one pass)
- **Action**: Run quality gates (unit tests with coverage, E2E, type check, TDD conventions) AND 10-principle security audit with OWASP ASI Top 10 threat analysis on all changed files. Special focus on: worker message protocol (no prototype pollution), Ed25519 signature verification (no key confusion), taskId validation (no bypass via task_created spam), worker termination (no resource leaks).
- **Verify**: All gates pass, all 10 security principles pass. Fix any failures, re-run until clean.
- **Done**: 0 test failures, 75%+ coverage on new code, 0 type errors, 10/10 security principles, 0 vulnerabilities

## Agent Strategy

| Wave | Agent | Model | Tasks |
|------|-------|-------|-------|
| 1 | Solo | sonnet | 1.1, 1.2 (types — fast, sequential) |
| 2 | Solo | sonnet | 2.1-2.4 (worker implementation — complex, needs focus) |
| 3 | Solo | sonnet | 3.1-3.3 (Ed25519 crypto — sequential, crypto work) |
| 4 | Solo | sonnet | 4.1-4.3 (validation — depends on worker refactor) |
| 5 | Solo | sonnet | 5.1-5.3 (tests — final integration) |
| Final | Ship-Readiness | sonnet | Quality gates + security audit |

### Process Notes

1. **Waves 2 and 3 could run in parallel** if context budget allows, but worker implementation (Wave 2) is complex and should have focused attention. Safer to run sequentially.

2. **Worker must import vodozemac separately.** The worker doesn't have access to the main thread's vodozemac instance. `worker.ts` must call `initCrypto()` from `engine.ts` on first instantiation.

3. **Vite worker bundling.** SvelteKit/Vite needs `new URL('./worker.ts', import.meta.url)` pattern for worker imports. Worker file must be at `src/lib/agents/worker.ts` to be co-located with other agent code.

4. **Signature verification: vodozemac vs WebCrypto.** Check if `vodozemac` exposes standalone `Ed25519.verify()`. If not, use `crypto.subtle.verify('Ed25519', publicKey, signature, message)` (supported in modern browsers). No new dependencies either way.

5. **Event validation exception list.** Only `task_created` and `subtask_created` can reference new taskIds. All other types (`task_assigned`, `task_status_changed`, `task_dependencies_changed`) must reference existing tasks.

6. **E2E preemption test needs fast timeout.** For E2E testing, add a dev-mode timeout override or use a custom test-only WASM module that sleeps for exactly 6 seconds (just over the 5s limit).

7. **Session break after Wave 3.** Waves 1-3 produce working Web Worker execution and signature verification. Waves 4-5 add validation and tests. If context gets tight, commit after Wave 3 and continue fresh.

8. **Ship-readiness uses sonnet.** This milestone adds worker boundary security and signature cryptography, but no core key management changes. Sonnet-level audit is sufficient (opus reserved for Megolm/key-rotation milestones).

## Estimated Tokens

| Wave | Est. Tokens |
|------|-------------|
| Wave 1: Worker Protocol Types | ~8K |
| Wave 2: Web Worker Implementation | ~35K |
| Wave 3: Ed25519 Signature Verification | ~18K |
| Wave 4: Event Validation (taskId Checking) | ~12K |
| Wave 5: Integration Tests & E2E | ~15K |
| Ship-Readiness Gate | ~8K |
| **Total** | **~96K** |
