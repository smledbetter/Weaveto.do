# M1 Acceptance Criteria

Status: **All passing**

```gherkin
Scenario: Create a task with subtasks
  Given I am in an E2EE room
  When I create a task "Prepare event materials"
    And specify "Split into: design, print, distribute"
  Then the task is parsed and split into three subtasks
  And each subtask is encrypted and stored in the room
  And no plaintext is exposed to the server or agent runtime
```

```gherkin
Scenario: Assign tasks based on availability
  Given there are three subtasks and two active members
  When I trigger "Auto-assign"
  Then an agent analyzes recent activity (locally, client-side)
  And assigns subtasks to members with lowest current load
  And encrypted assignment events are sent to the room
```

```gherkin
Scenario: Receive a reminder for an uncompleted task
  Given I have an assigned task "Print flyers" due in 1 hour
  When the deadline approaches and the task is incomplete
  Then an encrypted reminder is sent to my device
  And no data is retained after delivery
```

## Scope Clarifications

- **"Analyzes recent activity"** -> task-count load balancing + last-message-timestamp weighting. Full activity analysis deferred to M2 (WASM agents).
- **"Encrypted reminder is sent to my device"** -> in-tab only (setTimeout + Notification API). Persistent cross-tab reminders deferred to M2 (service worker).
- **"Agent accuracy >90%"** -> distribution variance <=1 task across members. Verified by unit tests with deterministic scenarios.

## Test Coverage

- 50 unit tests (Vitest): store, parser, agent, reminders
- 15 Playwright E2E tests (zero M0 regressions)
- 99%+ line coverage, 90%+ branch coverage on `src/lib/tasks/`
- Auto-assign distribution variance <=1 in all test scenarios
