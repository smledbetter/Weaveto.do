# Development Workflow

## Build & Dev Commands

```bash
npm run dev          # Start Vite dev server (port 5173)
npm run relay        # Start WebSocket relay server (port 3001)
npm run dev:all      # Start both relay and dev server
npm run build        # Production build
npm run check        # TypeScript and Svelte type checking
npm run preview      # Preview production build
npm run test:unit    # Vitest unit tests with coverage
npm run test:e2e     # Playwright E2E tests (Chromium)
```

## Environment

- Node managed via fnm: `/Users/stevo/.local/share/fnm/aliases/default/bin`
- When running commands in scripts/CI, ensure PATH includes the fnm bin directory

## Testing Process

Tests are written alongside or immediately after implementation, typically in a dedicated test wave.

- **Pure logic modules** (parsers, derivation, store): write tests in the same wave as implementation
- **UI components**: tested via E2E (Playwright), not unit tests
- **Crypto modules**: include known-answer test vectors (e.g., RFC 6070) in agent prompts
- **Dedicated test wave**: after all code waves, a test agent writes unit + E2E tests for the full milestone
- **Coverage verified** at the ship-readiness gate, not per-module

### Quality Gates

- Unit test coverage >= 75% lines, 73% functions/branches. Extract pure functions from I/O-bound code to maximize testable surface.
- All Playwright E2E tests pass (including regression tests from prior milestones)
- Zero axe-core accessibility violations on new UI
- Zero plaintext data on relay server
- `npm run check` passes (svelte-check + TypeScript)

---

## Sprint Workflow

A sprint = one milestone delivery. Every sprint follows 3 phases.

### Phase 1: Consensus + Plan

A single agent loads all three skill perspectives (`product-manager`, `ux-designer`, `weave-architect`) and produces all planning artifacts in one pass. This avoids 3 separate agents independently reading the same milestone docs and codebase.

**Before creating new docs, check if plan docs already exist.** The user may have assessed and planned the feature in a prior session. If `acceptance.md` and `implementation.md` already exist in `docs/milestones/M{N}-{name}/`, validate them against the current codebase and update rather than recreate.

**The agent must:**
1. Read the milestone plan, STATE.md, and relevant code
2. Write acceptance criteria (PM perspective): `docs/milestones/M{N}-{name}/acceptance.md`
3. Validate UX flows and accessibility (UX perspective)
4. Create the implementation plan (Architect perspective): `docs/milestones/M{N}-{name}/implementation.md`

**Plan template**: `docs/templates/PLAN-TEMPLATE.md`

**Plan must include:**
- `must_haves` — truths (observable outcomes), artifacts (files), key_links (cascading dependencies)
- Waves — dependency-grouped tasks with `depends_on` metadata
- Task types — `auto`, `checkpoint:human-verify`, `checkpoint:decision`
- Agent strategy — model selection per wave (haiku for mechanics, sonnet for logic, opus for crypto)
- **Batch small milestones** (<30 tests expected) into a single sprint session when possible. Small milestones have disproportionate overhead from planning, gating, and retro. M3.5 and M5.5 each spent ~40% of tokens on non-feature work.

### Phase 2: Execute + Gate

Run plans in dependency-aware waves, then verify.

**Execution rules:**
- Each subagent gets a **fresh context** with file path references (not embedded content)
- **2-3 tasks max** per subagent to stay in quality range
- **Atomic commit per wave** (not per task): `feat(M{N}): description`. Group related changes.
- **The orchestrator should orchestrate, not implement.** Delegate all waves to sonnet/haiku agents. Every wave done at opus rate costs ~5x more than sonnet delegation. Target: opus handles only planning, review, and coordination — never writes feature code directly.
- Orchestrator stays at **30-40% context** — delegates, doesn't accumulate
- Load **research artifacts** (`docs/research/*.md`) once, not re-discover
- **Crypto waves stay serial** — no parallelism on waves that modify key management chains
- **E2E agents must grep all test files** for old strings/selectors before finishing
- **Include known-answer test vectors** (e.g., RFC 6070 for PBKDF2) in crypto agent prompts
- **Plan session breaks** for milestones >100K tokens — commit at natural split points
- **Visual check after each UI wave** — don't wait until the end. Catch layout/copy issues before they compound across waves

**Wave execution:**
1. Analyze file dependencies between tasks
2. Group independent tasks into waves
3. Run same-wave tasks in parallel (spawn subagents)
4. Wait for wave completion before starting next wave

**Final wave — ship-readiness gate:**

A single agent loads both `production-engineer` and `security-auditor` skills and runs all checks in one pass:

