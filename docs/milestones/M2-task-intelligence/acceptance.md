# M2 Acceptance Criteria

Status: **Not Started**

## Task Dependencies

```gherkin
Scenario: Create a blocked task
  Given task "Design flyers" exists
  When I create task "Print flyers" with blockedBy: "Design flyers"
  Then "Print flyers" shows a blocked indicator
  And "Design flyers" shows it blocks 1 task

Scenario: Unblock a task by completion
  Given "Print flyers" is blocked by "Design flyers"
  When "Design flyers" is marked as completed
  Then "Print flyers" is no longer blocked
  And its status is pending (available for work)

Scenario: Prevent circular dependencies
  Given "A" exists and "B" is blocked by "A"
  When I try to make "A" blocked by "B"
  Then I see "Circular dependency detected"
  And the dependency is not created

Scenario: Auto-assign skips blocked tasks
  Given 3 pending tasks and 1 is blocked
  When I trigger auto-assign
  Then only the 2 unblocked tasks are assigned
```

## Natural Language Due Dates

```gherkin
Scenario: Parse relative date
  Given I am creating a task
  When I enter "tomorrow" in the due date field
  Then the due date is set to tomorrow
  And the parsed date is shown as preview

Scenario: Parse time offset
  When I enter "in 3 hours" in the due date field
  Then the due date is set to 3 hours from now

Scenario: Parse named day
  When I enter "next friday at 6pm"
  Then the due date is set to next Friday at 18:00

Scenario: Existing formats still work
  When I enter "30m" in the due date field
  Then the due date is set to 30 minutes from now

Scenario: Invalid input shows helpful error
  When I enter "flibbertigibbet"
  Then I see "Could not parse date. Try 'tomorrow', 'in 3 hours', or '30m'"
```

## Service Worker Reminders

```gherkin
Scenario: Reminder survives tab close
  Given I have a task due in 10 minutes
  When I close the tab and wait
  Then a browser notification fires at the reminder time

Scenario: No duplicate notifications across tabs
  Given I have the app open in 2 tabs
  When a reminder fires
  Then only 1 notification is shown (not 2)

Scenario: Fallback to in-tab reminders
  Given service workers are not supported
  When a task with a due date is created
  Then the existing setTimeout reminder is used
```

## Progress Visibility

```gherkin
Scenario: Parent task shows completion percentage
  Given "Setup event" has 4 subtasks and 2 are completed
  When I view the task panel
  Then "Setup event" shows "50%"

Scenario: Room-level progress
  Given 10 tasks total and 6 completed
  When I view the task panel header
  Then I see "6/10 complete (60%)" with a progress bar

Scenario: Blocked tasks count as incomplete
  Given 3 tasks: 1 completed, 1 blocked, 1 pending
  Then room progress shows "1/3 complete (33%)"
```

## Keyboard Shortcuts

```gherkin
Scenario: Open task modal with keyboard
  Given I am in a room
  When I press Cmd+K (or Ctrl+K)
  Then the task creation modal opens

Scenario: Navigate tasks with keyboard
  Given the task panel is open
  When I press Tab through the task list
  Then focus moves between task items
  And Enter toggles completion
```

## Inline Task Editing

```gherkin
Scenario: Edit task title inline
  Given a task "Buy groceries" exists
  When I click the task title
  Then it becomes an editable text field
  And pressing Enter saves the change
  And pressing Escape cancels

Scenario: Edit due date inline
  Given a task with due date exists
  When I click the due date
  Then I can type a new date using natural language
```

## Quality Gates

- Unit test coverage >= 80% on all new `src/lib/tasks/` code
- All Playwright E2E tests pass (new + M0/M1 regression)
- Zero axe-core accessibility violations
- Zero plaintext in service worker storage (encrypted IndexedDB)
- DAG validation prevents all circular dependencies
- Auto-assign distribution variance <= 1 (existing gate maintained)
- Natural language date parse success >= 95% for supported patterns
