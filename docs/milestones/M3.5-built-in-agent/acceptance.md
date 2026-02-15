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
    Given the auto-balance agent has assigned tasks
    When I close the tab and reopen the room
    Then the agent resumes with its previous state
    And continues assigning fairly

  Scenario: User can disable auto-balance
    Given the auto-balance agent is active (default)
    When I toggle it off in the Agents panel
    Then new unassigned tasks remain unassigned
    And the agent status shows "Inactive"
```

## Built-In Agent UX

```gherkin
Feature: Built-in agents are distinct from uploaded agents

  Scenario: Built-in agent shows on room join
    Given I join a new room
    When I open the Agents panel
    Then "Auto-Balance" appears with a "Built-in" badge
    And it is active by default

  Scenario: Activity log shows agent actions
    Given the auto-balance agent assigned "Buy groceries" to Alice
    When I view the Agents panel
    Then I see an activity entry like "Assigned 'Buy groceries' to Alice"

  Scenario: Built-in agents cannot be deleted
    Given the auto-balance agent is listed
    Then there is no "Delete" button for built-in agents
    And only a toggle to enable/disable
```

## Developer Tooling

```gherkin
Feature: Developer can build a custom agent from template

  Scenario: Template compiles to valid WASM
    Given I clone the agent template from agents/auto-balance/
    When I run build.sh
    Then a .wasm file and manifest.json are produced
    And the manifest wasmHash matches the binary's SHA-256

  Scenario: Custom agent can be uploaded
    Given I built a custom WASM agent from the template
    When I upload it via the Agents panel
    Then it passes validation and appears in the agent list
    And I can activate it

  Scenario: Host import docs are accurate
    Given the docs in docs/architecture/agents.md
    When I call each host import as documented
    Then the behavior matches the documentation
```

## Quality Gates

- Auto-balance WASM agent matches existing `autoAssign` test coverage
- Assignment distribution variance <= 1
- Built-in agent activates in new rooms without user action
- Template builds successfully on clean checkout
- All M0-M3 regression tests pass (207 unit, 36 E2E)
