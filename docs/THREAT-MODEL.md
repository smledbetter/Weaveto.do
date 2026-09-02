# Threat Model

## Trust Boundaries

### Client (Trusted)

The browser is the security perimeter. All cryptographic operations — key derivation, Olm/Megolm encrypt/decrypt, HKDF, AES-GCM — execute client-side. The PRF seed (root of all key material) never leaves the device.

**Implication**: A compromised device (malware, malicious extension, physical access) breaks all guarantees. PIN gate (M6) mitigates casual physical access but not a determined attacker with device control.

### Relay (Untrusted)

The relay is a ciphertext router. It sees:

- Room IDs (random UUIDs, no semantic meaning)
- Curve25519 identity keys (ephemeral, not linked to real-world identity)
- Ciphertext blobs (Megolm-encrypted payloads)
- IP addresses. Never written to disk and never held in plaintext in the relay's own memory, but unavoidably visible for the life of a connection. See "The address is minimized, not hidden" below.
- Connection timing and room membership graph

It never sees: plaintext messages, task content, display names, PRF seeds, Olm/Megolm session keys, or PIN material.

The relay enforces rate limits, connection caps, sender identity verification, and origin validation (M8), but these are availability and integrity measures — not confidentiality.

### Room Members (Semi-Trusted)

Anyone who completes the Olm key exchange (via room link) can decrypt all room content. There is no per-user access control, no message-level permissions, and no revocation within a session. Trust is established by sharing the room link out-of-band.

## Defended Threats

| Threat | Defense | Milestone |
|--------|---------|-----------|
| Relay operator reads messages | Olm/Megolm E2EE — relay routes ciphertext only | M0 |
| Relay compromise (attacker controls server) | No plaintext on server; sender identity verification prevents spoofing | M0, M8 |
| Network observer (ISP, WiFi, CDN) | E2EE payload; TLS in production via reverse proxy | M0 |
| Stolen room link (late joiner) | Burn-after-use, ephemeral mode, auto-delete limit exposure window | M5 |
| Device left unlocked | PIN gate locks session after inactivity, clears Megolm keys from memory | M6 |
| Malicious WASM agent | No-syscall sandbox, Worker preemption, Ed25519 signatures, event validation | M3, M7 |
| Room data persistence after use | 5-layer cleanup: IndexedDB, memory, Megolm state, auto-delete, ephemeral | M5 |
| Console side-channel | Zero `console.*` policy in client code; generic notification bodies | M8 |
| Cross-origin WebSocket hijack | Origin validation on upgrade | M8 |
| Relay DoS / resource exhaustion | Per-connection rate limiting, room/connection/IP caps | M8 |
| Relay aimed at internal addresses by a client (SSRF) | Push endpoints must be https, and the host is resolved at request time with the socket pinned to the checked address | P3 |
| MITM via fake identity key injection | Five emoji per member pair, derived from SHA-256 of the sorted identity keys, always visible in room info | M15 |
| Display name spoofing | The same emoji sit beside each display name. They derive from keys, not names, so a spoofed name shows the wrong emoji | M15 |
| Relay selectively drops messages | Per-sender sequence counters inside the encrypted payload. The shield turns amber on a gap | M15 |
| Revoked member retains access | Kick migrates the room: new room, new keys, task state carried, old room destroyed | M15 |
| Timestamp manipulation in task events | Events dated more than five minutes ahead of the receiver's clock are rejected | M11 |
| Reconnect Olm session divergence | Stale Olm sessions are cleared on reconnect and key exchange re-runs. Decrypt failures are surfaced, not swallowed | M11 |

## Undefended Threats

| Threat | Impact | Mitigation Path |
|--------|--------|-----------------|
| Compromised device / malicious extension | Full key material exposure | Out of scope — client is trust root |
| Metadata analysis (timing, room graph, IP) | Correlation of users and activity patterns | Address minimized, not hidden. Accepted. Gap 9 |
| JavaScript GC cannot zero key material | Keys may persist in freed memory | Platform limitation; WASM memory zeroed on teardown |
| Room member exfiltrates content | Screenshots, copy-paste of decrypted data | Social trust model — no technical mitigation |
| Relay code authenticity unverifiable | Users trust relay matches open-source repo | No attestation needed (no plaintext), but no proof either. Gap 4 |
| Any member can burn the room | A single member destroys every online member's local copy | Accepted. Burn is an encrypted message, so holding the Megolm key is the only bar. Gap 8 |
| Offline task cache readable from the same origin | Task content on the device is wrapped by a key stored beside it | Accepted, and the cache exists to be readable without a prompt. Gap 10 |
| Push endpoint links a device across rooms | Enabling notifications in two rooms registers the same endpoint under both, so the relay can tell they are the same device | Inherent to Web Push. One endpoint exists per browser (see below) |

