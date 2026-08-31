# M13 — Mobile Identity Persistence: Implementation Plan

## Architecture

### New Module: `src/lib/identity/store.ts`

IndexedDB-backed encrypted seed storage. Follows the exact pattern from `src/lib/pin/store.ts`.

```
DB name:    "weave-identity"
DB version: 1
Store name: "seeds"
keyPath:    "roomId"
Record:     { roomId: string, encryptedSeed: Uint8Array, iv: Uint8Array, deviceSalt: Uint8Array }
```

**Wrapping key derivation**: HKDF-SHA256 with:
- Salt: `"weaveto.do-identity-v1"` (fixed, purpose-specific)
- Info: `"identity-seed-wrapping"` (distinct from PIN wrapping)
- Input: A device-bound key derived from `crypto.getRandomValues(32)` stored in localStorage

**Device key**: A 32-byte random key stored in `localStorage` under `"weave-device-key"`. This is the weakest link — if an attacker has filesystem access they can read it. But this is the same threat model as sessionStorage (current) and is strictly better than ephemeral-per-session identity. The device key is NOT the seed itself — it's only used to wrap/unwrap the seed in IndexedDB.

### Flow Changes

**joinRoom() in +page.svelte** (lines 469-497):

```
Current:  PRF available → use PRF seed
          PRF unavailable → random seed (ephemeral, usingTempIdentity=true)
          Dev mode → random seed

After:    PRF available → use PRF seed (unchanged)
          PRF unavailable → check IndexedDB for stored seed
            Found → decrypt and use (persistent identity, usingTempIdentity=false)
            Not found → generate random seed, encrypt and store in IndexedDB
          Dev mode → random seed (unchanged, no IndexedDB storage)
```

**cleanup.ts** (line 35): Add `clearIdentitySeed(roomId)` as cleanup layer 6.

**Banner logic**: `usingTempIdentity` stays `false` when IndexedDB identity is loaded or created.

## Wave Plan

### Wave 1: Identity Store (serial — crypto module)

**Files to create**:
- `src/lib/identity/store.ts` — IndexedDB CRUD + AES-GCM encrypt/decrypt

**Files to read** (for pattern reference):
- `src/lib/pin/store.ts` (template)
- `src/lib/pin/derive.ts` (HKDF pattern)

**Agent**: sonnet (crypto logic, needs reasoning)

**Functions**:
- `openIdentityDB()` → IDBDatabase
- `storeIdentitySeed(roomId, seed)` → void (generate device key if needed, encrypt, store)
- `loadIdentitySeed(roomId)` → Uint8Array | null (load device key, decrypt, return seed)
- `clearIdentitySeed(roomId)` → void (delete record)
- `getOrCreateDeviceKey()` → Uint8Array (localStorage-backed device key)
- Export DB_NAME, DB_VERSION, STORE_NAME for tests

### Wave 2: Integration (serial — touches session/auth flow)

**Files to modify**:
- `src/routes/room/[id]/+page.svelte` — joinRoom() fallback path (lines 491-496)
- `src/lib/room/cleanup.ts` — add identity cleanup layer
- `src/lib/webauthn/prf.ts` — optional: persist credential ID in localStorage (not just sessionStorage)

**Agent**: sonnet (integration logic, cross-file coordination)

**Changes**:
1. In joinRoom() catch block (line 491): Before falling back to random seed, try `loadIdentitySeed(roomId)`. If found, use it. If not found, generate random seed and call `storeIdentitySeed(roomId, seed)`. Set `usingTempIdentity = false` in both cases.
2. In cleanup.ts: Import `clearIdentitySeed`, call after `clearPinKey`.
3. In prf.ts: Move credential ID storage from sessionStorage to localStorage for cross-session persistence (enables PRF assertion on return visits even after tab close).

### Wave 3: Unit Tests (parallel-safe)

**Files to create**:
- `tests/unit/identity-store.test.ts`

**Agent**: sonnet (test design needs reasoning)

**Test cases**:
- Encrypt/decrypt roundtrip (Node crypto.subtle)
- Store and load produces same seed bytes
- Load with missing record returns null
- Load with corrupted data returns null (doesn't throw)
- Clear removes the record
- Device key is generated on first call, reused on subsequent calls
- Different roomIds produce independent records
- DB constants exported correctly

### Wave 4: E2E Tests (parallel-safe)

**Files to modify**:
- `tests/e2e/smoke.spec.ts` — add smoke test for non-PRF identity persistence

**Agent**: haiku (mechanical test addition)

**Test case**: Verify that joining a room in dev mode works (existing behavior preserved). The actual IndexedDB persistence can't be fully E2E tested since dev mode bypasses WebAuthn, but we verify no regressions.

### Wave 5: Commit + Gates

Atomic commit per wave. Run all 4 gates after final wave.
