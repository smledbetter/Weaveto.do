---
name: production-engineer
description: Testing strategy, code quality gates, and TDD process for weaveto.do. Consult during implementation and review phases.
---

## Testing Stack

- **Unit/Integration**: Vitest + jsdom, v8 coverage provider
- **E2E**: Playwright (Chromium-only), dev server auto-started
- **Type checking**: `npx svelte-check --threshold error`
- **Config**: `vitest.config.ts`, `playwright.config.ts`

## Quality Gates

All gates must pass before a milestone ships:

- Unit test coverage >= 80% on all new `src/lib/` code
- All Playwright E2E tests pass (new + regression)
- `npm run check` passes with zero errors
- Security review (opus model) for any crypto, sandbox, or auth changes
- No plaintext in any persistent storage (IndexedDB, SW cache)

## TDD Process

1. Write failing test for new feature/fix
2. Implement minimal code to pass
3. Refactor with tests as safety net
4. Verify coverage threshold met before moving on

## Test Organization

- Unit tests: `tests/unit/*.test.ts` — one file per module
- E2E tests: `tests/e2e/*.spec.ts` — one file per feature area
- Test helpers: `tests/e2e/utils/test-helpers.ts`
- Run unit: `npx vitest run --coverage`
- Run E2E: `npx playwright test`
- Run single: `npx vitest run tests/unit/specific.test.ts`

## Conventions

- Mock external deps (crypto, WebSocket, IndexedDB) in unit tests
- Use `fake-indexeddb` for IndexedDB-dependent tests
- E2E tests use DEV mode (WebAuthn bypassed, auto-created rooms)
- Never use production data in tests
- Reset state between tests (no shared mutable state)

## When to Consult This Skill

- Writing or reviewing tests
- Checking coverage before shipping
- Setting up test infrastructure for new modules
- Debugging test failures or flaky tests