## Open Gaps

Numbers are stable identifiers, not an ordering. Closed gaps keep their number below rather than being renumbered, so a reference to "gap 6" resolves the same way it always did.

### 4. No Relay Authenticity Proof

**Gap**: Users cannot verify the relay is running unmodified open-source code. A malicious relay could add metadata logging, traffic analysis, or identity key injection without detection.

**Planned mitigation**: Reproducible relay builds via Nix. Publish build hashes to a transparency log. Community can rebuild from source and verify hashes match. No TEE needed — the relay never sees plaintext, so this is an integrity/trust measure, not a confidentiality one.

**Priority**: Low — confidentiality doesn't depend on relay trust, but important for self-hosters. Full metadata protection would need a network-layer defence this project does not provide, and the reasoning is in "The address is minimized, not hidden" below.

### 8. Burn Is Authorized By Membership, Not By The Creator

**Risk**: Any member can destroy the room for every other member who is online.

Burn used to be a relay operation. The relay held the creator's identity key and refused a purge from anyone else. Making the relay stateless removed that check, because it removed the state the check read. Burn is now an ordinary encrypted message: a client that receives one over the room's Megolm session deletes its local copy and leaves.

**Why this is accepted rather than fixed**: there is no longer a cryptographic notion of a creator anywhere in the system. `isCreator` is read from a URL parameter and is local to one browser. Restoring creator-only burn means putting durable room state back on the relay, which is the design this project deliberately left, or signing burns against a room key distributed at creation, which does not survive the member set changing.

**Why the exposure is smaller than it looks**: every member can already read everything, and the task list is an event log every member can already write to, so a member who wants to destroy the shared state can do so without a burn. Burn adds the ability to clear other people's *local* copies. It does not reach offline members, and it does not reach anyone's data on a device that is not currently in the room.

**Mitigation path**: if this becomes real, the fix is a signed burn tied to an ed25519 key established at room creation and carried in the invite link, so authorization travels with the link rather than with relay state.

### 9. The Address Is Minimized, Not Hidden

**Gap**: the relay sees the address every connection arrives from, and so does the host in front of it. This document previously pointed at a Tor hidden service as the mitigation, under a milestone number that did not exist. That work is dropped, so this is stated as an accepted gap instead of a promise.

**What is actually done**: the address is never written to disk and never held in plaintext in the relay's own memory. `hashClientIp` keys the per-address connection map on an HMAC under a salt that is random at boot and never written down, so the salt cannot outlive the process and two runs produce unrelated keys for the same address.

**What that is worth, precisely**: it removes the address from the one place this code controls. It does not remove it from the kernel socket table, from the host in front of the relay, or from the network path. Anyone holding live process memory holds the salt too, and IPv4 is small enough to brute force against a known salt, so the hash prevents enumeration of who connected but not confirmation of a suspected address.

**Why this is accepted rather than fixed**: hiding the address requires a party who sees it without knowing the destination, and a different party who sees the destination without the address, and those must be genuinely separate. An operator cannot be both, so this cannot be closed with infrastructure this project controls. The available answer was an onion service, and it was dropped as more expensive than it was worth for this application: latency against a real-time board, a per-address cap that cannot exist when every connection arrives from 127.0.0.1, and a Tor Browser stack that may not run WebAssembly at all. See #37.

For comparison, Signal does not solve this architecturally either. It minimizes and does not retain, which is the same class of answer given here.

**What someone who needs it should do**: run Tor Browser against the ordinary endpoint, which costs nothing and leaves the relay seeing an exit node rather than a user. Or run their own relay and point a client at it with the `?relay=` parameter tracked in #39, which puts the trust anchor on the person who needs the property.

### 10. The Offline Cache Is Wrapped By A Key Stored Beside It

