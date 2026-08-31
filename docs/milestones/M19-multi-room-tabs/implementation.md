# M19 — Multi-Room Tabs: Implementation Plan

## Architecture

### Key Decisions
1. **Per-tab Olm/Megolm** — each tab creates its own crypto sessions. No cross-tab key sharing.
2. **PRF seed via IndexedDB** — already works (M13). Tabs load seed from IDB, derive own Olm accounts.
3. **BroadcastChannel** — new coordination layer for PIN lock sync and cleanup coordination.
4. **sessionStorage stays tab-local** — pickle, lock state remain per-tab (correct for per-tab crypto).
5. **No new dependencies** — BroadcastChannel is a browser API.

### New File
- `src/lib/room/tab-sync.ts` — BroadcastChannel wrapper for tab coordination

### Modified Files
- `src/lib/pin/gate.ts` — broadcast lock events
- `src/lib/room/cleanup.ts` — tab-aware cleanup (skip shared state if other tabs active)
- `src/routes/room/[id]/+page.svelte` — integrate tab sync, handle lock broadcasts

---

## Wave Plan

### Wave 1: Tab Sync Module (NEW)
**File**: `src/lib/room/tab-sync.ts`
**Agent**: sonnet
**Dependencies**: none

Create `TabSync` class:
- `BroadcastChannel("weave-tab-sync")` for inter-tab communication
- Message types: `tab-register`, `tab-deregister`, `pin-locked`, `pin-unlocked`
- `register(tabId, roomId)` — announce tab presence
- `deregister(tabId)` — announce tab departure
- `broadcastLock()` — notify all tabs of PIN lock
- `onLock(callback)` — listen for lock events from other tabs
- `getActiveTabCount()` — query how many tabs are active (via request/response)
- `destroy()` — close BroadcastChannel
- Tab ID: `crypto.randomUUID()` generated per page load

### Wave 2: PIN Gate Lock Broadcast (MODIFY)
**File**: `src/lib/pin/gate.ts`
**Agent**: sonnet
**Dependencies**: Wave 1

Modify `SessionGate`:
- Accept optional `TabSync` instance in constructor
- On lock: call `tabSync.broadcastLock()` after clearing Megolm
- On receiving lock broadcast: call the lock callback (same as inactivity lock)
- Lock broadcast is fire-and-forget (no response expected)

### Wave 3: Tab-Aware Cleanup (MODIFY)
**File**: `src/lib/room/cleanup.ts`
**Agent**: sonnet
**Dependencies**: Wave 1

Modify `cleanupRoom()`:
- Accept optional `TabSync` instance
- Before clearing sessionStorage: check if this is `weave-olm-pickle` — only clear if no other tabs registered
- Room-specific IDB cleanup remains unchanged (already scoped by roomId)
- On cleanup: call `tabSync.deregister(tabId)` before closing channel

### Wave 4: Room Page Integration (MODIFY)
**File**: `src/routes/room/[id]/+page.svelte`
**Agent**: sonnet
**Dependencies**: Waves 1-3

Integrate tab sync into room lifecycle:
- Create `TabSync` on page load, register tab
- Pass `TabSync` to `SessionGate` constructor
- Pass `TabSync` to `cleanupRoom()`
- Listen for lock broadcasts: when received, trigger lock UI
- On page unload/cleanup: deregister tab
- No changes to PRF flow (IDB identity already works cross-tab)

### Wave 5: Tests
**Agent**: sonnet
**Dependencies**: Waves 1-4

Unit tests (`tests/unit/tab-sync.test.ts`):
- TabSync register/deregister
- Lock broadcast sends correct message
- Lock callback invoked on receiving broadcast
- Multiple instances coordinate (simulate 2 tabs)
- destroy() closes channel

Unit tests (`tests/unit/session-gate-broadcast.test.ts`):
- SessionGate with TabSync broadcasts on lock
- SessionGate responds to lock broadcast from other tab

E2E tests (`tests/e2e/multi-tab.spec.ts`):
- Open room in 2 browser contexts
- Verify independent operation
- Verify closing one doesn't affect the other
- Test PIN lock broadcast (if PIN enabled)
