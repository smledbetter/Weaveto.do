# M14 — Local Notifications: Acceptance Criteria

## Release Goal

Users receive timely local notifications for task assignments, status changes, and approaching due dates — with a contextual opt-in flow and quiet hours control.

## User Stories

### Story 1: Contextual Notification Opt-In

**As a** room member creating tasks with due dates
**I want** to be offered notifications at the moment they'd be useful
**So that** I'm not interrupted by a random permission prompt

#### Acceptance Criteria

Feature: Contextual notification opt-in

  Scenario: First due-date task triggers opt-in prompt
    Given I am in a room with no notification permission granted
    When I create or receive the first task that has a due date
    Then I see an inline prompt below the task: "Get reminded when this is due. [Turn on]"

  Scenario: User accepts opt-in
    Given the opt-in prompt is visible
    When I tap "Turn on"
    Then the browser requests notification permission
    And if granted, the prompt disappears and a bell icon appears in the task panel header

  Scenario: User dismisses opt-in
    Given the opt-in prompt is visible
    When I dismiss it (click X or ignore)
    Then the prompt disappears for this session
    And reappears next session if permission is still "default"

  Scenario: Permission already granted
    Given I previously granted notification permission
    When I join a room
    Then the bell icon is already visible in the task panel header
    And no opt-in prompt appears

  Scenario: Permission denied
    Given I denied notification permission in the browser
    When I join a room
    Then no opt-in prompt appears and no bell icon appears

### Story 2: Bell Icon and Notification Settings

**As a** room member who enabled notifications
**I want** a simple control for on/off and quiet hours
**So that** I don't get woken up at 3 AM

#### Acceptance Criteria

Feature: Bell icon notification settings

  Scenario: Bell icon states
    Given notifications are enabled
    Then the bell icon in the task panel header is filled (on)
    When I tap it
    Then a popover opens with: on/off toggle + quiet hours time range

  Scenario: Toggle notifications off
    Given the bell popover is open
    When I toggle notifications off
    Then the bell icon becomes unfilled (off)
    And no notifications fire until re-enabled

  Scenario: Quiet hours
    Given quiet hours are set to 22:00–08:00 (default)
    When a notification would fire at 23:30
    Then the notification is suppressed by the service worker
    And the notification is NOT deferred (it's simply dropped)

  Scenario: Custom quiet hours
    Given I change quiet hours to 00:00–07:00
    When a notification would fire at 22:30
    Then the notification fires normally

### Story 3: Expanded Notification Triggers

**As a** room member with notifications enabled
**I want** to be notified when tasks are assigned to me or change status
**So that** I stay informed without watching the screen

#### Acceptance Criteria

Feature: Expanded notification triggers

  Scenario: Task assigned to me
    Given I have notifications enabled
    And the tab is backgrounded or I'm in a different tab
    When another member assigns a task to me
    Then I receive a notification: "You have a new notification"

  Scenario: Task status change on my task
    Given I have notifications enabled
    And I am the assignee of a task
    When another member changes the task status
    Then I receive a notification: "You have a new notification"

  Scenario: Due date approaching
    Given I have notifications enabled
    And a task I'm assigned to has a due date
    When the due date is 5 minutes away
    Then I receive a notification: "A task is due soon — open Weave to view details"

  Scenario: Notification body is generic
    Given any notification trigger fires
    Then the notification body contains NO task title, room name, or user name
    And the notification uses a static generic string

  Scenario: No notification when tab is focused
    Given the tab is in the foreground
    When a notification trigger fires
    Then no browser notification is shown (in-app UI handles it)

  Scenario: Ephemeral rooms
    Given I am in an ephemeral room
    Then no notifications are scheduled or fired

## Deferred

- Notification grouping (automatic, no UI toggle — defer to post-feedback)
- Urgency filter / DND settings
- Notification rules UI
- Web Push (M16)