**Gap**: task snapshots and the pending event queue are held in IndexedDB, AES-GCM-256 encrypted under a key derived from a device key that lives in `localStorage`. Anything that can read one can read the other, so the encryption raises the bar against a copied database file and against nothing else.

This is the scheme identity seeds used and no longer do. `src/lib/identity/store.ts` moved to a key derived from a PIN and never stored, and its header says why. The offline cache still works the old way.

**Why this is accepted rather than fixed**: the cache exists to be readable without a prompt when someone reopens the tab offline. Wrapping it behind a PIN would mean asking for one before showing a task list that the person could see a moment earlier, which defeats the feature. The identity seed could take that trade because it is asked for once at join and is worth a prompt. A cache is not.

**What it is worth stating precisely**: this protects against an IndexedDB file lifted off the disk on its own. It does not protect against anything running in the origin, and it does not protect against someone with the whole browser profile.

`src/lib/tasks/offline.ts` says the same thing at the top of the file. It is recorded here because `docs/ROADMAP.md` and `docs/STATE.md` both describe M17 as "encrypted IndexedDB task snapshots" without the caveat, and a reader of this document should not have to open the source to find it.

**Note on burn**: an undecryptable record is still a record. `verifyRoomCleared` counts these stores by existence rather than by whether they open, because reading them through the loaders reported ciphertext-that-will-not-decrypt as absent.

## Closed Gaps

These were open when this document was written and are now closed. They stayed here as "planned mitigation" long after the work shipped, which made the app read as considerably less hardened than it is. Two of them were marked High.

Each is paired below with the code that closed it and the test that holds it closed.

### 1. No Key Verification UI — CLOSED

**Was**: users could not compare identity key fingerprints out-of-band, so a compromised relay could inject its own key during exchange and hold a MITM position.

**Closed by**: `deriveEmojiString` in `src/lib/room/verification.ts`. Both peers sort the two identity keys, hash with SHA-256, and take five emoji from a 256-entry palette, so both sides compute the same string without exchanging anything. Rendered in room info for every member pair, always visible, no verify button.

**Held by**: `tests/unit/room-verification.test.ts`, `tests/e2e/verification.spec.ts`. Issue #58.

### 2. No Member Revocation — CLOSED

**Was**: once a member held an Olm session there was no way to revoke access short of destroying the room, and Megolm rotation did not stop a holder of the room link re-establishing.

**Closed by**: `handleKickMember` migrates the room. A new room is created with new keys, task state is carried across, remaining members are redirected, and the old room is destroyed. The kicked member holds a link to a room that no longer exists.

**Held by**: issue #59. `MigrationBanner.svelte` carries the user-facing half.

### 3. No Message Delivery Confirmation — CLOSED

**Was**: the relay could drop or delay messages selectively with no way to detect it.

**Closed by**: `DeliveryTracker` in `src/lib/room/delivery.ts`. Per-sender sequence counters ride inside the encrypted payload, so the relay never sees them, and a gap latches the room shield from green to amber. Undecryptable key shares also mark it, since those leave no sequence gap of their own.

**Held by**: `tests/unit/delivery-tracker.test.ts`, and the reconnect suite for the key-share path. Issue #60.

### 5. Display Name Spoofing — CLOSED

**Was**: display names were unbound to identity keys, so anyone could join as "Alice".

**Closed by**: the gap 1 emoji render beside each display name in room info. They derive from keys, not names, so an impersonator shows different emoji from the person being impersonated.

**Held by**: issue #61. Note the related change in the production phase: display names no longer travel in clear text either, and now sit inside the Olm payload.

### 6. Timestamp Manipulation in Task Events — CLOSED

**Was**: conflict resolution is highest-timestamp-wins over client-supplied clocks, so a member sending far-future timestamps won every conflict.

**Closed by**: `MAX_FUTURE_DRIFT_MS` in `src/lib/tasks/store.svelte.ts`. Events dated more than five minutes ahead of the receiver are dropped before they reach the dedup set.

**Deviation worth recording**: this document originally said such events would be "dropped or clamped to current time". The code rejects rather than clamps. Rejection is the stronger choice, because a clamped event still competes at the current timestamp while a rejected one does not compete at all.

**Held by**: `tests/unit/timestamp-clamping.test.ts`, including the exact boundary. Issue #52.

