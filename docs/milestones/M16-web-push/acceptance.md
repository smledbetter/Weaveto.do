# M16 — Web Push: Acceptance Criteria

## Release Goal

Users receive push notifications when the browser is closed, with zero task content exposed in the push payload.

## Features

### Web Push Subscription

**As a** room member who wants to stay informed
**I want** to opt in to push notifications
**So that** I receive notifications even when my browser is closed

Feature: Web Push Subscription

  Scenario: User subscribes to push
    Given the user has granted notification permission (M14)
    And push is supported by the browser
    When the user enables push in the notification bell popover
    Then a PushSubscription is created via PushManager.subscribe()
    And the subscription is sent to the relay via encrypted message
    And the subscription is stored in IndexedDB for recovery

  Scenario: Push not supported
    Given the browser does not support PushManager
    Then the push toggle is hidden (local notifications still work)

### Relay Push Endpoint

**As a** relay server
**I want** to send push notifications to subscribed clients
**So that** users receive alerts when their browser is closed

Feature: Relay Push

  Scenario: Relay sends push on room event
    Given a client has registered a push subscription with the relay
    When a new encrypted message arrives in the room
    Then the relay sends a push notification to all subscribed clients (except the sender)
    And the push payload contains only a generic body (no task content)

  Scenario: VAPID keys from environment
    Given the relay is configured with VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables
    Then these keys are used for push notification signing
    And no VAPID keys are hardcoded in source

  Scenario: Push fails silently
    Given a push subscription endpoint returns 410 (Gone)
    Then the relay removes the subscription
    And no error is propagated to other clients

### SW Push Handler

**As a** service worker
**I want** to handle incoming push events
**So that** I can display notifications even with no tabs open

Feature: SW Push Handler

  Scenario: Push received while browser closed
    Given the service worker receives a push event
    Then it displays a notification with generic body
    And quiet hours are respected
    And clicking the notification opens the room

  Scenario: Push received while tab open
    Given a tab is open for the room
    Then no push notification is shown (local notification handled instead)

### Push Subscription Cleanup

**As a** privacy-conscious system
**I want** push subscriptions cleaned up on room destruction
**So that** no orphaned subscriptions remain after a room is burned/deleted

Feature: Push Cleanup

  Scenario: Room destroyed cleans up push
    Given a room has push subscriptions
    When the room is burned, auto-deleted, or purged
    Then push subscriptions are removed from the relay
    And the client's IDB push subscription record is cleared

## Deferred

- **Encrypted push payloads** — Generic payloads are sufficient for privacy. Full RFC 8188 content encryption deferred.
- **Push subscription rotation** — Subscription endpoints don't expire frequently enough to warrant rotation logic.
