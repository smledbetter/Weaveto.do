# M15 — Trust & Verification: Implementation Plan

## Architecture Decisions

1. **Emoji derivation**: `SHA-256(sorted(keyA, keyB))` → map first 10 bytes to 5 emoji from a 256-emoji palette. Sorting ensures determinism regardless of who initiates.

2. **Migration via encrypted message**: Rather than adding a relay message type, migration redirects use the existing `encrypted` message channel with a `migration` payload type. The creator sends a migration message containing the new room URL, then purges the old room. This keeps the relay zero-knowledge.

3. **Sequence counter**: Added to the plaintext JSON payload before padding/encryption. Each sender maintains a monotonically increasing counter per room. Receivers track `Map<senderKey, expectedSeq>` and detect gaps.

4. **No relay changes**: All M15 features work through existing encrypted message types. Migration redirect is an encrypted payload, sequence counters are inside encrypted payload.

## Wave Plan

### Wave 1: Types & Core Logic (serial — crypto)
**Model**: sonnet
**Files to create**:
- `src/lib/room/verification.ts` — `deriveEmojiString(keyA: string, keyB: string): Promise<string>` using SHA-256 + deterministic emoji mapping
- `src/lib/room/delivery.ts` — `DeliveryTracker` class: `recordSend(): number`, `checkReceived(senderKey: string, seq: number): { gap: boolean }`

**Files to read**: `src/lib/crypto/engine.ts` (SHA-256 pattern), `src/lib/room/types.ts`

### Wave 2: Room Migration Logic (serial — crypto)
**Model**: sonnet
**Files to modify**:
- `src/lib/room/session.ts` — Add `sendMigrationMessage(newRoomUrl: string)` method; add `senderSequence` to sendMessage/sendTaskEvent payload; handle `migration` payload type in message handler

**Files to read**: `src/lib/room/session.ts`, `src/lib/room/cleanup.ts`

### Wave 3: UI Components (parallel-safe — no shared files with Wave 2)
**Model**: sonnet
**Files to create**:
- `src/lib/components/MigrationBanner.svelte` — Dismissible banner with task carryover message
- `src/lib/components/ShieldIcon.svelte` — Green (healthy) / amber (gap detected) shield with tooltip

**Files to read**: `src/lib/components/NotificationBell.svelte` (popover pattern), `src/lib/components/AutoDeleteBanner.svelte` (banner pattern)

### Wave 4: Room Page Integration (depends on Waves 1-3)
**Model**: sonnet
**Files to modify**:
- `src/routes/room/[id]/+page.svelte` — Add verification emoji to room info popover; add shield icon to header; add migration banner; wire up delivery tracker; implement kick flow (creator creates new room, sends migration message to remaining members, purges old room)

**Files to read**: `src/routes/room/[id]/+page.svelte`, all new files from Waves 1-3

### Wave 5: Tests (depends on all waves)
**Model**: sonnet
**Files to create**:
- `tests/unit/room-verification.test.ts` — Emoji determinism (derive(A,B) === derive(B,A)), uniqueness for different key pairs, consistent output for same input
- `tests/unit/delivery-tracker.test.ts` — Sequence tracking, gap detection, reconnect reset, multiple senders
- `tests/e2e/verification.spec.ts` — Emoji visible in room info popover, shield icon state changes
- `tests/e2e/room-migration.spec.ts` — Kick flow, redirect, task preservation, banner display

**Files to read**: `tests/unit/notification-store.test.ts` (IDB test pattern), `tests/e2e/smoke.spec.ts` (E2E helper patterns), `tests/e2e/utils/room-helpers.ts`

## Crypto Security Checklist

- [ ] Emoji hash uses sorted keys (both parties see same emoji)
- [ ] No raw key material displayed to user
- [ ] New room on migration has fresh Megolm session (no key reuse)
- [ ] Old room fully destroyed after migration
- [ ] Sequence counter inside encrypted payload (relay cannot see)
- [ ] No console.log in any new client code

## Gate Commands

```bash
npm run check                    # TypeScript + svelte-check
npm run test:unit -- --coverage  # Vitest with coverage
npm run test:e2e                 # Playwright E2E
npm run build                    # Production build
```
