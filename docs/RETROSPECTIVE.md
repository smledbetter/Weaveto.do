# Retrospective: Building weaveto.do with Claude Agent Teams

Verified data from Claude Code session logs (JSONL files). Milestone boundaries derived from `git log` commit timestamps.

## Cumulative Quality

| Metric | M1 | M2 | M3 | M3.5 | M4 | M5 | M5.5 | M6 | M7 |
|--------|-----|-----|-----|------|-----|-----|------|-----|-----|
| Unit tests | 50 | 119 | 207 | 221 | 236 | 243 | 299 | 342 | **372** |
| E2E tests | 15 | 30 | 36 | 40 | 62 | 75 | 102 | 108 | **119** |
| New deps | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** |
| Security findings | 0 | 0 | 7 | 0 | 2 | 0 | 0 | 0 | **3 (gate-caught)** |

## Verified Token Usage

Source: `~/.claude/projects/` JSONL files (6 main sessions + 122 sub-agent sessions). Each API response includes a `usage` object with exact token counts.

| Milestone | API Calls | Input | Output | Cache Read | Cache Create | Total |
|-----------|-----------|-------|--------|------------|--------------|-------|
| M0 (+ setup) | 608 | 954 | 4,934 | 56,152,165 | 898,714 | 57,056,767 |
| M1+M2 | 1,520 | 15,874 | 8,513 | 99,830,995 | 5,031,419 | 104,886,801 |
| M3 | 543 | 4,005 | 2,936 | 40,329,634 | 1,525,517 | 41,862,092 |
| M3.5 | 380 | 2,485 | 2,924 | 25,941,846 | 1,258,724 | 27,205,979 |
| M4 (+ workflow) | 1,006 | 14,131 | 7,439 | 58,706,060 | 2,907,166 | 61,634,796 |
| M5 | 398 | 4,661 | 1,989 | 26,429,378 | 1,379,958 | 27,815,986 |
| M5.5 | 709 | 2,879 | 4,816 | 50,097,982 | 2,755,917 | 52,861,594 |
| M6 | 664 | 2,841 | 3,166 | 37,553,541 | 2,254,059 | 39,813,607 |
| M7 (+ UI fixes) | 596 | 1,169 | 3,712 | 46,816,415 | 1,870,462 | 48,691,758 |
| **TOTAL** | **6,424** | **48,999** | **40,429** | **441,858,016** | **19,881,936** | **461,829,380** |

## By Model

| Model | Total Tokens | % of Total |
|-------|-------------|------------|
| Opus 4.6 | 383,285,059 | 83.0% |
| Sonnet 4.5 | 53,433,292 | 11.6% |
| Haiku 4.5 | 24,316,708 | 5.3% |

## Key Observations

- Cache reads dominate (~95.7%) — re-reads of system prompts, skill files, CLAUDE.md, and prior conversation turns. Not new work.
- "New work" tokens (input + output + cache creation) total ~19.97M across all milestones.
- Data covers Claude Code sessions only.

## Token Efficiency

| Milestone | New Work/Test | Sonnet+Haiku % | Tests | Interpretation |
|-----------|--------------|----------------|-------|----------------|
| M3 | 16,302 | 33.5% | 94 | Best — security audit multiplied test output |
| M1+M2 | 37,729 | 45.2% | 134 | Good — large scope amortized setup costs |
| M7 | 45,740 | 27.6% | 41 | Good — serial execution, focused scope |
| M6 | 46,123 | 72.9% | 49 | Good — highest delegation %, crypto still efficient |
| M5.5 | 58,800 | 25.8% | 47 | Moderate — UX work produces fewer tests per feature |
| M5 | 69,330 | 43.2% | 20 | Moderate — complex relay/cleanup logic |
| M3.5 | 70,229 | 30.0% | 18 | Moderate — small scope, fixed overhead dominates |
| M4 | 79,155 | 47.4% | 37 | Worst — workflow audit inflated tokens without adding tests |

## Cache Efficiency

| Milestone | Cache Read / New Work | New Work % |
|-----------|----------------------|------------|
| M6 | 16.6x | 5.7% (best) |
| M5.5 | 18.1x | 5.2% |
| M5 | 19.1x | 5.0% |
| M1+M2 | 19.7x | 4.8% |
| M4 | 20.0x | 4.8% |
| M3.5 | 20.5x | 4.6% |
| M7 | 25.0x | 3.9% |
| M3 | 26.3x | 3.7% |
| M0+setup | 62.1x | 1.6% (bootstrapping) |

## Optimal Model Mix (M6 baseline)

27% opus (orchestration only), 56% sonnet (logic + crypto), 17% haiku (UI + mechanical). This yielded the best cache efficiency (5.7%) and lowest per-call cost.
