# M16 — Web Push: Implementation Plan

## Architecture Decisions

1. **No `web-push` dependency**: Use Node.js `crypto` for VAPID JWT signing. Generic payloads mean no RFC 8188 content encryption needed.

2. **VAPID keys from environment**: `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` env vars. In dev mode, auto-generate ephemeral keys if not set.

3. **Subscription storage on relay**: In-memory `Map<roomId, Map<identityKey, PushSubscription>>`. No persistent storage — subscriptions re-register on reconnect.

4. **Generic push payload**: `{ title: "Weave", body: "You have a new notification" }`. No task content ever. Same pattern as M14 local notifications.

5. **Push via encrypted channel**: Client sends push subscription to relay as an encrypted message (type: `push_subscribe`). Relay stores the subscription endpoint. On room events, relay POSTs to subscription endpoints.

## Wave Plan

### Wave 1: Types and VAPID Utilities (server-side)
**Model**: sonnet
**Files to create**:
- `server/vapid.ts` — VAPID JWT generation using Node.js `crypto`, key loading from env, push sending via fetch
- `server/push-types.ts` — PushSubscription types, relay message types for push

### Wave 2: Relay Push Integration
**Model**: sonnet
**Files to modify**:
- `server/relay.ts` — Add push subscription handling (store/remove on join/leave), trigger push on encrypted messages, add VAPID public key endpoint

### Wave 3: Client Push Manager + SW Handler
**Model**: sonnet
**Files to create**:
- `src/lib/notifications/push.ts` — `subscribeToPush()`, `unsubscribePush()`, push subscription IDB store
**Files to modify**:
- `src/service-worker.ts` — Add `push` event listener with quiet hours and generic body

### Wave 4: Room Page Integration + Cleanup
**Model**: sonnet
**Files to modify**:
- `src/routes/room/[id]/+page.svelte` — Push toggle in bell popover, send subscription to relay
- `src/lib/components/NotificationBell.svelte` — Add push toggle
- `src/lib/room/cleanup.ts` — Add push subscription cleanup step

### Wave 5: Tests
**Model**: sonnet
**Files to create**:
- `tests/unit/vapid.test.ts` — VAPID JWT structure, signing, expiry
- `tests/unit/push-subscription.test.ts` — IDB storage, subscribe/unsubscribe
- `tests/e2e/push-notifications.spec.ts` — Push toggle visibility, subscription flow mock

## Security Checklist

- [ ] VAPID keys from environment (not hardcoded)
- [ ] Push payloads are generic only (no task content)
- [ ] Subscriptions cleaned up on room destruction
- [ ] No console.log in client code
- [ ] Push subscription sent via encrypted channel
- [ ] 410 Gone response removes stale subscription
