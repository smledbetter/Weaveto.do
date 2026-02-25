# M18 — Sync and Conflict Resolution: Implementation Plan

## Architecture Decisions

1. **No new relay message types**: Sync uses the existing `encrypted` message channel. A new payload field `syncEvents: TaskEvent[]` carries event history. The relay never sees plaintext.

2. **Event log in TaskStore**: TaskStore maintains an in-memory event log (`appliedEvents: TaskEvent[]`). On reconnect, each client sends its recent events to all peers via encrypted message. Peers apply through `applyEvent()` (which deduplicates via seenEvents).

3. **Sync window**: Only events from the last 24 hours are included in sync. Older events are assumed already received. This bounds the sync payload size.

4. **Sync state machine**: Connected → Syncing (after re-establishment, before pending replay) → Connected. The ConnectionIndicator shows "Syncing..." during exchange.

5. **Optimistic UI already done**: M17 already applies events before send. M18 adds the sync response handling and event log.

## Wave Plan

### Wave 1: TaskStore Event Log
**Model**: sonnet
**Files to modify**:
- `src/lib/tasks/store.svelte.ts` — Add `appliedEvents: TaskEvent[]` array. Append to it in `applyEvent()`. Add `getRecentEvents(sinceMs: number)` method. Add `clearEventLog()` for cleanup.

### Wave 2: Session Sync Methods
**Model**: sonnet
**Files to modify**:
- `src/lib/room/session.ts` — Add `sendSyncEvents(events: TaskEvent[])` method that sends events in a `syncEvents` payload within an encrypted message. Add handling of incoming `syncEvents` in message handler, passing them to a sync callback.

### Wave 3: Room Page Sync Integration
**Model**: sonnet
**Files to modify**:
- `src/routes/room/[id]/+page.svelte` — Add sync state (`syncing`). After re-establishment completes: set syncing=true, send recent events, apply received sync events, replay pending offline events, set syncing=false. Update ConnectionIndicator to show "Syncing..." state.
- `src/lib/components/ConnectionIndicator.svelte` — Add `syncing` prop. When syncing=true, show "Syncing..." label.

### Wave 4: Tests
**Model**: sonnet
**Files to create**:
- `tests/unit/sync-events.test.ts` — Event log, getRecentEvents, sync payload round-trip, conflict resolution with concurrent edits
- `tests/e2e/sync-conflict.spec.ts` — Sync indicator visibility, connection status states

## Security Checklist

- [ ] Sync events sent via encrypted channel (Megolm)
- [ ] No plaintext task data visible to relay
- [ ] Event log bounded (24h window)
- [ ] No console.log in client code
- [ ] Sync events deduplicated via seenEvents
