# M6 Implementation Plan: Session Security

## Context

M5.5 (UX Polish) gives us room names and better onboarding copy. M6 adds a cryptographic access control layer — PIN-based endpoint compromise containment — on top of the existing WebAuthn + Olm/Megolm stack. The PIN is a knowledge factor: WebAuthn proves "same device," PIN proves "same human." Together they gate access to new Megolm session keys after rotation.

Builds on: `src/lib/crypto/engine.ts` (HKDF, Megolm), `src/lib/webauthn/prf.ts` (PRF seed), `src/lib/room/session.ts` (key exchange, Megolm sessions).

## must_haves

### truths (observable outcomes)
- Room creator can toggle "Require PIN" during room creation
- Members in PIN-required rooms must set a 6-digit PIN after WebAuthn
- Inactive sessions auto-lock and require PIN re-entry to continue
- Megolm key rotation encrypts new session keys under PIN-derived keys
- Compromised endpoint without PIN cannot decrypt post-rotation messages
- Zero new npm dependencies

### artifacts (files produced)
- `src/lib/pin/derive.ts` — PBKDF2 key derivation from PIN
- `src/lib/pin/store.ts` — encrypted PIN key storage (IndexedDB, wrapped by PRF key)
- `src/lib/pin/gate.ts` — session lock logic (timeout, visibility change, re-entry)
- `src/lib/pin/types.ts` — PIN policy types, room metadata extensions
- `src/lib/components/PinSetup.svelte` — PIN creation UI (numeric keypad, confirm)
- `src/lib/components/PinEntry.svelte` — PIN re-entry UI (lock overlay, rate limiting)
- `src/lib/components/PinPolicyToggle.svelte` — creator toggle for room creation
- `tests/unit/pin/*.test.ts` — unit tests for derive, store, gate
- `tests/e2e/pin.spec.ts` — E2E tests for PIN flows

### key_links (where breakage cascades)
- `session.ts` key exchange must wrap new Megolm keys under PIN-derived keys when policy is active
- Room creation page (`+page.svelte` on homepage) gains PIN policy toggle
- Room page (`room/[id]/+page.svelte`) gains lock overlay and shield indicator
- `cleanup.ts` must clear PIN state on room destruction

## Waves

### Wave 1: PIN Key Derivation & Storage
> No dependencies. Foundation for all subsequent waves.

**Task 1.1** (type: auto)
- **Files**: `src/lib/pin/types.ts`
- **Action**: Define PIN policy types (`PinPolicy`, `PinState`, `StoredPinKey`), room metadata extension for PIN requirement
- **Verify**: TypeScript compiles, types imported cleanly
- **Done**: Types cover all PIN states (unset, set, locked, failed)

**Task 1.2** (type: auto)
- **Files**: `src/lib/pin/derive.ts`
- **Action**: Implement `derivePinKey(pin: string, salt: Uint8Array): Promise<CryptoKey>` using WebCrypto PBKDF2-SHA256 with 600K iterations. Implement `generatePinSalt(): Uint8Array`. Implement `verifyPin(pin: string, salt: Uint8Array, expectedHash: Uint8Array): Promise<boolean>`.
- **Verify**: Unit tests confirm deterministic derivation, salt uniqueness, verification round-trip
- **Done**: All derive/verify functions pass with known test vectors

**Task 1.3** (type: auto)
- **Files**: `src/lib/pin/store.ts`
- **Action**: Implement PIN key encrypted storage in IndexedDB. `storePinKey(roomId, pinKey, prfSeed)` wraps PIN key under HKDF-derived encryption key from PRF seed. `loadPinKey(roomId, prfSeed)` unwraps. `clearPinKey(roomId)` deletes.
- **Verify**: Unit tests confirm store/load round-trip, clear removes data
- **Done**: PIN key survives page reload, cleared on room destruction

**Task 1.4** (type: auto)
- **Files**: `tests/unit/pin/derive.test.ts`, `tests/unit/pin/store.test.ts`
- **Action**: Write unit tests for derivation (determinism, salt uniqueness, iteration count) and storage (round-trip, clear, missing key)
- **Verify**: `npm run test:unit` passes
- **Done**: 90%+ coverage on derive.ts and store.ts

