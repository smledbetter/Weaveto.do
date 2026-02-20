# weaveto.do

Privacy-first, E2E encrypted task coordination. See `docs/` for full documentation.

## Flowstate Sprint Workflow

This project uses the Flowstate sprint process. When asked to "start the next sprint" or "run a sprint," follow this workflow.

### File Locations

- **Flowstate dir**: `~/.flowstate/weaveto-do/`
- **Config**: `~/.flowstate/weaveto-do/flowstate.config.md` (quality gates, agent strategy)
- **Baselines**: `~/.flowstate/weaveto-do/metrics/baseline-sprint-N.md`
- **Retrospectives**: `~/.flowstate/weaveto-do/retrospectives/sprint-N.md`
- **Metrics**: `~/.flowstate/weaveto-do/metrics/`
- **Metrics collection**: Use `mcp__flowstate__collect_metrics` MCP tool (or legacy `~/.flowstate/weaveto-do/metrics/collect.sh`)
- **Progress**: `~/.flowstate/weaveto-do/progress.md` (operational state for next session)
- **Roadmap**: `docs/ROADMAP.md` (in this repo)
- **Skills**: `.claude/skills/` (in this repo)

### How to Determine the Next Sprint

1. Read `docs/ROADMAP.md` -- find the first phase not marked done.
2. Find the highest-numbered baseline in `~/.flowstate/weaveto-do/metrics/` -- that's your sprint number.
3. Read that baseline for starting state, gate commands, and H7 audit instructions.

---

### Phase 1+2: THINK then EXECUTE

