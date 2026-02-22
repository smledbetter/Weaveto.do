# M11 — Reconnect & Hardening: Implementation Plan

## must_haves

### truths
- After reconnect, all messages from room members decrypt successfully (no silent failures)
- Task events with timestamps >5 minutes in the future are rejected client-side
- One-time keys replenish automatically when inventory drops below 5
- Users see "Re-establishing encryption..." indicator during post-reconnect key exchange

### artifacts
- `src/lib/room/session.ts` — modified (Olm session clearing, re-establishment flag, OTK replenishment)
- `src/lib/tasks/store.svelte.ts` — modified (timestamp clamping in applyEvent)
- `src/routes/room/[id]/+page.svelte` — modified (re-establishing encryption indicator)
- `tests/unit/timestamp-clamping.test.ts` — new
- `tests/unit/otk-replenishment.test.ts` — new
- `tests/unit/reconnect-olm.test.ts` — new

### key_links
- `session.ts:attemptReconnect()` → clears olmSessions → triggers key exchange → sets reestablishing flag
- `store.svelte.ts:applyEvent()` → timestamp check → reject/accept → conflict resolution
- `session.ts:handleKeyShare()` → after key exchange → check OTK count → replenish if low

## Wave Plan

### Wave 1: Timestamp Clamping (sonnet — logic, no crypto)
**Files to read**: `src/lib/tasks/store.svelte.ts`, `src/lib/tasks/types.ts`, `tests/unit/task-store.test.ts`
**Files to write**: `src/lib/tasks/store.svelte.ts`, `tests/unit/timestamp-clamping.test.ts`
**Scope**:
- Add `MAX_FUTURE_DRIFT_MS = 5 * 60 * 1000` constant to store
- In `applyEvent()`, before duplicate check: reject events where `event.timestamp > Date.now() + MAX_FUTURE_DRIFT_MS`
- Unit tests: normal timestamps accepted, future timestamps rejected, boundary (exactly 5min), past timestamps work normally
**Agent**: sonnet (logic task)

### Wave 2: Olm Session Clearing + Re-establishment Indicator (sonnet — crypto-adjacent, serial)
**Files to read**: `src/lib/room/session.ts`, `src/lib/crypto/engine.ts`
**Files to write**: `src/lib/room/session.ts`, `tests/unit/reconnect-olm.test.ts`
**Scope**:
- In `attemptReconnect()`: clear `olmSessions` map before generating new OTKs
- Add `reestablishing: boolean` flag to RoomSession, set true on reconnect, false when all members have completed key exchange
- Add `onReestablishing?: (active: boolean) => void` callback to session options
- Track pending key exchanges: set of identityKeys from member list, remove as key_share succeeds
- When set is empty → set reestablishing = false, fire callback
- Replace silent catch blocks in key share decryption with `onDecryptFailure?.(senderId)` callback
- Unit tests: olmSessions cleared on reconnect, reestablishing flag lifecycle, decrypt failure callback fires
**Agent**: sonnet (crypto-adjacent, needs careful reasoning)

### Wave 3: OTK Replenishment (sonnet — crypto-adjacent, serial after Wave 2)
**Files to read**: `src/lib/room/session.ts`, `src/lib/crypto/engine.ts`
**Files to write**: `src/lib/room/session.ts`, `src/lib/crypto/engine.ts`, `tests/unit/otk-replenishment.test.ts`
**Scope**:
- Add `getOneTimeKeyCount(account): number` to engine.ts (count keys from `getOneTimeKeys`)
- After each successful inbound session creation in session.ts, check OTK count
- If count < 5: generate 10 new OTKs, mark published, send `otk_replenish` or include in next outgoing message
- Since relay doesn't have an OTK update message type, piggyback on the existing join/key_share protocol: generate and mark published locally (they're used when peers create outbound sessions to us, which happens server-side via the member list OTK bundle)
- Actually: OTKs are sent in the join message and consumed by peers creating outbound sessions. After reconnect, fresh OTKs are already sent. The gap is mid-session OTK exhaustion. For now: track count and regenerate + re-announce via a lightweight `otk_update` message to relay, OR simpler: just generate locally and they're available when the next `create_outbound_session` happens against us
- Simplest approach: after each inbound session creation, check count, regenerate if low. New OTKs are available for subsequent outbound session attempts by peers
- Unit tests: OTK count checked after key exchange, replenishment triggered at threshold, count stays above zero
**Agent**: sonnet (crypto-adjacent)

### Wave 4: UI Indicator + Integration (haiku — mechanical UI)
**Files to read**: `src/routes/room/[id]/+page.svelte`
**Files to write**: `src/routes/room/[id]/+page.svelte`
**Scope**:
- Wire `onReestablishing` callback from session to page state
- Show "Re-establishing encryption..." banner (similar to "Reconnecting..." connection status)
- Style: amber/yellow background, dismisses automatically when reestablishing = false
- ARIA: `role="status"` with `aria-live="polite"`
**Agent**: haiku (mechanical UI wiring)

## Crypto Serialization

Waves 2 and 3 are serial (both modify `session.ts` crypto paths). Wave 1 is independent. Wave 4 depends on Wave 2 (needs the callback).

Execution order: Wave 1 ∥ Wave 2 → Wave 3 → Wave 4

## Verification

```
Automated: npm run check && npm run test:unit && npm run test:e2e && npm run build
Manual: Open two browser tabs, connect to same room. Kill network on one tab, restore. Verify messages decrypt after reconnect.
```
