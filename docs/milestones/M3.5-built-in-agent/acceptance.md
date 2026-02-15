# M3.5 Acceptance Criteria

Status: **Not Started**

## Built-In Auto-Balance Agent

```gherkin
Feature: Auto-balance agent assigns unassigned tasks

  Scenario: Fair distribution across active members
    Given a room with 3 members (Alice, Bob, Carol)
    And Alice has 2 pending tasks, Bob has 0, Carol has 1
    And a new unassigned task is created
    When the agent tick runs
    Then the task is assigned to Bob (lowest load)
    And a task_assigned event is sent to the room

  Scenario: Recency tie-breaker when loads are equal
    Given a room with 3 members with equal task loads
    And Alice messaged 2 minutes ago, Bob 5 minutes ago, Carol 30 minutes ago
    And a new unassigned task is created
    When the agent tick runs
    Then the task is assigned to Alice (most recently active)

  Scenario: Blocked tasks are not assigned
    Given an unassigned task that depends on an incomplete task
    When the agent tick runs
    Then the task remains unassigned

  Scenario: Agent state persists across sessions
    Given the auto-balance agent has run and assigned tasks
    When I close the tab and reopen the room
    Then the agent resumes without re-assigning already-assigned tasks
```

## First-Run Disclosure

```gherkin
Feature: Users are informed when auto-balance first activates

  Scenario: Toast shown on first activation
    Given I have never seen the auto-balance notice
    When the agent first activates in any room
    Then a dismissible toast appears: "Auto-Balance is now active"
    And the toast has a "Manage Agents" link and a "Got it" button

  Scenario: Toast not shown again
    Given I previously dismissed the auto-balance notice
    When I join a new room and the agent activates
    Then no toast is shown

  Scenario: Toast auto-dismisses
    Given the auto-balance toast is visible
    When 10 seconds pass without interaction
    Then the toast disappears
```

## Built-In Agent UX

```gherkin
Feature: Built-in agents are clearly presented in AgentPanel

  Scenario: Built-in agent visible on room join
    Given I join a room
    When I open the Agents panel
    Then "Auto-Balance" appears with a "Built-in" badge
    And it shows a description: "Assigns unassigned tasks to the member with the fewest pending tasks"
    And it shows "Runs every 30 seconds"

  Scenario: Last-run timestamp updates
    Given the auto-balance agent is active
    When a tick completes
    Then the "Last run" timestamp updates in the AgentPanel

  Scenario: User can disable built-in agent
    Given the auto-balance agent is active (default)
    When I toggle it off in the Agents panel
    Then new unassigned tasks remain unassigned
    And the preference persists across page reloads

  Scenario: Built-in agents cannot be deleted
    Given the auto-balance agent is listed
    Then there is no "Delete" button for built-in agents
    And only a toggle to enable/disable

  Scenario: Upload form is hidden
    Given I open the Agents panel
    Then there is no "Upload Agent" form visible
```

## Quality Gates

- Auto-balance WASM matches existing `autoAssign` test coverage (11 test vectors)
- Assignment distribution variance <= 1
- Built-in agent activates on room join unless user disabled
- First-run toast shown once, dismissible, auto-dismisses after 10s
- User toggle persists in localStorage across sessions
- All M0-M3 regression tests pass (207 unit, 36 E2E)
- Zero svelte-check errors
