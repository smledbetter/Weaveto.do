# M17 — Offline Task Store: Implementation Plan

## Architecture Decisions

1. **Encrypted IDB store**: AES-GCM-256 via HKDF-SHA256 derived from PRF seed. Salt: `"weaveto.do-tasks-offline-v1"`, info: `"task-store-offline"`. Same pattern as M13 identity store.

2. **Snapshot + event queue model**: IDB stores both a task snapshot (current state) and a pending event queue (unsent events). Snapshot loads immediately on mount; pending events replay on reconnect.

3. **Two IDB databases**: `weave-offline-tasks` (encrypted task snapshots per room) and `weave-offline-queue` (pending events per room). Separate DBs for independent lifecycle.

4. **Unified connection indicator**: Replace separate `ConnectionIndicator.svelte` and reestablishing banner with a single component showing dot + optional label.

5. **Sync dot on task rows**: Offline-created tasks get a `pendingSync: true` flag in TaskStore. Cleared when the event is successfully sent. TaskPanel renders a pale dot for pending tasks.

## Wave Plan

### Wave 1: Offline Store Module (IDB + encryption)
**Model**: sonnet
**Files to create**:
- `src/lib/tasks/offline.ts` — `OfflineTaskStore` class: openDB, saveSnapshot(roomId, tasks, prfSeed), loadSnapshot(roomId, prfSeed), saveQueue(roomId, events), loadQueue(roomId), clearAll(roomId)

### Wave 2: TaskStore Integration + Event Queue
**Model**: sonnet
**Files to modify**:
- `src/lib/tasks/store.svelte.ts` — Add `getSnapshot()` method returning serializable task array. Add `pendingSync` tracking per task.
- `src/lib/tasks/types.ts` — Add `pendingSync?: boolean` to Task interface

### Wave 3: Unified Connection Indicator
**Model**: sonnet
**Files to modify**:
- `src/lib/components/ConnectionIndicator.svelte` — Rework: accept `connected`, `reestablishing`, `pendingCount` props. Render filled/empty dot + label per state matrix.

### Wave 4: Room Page Integration
**Model**: sonnet
**Files to modify**:
- `src/routes/room/[id]/+page.svelte` — Load offline snapshot on mount (before WS connects). Queue events when disconnected. Replay on reconnect. Save snapshot after each event. Update ConnectionIndicator props. Track pending event count.
- `src/lib/room/cleanup.ts` — Add step 9: clear offline task store + event queue

### Wave 5: Task Panel Sync Indicator
**Model**: sonnet
**Files to modify**:
- `src/lib/components/TaskPanel.svelte` — Render pale sync dot on task rows where `task.pendingSync === true`. Tooltip: "Will sync when reconnected"

### Wave 6: Tests
**Model**: sonnet
**Files to create**:
- `tests/unit/offline-store.test.ts` — IDB CRUD, encryption round-trip, queue FIFO, snapshot save/load
- `tests/e2e/offline-tasks.spec.ts` — Offline task creation, sync indicator visibility, connection status states

## Security Checklist

- [ ] Task data AES-GCM encrypted in IndexedDB (never plaintext)
- [ ] Encryption key derived from PRF seed via HKDF (not stored)
- [ ] No console.log in client code
- [ ] Offline store cleaned up on room destruction
- [ ] Pending events cleared after successful send
- [ ] No task content in connection status labels