Read these files first:
- `docs/PROJECT.md` (vision, milestones, success metrics)
- `docs/ROADMAP.md` (find this sprint's phase)
- The current baseline (see above)
- `~/.flowstate/weaveto-do/progress.md` (if exists -- operational state from last session)
- `~/.flowstate/weaveto-do/flowstate.config.md`
- The previous sprint's retro (if exists)
- All files in `.claude/skills/`
- `~/.flowstate/hypotheses.json` (canonical hypothesis IDs, names, valid results)

Also load research artifacts:
- `docs/research/SVELTEKIT.md` -- Svelte 5 runes, vodozemac quirks, test patterns
- `docs/research/CRYPTO.md` -- Olm/Megolm flow, HKDF patterns, AES-GCM
- `docs/research/WORKFLOW-PATTERNS.md` -- efficiency patterns (waves, atomic commits)

**THINK**: Acting as a consensus agent with all 5 skill perspectives (PM, UX, Architect, Production Engineer, Security Auditor):
0. FEASIBILITY CHECK: List new external dependencies, verify they exist in the registry, run a minimal spike on the highest-risk task. Flag unverified or experimental deps with a fallback plan. If the spike fails, revise scope before proceeding. Confirm a formatter AND linter are configured as gates -- if either is missing, set one up now.
1. Write acceptance criteria in Gherkin format for the phase scope
2. Produce a wave-based implementation plan (group tasks by file dependency; parallel where no shared files)
3. For each task: files to read, files to write, agent model (haiku for mechanical, sonnet for reasoning, opus for crypto)

**EXECUTE**: Immediately after planning -- do NOT wait for human approval:
- Spawn subagents per wave
- Each subagent gets file path references (not content), task scope, relevant skill context
- Commit atomically after each wave
- Do NOT read full implementation files into orchestrator context -- delegate to subagents
- Crypto waves stay serial -- no parallelism on waves that modify key management chains
- Run quality gates IN ORDER after all waves:
  1. `npm run check`
  2. `npm run test:unit`
  3. `npm run test:e2e`
  4. `npm run build`
- Optional preventive gates (run after core gates pass):
  - `bash ~/Sites/Flowstate/tools/deps_check.sh` (verify new deps exist in registry)
  - `bash ~/Sites/Flowstate/tools/sast_check.sh` (static security analysis)
  - `bash ~/Sites/Flowstate/tools/deadcode_check.sh` (detect unused exports/deps)
- Save gate output to `~/.flowstate/weaveto-do/metrics/sprint-N-gates.log`
- If any gate fails: classify as REGRESSION or FEATURE, fix, re-run, max 3 cycles

When all gates pass, say: "Ready for Phase 3: SHIP whenever you want to proceed."

### Phase 3: SHIP

1. **Collect metrics** using Flowstate MCP tools:
   - Call `mcp__flowstate__sprint_boundary` with `project_path="/Users/stevo/Sites/Weaveto.do"` and `sprint_marker` (e.g. "M9", "sprint 2") to find the boundary timestamp
   - Call `mcp__flowstate__list_sessions` with `project_path="/Users/stevo/Sites/Weaveto.do"` to find the session ID(s) for this sprint
   - Call `mcp__flowstate__collect_metrics` with `project_path`, `session_ids`, and the boundary timestamp as `after`
   - Save the raw metrics response to `~/.flowstate/weaveto-do/metrics/sprint-N-metrics.json`

2. **Write import JSON** at `~/.flowstate/weaveto-do/metrics/sprint-N-import.json`:
   - Start from the MCP metrics response (`sprint-N-metrics.json`) as the base
   - Add these fields:
     ```json
     {
       "project": "weaveto-do",
       "sprint": N,
       "label": "WTD SN",
       "phase": "[phase name from roadmap]",
       "metrics": {
         "...everything from sprint-N-metrics.json...",
         "tests_total": "<current test count>",
         "tests_added": "<tests added this sprint>",
         "coverage_pct": "<current coverage % or null>",
         "lint_errors": 0,
         "gates_first_pass": "<true|false>",
         "gates_first_pass_note": "<note if false, empty string if true>",
         "loc_added": "<LOC from git diff --stat>",
         "loc_added_approx": false,
         "task_type": "<feature|bugfix|refactor|infra|planning|hardening>",
         "rework_rate": "<from sprint-N-metrics.json, or null>",
         "judge_score": "<[scope, test_quality, gate_integrity, convention, diff_hygiene] 1-5 each, or null>",
         "judge_blocked": "<true if judge prevented stopping, false otherwise, or null>",
         "judge_block_reason": "<reason string if blocked, or null>",
         "coderabbit_issues": "<number of CodeRabbit issues on PR, or null>",
         "coderabbit_issues_valid": "<number human agreed were real, or null>",
         "mutation_score_pct": "<mutation score if run, or null>",
         "delegation_ratio_pct": "<from sprint-N-metrics.json>",
         "orchestrator_tokens": "<from sprint-N-metrics.json>",
         "subagent_tokens": "<from sprint-N-metrics.json>",
         "context_compressions": "<from sprint-N-metrics.json>"
       },
       "hypotheses": [
         {"id": "H1", "name": "<from hypotheses.json>", "result": "...", "evidence": "..."},
         {"id": "H5", "name": "<from hypotheses.json>", "result": "...", "evidence": "..."},
         {"id": "H7", "name": "<from hypotheses.json>", "result": "...", "evidence": "..."}
       ]
     }
     ```
   - Validate: call `mcp__flowstate__import_sprint` with the import JSON path and `dry_run=true`
   - Fix any errors before proceeding. Warnings (auto-corrections) are ok.

3. **Write retrospective** at `~/.flowstate/weaveto-do/retrospectives/sprint-N.md`:
   - What was built (deliverables, test count, files changed, LOC)
   - Metrics comparison vs previous sprint
   - What worked / what failed, with evidence
   - H7 audit: check the 5 instructions listed in the baseline
     For each instruction, verify TWO ways:
     a. Process check: was the activity performed? (e.g., "security review ran")
     b. Code check: read the new/modified source files and verify the code
        actually follows the instruction. Quote file:line evidence for each.
     If the process check passes but the code check fails, rate as NON-COMPLIANT.
   - Hypothesis results table (include at minimum H1, H5, H7)
   - Change proposals as diffs (with `- Before` / `+ After` blocks)

4. **Do NOT apply skill changes** -- proposals stay in the retro for human review

5. **Commit**: `git add -A && git commit -m "sprint N: [description]"`

6. **Write next baseline** at `~/.flowstate/weaveto-do/metrics/baseline-sprint-{N+1}.md`:
   - Current git SHA, test count, coverage %, lint error count
   - Gate commands and current status
   - 5 H7 instructions to audit next sprint (rotate from skills)
     Each instruction must include a verification method:
     - What to grep/check in new source files
     - What PASS and FAIL look like (specific patterns, not just "was it done?")

7. **Update roadmap**: mark this phase done in `docs/ROADMAP.md`, update Current State section

8. **Write progress file** at `~/.flowstate/weaveto-do/progress.md`:
   - What was completed this sprint (list of deliverables)
   - What failed or was deferred (and why)
   - What the next session should do first
   - Any blocked items or external dependencies awaiting resolution
   - Current gate status (all passing? which ones?)
   This is operational state for the next agent session, not analysis. Overwrite any previous progress.md.

9. **Completion check** -- print this checklist with [x] or [MISSING] for each:
   - metrics/sprint-N-metrics.json exists (raw MCP metrics response)
   - metrics/sprint-N-import.json exists (complete import-ready JSON, validated via MCP dry_run)
   - retrospectives/sprint-N.md has hypothesis table (H1, H5, H7) and change proposals
   - metrics/baseline-sprint-{N+1}.md exists with SHA, tests, coverage, gates, H7 instructions
   - progress.md written (current state for next session)
   - docs/ROADMAP.md updated
   - Code committed
   Fix any MISSING items before declaring done.

---

## Quick Links

- `docs/PROJECT.md` -- vision, milestones, success metrics
- `docs/STATE.md` -- current project state, what's done, what's next
- `docs/WORKFLOW.md` -- legacy sprint workflow (reference only; this file is the active workflow)
- `docs/milestones/M{N}-{name}/` -- per-milestone plans, acceptance criteria
- `docs/templates/PLAN-TEMPLATE.md` -- implementation plan template

## Research Artifacts

Cached knowledge -- load once per session instead of re-discovering:

- `docs/research/SVELTEKIT.md` -- Svelte 5 runes, vodozemac quirks, test patterns, build conventions
- `docs/research/CRYPTO.md` -- Olm/Megolm flow, HKDF patterns, AES-GCM usage, WebAuthn PRF
- `docs/research/WORKFLOW-PATTERNS.md` -- efficiency patterns (waves, atomic commits, context budgets)

## Key Architecture

- **Client**: SvelteKit 5 with Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`)
- **Crypto**: vodozemac WASM (Olm/Megolm), WebAuthn PRF, HKDF-SHA256
- **Server**: Node.js WebSocket relay (ciphertext-only routing)
- **Tasks**: Event-sourced store, rides existing `encrypted` message type (zero relay changes)

### Critical Files

| File | Purpose |
|------|---------|
| `src/lib/crypto/engine.ts` | vodozemac WASM wrapper: Olm, Megolm, HKDF |
| `src/lib/room/session.ts` | Room session: WebSocket, key exchange, encrypt/decrypt, task events |
| `src/lib/tasks/store.svelte.ts` | Event-sourced task store with conflict resolution |
| `src/lib/tasks/agent.ts` | Auto-assign pure function (load balance + recency) |
| `server/relay.ts` | WebSocket relay: ciphertext routing, room registry |

### Agent Team Strategy

| Scenario | Approach |
|----------|----------|
| Single-file fix | Solo haiku |
| Small feature (1 subsystem) | Solo sonnet |
| Feature (2-3 subsystems) | Team: sonnet lead + 2-3 haiku |
| Cross-cutting feature | Team: sonnet lead + 2 sonnet + 2 haiku |
| Security-critical crypto | Team: opus lead + 2 sonnet + haiku |

## Conventions

- Start each sprint in a fresh session. One sprint = one session.
- No `console.log`/`console.error` in client code (security requirement)
- vodozemac WASM is browser-only (needs `document` for init)
- vodozemac `one_time_keys` returns JS `Map` (not plain object) -- use `.get()` / `.forEach()`
- `account.curve25519_key` / `account.ed25519_key` are properties, not methods
- `create_inbound_session` takes 3 args: `(identity_key, message_type, ciphertext)`
- All encryption uses `Uint8Array` for plaintext, `string` for ciphertext
- WebAuthn bypassed in dev via `import.meta.env.DEV` (build-time stripped)
- CSP in `svelte.config.js` with auto-nonces (production only)
- Tasks: highest timestamp wins conflicts, actorId lexicographic tiebreaker
- Duplicate event detection: `taskId:type:timestamp:actorId` key
- Crypto waves stay serial -- no parallelism on key management chains
- E2E agents must grep all test files for old strings/selectors before finishing
- Include known-answer test vectors (e.g., RFC 6070 for PBKDF2) in crypto agent prompts
