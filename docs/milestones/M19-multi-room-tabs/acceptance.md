# M19 — Multi-Room Tabs: Acceptance Criteria

## User Stories

### US1: Multi-Tab Room Access
**As a** room participant
**I want** to open different rooms in separate browser tabs
**So that** I can participate in multiple rooms simultaneously

### US2: Tab Isolation
**As a** room participant
**I want** each tab to operate independently
**So that** closing one tab doesn't disrupt my other rooms

### US3: Cross-Tab PIN Lock
**As a** security-conscious user
**I want** PIN lock in one tab to lock all my tabs
**So that** stepping away from my device protects all rooms

### US4: PRF Identity Reuse
**As a** user opening a second tab
**I want** to reuse my existing identity without another WebAuthn ceremony
**So that** joining rooms is seamless across tabs

---

## Gherkin Scenarios

### Feature: Multi-Tab Room Participation

```gherkin
Scenario: Open two rooms in separate tabs
  Given I am in Room A in Tab 1
  When I open Room B in a new tab (Tab 2)
  Then Tab 2 connects independently with its own WebSocket
  And Tab 2 has its own Olm/Megolm sessions
  And both tabs can send and receive messages independently

Scenario: Close one tab without affecting another
  Given I have Room A in Tab 1 and Room B in Tab 2
  When I close Tab 1
  Then Tab 2 continues to operate normally
  And Tab 2's WebSocket remains connected
  And Tab 2's crypto sessions are unaffected

Scenario: Cleanup scoped to closed tab's room only
  Given I have Room A in Tab 1 and Room B in Tab 2
  When Tab 1 runs cleanup for Room A
  Then Room A's IndexedDB data is cleared
  And Room B's IndexedDB data remains intact
  And Tab 2's sessionStorage is unaffected
```

### Feature: Cross-Tab PIN Lock

```gherkin
Scenario: PIN lock broadcasts to all tabs
  Given I have Room A (PIN-protected) in Tab 1 and Room B (PIN-protected) in Tab 2
  When Tab 1's inactivity timer triggers a lock
  Then Tab 1 shows the PIN entry screen
  And Tab 2 receives a lock broadcast via BroadcastChannel
  And Tab 2 also shows the PIN entry screen

Scenario: PIN unlock in one tab does not unlock others
  Given Tab 1 and Tab 2 are both locked
  When I enter my PIN in Tab 1
  Then Tab 1 unlocks and resumes normal operation
  And Tab 2 remains locked (user must unlock each tab individually)

Scenario: Lock on visibility change affects only that tab
  Given I have rooms in Tab 1 and Tab 2
  When I hide Tab 1 for longer than the grace period
  Then Tab 1 locks
  And Tab 2 broadcasts a lock event
  And Tab 2 locks as well
```

### Feature: PRF Identity Sharing

```gherkin
Scenario: Second tab reuses identity from IndexedDB
  Given I joined Room A in Tab 1 (PRF seed stored in IndexedDB)
  When I open Room B in Tab 2
  Then Tab 2 loads the device key from localStorage
  And Tab 2 creates its own Olm account from the PRF seed
  And Tab 2 does NOT trigger a new WebAuthn PRF ceremony

Scenario: First tab in session performs PRF ceremony
  Given no active tabs exist
  When I open Room A in Tab 1
  Then Tab 1 performs the WebAuthn PRF ceremony
  And Tab 1 stores the identity seed in IndexedDB
  And the seed is available for subsequent tabs
```

### Feature: Tab-Aware Cleanup

```gherkin
Scenario: Tab registers and deregisters with BroadcastChannel
  Given no tabs are open
  When I open Room A in Tab 1
  Then Tab 1 registers itself on the "weave-tabs" BroadcastChannel
  When I close Tab 1
  Then Tab 1 deregisters from the channel

Scenario: Shared sessionStorage keys preserved when other tabs active
  Given Tab 1 and Tab 2 are both open
  When Tab 1 performs cleanup
  Then Tab 1 clears only its room-specific sessionStorage keys
  And shared sessionStorage keys remain intact for Tab 2
```
