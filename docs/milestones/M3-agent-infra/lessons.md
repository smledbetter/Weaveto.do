# M3 Lessons Learned

## What Went Well

### Raw WASM over Extism
Choosing the raw WebAssembly API over Extism was the right call. Zero new dependencies, no `crossOriginIsolated` requirement, no SharedArrayBuffer headaches. The browser's built-in API is mature and sufficient for event-driven agents that don't need parallel execution.

### Security-first iteration
Running the opus security audit *before* shipping (not after) caught critical issues:
- The original push-model for events (host writes to WASM offset 0) was a memory corruption vector. Switching to host-pull via `host_get_event` was cleaner and safer.
- Pre-deriving CryptoKey at activation time instead of storing raw prfSeed in contexts was an easy win that removed a whole class of key exposure risk.

### Agent team for parallel work
Session 2 used a sonnet lead + 2 haiku agents. The lead wrote skeleton interfaces first, then agents implemented loader and AgentPanel in parallel. This worked cleanly because the interfaces were the contract — agents didn't need to read each other's code.

### Integration test skeleton early
Writing the integration test skeleton in Session 3 (before wiring) caught a prop name mismatch (`activeAgentIds` vs `activeAgents`) that would have been a runtime bug. Write the test first, even if it's just stubs.

## What Could Be Better

### No reference agent shipped
We built a complete WASM sandbox with no agent to put in it. The PM correctly flagged this as "a Ferrari engine with no car." M3 infrastructure is necessary but not sufficient — user value requires a working agent. This led to creating M3.5.

### M3 plan.md was stale
The original plan referenced WebContainer and Extism — both rejected during implementation. The plan should have been updated as decisions were made, not retroactively after completion.

### Timeout limitations understood too late
The 5-second `callWithTimeout` wrapper can't actually preempt synchronous WASM execution on the main thread. This was known architecturally but wasn't surfaced as a risk until the security audit. The Web Worker fix (C-2) is deferred but should be prioritized if agents become compute-heavy.

### Session 4 (security hardening) was unplanned
The original 3-session plan didn't allocate time for security review remediation. It should have been baked into Session 3 or planned as a separate session from the start. Security isn't a phase — it's continuous.

## Patterns to Keep

1. **Pre-write skeleton interfaces before spawning agents** — proven again in S2
2. **Include interfaces in agent prompts** — don't send agents to "go read types.ts"
3. **opus for security review, sonnet for implementation** — right tool for the job
4. **Integration test skeleton first** — catches wiring bugs before they compound
5. **Host-pull over host-push** — let the sandboxed code request data, don't write into its memory unsolicited

## Patterns to Avoid

1. **Shipping infrastructure without a reference implementation** — always ship at least one working example
2. **Leaving plan.md stale** — update the plan as design decisions diverge from the original
3. **Deferring security review to "later"** — bake audit remediation into the session plan

## Key Numbers

| Metric | Value |
|--------|-------|
| Sessions | 4 (3 planned + 1 security hardening) |
| New files | 12 (6 source, 6 test) |
| Modified files | 3 |
| Unit tests added | 88 (119 → 207) |
| E2E tests added | 6 (30 → 36) |
| New dependencies | 0 |
| Security findings fixed | 7 (2 critical, 4 high, 2 medium) |
| Security findings deferred | 6 (1 critical, 3 low, 2 info) |
