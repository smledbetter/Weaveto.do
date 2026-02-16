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

## TDD Process

Each feature follows test-driven development:

1. **Write failing tests** for the new module
2. **Implement minimal code** to pass
3. **Refactor** with tests as safety net
4. **Verify coverage** meets 80%+ threshold before moving on

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

### Phase 2: Execute + Gate

Run plans in dependency-aware waves, then verify.

**Execution rules:**
- Each subagent gets a **fresh context** with file path references (not embedded content)
- **2-3 tasks max** per subagent to stay in quality range
- **Atomic commit** after every completed task: `feat(M{N}): description`
- Orchestrator stays at **30-40% context** — delegates, doesn't accumulate
- Load **research artifacts** (`docs/research/*.md`) once, not re-discover
- **Crypto waves stay serial** — no parallelism on waves that modify key management chains
- **E2E agents must grep all test files** for old strings/selectors before finishing
- **Include known-answer test vectors** (e.g., RFC 6070 for PBKDF2) in crypto agent prompts
- **Plan session breaks** for milestones >100K tokens — commit at natural split points

**Wave execution:**
1. Analyze file dependencies between tasks
2. Group independent tasks into waves
3. Run same-wave tasks in parallel (spawn subagents)
4. Wait for wave completion before starting next wave

**Visual QA (before gate, after all code waves):**

The orchestrator opens key pages and reviews visually before running the automated gate. This catches layout bugs, redundant copy, confusing UX that automated tests miss. Costs almost nothing; prevents post-ship fix churn.

**Final wave — ship-readiness gate:**

A single agent loads both `production-engineer` and `security-auditor` skills and runs all checks in one pass:

- **Quality gates**: `npm run test:unit` (75%+ coverage), `npm run test:e2e` (0 regressions), `npm run check` (0 errors), TDD conventions
- **Security audit**: 10-principle review on all changed files, OWASP ASI Top 10 threat analysis
- Must produce a combined pass/fail report
- **Must pass before proceeding to Phase 3.** Fix any issues found, then re-run.
- **Use opus for crypto milestones** (key management, derivation, wrapping). Use sonnet for UI/logic milestones.

### Phase 3: Ship

The orchestrator handles this directly — no subagents needed.

1. Push all commits to main
2. Update `docs/STATE.md` — mark milestone complete, set next milestone
3. Update `docs/PROJECT.md` — milestone table
4. Sync GitHub via `gh` CLI:
   - Close completed milestone and all its issues
   - Create/update next milestone with release goal
   - Create issues for next milestone features (user stories + Gherkin acceptance criteria from Phase 1)
5. Write retrospective to `docs/milestones/M{N}-{name}/retrospective.md`:
   - What was built (deliverables, test counts)
   - What worked (efficiency wins)
   - What was inefficient (missed opportunities)
   - Patterns established
   - Cost observations (model selection, context usage)
   - **Never skip** (M2 was missed — don't repeat)

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
