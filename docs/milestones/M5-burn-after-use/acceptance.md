# M5 Acceptance Criteria: Burn-After-Use

## Feature 1: Auto-Deletion on Room Completion

### User Story

**As a** coordination team member
**I want** the room to automatically clean up after all tasks are completed
**So that** sensitive project data doesn't linger indefinitely and I don't have to remember to manually delete it

### Acceptance Criteria

#### Scenario: All tasks completed triggers grace period

```gherkin
Feature: Auto-deletion on room completion

  Scenario: Room prompts for deletion when all tasks complete
    Given I am in a room with 3 tasks
    And 2 tasks are marked complete
    When I mark the final task as complete
    Then I see a persistent banner: "All tasks complete. Room will auto-delete in 24 hours."
    And the banner shows a countdown timer
    And the banner has "Keep Room" and "Delete Now" buttons

  Scenario: Grace period is visible to all members
    Given all tasks in the room are complete
    And the 24-hour grace period has started
    When a new member joins the room
    Then they see the deletion countdown banner
    And they see the same time remaining as other members

  Scenario: Cancelling auto-deletion stops the timer
    Given all tasks are complete
    And the deletion countdown is active
    When I click "Keep Room"
    Then the countdown banner disappears
    And the room remains active indefinitely
    And all members see a notification: "[Member] cancelled auto-deletion"

  Scenario: Re-completing tasks restarts grace period
    Given the deletion countdown was cancelled
    When I mark a task as incomplete then complete again
    Then the 24-hour countdown restarts
    And all members see the banner again

  Scenario: Grace period expires and room purges
    Given all tasks are complete
    And the 24-hour grace period started
    And no one clicked "Keep Room"
    When 24 hours elapse
    Then the relay purges all room data
    And all connected clients receive a "room_deleted" message
    And all clients clear local state (tasks, messages, IndexedDB, sessionStorage)
    And all clients redirect to homepage with notice: "Room auto-deleted after completion"

  Scenario: Deletion while members offline
    Given all tasks are complete
    And the grace period expires
    And some members are offline
    When an offline member reopens their tab
    Then they see "This room has been deleted" on the room page
    And their local state is cleared
```

---

## Feature 2: Manual Burn Command

### User Story

**As a** room creator
**I want** to immediately destroy all room data with a single command
**So that** I can ensure no trace remains after handling sensitive coordination tasks

### Acceptance Criteria

#### Scenario: Room creator burns room via /burn command

```gherkin
Feature: Manual burn command

  Scenario: /burn command requires strong confirmation
    Given I am the room creator
    When I type "/burn" in the message input and press Enter
    Then the message input is NOT sent as a chat message
    And a modal appears with title "Permanently Delete Room"
    And the modal shows: "This action cannot be undone. All messages, tasks, and member access will be destroyed immediately."
    And the modal requires me to type "DELETE" (exact match, case-sensitive) to proceed
    And the modal has a "Cancel" button and a "Delete Room" button (disabled until I type correctly)

  Scenario: Successfully burning room as creator
    Given I am the room creator
    And the burn confirmation modal is open
    When I type "DELETE" in the confirmation field
    And I click "Delete Room"
    Then my client sends an authenticated purge request to the relay (signed with my identity key)
    And the relay validates my identity as room creator
    And the relay broadcasts "room_destroyed" to all connected members
    And the relay purges the room from its in-memory store
    And my client clears all local state (messages, tasks, IndexedDB agent state, sessionStorage Olm pickle, service worker cache)
    And I am redirected to the homepage with notice: "Room deleted"

  Scenario: All members receive burn notification
    Given I am NOT the room creator
    And I am connected to the room
    When the room creator executes /burn successfully
    Then I receive a "room_destroyed" message from the relay
    And I see a modal: "This room has been deleted by the creator"
    And my local state is cleared automatically
    And I am redirected to the homepage after 3 seconds

  Scenario: Non-creator tries to burn room
    Given I am NOT the room creator
    When I type "/burn" and complete the confirmation modal
    Then my client sends a purge request to the relay
    And the relay rejects the request with "unauthorized"
    And I see an error: "Only the room creator can delete this room"
    And the room remains active

  Scenario: Burn fails if relay connection lost
    Given I am the room creator
    And the burn confirmation modal is open
    And my WebSocket connection drops
    When I type "DELETE" and click "Delete Room"
    Then I see an error: "Cannot delete room while disconnected"
    And the modal remains open
    And no deletion occurs

  Scenario: Offline members discover burned room
    Given a room was burned while I was offline
    When I navigate to the room URL
    Then the relay responds with "room_not_found"
    And I see: "This room does not exist or has been deleted"
    And my local cached state is cleared
```

---

## Feature 3: Ephemeral Mode

### User Story

**As a** organizer of one-time sensitive coordination
**I want** to create a room with zero persistence
**So that** I can ensure data only exists while we're actively working, with no relay storage or local caching

