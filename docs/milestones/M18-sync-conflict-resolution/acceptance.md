# M18 — Sync and Conflict Resolution: Acceptance Criteria

## Feature: Event History Sync on Reconnect

### Scenario: Reconnecting client receives missed events
Given user A is online and creates tasks
And user B is offline during that time
When user B reconnects and re-establishes keys
Then user B receives user A's events via encrypted sync
And user B's task list shows user A's changes

### Scenario: Both users reconnect with offline changes
Given user A creates tasks offline
And user B creates different tasks offline
When both users reconnect
Then both users see all tasks from both users
And no tasks are lost

## Feature: Conflict Resolution

### Scenario: Same task edited by two users offline
Given user A changes task X title to "Alpha"
And user B changes task X title to "Beta"
When both reconnect and sync
Then the change with the higher timestamp wins
And if timestamps are equal, the higher actorId wins
And both users see the same final state

### Scenario: Duplicate events are safely ignored
Given a user receives the same event twice during sync
Then the event is applied only once (seenEvents deduplication)
And the task state remains consistent

## Feature: Optimistic UI

### Scenario: Changes appear immediately during offline editing
Given a user is offline
When the user creates or updates a task
Then the change appears immediately in the UI
And a sync dot shows the task is pending

### Scenario: Sync dot clears after successful sync
Given a user has pending sync tasks
When the user reconnects and events are sent
Then sync dots disappear from all synced tasks

## Feature: Sync Status Indicator

### Scenario: Syncing state shown during event exchange
Given a user reconnects after being offline
When event history is being exchanged
Then the connection indicator shows "Syncing..."

### Scenario: Sync complete
Given syncing has finished
Then the connection indicator shows normal connected state
