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
- IP addresses (not logged, but visible during connection)
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

## Undefended Threats

| Threat | Impact | Mitigation Path |
|--------|--------|-----------------|
| Compromised device / malicious extension | Full key material exposure | Out of scope — client is trust root |
| Metadata analysis (timing, room graph, IP) | Correlation of users and activity patterns | M19 Tor hidden service reduces IP exposure |
| JavaScript GC cannot zero key material | Keys may persist in freed memory | Platform limitation; WASM memory zeroed on teardown |
| Room member exfiltrates content | Screenshots, copy-paste of decrypted data | Social trust model — no technical mitigation |
| Relay selectively drops messages | Availability degradation, silent message suppression | No detection mechanism currently |
| MITM via fake identity key injection | Attacker intercepts Olm session establishment | No key verification UI (see Open Gaps) |
| Relay code authenticity unverifiable | Users trust relay matches open-source repo | No attestation needed (no plaintext), but no proof either |
| Display name spoofing | Any member can impersonate another by using their display name | No binding between identity key and display name (see Open Gaps) |
| Timestamp manipulation in task events | Malicious member sends future timestamps, wins every conflict | No timestamp window validation (see Open Gaps) |
| Reconnect Olm session divergence | Reconnect generates fresh OTKs but keeps stale Olm sessions; decrypt failures swallowed silently | Clear stale sessions on reconnect (see Open Gaps) |
| Any member can burn the room | A single member destroys every online member's local copy | Accepted. Burn is an encrypted message, so holding the Megolm key is the only bar (see Open Gaps) |

## Open Gaps & Planned Mitigations

### 1. No Key Verification UI

**Gap**: Users cannot compare identity key fingerprints out-of-band. A compromised relay could inject its own identity key during key exchange, establishing a MITM position on Olm sessions.

**Planned mitigation**: Emoji safety strings as ambient display. In the room info popover, add a "Security" section showing 5 emoji per member derived from `SHA-256(sorted(identityKeyA, identityKeyB))` — always visible, no action button. One line of text: "Ask members to confirm these match on their screen." Users who care compare out-of-band; others ignore it.

**Priority**: High — this is the only gap where an active attacker can break confidentiality without device compromise.

### 2. No Member Revocation

**Gap**: Once a member has established an Olm session, there is no mechanism to revoke their access without destroying the room. Key rotation (M6) rotates the Megolm session but doesn't prevent a revoked member from re-establishing an Olm session if they still have the room link.

**Planned mitigation**: Room migration. When the creator kicks a member, the client automatically creates a new room, migrates task state, and sends remaining members a redirect. All members re-authenticate into the new room. The old room is destroyed. This is heavier than re-keying but gives a clean cryptographic break — the kicked member has no room ID, no Olm sessions, and no link to the new room.

**Priority**: Medium — social trust model covers most cases, but needed for rooms with evolving membership.

### 3. No Message Delivery Confirmation

**Gap**: The relay could selectively drop or delay messages without detection. There is no delivery-confirmation protocol to detect selective message suppression.

**Planned mitigation**: Per-sender sequential message counters inside encrypted payload. Room-level indicator: shield icon in room header turns green→amber when any gap is detected. Tapping shows "Some messages may have been missed." No per-message warnings, no named members (avoids social alarm). Resets on reconnect. Lightweight — no consensus protocol, just gap detection.

**Priority**: Low — requires a compromised relay, and the relay's power is already minimal.

### 4. No Relay Authenticity Proof

**Gap**: Users cannot verify the relay is running unmodified open-source code. A malicious relay could add metadata logging, traffic analysis, or identity key injection without detection.

**Planned mitigation**: Reproducible relay builds via Nix. Publish build hashes to a transparency log. Community can rebuild from source and verify hashes match. No TEE needed — the relay never sees plaintext, so this is an integrity/trust measure, not a confidentiality one.

**Priority**: Low — confidentiality doesn't depend on relay trust, but important for self-hosters and high-risk users. Pairs with M19 (Tor) for full metadata protection.

### 5. Display Name Spoofing

**Gap**: Any room member can set an arbitrary display name in their join message. There is no binding between identity key and display name, and no uniqueness enforcement. A malicious member joining as "Alice" is indistinguishable from the real Alice in the UI.

**Planned mitigation**: Emoji strings (from gap #1) are always visible next to display names in the room info security section. Since emoji are derived from identity keys, spoofed display names will show different emoji — making impersonation visible to anyone who checks. No verified/unverified badge needed; the emoji themselves are the differentiator.

**Priority**: Medium — trivially exploitable, but impact is limited to social engineering within a room where members already have full access to content.

### 6. Timestamp Manipulation in Task Events

**Gap**: Task conflict resolution uses "highest timestamp wins" with client-supplied `Date.now()`. A malicious member can send events with timestamps far in the future, winning every conflict resolution and gaining unilateral control over task state.

**Planned mitigation**: Reject task events with timestamps more than 5 minutes in the future relative to the receiver's clock. Events outside the window are dropped or clamped to current time. Simple, cheap, and eliminates the attack without requiring clock synchronization.

**Priority**: Medium — undermines task store integrity. Easy fix.

### 7. Reconnect Olm Session Divergence

**Gap**: `attemptReconnect()` generates fresh one-time keys and re-joins, but the existing `olmSessions` map is not cleared. Other members' Olm ratchet state diverges from the reconnecting client's state. Key share messages using stale sessions fail, and the catch blocks swallow errors silently — users see no indication that encrypted communication has broken down.

**Planned mitigation**: On reconnect, clear stale Olm sessions and re-establish key exchange with all current members. Surface a transient "Re-establishing encryption..." indicator during re-key. Replace silent catch blocks with user-visible decrypt failure warnings.

**Priority**: High — this affects E2EE reliability under normal network conditions (WiFi drops, mobile switching). Users lose encryption silently.

### 8. Burn Is Authorized By Membership, Not By The Creator

**Risk**: Any member can destroy the room for every other member who is online.

Burn used to be a relay operation. The relay held the creator's identity key and refused a purge from anyone else. Making the relay stateless removed that check, because it removed the state the check read. Burn is now an ordinary encrypted message: a client that receives one over the room's Megolm session deletes its local copy and leaves.

**Why this is accepted rather than fixed**: there is no longer a cryptographic notion of a creator anywhere in the system. `isCreator` is read from a URL parameter and is local to one browser. Restoring creator-only burn means putting durable room state back on the relay, which is the design this project deliberately left, or signing burns against a room key distributed at creation, which does not survive the member set changing.

**Why the exposure is smaller than it looks**: every member can already read everything, and the task list is an event log every member can already write to, so a member who wants to destroy the shared state can do so without a burn. Burn adds the ability to clear other people's *local* copies. It does not reach offline members, and it does not reach anyone's data on a device that is not currently in the room.

**Mitigation path**: if this becomes real, the fix is a signed burn tied to an ed25519 key established at room creation and carried in the invite link, so authorization travels with the link rather than with relay state.

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