### Acceptance Criteria

#### Scenario: Creating ephemeral room

```gherkin
Feature: Ephemeral mode

  Scenario: Ephemeral option on room creation
    Given I am on the homepage
    When I click "Create New Room"
    Then I see a modal with room creation options
    And I see a checkbox labeled "Ephemeral mode (no persistence)"
    And the checkbox has a help icon with tooltip: "Messages and tasks exist only while tabs are open. Closing all tabs deletes the room."

  Scenario: Ephemeral room has persistent visual indicator
    Given I created an ephemeral room
    When I join the room
    Then I see a flame icon in the room header
    And the icon has aria-label "Ephemeral room: no data persistence"
    And the icon is styled with high contrast (WCAG AA)
    And hovering shows tooltip: "This room will be deleted when all members leave"

  Scenario: Ephemeral room shows member count warning
    Given I am in an ephemeral room
    And I am the only member
    When I see the member count
    Then it shows "1 member" with a warning icon
    And the warning tooltip says: "Closing this tab will delete the room"

  Scenario: Ephemeral room purges on last member disconnect
    Given I created an ephemeral room
    And 2 other members joined
    And we created 5 tasks and sent 20 messages
    When the last member closes their tab (WebSocket disconnects)
    Then the relay immediately purges the room from memory
    And no data remains in the relay's rooms Map
    And no IndexedDB writes occurred for tasks or agent state
    And no service worker cache writes occurred

  Scenario: Ephemeral room blocks service worker registration
    Given I am in an ephemeral room
    When the room session initializes
    Then service worker reminder scheduling is disabled
    And task reminder notifications show in-tab only (if tab is open)

  Scenario: Cannot convert regular room to ephemeral
    Given I am in a regular (non-ephemeral) room
    When I inspect the room settings
    Then there is no option to enable ephemeral mode
    And ephemeral mode is only settable at room creation time

  Scenario: Rejoining ephemeral room URL after purge
    Given I was in an ephemeral room
    And all members left (room purged)
    When I navigate to the same room URL
    Then the relay responds with "room_not_found"
    And I see: "This room does not exist or has been deleted"
    And I have the option to "Create New Room" (which would create a fresh ephemeral room at a different URL)

  Scenario: Ephemeral room auto-assignment works in-memory only
    Given I am in an ephemeral room with built-in agent active
    And 3 members are present
    When the auto-balance agent ticks
    Then it reads in-memory task state from the RoomSession
    And it emits assignment events via the normal E2EE flow
    But no agent state is persisted to IndexedDB
```

---

## Cross-Feature Security Requirements

### Authentication and Authorization

**All burn operations must verify room creator identity:**
- Manual `/burn` command: relay verifies sender's identity key matches room creator's identity key
- Creator identity established on room creation (`create: true` flag in join message)
- Relay stores creator identity key in room metadata (in-memory only)

**WebAuthn re-authentication is NOT required** (different from original plan):
- Friction is provided by typing "DELETE" in the confirmation modal
- WebAuthn re-auth adds unnecessary complexity for a privacy-first system with no accounts
- Room creator's identity key already proves they created the room

### Client-Side Cleanup Checklist

**When a room is destroyed (manual burn or auto-delete), clients must clear:**
1. In-memory state:
   - RoomSession disconnect
   - TaskStore.clear()
   - Messages array cleared
   - Member list cleared
2. sessionStorage:
   - `weave-olm-pickle` (Olm account pickle)
   - `weave-key-warning-shown`
   - `weave-task-panel-open`
3. IndexedDB:
   - Agent modules for this room (if not built-in)
   - Agent state for this room
   - Service worker reminders for this room
4. localStorage:
   - `weave-agent-disabled:{agentId}` for room-specific agents
   - `weave-agent-first-run-shown` (optional: keep global)
5. Service Worker:
   - Broadcast "clear-room-reminders" message to service worker
   - Service worker deletes all reminders matching this room ID
6. Agent executor:
   - Shutdown all active agents
   - Clear agent state cache

### UX Requirements

**Irreversible action friction:**
- Type-to-confirm ("DELETE") required for manual burn
- Visual warning with "cannot be undone" messaging
- Confirmation input must exactly match (case-sensitive)
- Submit button disabled until input is correct

**Ephemeral mode visibility:**
- Flame icon always visible in room header (not hidden behind menu)
- High-contrast styling (meets WCAG AA 3:1 for graphical objects)
- Persistent tooltip on hover
- ARIA label for screen readers
- Member count shows warning when only 1 member in ephemeral room

**Grace period countdown:**
- Shows time remaining in human-readable format ("23h 45m remaining")
- Updates every minute (not every second to reduce DOM churn)
- Visible to all members in persistent banner
- "Keep Room" and "Delete Now" buttons always visible
- Cancelling requires room creator only (or any member? — TBD in implementation)