### Wave 2: PIN UI Components & Room Policy
> Depends on: Wave 1 (types and derive)

**Task 2.1** (type: auto)
- **Files**: `src/lib/components/PinSetup.svelte`
- **Action**: 6-digit numeric PIN creation component. Two-step: enter + confirm. Error on mismatch. Accessible numeric keypad with large tap targets. Emits `oncreate` with PIN string.
- **Verify**: Visual check, keyboard navigable, screen reader announces states
- **Done**: PIN setup flow works on desktop and mobile viewports

**Task 2.2** (type: auto)
- **Files**: `src/lib/components/PinEntry.svelte`
- **Action**: PIN re-entry component with lock overlay. Blurs room content behind. Shows attempt counter. Rate limiting UI: disabled state with countdown timer after 3 failures. 10 failures emits `onlockout`. Emits `onverify` with PIN string.
- **Verify**: Visual check, rate limiting countdown works, lockout fires
- **Done**: Lock overlay traps focus, keyboard accessible, aria-live announcements

**Task 2.3** (type: auto)
- **Files**: `src/lib/components/PinPolicyToggle.svelte`
- **Action**: Toggle component for room creation page. "Require PIN for all members" with explanatory subtext about endpoint compromise protection. Emits `onchange` with boolean.
- **Verify**: Visual check, toggle state reflects correctly
- **Done**: Toggle integrates into room creation flow

**Task 2.4** (type: auto)
- **Files**: `src/routes/room/[id]/+page.svelte`, `src/routes/+page.svelte`
- **Action**: Wire PinPolicyToggle into room creation. Wire PinSetup into join flow (after WebAuthn, before connection). Wire PinEntry as lock overlay. Add shield icon to room header when PIN policy active. Pass PIN policy as encrypted room metadata in join message.
- **Verify**: Full join flow with PIN works end-to-end in dev mode
- **Done**: Creator can require PIN, joiner sees PIN setup, shield shows

### Wave 3: Session Lock & Rate Limiting
> Depends on: Wave 2 (PIN entry UI wired into room page)

**Task 3.1** (type: auto)
- **Files**: `src/lib/pin/gate.ts`
- **Action**: Session lock manager. Tracks inactivity via `setTimeout` + `visibilitychange`. Configurable timeout (5/15/30 min, stored in room metadata). On lock: clears Megolm keys from memory, sets locked state. On unlock (PIN verified): restores session. Rate limiting: track attempts, exponential backoff (30s base, doubles), lockout after 10. Tab hidden >60s triggers lock on return.
- **Verify**: Unit tests for timeout logic, rate limiting math, lockout threshold
- **Done**: Session locks after configured timeout, rate limiting enforced

**Task 3.2** (type: auto)
- **Files**: `src/lib/room/session.ts`
- **Action**: Add `lockSession()` method that clears Megolm outbound/inbound sessions from memory. Add `unlockSession(pinKey)` that re-requests Megolm keys from peers (gated by PIN key). Add reconnect flow that requires PIN before key exchange.
- **Verify**: After lock, sending/receiving fails. After unlock with correct PIN, messaging resumes.
- **Done**: Session lock/unlock cycle works without message loss

**Task 3.3** (type: auto)
- **Files**: `tests/unit/pin/gate.test.ts`
- **Action**: Unit tests for gate logic (timeout triggers, visibility change, rate limiting, lockout, backoff calculation)
- **Verify**: `npm run test:unit` passes
- **Done**: 90%+ coverage on gate.ts

### Wave 4: Megolm Key Rotation Gated by PIN
> Depends on: Wave 3 (session lock/unlock mechanism)

