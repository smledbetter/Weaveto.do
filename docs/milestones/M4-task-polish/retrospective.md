# M4 Retrospective: Task Polish

## What Was Built

- **5 features**: Task descriptions, due date sorting, quick-pick date buttons, urgent flag, room-scoped search
- **Schema**: `description?: string` and `urgent?: boolean` on Task, `task_updated` event type
- **Parser**: `| urgent` and `| desc:` directives in `/task` command
- **UI**: Sort toggle (3-state), search input with aria-live, urgent text badge, description display, quick-pick buttons
- **Tests**: 235 unit tests (+14 new), 22 new E2E tests, 0 regressions
- **Accessibility**: WCAG 2.1 AA compliant (text badges not color-only, aria-live regions, keyboard navigation)

## What Worked

- **Wave execution**: 5 clean waves with clear dependency boundaries. Parallel execution in waves 1, 2, and 4.
- **Thin orchestrator**: Lead stayed under 40% context by delegating to subagents with file path references.
- **Additive architecture**: Event-sourced store handled new fields with zero breaking changes — spread operators absorbed new fields automatically.
- **UX consensus upfront**: Cutting description inline editing and expand/collapse before implementation saved a full wave of complexity.
- **Atomic commits**: 6 commits, each independently revertable. Clean git bisect path.

## What Was Inefficient

- **Accessibility pre-work**: Theme contrast fixes (earlier session) had to be re-verified against new urgent tokens. Could have been batched.
- **Room page wiring**: Turned out handleCreateTask lived in TaskPanel, not the room page. Agent spent time investigating before finding the right file. Better file-path documentation in the plan would have avoided this.

## Patterns Established

- **Binary flags over priority levels**: Urgent flag is simpler than P1-P4 and matches the ephemeral, low-ceremony design philosophy.
- **Scrollable max-height over expand/collapse**: For descriptions, CSS `max-height` + scroll is simpler than stateful expand/collapse per-task. Saves per-row state management.
- **Text badges for status**: Consistent with "Blocked" badge pattern. Color + text, never color alone (WCAG 1.4.1).
- **Session-only preferences**: Sort mode resets on reload. No localStorage for user preferences (privacy principle).

## Deferred Items

- Description inline editing (M4.5)
- Quick-pick buttons in inline due date editing (M4.5)
- Markdown/rich text descriptions (requires sanitizer, deferred indefinitely)

## Cost Observations

- **Model selection**: Haiku for types/theme (mechanical), Sonnet for store/parser/UI (logic), no Opus needed (no crypto changes)
- **Total agents spawned**: ~10 (3 consensus + 7 execution)
- **Estimated context usage**: Lead stayed at ~35% through 5 waves
