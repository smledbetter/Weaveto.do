# M0 Acceptance Criteria

Status: **All passing**

```gherkin
Scenario: Create an E2EE room
  Given I am on the weaveto.do homepage
  When I click "New Room"
  Then a new cryptographic identity is generated using WebAuthn
  And a unique room ID is displayed (e.g., weaveto.do/r/abc123)
  And the room is configured for end-to-end encryption using Megolm
  And no personal information is stored locally or on any server
```

```gherkin
Scenario: Join an E2EE room
  Given I have a valid room ID (weaveto.do/r/abc123)
  When I navigate to the URL
  Then I am prompted to authenticate using WebAuthn
  And my device establishes a secure session with existing members
  And I can receive and decrypt previously sent messages
  And my identity remains anonymous to the server
```

```gherkin
Scenario: Send an encrypted message
  Given I am a member of an E2EE room
  When I send a message "Distribute flyers at 10 AM"
  Then the message is encrypted before leaving my device
  And only room members can decrypt it
  And the server logs only encrypted blobs and timestamps (no content or sender metadata)
```

## Test Coverage

- 15 Playwright E2E tests covering room creation, joining, messaging, encryption
- All scenarios verified against relay server logs (zero plaintext)
