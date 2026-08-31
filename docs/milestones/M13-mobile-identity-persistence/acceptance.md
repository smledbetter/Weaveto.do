# M13 — Mobile Identity Persistence: Acceptance Criteria

## Release Goal

Mobile users get a persistent crypto identity across sessions without WebAuthn PRF, using IndexedDB-stored encrypted seeds.

## Acceptance Criteria

### Feature 1: Persistent Identity via IndexedDB

```gherkin
Scenario: First visit on a non-PRF device
  Given a user visits a room on a device without WebAuthn PRF support
  When they join the room
  Then a crypto seed is generated randomly
  And the seed is encrypted with a device-bound AES-GCM key and stored in IndexedDB
  And the "Using temporary identity" banner does NOT appear
  And encryption works normally

Scenario: Return visit on the same non-PRF device
  Given a user previously joined a room on a non-PRF device
  When they visit the same room again in a new session
  Then the encrypted seed is loaded from IndexedDB and decrypted
  And the user gets the same crypto identity (same identity key)
  And no WebAuthn prompt appears

Scenario: Return visit — stored seed corrupted or missing
  Given a user previously had a stored identity
  When the stored seed cannot be decrypted (e.g., IDB cleared by browser)
  Then a new random seed is generated and stored
  And the user gets a new identity (no error, no crash)
```

### Feature 2: PRF Users Unaffected

```gherkin
Scenario: PRF-capable device uses PRF path
  Given a user visits on a device with WebAuthn PRF support
  When they join the room
  Then the WebAuthn PRF ceremony is used (not IndexedDB fallback)
  And identity behavior is unchanged from pre-M13

Scenario: Dev mode uses random seed
  Given the app is running in dev mode (import.meta.env.DEV)
  When a user joins a room
  Then a random seed is generated per session (no IndexedDB storage)
  And behavior is unchanged from pre-M13
```

### Feature 3: PIN Protection for Persisted-Seed Users

```gherkin
Scenario: PIN setup with IndexedDB-persisted seed
  Given a user joined via IndexedDB-persisted seed (non-PRF device)
  And the room requires PIN protection
  When they set up a PIN
  Then the PIN key is derived from the persisted seed (same as PRF seed path)
  And PIN lock/unlock works identically to PRF users

Scenario: PIN verification on return visit
  Given a user has both a persisted seed and a stored PIN key
  When they return to a PIN-protected room
  Then the stored seed is loaded first
  Then the stored PIN key is loaded using the seed
  And PIN entry works normally
```

### Feature 4: Cleanup on Room Destruction

```gherkin
Scenario: Manual burn clears persisted identity
  Given a user has a persisted identity in IndexedDB
  When the room creator executes /burn
  Then the persisted seed is deleted from IndexedDB
  And sessionStorage Olm pickle is cleared (existing behavior)

Scenario: Auto-delete clears persisted identity
  Given a user has a persisted identity in IndexedDB
  When the 24h auto-delete timer fires
  Then the persisted seed is deleted from IndexedDB

Scenario: Ephemeral room purge clears persisted identity
  Given a user has a persisted identity in IndexedDB for an ephemeral room
  When all members leave and the room is destroyed
  Then the persisted seed is deleted from IndexedDB
```

### Feature 5: Security — Encrypted at Rest

```gherkin
Scenario: IndexedDB stores only ciphertext
  Given a crypto seed is stored in IndexedDB
  Then the stored value is AES-GCM encrypted (not plaintext)
  And the wrapping key is derived via HKDF-SHA256 with a device-specific salt
  And the wrapping key exists only in memory (never persisted)

Scenario: No console output
  Given the identity store module is loaded
  When any operation is performed (store, load, clear, error)
  Then zero console.log/error/warn calls are made
```
