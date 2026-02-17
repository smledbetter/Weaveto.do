# M9 Acceptance Criteria: Encrypted Notifications

## Release Goal

Members get notified of task assignments and due dates even when the tab is closed, with zero plaintext in notification payloads. Builds on existing service worker reminders with expanded event coverage, local rules, and Web Push for closed-browser delivery.

## What Exists Today

- **In-tab reminders**: `setTimeout` fires 5 min before due, shows browser `Notification`
- **Service worker reminders**: IndexedDB stores `{taskId, dueAt, fireAt, fired}` — zero plaintext. Polls every 30s, fires generic "A task is due soon" notifications
- **No push infrastructure**: No push gateway, no FCM/APNs, no relay-routed notifications
- **No server-side notification state**: Relay routes ciphertext only

## What This Milestone Adds

1. **Expanded SW notifications** — assignment, status change, grouping (not just due date reminders)
2. **Local notification rules** — per-room toggle, urgency filter, do-not-disturb
3. **Web Push API** — encrypted push via relay for closed-browser delivery (first relay feature addition since M0)

## What's Cut (from original PRD)

| Cut | Reason |
|-----|--------|
| Matrix rooms / Noise Pipes | Not our protocol. We use WebSocket relay. |
| Mutual TLS | Browser WebSocket doesn't support client certs. TLS encrypts transport already. |
| Location-aware silencing | No location data by design. Contradicts privacy model. |
| Cryptographic delivery receipts | Relay is stateless. Receipts require server-side tracking. |
| Tamper-evident logging | No server-side notification history to tamper with. |
| Device wipe integration | Web app. Not our domain. |
| Per-contact rules | No persistent contact/identity model. Rooms are ephemeral. |
| Rotating notification tokens | Web Push API handles subscription rotation via the browser. |
| Independent audit capability | Over-engineered for the threat model. |

## User Stories

### Expanded Service Worker Notifications

**As a** room member with tasks assigned to me
**I want to** receive notifications when I'm assigned a task or a task status changes
**So that** I stay informed without keeping the tab focused

#### Acceptance Criteria

```gherkin
Feature: Expanded Service Worker Notifications

  Scenario: Notification on task assignment
    Given a member has browser notifications enabled
    And the tab is in the background
    When another member assigns them a task
    Then a notification appears: "You have a new task in [room-name]"
    And no task title or content is included in the notification

  Scenario: Notification on task completion for owned task
    Given a member owns a task
    And the tab is in the background
    When another member completes that task
    Then a notification appears: "A task was completed in [room-name]"

  Scenario: Notification grouping
    Given a member receives 3 notifications within 10 seconds
    Then they are grouped into a single notification: "3 updates in [room-name]"

  Scenario: No notification for own actions
    Given a member assigns a task to themselves
    Then no notification is fired for that action
```

### Local Notification Rules

**As a** room member
**I want to** control which notifications I receive and when
**So that** I'm not overwhelmed during focused work

#### Acceptance Criteria

```gherkin
Feature: Local Notification Rules

  Scenario: Per-room notification toggle
    Given a member opens room notification settings
    When they disable notifications for this room
    Then no notifications fire for events in this room
    And other rooms are unaffected

  Scenario: Urgency-only filter
    Given a member has set notifications to "urgent only"
    When a non-urgent task is assigned to them
    Then no notification fires
    When an urgent task is assigned to them
    Then a notification fires

  Scenario: Do Not Disturb mode
    Given a member enables Do Not Disturb for 1 hour
    When a notification-worthy event occurs
    Then no notification is shown
    And the event is visible when DND expires and the tab is opened
    And a moon icon appears in the room header

  Scenario: DND state persists across tab close
    Given a member has DND enabled until tomorrow
    When they close and reopen the tab
    Then DND is still active
    And the moon icon is visible
```

### Web Push (Encrypted)

**As a** room member who closes their browser
**I want to** still receive notifications for important room events
**So that** I don't miss task assignments or deadlines

#### Acceptance Criteria

```gherkin
Feature: Web Push (Encrypted)

  Scenario: Push notification when browser is closed
    Given a member has granted push permission
    And their browser is closed
    When another member assigns them a task
    Then a push notification is delivered via Web Push API
    And the push payload contains only an encrypted event type and room ID
    And no plaintext task content is included

  Scenario: Just-in-time permission prompt
    Given a member creates their first task with a due date
    And they have not been asked about push notifications before
    Then a non-modal prompt appears: "Get notified even when this tab is closed?"
    And the browser permission dialog follows if they tap "Yes"
    And no prompt appears if they tap "Not now"
    And they are not asked again if they decline

  Scenario: Push subscription cleanup on room destruction
    Given a member has a push subscription for a room
    When the room is destroyed (burn/auto-delete/ephemeral purge)
    Then the push subscription is removed from the relay
    And no further push notifications are sent for that room

  Scenario: Push respects notification rules
    Given a member has DND enabled
    And their browser is closed
    When a notification-worthy event occurs
    Then no push notification is sent
```

## Notification Content Policy

All notifications — service worker and Web Push — follow the same content rules:

| Event | Notification Text |
|-------|------------------|
| Task assigned to you | "You have a new task in [room-name]" |
| Your task completed by another | "A task was completed in [room-name]" |
| Task due soon (5 min) | "A task is due soon in [room-name]" |
| Multiple events (grouped) | "N updates in [room-name]" |
| Chat activity (future) | "Activity in [room-name]" |

**Never included**: task titles, member names, task content, due dates, assignment details.

Room name is the 2-word hash (e.g., "swift-falcon") — deterministic, not user-generated content.

## Security Invariants

- Zero plaintext in any notification payload (SW or Push)
- Web Push uses RFC 8291 ECDH + AES-128-GCM (browser-standard encryption)
- Push subscription endpoint is the only data stored on relay (no task data, no member data)
- Relay remains stateless for room content (push subscriptions are the exception, scoped to endpoint URLs)
- DND and notification rules stored locally only (localStorage/IndexedDB)
- Push subscription cleaned up on all room destruction paths

## Definition of Done

- All Gherkin scenarios passing (unit + E2E)
- 80%+ coverage on new notification code
- 0 new dependencies (Web Push API is browser-native; VAPID key generation uses WebCrypto)
- 0 type errors (`npm run check`)
- Ship-readiness gate: prod-eng + security audit pass
- Vulnerability scanning (M8) has validated existing SW notification infrastructure before this milestone begins
