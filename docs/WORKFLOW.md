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

## Milestone Workflow

Each milestone follows this lifecycle:

### 1. Plan
- Confer with advisors (architect, PM, UX, security) as needed
- Write `docs/milestones/M{N}-{name}/plan.md` with scope, design decisions, file changes
- Write `docs/milestones/M{N}-{name}/acceptance.md` with Gherkin scenarios

### 2. Implement
- Follow TDD process per module
- Update `docs/STATE.md` as work progresses
- Phase-gate: each phase has its own quality gate before proceeding

### 3. Ship
- All quality gates pass
- Write `docs/milestones/M{N}-{name}/lessons.md` capturing what was learned
- Update `docs/STATE.md` to reflect completion
- Update `docs/PROJECT.md` milestone table

## Agent Team Strategy

See `memory/agent-teams.md` for when/how to use Claude Code agent teams.

Quick heuristic: 3+ parallel work streams in a DAG -> use a team. Default to solo sonnet, spawn team if parallelism identified.

| Scenario | Approach |
|----------|----------|
| Single-file fix | Solo haiku |
| Small feature (1 subsystem) | Solo sonnet |
| Feature (2-3 subsystems) | Team: sonnet lead + 2-3 haiku |
| Cross-cutting feature | Team: sonnet lead + 2 sonnet + 2 haiku |
| Security-critical crypto | Team: opus lead + 2 sonnet + haiku |

## Architecture Docs

Deep-dive architecture docs live in `docs/architecture/`:
- `crypto.md` — Olm/Megolm key management, HKDF derivation, pickle lifecycle
- `agents.md` — Agent sandboxing, WASM execution model, capability constraints
- Future: `federation.md` — cross-node sync protocol

## Key Conventions

- No `console.log`/`console.error` in client code (security requirement)
- WebAuthn bypassed in dev mode via `import.meta.env.DEV` (build-time stripped)
- vodozemac WASM is browser-only (needs `document` for init)
- Tasks ride the existing `encrypted` message type — zero relay changes
- Event sourcing: highest timestamp wins, actorId lexicographic tiebreaker