- **Quality gates**: `npm run test:unit` (75%+ coverage), `npm run test:e2e` (0 regressions), `npm run check` (0 TypeScript errors), TDD conventions
- **`npm run check` is mandatory** — Vitest doesn't catch TypeScript type errors. Code can pass all tests but fail type checking (e.g., M7's `Uint8Array<ArrayBufferLike>` vs `BufferSource`).
- **Security audit**: 10-principle review on all changed files, OWASP ASI Top 10 threat analysis
- Must produce a combined pass/fail report
- **Must pass before proceeding to Phase 3.** Fix any issues found, then re-run.
- **Use opus for crypto milestones** (key management, derivation, wrapping). Use sonnet for UI/logic milestones.

### Phase 3: Ship

The orchestrator handles this directly. Steps 1-3 are parallelizable.

1. **Push** all commits to main
2. **In parallel:**
   - **a) Doc updates** (haiku agent or orchestrator): Update `docs/STATE.md` (mark milestone complete, set next), update `docs/PROJECT.md` (milestone table), sync GitHub via `gh` CLI (close milestone/issues, create next milestone + issues)
   - **b) Retrospective** (orchestrator): Append to `.local/session-retrospective.md`:
     - What was built (deliverables, test counts)
     - What worked (efficiency wins)
     - What was inefficient (missed opportunities)
     - Patterns established
     - Cost observations (model selection, context usage)
     - **Token accounting**: Run token count script against JSONL session logs. Record verified totals (input, output, cache_read, cache_creation) and model mix percentages. Separate **feature tokens** (code waves, tests) from **meta tokens** (planning, retro, doc sync, GitHub housekeeping) — meta work should be <15% of total new-work tokens.
     - Update cross-milestone tables (process evolution, cumulative quality, top lessons)
     - **Never skip** (M2 was missed — don't repeat)
3. **Review lessons and recommend process changes** for the next milestone:
   - Read the full retro history (`.local/session-retrospective.md`)
   - Identify recurring failures, new patterns, and efficiency gains
   - Produce concrete recommendations (what to keep, what to change, what to add)
   - Update all affected files: `MEMORY.md`, `WORKFLOW.md`, next milestone's `implementation.md`, config files
   - This step ensures lessons are actionable, not just recorded

**To start a sprint**: say "sprint" or "start sprint for M{N}"

---

## Agent Team Strategy

See `docs/research/WORKFLOW-PATTERNS.md` for detailed efficiency patterns.

Quick heuristic: **3+ parallel work streams in a DAG -> use a team.** Default to solo sonnet, spawn team if parallelism identified.

| Scenario | Approach |
|----------|----------|
| Single-file fix | Solo haiku |
| Small feature (1 subsystem) | Solo sonnet |
| Feature (2-3 subsystems) | Team: sonnet lead + 2-3 haiku |
| Cross-cutting feature | Team: sonnet lead + 2 sonnet + 2 haiku |
| Security-critical crypto | Team: opus lead + 2 sonnet + haiku |

**Target model mix** (based on M6's best efficiency): ~27% opus, ~56% sonnet, ~17% haiku. Opus should be limited to orchestration, planning, review, and crypto audits. Feature code and tests should be sonnet/haiku. Milestones exceeding 80% opus (like M1-M4) are 3-5x more expensive per unit of work.

### Context Budget

| Orchestrator Usage | Quality | Action |
|-------------------|---------|--------|
| 0-30% | Peak | Optimal |
| 30-40% | Good | Normal range |
| 50-60% | Warning | Split remaining work |
| 60%+ | Poor | Commit, start fresh |

---

## Research Artifacts

Cached knowledge in `docs/research/` — load once per session, don't re-discover:

| File | Content | When to Load |
|------|---------|-------------|
| `SVELTEKIT.md` | Svelte 5 runes, vodozemac quirks, test patterns | Every session |
| `CRYPTO.md` | Olm/Megolm, HKDF, AES-GCM, WebAuthn PRF | Crypto work |
| `WORKFLOW-PATTERNS.md` | GSD-derived efficiency patterns | Sprint planning |

---

## Architecture Docs

Deep-dive architecture docs live in `docs/architecture/`:
- `crypto.md` — Olm/Megolm key management, HKDF derivation, pickle lifecycle
- `agents.md` — Agent sandboxing, WASM execution model, capability constraints

## Key Conventions

- No `console.log`/`console.error` in client code (security requirement)
- WebAuthn bypassed in dev mode via `import.meta.env.DEV` (build-time stripped)
- vodozemac WASM is browser-only (needs `document` for init)
- Tasks ride the existing `encrypted` message type — zero relay changes
- Event sourcing: highest timestamp wins, actorId lexicographic tiebreaker
