# M{N} Implementation Plan: {Title}

## Context

{Why this milestone exists. What problem it solves. What's already built that it builds on.}

## must_haves

### truths (observable outcomes)
- {User-visible outcome 1}
- {User-visible outcome 2}

### artifacts (files produced)
- `src/lib/{module}.ts`
- `tests/unit/{module}.test.ts`

### key_links (where breakage cascades)
- {Critical connection, e.g., "store changes affect TaskPanel, AgentPanel, and E2E tests"}

## Waves

### Wave 1: Foundation
> No dependencies. All tasks run in parallel.

**Task 1.1** (type: auto)
- **Files**: `src/lib/types.ts`
- **Action**: {What to implement}
- **Verify**: {How to verify it works}
- **Done**: {Definition of done}

**Task 1.2** (type: auto)
- **Files**: `tests/unit/helpers.ts`
- **Action**: {What to implement}
- **Verify**: {How to verify}
- **Done**: {Definition of done}

### Wave 2: Core Logic
> Depends on: Wave 1

**Task 2.1** (type: auto)
- **Files**: `src/lib/feature.ts`
- **Action**: {What to implement}
- **Verify**: {How to verify}
- **Done**: {Definition of done}

**Task 2.2** (type: auto)
- **Files**: `src/lib/other-feature.ts`
- **Action**: {What to implement}
- **Verify**: {How to verify}
- **Done**: {Definition of done}

### Wave 3: Integration + UI
> Depends on: Wave 2

**Task 3.1** (type: auto)
- **Files**: `src/lib/components/Feature.svelte`, `src/routes/room/[id]/+page.svelte`
- **Action**: {What to implement}
- **Verify**: {How to verify}
- **Done**: {Definition of done}

**Task 3.2** (type: checkpoint:human-verify)
- **Files**: UI components
- **Action**: {What to implement}
- **Verify**: {Manual visual check}
- **Done**: {Definition of done}

### Wave 4: Tests + Verification
> Depends on: Wave 3

**Task 4.1** (type: auto)
- **Files**: `tests/unit/*.test.ts`, `tests/e2e/*.spec.ts`
- **Action**: {Write tests}
- **Verify**: `npm run test:unit && npm run test:e2e`
- **Done**: {Coverage targets met, 0 regressions}

### Final Wave: Ship-Readiness Gate
> Depends on: all prior waves. Must pass before shipping.

**Ship-Readiness Review** (type: checkpoint:gate)
- **Skills**: `production-engineer` + `security-auditor` (single agent, one pass)
- **Action**: Run quality gates (unit tests with coverage, E2E, type check, TDD conventions) AND 10-principle security audit with OWASP ASI Top 10 threat analysis on all changed files
- **Verify**: All gates pass, all 10 security principles pass. Fix any failures, re-run until clean.
- **Done**: 0 test failures, 80%+ coverage on new code, 0 type errors, 10/10 security principles, 0 vulnerabilities

## Agent Strategy

| Wave | Agent | Model | Tasks |
|------|-------|-------|-------|
| 1 | Solo | sonnet | 1.1, 1.2 (fast, sequential) |
| 2 | Worker A | haiku | 2.1 |
| 2 | Worker B | haiku | 2.2 |
| 3 | Lead | sonnet | 3.1, 3.2 |
| 4 | Solo | sonnet | 4.1 |
| Final | Ship-Readiness | sonnet | Quality gates + security audit |
