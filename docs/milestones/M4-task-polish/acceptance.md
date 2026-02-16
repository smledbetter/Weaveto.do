# M4 Acceptance Criteria

Status: **Complete**

## Task Descriptions

```gherkin
Scenario: Add description when creating a task
  Given I am a team member in an encrypted room
  When I create a task "Order supplies" with description "Need: 200 flyers, 50 posters, tape"
  Then the task is created with both title and description
  And the description is encrypted like all task data
  And no plaintext is exposed to the relay server

Scenario: View task description
  Given a task "Order supplies" exists with a description
  When I view the task in the task panel
  Then the description is displayed below the title in plain text
  And long descriptions are scrollable (max 4 lines visible)

Scenario: Create task without description
  Given I am creating a new task
  When I leave the description field empty
  Then the task is created with only a title
  And no description field is shown until I add one

Scenario: Description survives conflict resolution
  Given two members edit the same task description simultaneously
  When both edits are received
  Then the description with the highest timestamp wins
  And in case of a tie, actorId lexicographic order determines the winner
```

## Due Date Sorting

```gherkin
Scenario: Toggle to due date ascending sort
  Given I am a room coordinator viewing multiple tasks
  When I click the sort toggle in the task panel header
  Then tasks are sorted by due date (earliest first)
  And tasks without due dates appear at the bottom

Scenario: Toggle to due date descending sort
  Given tasks are sorted by due date ascending
  When I click the sort toggle again
  Then tasks are sorted by due date (latest first)
  And tasks without due dates still appear at the bottom

Scenario: Toggle back to creation order
  Given tasks are sorted by due date
  When I click the sort toggle a third time
  Then tasks return to creation order (original event timestamp)
  And the sort preference is reset

Scenario: Sort preference is session-only
  Given I have sorted tasks by due date
  When I reload the page
  Then tasks are displayed in creation order
  And no sort preference is persisted (privacy principle)

Scenario: Empty room shows no sort toggle
  Given I am in a room with zero tasks
  When I view the task panel
  Then the sort toggle is visible but has no effect
```

## Quick-Pick Date Buttons

```gherkin
Scenario: Use Today button
  Given I am creating a task
  When I click the "Today" quick-pick button
  Then the due date field is populated with today's date
  And I can submit the task without typing

Scenario: Use Tomorrow button
  Given I am creating a task
  When I click the "Tomorrow" quick-pick button
  Then the due date field is populated with tomorrow's date

Scenario: Use Next Week button
  Given I am creating a task
  When I click the "Next Week" quick-pick button
  Then the due date field is populated with 7 days from today

Scenario: Override quick-pick with custom date
  Given I clicked "Today" and the field shows today's date
  When I type "in 3 hours" in the custom date field
  Then the due date is set to 3 hours from now (overriding Today)

Scenario: Quick-picks work with natural language parser
  Given I used the "Tomorrow" button
  When the task is created
  Then the due date is correctly parsed and stored as a timestamp
  And all existing natural language patterns still work

Scenario: Quick-picks in inline editing (deferred)
  Note: Quick-pick buttons in inline due date editing deferred to M4.5
```

## Urgent Flag

```gherkin
Scenario: Mark task as urgent during creation
  Given I am a team member creating a task
  When I toggle the "Urgent" flag in the creation modal
  Then the task is created with urgent: true
  And the task displays a text badge "Urgent" (not color alone)

Scenario: Toggle urgent flag on existing task
  Given a non-urgent task exists
  When I click the urgent toggle on the task row
  Then the task is updated to urgent: true
  And the visual indicator appears immediately
  And the update is encrypted and synced to all room members

Scenario: Urgent tasks sort above non-urgent
  Given 5 tasks: 2 urgent, 3 non-urgent
  When I view the task panel (in any sort mode)
  Then urgent tasks appear before non-urgent tasks
  And within each group, the selected sort order is maintained

Scenario: Remove urgent flag
  Given an urgent task exists
  When I click the urgent toggle to turn it off
  Then the task is updated to urgent: false
  And the visual indicator disappears
  And the task moves to the non-urgent section of the list

Scenario: Urgent flag survives conflict resolution
  Given two members toggle the urgent flag simultaneously
  When both events are received
  Then the event with the highest timestamp wins
  And actorId is the tiebreaker if timestamps match
```

## Room-Scoped Task Search

```gherkin
Scenario: Search tasks by title
  Given I am in a room with tasks "Order flyers", "Design poster", "Distribute flyers"
  When I type "flyers" in the search box
  Then I see only "Order flyers" and "Distribute flyers"
  And "Design poster" is hidden

Scenario: Search tasks by description
  Given a task "Setup" has description "Reserve venue, contact caterer"
  When I type "caterer" in the search box
  Then "Setup" appears in the filtered results
  And tasks without matching title or description are hidden

Scenario: Search is case-insensitive
  Given a task "Order Supplies" exists
  When I type "order supplies" (lowercase)
  Then the task appears in results

Scenario: Clear search restores full list
  Given I have filtered tasks with "flyers"
  When I clear the search input
  Then all tasks are visible again
  And the previous sort order is maintained

Scenario: Search only within current room
  Given I am in room A with task "Buy groceries"
  When I switch to room B (which has different tasks)
  Then the search box is empty
  And I can only search tasks in room B (privacy isolation)

Scenario: No cross-room search
  Given I am a member of multiple rooms
  When I search for "groceries"
  Then only tasks in the current room are searched
  And tasks from other rooms never appear in results

Scenario: Search with no results
  Given I am in a room with 5 tasks
  When I search for "nonexistent keyword"
  Then I see "No tasks found" (or empty state)
  And the search box remains populated for easy editing

Scenario: Real-time filtering as user types
  Given I am in a room with many tasks
  When I start typing "des" in the search box
  Then the task list updates in real-time after each keystroke
  And I see tasks matching "des" before I finish typing
```

## Quality Gates

- Unit test coverage >= 80% on all new code in `src/lib/tasks/`
- All Playwright E2E tests pass (new + M0/M1/M2/M3/M3.5 regressions)
- Zero axe-core accessibility violations
- Description field encrypted client-side (zero plaintext on relay)
- Sort toggle cycles through exactly 3 states (asc/desc/creation)
- Quick-pick buttons populate values compatible with existing NL parser
- Urgent flag conflict resolution follows timestamp + actorId tiebreaker
- Search operates only on decrypted client-side data
- Search has zero cross-room leakage (verified in E2E tests)
- Auto-balance agent still functions correctly with urgent tasks
