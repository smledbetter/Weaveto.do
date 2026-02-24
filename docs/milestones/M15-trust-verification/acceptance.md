# M15 — Trust & Verification: Acceptance Criteria

## Release Goal

Users can visually verify encryption keys with other room members, creators can remove compromised members with a clean cryptographic break, and message delivery gaps are detected automatically.

## Features

### Emoji Key Verification

**As a** privacy-conscious room member
**I want** to see emoji safety strings for each member
**So that** I can verify we share the same encryption keys without comparing raw cryptographic data

Feature: Emoji Key Verification

  Scenario: Two members see matching emoji
    Given Alice and Bob are both in a room
    When Alice opens the room info popover
    Then she sees a "Security" section with 5 emoji next to Bob's name
    And the emoji are derived from SHA-256(sorted(aliceKey, bobKey))
    And Bob sees the same 5 emoji next to Alice's name

  Scenario: Emoji are always visible
    Given a user opens room info
    Then emoji strings are rendered unconditionally (no "Verify" button)
    And helper text reads "Ask members to confirm these match on their screen."

  Scenario: Solo member sees no emoji
    Given a room with only one member
    When the member opens room info
    Then no emoji verification section is shown (no one to verify against)

### Member Revocation via Room Migration

**As a** room creator
**I want** to kick a member and have a new room created automatically
**So that** the removed member loses all cryptographic access without key reuse

Feature: Member Revocation

  Scenario: Creator kicks a member
    Given Alice is the room creator and Bob and Carol are members
    When Alice clicks "Remove" on Bob in the member list
    Then a new room is created with fresh roomId and Megolm session
    And task state is migrated to the new room
    And Alice and Carol are redirected to the new room
    And the old room is destroyed via purge
    And Bob cannot join the new room

  Scenario: Non-creator cannot kick
    Given Bob is not the room creator
    Then no "Remove" option appears in the member list for Bob

  Scenario: Migration banner shown
    Given Carol is redirected to a new room after a kick
    Then she sees a dismissible banner: "This room was recreated — your tasks have been carried over."
    And the banner can be dismissed with a close button

  Scenario: Tasks preserved after migration
    Given a room has 3 tasks (1 pending, 1 in-progress, 1 completed)
    When the creator kicks a member
    Then the new room contains all 3 tasks with their original state

### Message Delivery Confirmation

**As a** room member
**I want** to know if messages may have been missed
**So that** I can take action if communication appears incomplete

Feature: Delivery Confirmation

  Scenario: All messages received (healthy)
    Given all messages from all senders have sequential counters with no gaps
    Then the shield icon in the room header shows green (filled)

  Scenario: Gap detected (amber)
    Given sender A sends messages with sequence 1, 2, 4 (gap at 3)
    When the receiver processes message 4
    Then the shield icon turns amber (outline)
    And clicking the shield shows "Some messages may have been missed."

  Scenario: Counter resets on reconnect
    Given a gap was previously detected
    When the user reconnects to the room
    Then the shield resets to green
    And sequence tracking starts fresh

  Scenario: Counter inside encrypted payload
    Given a message is sent
    Then the sequence counter is included in the plaintext JSON before encryption
    And the counter is not visible to the relay server

## Deferred

- **Reproducible relay builds** — Requires Nix infrastructure setup; not blocking trust features