### 7. Reconnect Olm Session Divergence — CLOSED

**Was**: reconnect generated fresh one-time keys but kept the stale `olmSessions` map, so ratchet state diverged, key shares failed, and the catch blocks swallowed it. Encryption broke silently under ordinary WiFi drops.

**Closed by**: `src/lib/room/session.ts` clears `olmSessions` on reconnect open, rebuilds `pendingKeyExchanges` from the member list, and re-runs key exchange. Decrypt failures set `decryptionFailed` and render as "Unable to decrypt this message" rather than disappearing.

**Held by**: `tests/unit/reconnect-olm.test.ts`, `tests/e2e/network-resilience.spec.ts`, `tests/e2e/relay-restart.spec.ts`. Issue #51.

## What Push Notifications Cost

Identity keys are derived per room, so the relay cannot tell that the same device joined two different rooms. Push notifications are the exception, and the reason is worth writing down because it is not obvious and cannot be engineered away here.

A browser has **one** push subscription per service worker registration. `pushManager.subscribe()` returns the same endpoint whatever room asked for it. So a member who turns notifications on in two rooms causes the relay to store an identical endpoint string under both, and the relay can trivially link them. Per-room identities do not help, because the endpoint is the linking value.

Turning notifications on is per room, which limits the exposure to the rooms where someone chose it rather than every room they have ever joined. That is a reduction, not a fix.

Removing it entirely needs one of:

- **Drop Web Push.** The property becomes true and the feature is gone.
- **A service worker registration per room**, each with its own scope and therefore its own endpoint. Technically possible, and it means one registration per room accumulating on the device, with its own cleanup problem. Not attempted.

The push itself carries nothing. `sendPushNotification` posts an empty body and the service worker shows a fixed string, so the push service learns that a device was pinged and nothing about what. That protects the content. It does not make the recipient anonymous to the relay, and the same is true of every app built on Web Push.

## Push Endpoint Validation

The relay POSTs to the endpoint a client supplies. Unchecked, that is a request the relay makes on the client's behalf, from inside the network it is deployed in, to an address the client could not reach itself. The response never goes back, so it is blind, but reachability is inferable from timing and anything acting on an unauthenticated POST can still be triggered. 169.254.169.254 is the address that matters most, because the cloud metadata service answers unauthenticated requests with credentials.

Two checks, at two different times, because one time is not enough.

**At subscribe time**, syntactically: the scheme must be `https:`, there must be no credentials in the URL, and a literal address must not be one of the unroutable ranges. A refusal closes the connection, the same as any other message the relay will not accept, so it is visible rather than silent.

**At request time**, the hostname is resolved and every answer is checked, and the socket is pinned to the address that was checked. This is the part that matters. Validating a hostname when the subscription arrives and resolving it again when the request is sent is not a check at all, because the second answer can differ from the first and an attacker controls both. That gap is DNS rebinding. The guard is passed to the request as its `lookup` option, so the socket connects to exactly what the guard returned.

It refuses when **any** answer is blocked rather than picking a public one out of a mixed set. A real push service has no reason to resolve to a private address, and quietly selecting the acceptable answer turns a clear refusal into a race an attacker can keep re-entering.

Anything the classifier cannot parse is treated as blocked. The endpoint comes from an unauthenticated client, so an address it does not understand is a reason to refuse, not a reason to try.

Covered by `tests/unit/push-endpoint.test.ts` and `tests/unit/push-lookup.test.ts`, and by the `blocked endpoints refused` check in `npm run loadtest -- --profile=push`.

## Review Cadence

**Last reviewed**: 2026-02-20 (NIST SP 800-30 risk assessment, 13 new threats identified)

**Scheduled review**: After each milestone that touches crypto, transport, or storage.

**Review triggers** (re-evaluate this document when any of these occur):

- Adding server-side processing of any kind (breaks the "relay never decrypts" assumption)
- Adding persistent storage on the relay or a database layer
- Changing the transport protocol (e.g., WebSocket → WebTransport, adding federation)
- Adding new trust boundaries (e.g., push notification service, CDN, third-party API)
- Changing the identity model (e.g., accounts, cross-device identity, recovery keys)
- A security incident or externally reported vulnerability
- Shipping M14 (Trust & Verification) — update defended/undefended tables to reflect closed gaps
