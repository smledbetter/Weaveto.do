# Workflow Patterns (GSD-Derived)

Token efficiency patterns derived from the GSD framework, adapted for weaveto.do.

## Thin Orchestrator Pattern

The lead agent (sonnet/opus) acts as a **thin orchestrator** that stays at 30-40% context:

- **Never embed file content** in subagent prompts. Pass `@file-path` references instead.
- **Let subagents read** what they need in their fresh 200k context.
- **Collect summaries**, not raw output, from completed subagents.
- **Track progress** via todo list, not by re-reading completed work.

### Anti-patterns
- Copying file contents into agent prompts (wastes orchestrator context)
- Reading files "just in case" before spawning agents
- Re-verifying subagent work by reading all modified files

## Fresh Context Strategy

Each subagent worker gets a **fresh 200k token context** for actual work:

- Task 50 has the same quality as task 1 (no accumulated garbage)
- Workers read files themselves — they have full context budget
- Workers commit atomically — their work is durable regardless of orchestrator state

### Context Budget Thresholds
| Usage | Quality | Action |
|-------|---------|--------|
| 0-30% | Peak | Optimal range |
| 30-40% | Good | Normal for orchestrator |
| 40-50% | Acceptable | Consider splitting remaining work |
| 50-60% | Warning | Quality degradation begins |
| 60%+ | Poor | Stop, commit, start fresh session |

## Wave-Based Execution

Group tasks by dependencies, execute independent tasks in parallel:

1. **Analyze file dependencies** — if a file appears in multiple tasks, later task depends on earlier
2. **Assign wave numbers** — independent tasks share a wave, dependent tasks get higher waves
3. **Execute per wave** — all tasks in wave N run in parallel; wave N+1 waits for N to complete
4. **Commit per task** — each completed task gets its own atomic commit

### Example
```
Wave 1: [types.ts, test-helpers.ts]     — independent foundation
Wave 2: [store.ts, parser.ts, agent.ts] — all depend on types.ts
Wave 3: [UI component, integration test] — depend on wave 2
```

## Atomic Commit Strategy

Commit after every completed task, not per phase or milestone:

```
feat(M4): add task description field to types
feat(M4): implement description in task store
feat(M4): add description input to TaskCreateModal
test(M4): unit tests for task descriptions
feat(M4): due date sorting toggle
```

### Benefits
- `git bisect` finds exact failing task
- Each task independently revertable
- Clear history for future sessions reading commit log
- Subagent crashes don't lose completed work

## Research Artifact Caching

Create research files once, load by reference across sessions:

| File | Content | When to Load |
|------|---------|-------------|
| `docs/research/SVELTEKIT.md` | Svelte 5 runes, vodozemac quirks, test patterns | Every session |
| `docs/research/CRYPTO.md` | Olm/Megolm, HKDF, AES-GCM, WebAuthn PRF | Sessions touching crypto |
| `docs/research/WORKFLOW-PATTERNS.md` | This file — efficiency patterns | Sprint planning |

### Rules
- **HIGH confidence**: Verified against official docs or project tests. State as fact.
- **MEDIUM confidence**: Verified via search + one official source. State with attribution.
- **LOW confidence**: Unverified. Flag for validation before relying on.
- **Update, don't accumulate**: When patterns change, edit the file. Don't append "corrections."

## Plan Structure (must_haves)

Every implementation plan should include:

### must_haves
- **truths**: Observable outcomes from user's perspective ("user can sort tasks by due date")
- **artifacts**: Specific files that must exist when done (`src/lib/tasks/sort.ts`)
- **key_links**: Critical connections where breakage cascades ("sort function used by TaskPanel and E2E tests")

### Task Types
- **auto**: Fully autonomous — agent executes without human input
- **checkpoint:human-verify**: Pause for visual/functional verification after automation
- **checkpoint:decision**: Implementation choice needs user input before proceeding

### Verification
Every plan ends with automated + manual verification:
```
Automated: npm run test:unit && npm run test:e2e && npm run check
Manual: [specific smoke test steps]
```
