# M1 Lessons Learned: Task Management

**Milestone**: M1 — Task Management & Agent Orchestration
**Completed**: 2026-02-15
**Scope**: 7 new files, 5 modified files. Event-sourced tasks, auto-assign agent, in-tab reminders.

---

## Event Sourcing

1. **Duplicate detection key must include actorId.** Initial key was `taskId:type:timestamp` which caused false positives when two users performed the same operation type at similar times. Final key: `taskId:type:timestamp:actorId`.

2. **Conflict resolution is simple for small teams.** Highest-timestamp-wins with actorId lexicographic tiebreaker works well for 2-10 member rooms. Vector clocks are unnecessary at this scale — deferred to M3 if federation requires it.

3. **Tasks ride existing encrypted messages with zero relay changes.** Adding an optional `taskEvent` field to the JSON payload before Megolm encryption means the relay server is completely unaware of task functionality. This is a powerful pattern for extending E2EE systems.

## Agent Design

4. **Pure function agents are testable and predictable.** `autoAssign()` takes inputs, returns events. No side effects, no background processes, no state. 100% unit test coverage was trivial to achieve.

5. **Preview before commit is essential for auto-assign.** Users need to see the proposed distribution before it takes effect. The preview modal pattern (show plan -> confirm -> execute) should be the default for any automated action.

6. **Recency weighting needs a clear window.** 10-minute recency window for "recently active" members works for synchronous sessions. Async teams will need different heuristics (M2).

## UI/UX

7. **Collapsible panel preserves messaging-first identity.** Making the task panel opt-in (collapsed by default) keeps the app feeling like a messaging tool that happens to have tasks, not a project management tool with chat.

8. **Form-based creation is more discoverable than commands.** The `/task` command is powerful but hidden. The modal with labeled fields (title, assignee, due, subtasks) lets users discover capabilities without documentation.

9. **Mobile tab switching works better than split panes.** On screens <768px, showing one panel at a time (Messages | Tasks tabs) is cleaner than trying to squeeze both into view.

10. **Fixed-position UI elements conflict with each other.** The theme toggle floating button blocked the send button. Solution: integrate toggles into existing navigation rather than adding floating elements.

## Reminders

11. **In-tab reminders are a valid MVP.** setTimeout + Notification API covers the "I'm actively using the app" use case. Users understand "reminders work while this tab is open" when told clearly. Service worker persistence is a meaningful upgrade for M2.

## Testing

12. **TDD with Vitest is fast and effective.** Writing tests first for store, parser, agent, and reminders caught design issues early (especially the duplicate detection key). The 80% coverage threshold is achievable without heroics when tests are written first.

13. **Svelte component tests are harder than logic tests.** Unit testing pure TypeScript modules (store, parser, agent, reminders) is straightforward. Testing Svelte components requires more setup (jsdom, component mounting). E2E tests cover component behavior more effectively.

## Process

14. **Phase-gating prevents cascading failures.** Each phase had a quality gate (tests pass, coverage met) before proceeding. This caught the missing `agent.ts` module early (TaskPanel imported it before it was implemented).

15. **Dynamic imports create hidden dependencies.** TaskPanel's dynamic import of `$lib/tasks/agent` wasn't caught until svelte-check ran. Static imports or explicit phase ordering prevents this.
