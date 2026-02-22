# M11 — Reconnect & Hardening: Acceptance Criteria

## Release Goal

After a network reconnect, users re-establish end-to-end encryption with all room members automatically — no silent decrypt failures. Malicious timestamp attacks are blocked. One-time keys are always available for new members.

## Features

- [x] Reconnect Olm session fix
- [x] Timestamp clamping
- [x] OTK replenishment

## Definition of Done

All acceptance criteria below passing. All quality gates green.

---

## Feature 1: Reconnect Olm Session Fix

### Story

**As a** room member on an unstable network
**I want** encryption to automatically re-establish after a reconnect
**So that** I don't see undecryptable messages or lose data

### Acceptance Criteria

```gherkin
Feature: Reconnect Olm Session Re-establishment

  Scenario: Happy path — reconnect re-establishes encryption
    Given I am in an encrypted room with 2 other members
    And my WebSocket connection drops
    When my client reconnects automatically
    Then stale Olm sessions are cleared
    And the UI shows "Re-establishing encryption..." indicator
    And key exchange completes with all current members
    And the indicator disappears
    And subsequent messages decrypt successfully

  Scenario: Reconnect with member who left during disconnect
    Given I am in a room with members A and B
    And member B leaves while I am disconnected
    When I reconnect
    Then I re-establish encryption only with member A
    And no stale session exists for member B

  Scenario: Decrypt failure surfaced to user
    Given I reconnect to a room
    And key exchange with member A fails (e.g., OTK exhausted)
    When member A sends a message
    Then I see a warning "Unable to decrypt — encryption is being re-established"
    And the message is not silently dropped

  Scenario: Multiple rapid disconnects
    Given I am in a room
    When my connection drops and reconnects 3 times in quick succession
    Then only the final reconnect's key exchange is active
    And no duplicate Olm sessions are created
```

---

## Feature 2: Timestamp Clamping

### Story

**As a** room member
**I want** task events with future timestamps to be rejected
**So that** a malicious member cannot permanently override my task changes

### Acceptance Criteria

```gherkin
Feature: Timestamp Clamping on Task Events

  Scenario: Happy path — normal timestamps accepted
    Given I receive a task event with timestamp within 5 minutes of now
    When the event is applied to the store
    Then the event is accepted normally

  Scenario: Future timestamp rejected
    Given I receive a task event with timestamp 10 minutes in the future
    When the event is applied to the store
    Then the event is rejected (not applied)

  Scenario: Boundary — exactly 5 minutes future
    Given I receive a task event with timestamp exactly 5 minutes in the future
    When the event is applied to the store
    Then the event is accepted (<=5 min window)

  Scenario: Past timestamps still work
    Given I receive a task event with timestamp 30 seconds in the past
    When the event is applied to the store
    Then normal conflict resolution applies (highest timestamp wins)
```

---

## Feature 3: OTK Replenishment

### Story

**As a** room creator inviting many members
**I want** one-time keys to automatically replenish
**So that** new members can always establish encrypted sessions with me

### Acceptance Criteria

```gherkin
Feature: One-Time Key Replenishment

  Scenario: Happy path — OTKs replenished when low
    Given my account has 10 OTKs at connection
    And 7 members join and consume 7 OTKs
    When OTK count drops below threshold (5)
    Then 10 new OTKs are generated and published
    And the relay receives the updated key bundle

  Scenario: OTK count stays above zero
    Given multiple members join in rapid succession
    When each consumes an OTK for key exchange
    Then replenishment triggers before count reaches zero
    And no key exchange fails due to OTK exhaustion

  Scenario: Replenishment on reconnect
    Given I reconnect to a room
    When new OTKs are generated
    Then the OTK count is at least 10
    And old unpublished keys are not double-counted
```

---

## Deferred

- Message replay/buffering on reconnect (M16-M17 scope)
- Cross-device identity persistence (M12 scope)
- Member revocation with room migration (M14 scope)