**Task 4.1** (type: auto)
- **Files**: `src/lib/room/session.ts`, `src/lib/crypto/engine.ts`
- **Action**: Implement `rotateGroupSession(memberPinKeys: Map<string, CryptoKey>)`. Creates new Megolm outbound session. Encrypts new session key under each member's PIN-derived key (AES-GCM wrap). Distributes wrapped keys via existing key_share mechanism. Members must unwrap with their PIN key to create inbound session.
- **Verify**: After rotation, only members with valid PIN key can decrypt new messages
- **Done**: Post-rotation messages undecryptable without PIN

**Task 4.2** (type: auto)
- **Files**: `src/lib/room/session.ts`
- **Action**: Creator-forced rotation. New protocol message `type: "rotate_keys"` (encrypted, creator-only). On receipt, all members' current inbound sessions invalidated, must re-enter PIN and receive new wrapped key. Add `/rotate` command in room.
- **Verify**: Creator triggers rotation, all members prompted for PIN, messaging resumes after PIN entry
- **Done**: Forced rotation locks out members without PIN

**Task 4.3** (type: auto)
- **Files**: `src/lib/room/cleanup.ts`
- **Action**: Extend cleanup orchestrator to clear PIN state (IndexedDB PIN keys, gate timers, rate limiting state) on room destruction.
- **Verify**: After cleanup, no PIN artifacts remain in IndexedDB
- **Done**: Clean destruction with PIN state

### Wave 5: Tests & Integration
> Depends on: Wave 4

**Task 5.1** (type: auto)
- **Files**: `tests/unit/pin/*.test.ts`
- **Action**: Comprehensive unit tests: PIN derivation with known vectors, key wrapping round-trip, session lock/unlock, rate limiting math, cleanup coverage
- **Verify**: `npm run test:unit` — 80%+ coverage on all `src/lib/pin/` files
- **Done**: All unit tests pass, coverage targets met

**Task 5.2** (type: auto)
- **Files**: `tests/e2e/pin.spec.ts`
- **Action**: E2E tests: PIN setup during join, session lock after inactivity (accelerated timer), PIN re-entry, rate limiting visible, creator-forced rotation, post-rotation message delivery
- **Verify**: `npm run test:e2e` passes
- **Done**: All E2E scenarios from acceptance.md covered

### Final Wave: Ship-Readiness Gate
> Depends on: all prior waves. Must pass before shipping.

**Ship-Readiness Review** (type: checkpoint:gate)
- **Skills**: `production-engineer` + `security-auditor` (single agent, one pass)
- **Action**: Run quality gates (unit tests with coverage, E2E, type check, TDD conventions) AND 10-principle security audit with OWASP ASI Top 10 threat analysis on all changed files. Special focus on: PIN key never transmitted, PBKDF2 iteration count, rate limiting bypass resistance, Megolm key wrapping correctness.
- **Verify**: All gates pass, all 10 security principles pass. Fix any failures, re-run until clean.
- **Done**: 0 test failures, 80%+ coverage on new code, 0 type errors, 10/10 security principles, 0 vulnerabilities

## Agent Strategy

| Wave | Agent | Model | Tasks |
|------|-------|-------|-------|
| 1 | Solo | sonnet | 1.1-1.4 (types, derive, store, tests — sequential) |
| 2 | Worker A | haiku | 2.1, 2.2, 2.3 (UI components — parallel) |
| 2 | Worker B | sonnet | 2.4 (wiring — after components) |
| 3 | Solo | sonnet | 3.1-3.3 (gate logic + session changes + tests) |
| 4 | Solo | sonnet | 4.1-4.3 (key rotation — critical crypto, needs focus) |
| 5 | Solo | sonnet | 5.1, 5.2 (tests) |
| Final | Ship-Readiness | sonnet | Quality gates + security audit |

## Estimated Tokens

| Wave | Est. Tokens |
|------|-------------|
| Wave 1: PIN Key Derivation & Storage | ~20K |
| Wave 2: PIN UI Components & Room Policy | ~25K |
| Wave 3: Session Lock & Rate Limiting | ~20K |
| Wave 4: Megolm Key Rotation Gated by PIN | ~30K |
| Wave 5: Tests & Integration | ~15K |
| Ship-Readiness Gate | ~10K |
| **Total** | **~120K** |
