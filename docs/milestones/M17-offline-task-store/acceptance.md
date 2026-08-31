# M17 — Offline Task Store: Acceptance Criteria

## Feature: Encrypted Offline Task Persistence

### Scenario: Tasks persist across page reloads
Given a user is in a room with tasks
When the user reloads the page
Then tasks appear from IndexedDB before WebSocket connects
And tasks are AES-GCM encrypted at rest in IndexedDB

### Scenario: Tasks persist when network is unavailable
Given a user has previously loaded a room with tasks
When the user opens the room without network
Then tasks appear from the offline store
And the connection status shows "Offline"

## Feature: Offline Task Creation

### Scenario: User creates a task while offline
Given a user is in a room but disconnected
When the user creates a new task
Then the task appears immediately in the task list
And a sync indicator dot appears on the task row
And the task event is queued for later delivery

### Scenario: Queued events are sent on reconnect
Given a user has created tasks while offline
When the user reconnects to the room
Then all queued events are sent in FIFO order
And sync indicator dots disappear after successful send

## Feature: Unified Connection Status

### Scenario: Connected state
Given the WebSocket is open and keys are established
Then the connection dot is filled
And no status label is shown

### Scenario: Reconnecting state
Given the WebSocket has disconnected
When the client is attempting to reconnect
Then the connection dot is empty
And the label shows "Reconnecting..."

### Scenario: Offline state
Given the user has no network connection
Then the connection dot is empty
And the label shows "Offline"

### Scenario: Offline with pending events
Given the user is offline with queued task events
Then the connection dot is empty
And the label shows "Offline · N pending"

## Feature: Event Queue Persistence

### Scenario: Pending events survive page reload
Given a user has created tasks while offline
When the user reloads the page
Then pending events are restored from IndexedDB
And events are sent when connection is restored

## Feature: Cleanup Integration

### Scenario: Offline store cleaned on room destruction
Given a user is in a room with offline data
When the room is destroyed (burn, auto-delete, or purge)
Then the offline task store for that room is cleared from IndexedDB
And the event queue for that room is cleared from IndexedDB
