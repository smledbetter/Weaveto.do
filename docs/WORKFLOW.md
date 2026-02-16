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

- Unit test coverage >= 80% for new modules (lines, functions, branches)
- All Playwright E2E tests pass (including regression tests from prior milestones)
- Zero axe-core accessibility violations on new UI
- Zero plaintext data on relay server
- `npm run check` passes (svelte-check + TypeScript)

---

## Sprint Workflow

A sprint = one milestone delivery. Every sprint follows 5 phases in order.

### Phase 1: Consensus

PM, UX designer, and architect discuss and agree on features for the next milestone.

**Artifacts produced:**
- `docs/milestones/M{N}-{name}/plan.md` — updated with agreed features
- `docs/milestones/M{N}-{name}/acceptance.md` — Gherkin acceptance criteria
- GitHub milestone + issues created/updated

### Phase 2: Plan

Architect creates an implementation plan optimized for token efficiency.

**Use the plan template**: `docs/templates/PLAN-TEMPLATE.md`

**Plan must include:**
- `must_haves` — truths (observable outcomes), artifacts (files), key_links (cascading dependencies)
- Waves — dependency-grouped tasks with `depends_on` metadata
- Task types — `auto`, `checkpoint:human-verify`, `checkpoint:decision`
- Agent strategy — model selection per wave (haiku for mechanics, sonnet for logic, opus for crypto)
- Commit strategy — atomic commits per task
- Verification — automated + manual checks

### Phase 3: Execute

Run plans in dependency-aware waves.

**Execution rules:**
- Each subagent gets a **fresh context** with file path references (not embedded content)
- **2-3 tasks max** per subagent to stay in quality range
- **Atomic commit** after every completed task: `feat(M{N}): description`
- Orchestrator stays at **30-40% context** — delegates, doesn't accumulate
- Load **research artifacts** (`docs/research/*.md`) once, not re-discover

**Wave execution:**
1. Analyze file dependencies between tasks
2. Group independent tasks into waves
3. Run same-wave tasks in parallel (spawn subagents)
4. Wait for wave completion before starting next wave

**After final wave — run quality gates (parallel):**

1. **Production engineer** (`production-engineer` skill) — runs all quality gates:
   - `npm run test:unit` — 80%+ coverage on new code
   - `npm run test:e2e` — 0 regressions
   - `npm run check` — 0 type errors
   - Verify TDD conventions (test organization, state isolation, appropriate mocking)

2. **Security auditor** (`security-auditor` skill) — 10-principle audit on all changed files:
   - Reviews code against all 10 security principles
   - Runs OWASP ASI Top 10 threat analysis
   - Must PASS all 10 principles before shipping

**Both must pass before proceeding to Phase 4.** Fix any issues found, then re-run the failing gate.

### Phase 4: Ship

- Push all commits to main
- Update `docs/STATE.md` — mark milestone complete, set next milestone
- Update `docs/PROJECT.md` — milestone table
- **Consult product manager** (`product-manager` skill) to sync GitHub:
  - Close completed milestone and all its issues
  - Create/update next milestone with release goal
  - Create issues for next milestone features (user stories + Gherkin acceptance criteria)
  - Verify all GitHub milestones/issues match `docs/STATE.md`

### Phase 5: Retro

- Update `.local/session-retrospective.md` with:
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
