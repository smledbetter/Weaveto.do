# M6 Acceptance Criteria: Session Security

## Release Goal

If one member's device is compromised, the attacker can't access future room content after key rotation. PIN-based endpoint compromise containment using PBKDF2 key derivation (zero new dependencies).

## Threat Model

**Scenario**: Alice, Bob, and Carol are in a room. Bob's device is seized/stolen/malware'd. The adversary has Bob's active session — Megolm keys in memory, WebSocket connected.

**What PIN prevents**:
- Decrypting new Megolm session keys after rotation (forward secrecy from compromise point)
- Re-entering the room after session expiration without the PIN
- Surviving a forced key rotation triggered by another member

**What PIN cannot prevent**:
- Reading messages already decrypted before compromise (in memory)
- Sending messages using the current (pre-rotation) Megolm session

## Key Derivation Chain

```
PIN (6 digits)
  -> PBKDF2-SHA256 (600K iterations, random salt)
  -> 256-bit PIN key

PRF seed (from WebAuthn)
  -> HKDF-SHA256 ("pin-encryption-v1")
  -> PIN encryption key (wraps PIN key for storage)

On Megolm key rotation:
  New session key encrypted under recipient's PIN key
  -> Only someone who knows PIN + has device can decrypt
```

## User Stories

### PIN Setup

**As a** room creator coordinating sensitive tasks
**I want to** require everyone in the room to set a PIN
**So that** if any member's device is compromised, the attacker can't access future room content after we rotate keys

#### Acceptance Criteria

```gherkin
Feature: PIN Setup

  Scenario: Creator requires PIN for room
    Given a user is creating a new room
    When they enable "Require PIN for all members"
    Then all joining members must set a 6-digit PIN after WebAuthn
    And the room header shows a shield indicator

  Scenario: Member sets PIN on join
    Given a room requires PINs
    When a new member completes WebAuthn
    Then they are prompted to create a 6-digit PIN
    And the PIN is derived via PBKDF2-SHA256 with 600K iterations
    And the PIN key is stored encrypted under their PRF-derived key
    And the PIN never leaves the client device

  Scenario: PIN-optional room
    Given a room does not require PINs
    When a member joins
    Then no PIN prompt is shown
    And the join flow is unchanged from current behavior

  Scenario: PIN confirmation mismatch
    Given a member is setting up a PIN
    When the confirmation entry does not match the first entry
    Then an error is shown: "PINs don't match. Try again."
    And the user can re-enter both fields
```

### Session Gating

**As a** room member with a PIN
**I want** my session to lock after inactivity
**So that** someone who picks up my device can't access room content without my PIN

#### Acceptance Criteria

```gherkin
Feature: Session Lock

  Scenario: Auto-lock after inactivity
    Given a member has been inactive for the configured timeout
    When the timeout expires
    Then Megolm keys are cleared from memory
    And a lock overlay with PIN entry is displayed
    And room content is blurred behind the overlay

  Scenario: PIN re-entry on reconnect
    Given a member disconnects from a PIN-protected room
    When they reconnect
    Then they must enter their PIN before receiving new Megolm keys

  Scenario: Tab switch triggers grace period
    Given a member is in an active room
    When the tab becomes hidden for more than 60 seconds
    Then the session lock activates on tab return

  Scenario: Rate limiting after failed attempts
    Given a user has entered an incorrect PIN 3 times
    When they attempt a 4th entry
    Then they must wait 30 seconds before the next attempt
    And the wait doubles with each subsequent failure

  Scenario: Lockout after 10 failures
    Given a user has failed PIN entry 10 times
    When they attempt an 11th entry
    Then the session is cleared
    And they are redirected to the homepage
```

### Megolm Key Rotation with PIN Gating

**As a** room creator who suspects a device compromise
**I want to** rotate encryption keys so only members with valid PINs can continue
**So that** the compromised endpoint is locked out of future messages

#### Acceptance Criteria

```gherkin
Feature: Megolm Key Rotation with PIN Gating

  Scenario: Key rotation excludes members without valid PIN
    Given a room has active Megolm sessions
    When a key rotation is triggered
    Then new session keys are encrypted under each member's PIN-derived key
    And members who haven't entered their PIN cannot decrypt new messages

  Scenario: Creator forces key rotation
    Given the room creator suspects a device compromise
    When they trigger "Rotate keys now"
    Then all active Megolm sessions are invalidated
    And new session keys are distributed encrypted under PIN-derived keys
    And all members must re-enter their PIN to continue

  Scenario: Periodic automatic rotation
    Given a room has PIN policy enabled
    When the configured rotation interval elapses
    Then keys are automatically rotated
    And new keys are gated by PIN-derived keys
```

## Recovery Model

- **Forget PIN**: Rejoin the room as a new identity via invite link + new WebAuthn credential
- **No recovery codes**: Preserves the no-account, zero-knowledge model
- **No PIN change in V1**: Forget -> rejoin is the only path

## Security Invariants

- PIN never transmitted over the network (derived and used client-side only)
- PIN key stored encrypted under PRF-derived key (device-bound)
- PBKDF2-SHA256 with 600K+ iterations (WebCrypto native, zero new dependencies)
- Rate limiting is client-side (3 failures -> exponential backoff)
- Zero new dependencies added

## What's Cut

| Feature | Reason |
|---------|--------|
| Recovery codes | Contradicts no-account model |
| Argon2 | PBKDF2 via WebCrypto is zero-dep. 6-digit PIN + rate limiting is sufficient. |
| Trusted device backup | Multi-device is M9+ scope |
| Haptic feedback | Defer to future UX pass |
| PIN change flow | V1: forget -> rejoin. Change flow is future scope. |

## Definition of Done

- All Gherkin scenarios passing (unit + E2E)
- 80%+ coverage on new `src/lib/pin/` code
- 0 new dependencies
- 0 type errors (`npm run check`)
- Ship-readiness gate: prod-eng + security audit pass
