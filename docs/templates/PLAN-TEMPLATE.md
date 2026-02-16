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

### Wave 5: Quality Gates
> Depends on: Wave 4. Both tasks run in parallel. Must pass before shipping.

**Task 5.1: Production Engineer Review** (type: checkpoint:gate)
- **Skill**: `production-engineer`
- **Action**: Run all quality gates — unit tests with coverage, E2E tests, type check, TDD conventions
- **Verify**: All gates pass. Fix any failures, re-run until green.
- **Done**: 0 test failures, 80%+ coverage on new code, 0 type errors

**Task 5.2: Security Audit** (type: checkpoint:gate)
- **Skill**: `security-auditor`
- **Action**: 10-principle audit on all changed/new source files. OWASP ASI Top 10 threat analysis.
- **Verify**: All 10 principles PASS. Fix any violations, re-audit until clean.
- **Done**: 10/10 principles pass, 0 vulnerabilities

## Agent Strategy

| Wave | Agent | Model | Tasks |
|------|-------|-------|-------|
| 1 | Solo | sonnet | 1.1, 1.2 (fast, sequential) |
| 2 | Worker A | haiku | 2.1 |
| 2 | Worker B | haiku | 2.2 |
| 3 | Lead | sonnet | 3.1, 3.2 |
| 4 | Solo | sonnet | 4.1 |
| 5 | Prod Engineer | sonnet | 5.1 (quality gates) |
| 5 | Security Auditor | sonnet | 5.2 (10-principle audit) |

## Commit Strategy

```
feat(M{N}): {task 1.1 description}
feat(M{N}): {task 1.2 description}
feat(M{N}): {task 2.1 description}
feat(M{N}): {task 2.2 description}
feat(M{N}): {task 3.1 description}
test(M{N}): {task 4.1 description}
```

## Verification

### Automated
```bash
npm run test:unit    # 80%+ coverage on new modules
npm run test:e2e     # 0 regressions
npm run check        # svelte-check passes
```

### Manual
1. {Smoke test step 1}
2. {Smoke test step 2}
3. {Smoke test step 3}
