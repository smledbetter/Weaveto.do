# M5.5 Acceptance Criteria: UX Polish

## Release Goal

New users can understand and navigate the app without prior context. Rooms have memorable identities, modes are clearly explained, and onboarding copy guides invited users through the join flow.

## User Stories

### Room Mode Clarity

**As a** first-time user creating a room
**I want to** understand the difference between Standard and Ephemeral modes
**So that** I choose the right mode for my coordination needs

#### Acceptance Criteria

```gherkin
Feature: Room Mode Selection

  Scenario: Named modes with radio buttons
    Given a user is on the homepage
    Then they see two radio buttons: "Standard" and "Ephemeral"
    And "Standard" is selected by default
    And each mode has a short description explaining when to use it

  Scenario: Standard mode description
    Given a user sees the mode selection
    Then "Standard" shows: "Tasks persist until completed or deleted. Best for ongoing projects."

  Scenario: Ephemeral mode description
    Given a user sees the mode selection
    Then "Ephemeral" shows: "Nothing saved. Room disappears when everyone leaves. Best for one-time coordination."

  Scenario: Mode selection creates correct room type
    Given a user selects "Ephemeral" mode
    When they click "New Room"
    Then the room is created with ephemeral=true
    And the flame indicator appears in the room header
```

### Onboarding Copy

**As an** invited user clicking a room link for the first time
**I want to** understand what I'm joining and why I need to authenticate
**So that** I feel confident proceeding through the WebAuthn ceremony

#### Acceptance Criteria

```gherkin
Feature: Join Page Onboarding

  Scenario: Friendly join page copy
    Given an invited user navigates to a room URL
    Then they see the room name (e.g. "swift-falcon") instead of "Join Room"
    And a brief explanation: "You've been invited to a private, encrypted room."
    And the auth note says: "Your fingerprint creates a temporary identity for this session. Nothing is stored."

  Scenario: Display name input guidance
    Given a user is on the join page
    Then the name input placeholder says "What should we call you?"
    And the submit button says "Join Room"
```

### Agent Panel Explainer

**As a** user opening the Agents panel for the first time
**I want to** understand what agents are and what the auto-balance agent does
**So that** I don't feel confused by unfamiliar UI

#### Acceptance Criteria

```gherkin
Feature: Agent Panel Explainer

  Scenario: Explainer text in agent panel
    Given a user opens the Agents panel
    Then they see an explainer section at the top
    And it says: "Agents run small automations inside your room. They can read tasks and assign them, but never see your messages."
    And below: "The auto-balance agent distributes unassigned tasks evenly. More agents coming soon."

  Scenario: Advanced section for custom agents
    Given a user sees the agent panel explainer
    Then the "Advanced" upload toggle has a note: "Upload a custom WASM agent. For developers only."
```

### Memorable Room Names

**As a** user in a room
**I want to** see a memorable name like "swift-falcon" instead of a hex hash
**So that** I can easily tell rooms apart and share the name verbally

#### Acceptance Criteria

```gherkin
Feature: Memorable Room Names

  Scenario: Room name derived from hash
    Given a room with ID "a1b2c3..."
    Then a deterministic 2-word name is generated (e.g. "swift-falcon")
    And the same room ID always produces the same name

  Scenario: Room name in page title
    Given a user is in a room named "swift-falcon"
    Then the browser tab shows "swift-falcon — weaveto.do"

  Scenario: Room name in header
    Given a user is in a room named "swift-falcon"
    Then the room header shows "swift-falcon" instead of "Room"
```

### Shortened Room URLs

**As a** user sharing a room link
**I want** the URL to use the room name instead of a hex hash
**So that** I can share it verbally and it's easier to remember

#### Acceptance Criteria

```gherkin
Feature: Shortened Room URLs

  Scenario: Room URL uses name-based path
    Given a room with name "swift-falcon"
    Then the room is accessible at /swift-falcon
    And the old /room/[hex] URL still works (redirect or alias)

  Scenario: Invite modal shows short URL
    Given a user opens the invite modal
    Then the displayed URL uses the short form (/swift-falcon)
    And the QR code encodes the short URL
```

### Display Name Visibility

**As a** user in a room
**I want to** see my own display name somewhere in the room header
**So that** I know what name others see me as

#### Acceptance Criteria

```gherkin
Feature: Display Name in Room Header

  Scenario: User sees own name
    Given a user joined as "Alice"
    Then the room header shows "Alice" near the member count
    And it's styled subtly (not competing with room name)
```

## Definition of Done

- All Gherkin scenarios passing (unit + E2E)
- 80%+ coverage on new modules (room name generator)
- 0 new dependencies
- 0 type errors (`npm run check`)
- 0 E2E regressions from M0-M5
- Ship-readiness gate: prod-eng + security audit pass
