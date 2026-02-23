# M12 — Mobile UX Improvements

## Acceptance Criteria

### 1. Consolidated Onboarding (Banner Consolidation)

```gherkin
Feature: First-visit onboarding consolidates all informational banners

  Scenario: New user sees walkthrough instead of stacked banners
    Given the user has never visited this room before
    When the room connects and enters the "connected" phase
    Then the CoachMarks walkthrough appears
    And no warning banners (key warning, temp identity, solo member) are visible behind it

  Scenario: Walkthrough step 1 covers encryption + key warning
    Given the walkthrough is on step 1 "Your encrypted room"
    Then the step body mentions that keys live in this tab
    And the step body mentions that closing the tab requires rejoining

  Scenario: Walkthrough shows temp identity step only when applicable
    Given the user's device does not support WebAuthn PRF
    Then the walkthrough includes a "Temporary identity" step
    And the step explains that their identity will change next session

  Scenario: Walkthrough does not show temp identity step for PRF users
    Given the user's device supports WebAuthn PRF
    Then the walkthrough does NOT include the "Temporary identity" step

  Scenario: Final step covers inviting + solo member prompt
    Given the user is the only member in the room
    And the walkthrough reaches the "Invite your team" step
    Then the step body mentions they are the only one here
    And the step includes an action to open the invite modal

  Scenario: Completing walkthrough suppresses all informational banners
    Given the user completes or skips the walkthrough
    Then the key warning banner does not appear
    And the temp identity banner does not appear
    And the solo member banner does not appear
    And the sessionStorage flags for all three are set

  Scenario: Returning user sees no informational banners
    Given the user has previously completed the walkthrough
    When they reconnect to the room
    Then no key warning, temp identity, or solo member banners appear

  Scenario: Urgent banners still show independently
    Given the walkthrough has been completed
    When all tasks complete and auto-delete countdown starts
    Then the auto-delete banner appears normally
    When encryption is being re-established
    Then the re-establishing banner appears normally
```

### 2. Unified Mobile Navigation (Bottom Nav)

```gherkin
Feature: Mobile bottom navigation replaces double tab bar

  Scenario: Mobile shows bottom nav instead of header toggles + tab bar
    Given the viewport is narrower than 768px
    When the room is connected
    Then a bottom navigation bar is visible with 3 items: Chat, Tasks, Automation
    And the mobile-tabs bar (Messages/Tasks/Automation) is NOT rendered
    And the header toggle buttons (Tasks, Automation) are NOT visible

  Scenario: Bottom nav defaults to Chat view
    Given the user is on mobile
    When they enter the room
    Then the Chat view (messages + composer) is active
    And the Chat nav item is highlighted

  Scenario: Switching to Tasks view
    Given the user is on mobile viewing Chat
    When they tap the Tasks nav item
    Then the TaskPanel is shown full-width
    And the messages column is hidden
    And the Tasks nav item is highlighted

  Scenario: Switching to Automation view
    Given the user is on mobile viewing Chat
    When they tap the Automation nav item
    Then the AgentPanel is shown full-width
    And the messages column is hidden
    And the Automation nav item is highlighted

  Scenario: Task count badge on nav item
    Given there are 3 active tasks
    Then the Tasks nav item shows a badge with "3"

  Scenario: Automation count badge on nav item
    Given there are 2 active agents
    Then the Automation nav item shows a badge with "2"

  Scenario: Bottom nav does not appear on desktop
    Given the viewport is wider than 768px
    Then the bottom navigation bar is NOT visible
    And the header toggle buttons work as before (side panels)

  Scenario: Invite stays in header on mobile
    Given the user is on mobile
    Then the Invite button remains in the header
    And tapping it opens the InviteModal as before

  Scenario: Simplified mobile header
    Given the viewport is narrower than 768px
    Then the header shows: room name, Invite button, member count
    And the Tasks and Automation toggle buttons are hidden

  Scenario: Composer moves with Chat view
    Given the user is on the Tasks or Automation view
    Then the composer (message input) is NOT visible
    When they switch back to Chat
    Then the composer is visible again
```

### 3. Background Color Fix

```gherkin
Feature: App background matches theme with no white border

  Scenario: Light mode has no white border
    Given the user is in light mode
    Then the html and body background is var(--bg-base) (#f4f3f1)
    And no white frame is visible around the app content

  Scenario: Dark mode has no white border
    Given the user is in dark mode
    Then the html and body background is var(--bg-base) (#0c0c0e)
    And no white frame is visible around the app content

  Scenario: Background applies on all pages
    Given the user is on the homepage or any room page
    Then the background color matches the theme
    And there is no gap between the app content and the viewport edge
```

## Non-Goals

- No changes to desktop layout (side panels stay as-is)
- No changes to the room info popover
- No new components for notifications or settings
- No changes to the PinEntry, BurnConfirmModal, or InviteModal flows
- CoachMarks storage key changes are backward-compatible (new key, old key still works)
