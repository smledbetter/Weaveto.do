# Roadmap

*Last updated: 2026-09-01.*

## Current State

- **Git SHA**: `c6b5103` on `main`, CI green
- **Unit tests**: 1,064 across 64 files, Vitest on jsdom
- **E2E tests**: 261 across 34 files, Playwright. CI runs 5 browser projects plus a production-build job
- **Coverage**: 60.7% lines, 46% branches
- **Lint**: `npm run check` passes with 0 errors and 25 warnings
- **Build**: `npm run build` passes
- **Milestones complete**: M0 through M19, 21 shipped, plus an unnumbered production phase
- **LOC**: 41,249 total. 15,795 client, 1,998 relay, 23,456 tests
- **Production dependencies**: 3
- **Issues**: 69 closed, 10 open
- **Deployment**: relay on Fly, client on Vercel, MIT licensed

## Completed Milestones

### Pre-Flowstate

- ~~M0: E2EE Room Core~~ — WebAuthn PRF, vodozemac Olm/Megolm, WebSocket relay
- ~~M1: Task Management~~ — Event-sourced store, auto-assign, subtasks, reminders
- ~~M2: Task Intelligence~~ — Dependencies, natural language dates, keyboard shortcuts
- ~~M3: Agent Infrastructure~~ — WASM sandbox, encrypted state, host functions, circuit breaker
- ~~M4: Built-In Agents~~ — WAT auto-balance agent, built-in registry
- ~~M5: Task Polish~~ — Descriptions, sorting, urgent flag, search
- ~~M6: Burn-After-Use~~ — Auto-deletion, manual burn, ephemeral mode. The relay purge step was removed when the relay became stateless, and burn became an encrypted message between members.
- ~~M7: Session Security~~ — PIN gate, PBKDF2, session lock, key rotation
- ~~M8: Agent Hardening~~ — Web Worker preemption, Ed25519 signatures, event validation

### Flowstate Sprints

*Numbering caveat: the list above collapses `M3.5` into `M4` and omits `M5.5`, so from that point it runs one ahead of the `docs/milestones/` directory names. `M9: Vulnerability Scanning` below is the directory `M8-vulnerability-scanning`. The two schemes agree again from `M11`. See `docs/STATE.md` for the mapping.*


- ~~M9: Vulnerability Scanning~~ ✅ (Sprint 1) — Security audit across all shipped milestones. 2 critical, 9 high, 18 medium findings. All critical + high fixed. Security report: `docs/milestones/M8-vulnerability-scanning/SECURITY-REPORT.md`
- ~~M10: UX & Accessibility~~ ✅ (Sprint 2) — Header decluttered, coach marks, ARIA fixes, focus-visible rings, connection status label, task empty-state prompt. +13 unit tests.
- ~~M11: Reconnect & Hardening~~ ✅ (Sprint 3) — Stale Olm session clearing on reconnect, re-establishment tracking with UI indicator, timestamp clamping (5-min future window), OTK replenishment (threshold-based). +27 unit tests.
- ~~M12: Mobile UX Improvements~~ ✅ (Sprint 4) — Banner consolidation into CoachMarks walkthrough, MobileNav bottom navigation (Chat/Tasks/Auto), background color fix. +22 unit tests. 1 dev dependency added (@testing-library/svelte).
- ~~M13: Mobile Identity Persistence~~ ✅ (Sprint 5) — IndexedDB-encrypted identity seed store (AES-GCM-256 via HKDF), PRF-first fallback chain in joinRoom(), cleanup integration, PIN compatibility for IDB-persisted seeds. +16 unit, +11 E2E tests. Production integration test suite.
- ~~M14: Local Notifications~~ ✅ (Sprint 6) — Contextual opt-in banner, NotificationBell popover with toggle + quiet hours, SW quiet-hours enforcement, notification triggers (assignment, status change), IndexedDB prefs store, cleanup integration. Removed silent requestPermission (H7 violation). +48 unit, +7 E2E tests. Delegation ratio improved 4.9% → 43.0%.
- ~~M15: Trust & Verification~~ ✅ (Sprint 7) — Emoji key verification (SHA-256 sorted keys → 5 emoji per member pair, ambient in room info). Member revocation via room migration (kick → new room, task state preserved, banner shown). Message delivery confirmation (per-sender sequence counters inside encrypted payload, shield icon green/amber). +19 unit, +13 E2E tests. Gates first pass. Delegation ratio 58.6%.
- ~~M16: Web Push~~ ✅ (Sprint 8) — VAPID JWT signing (ES256 via Node.js crypto, env-configured keys), relay push dispatch (in-memory subscription store, /vapid-key endpoint, push to offline clients), client push manager (IDB subscription store, subscribeToPush/unsubscribe), SW push handler (quiet hours, generic body), push toggle in NotificationBell, cleanup integration. Zero new dependencies. +38 unit, +6 E2E tests. Gates first pass. Delegation ratio 64.4%.
- ~~M17: Offline Task Store~~ ✅ (Sprint 9) — Encrypted IDB task snapshots + event queue (AES-GCM-256 via HKDF), unified ConnectionIndicator (Connected/Reconnecting/Offline/Offline·N pending), offline task creation with sync dot indicator, event replay on reconnect, TaskStore snapshot/loadSnapshot methods, cleanup integration. +30 unit, +7 E2E tests. Gates first pass. Delegation ratio 46.9%.
- ~~M18: Sync and Conflict Resolution~~ ✅ (Sprint 10) — TaskStore event log with 24h sync window, session sync methods (sendSyncEvents via Megolm channel), reconnect sync flow (send history → wait → replay pending), ConnectionIndicator "Syncing..." state, conflict convergence (timestamp+actorId rules). +19 unit, +10 E2E tests. Gates first pass. Fastest sprint (4m 59s). Delegation ratio 51.7%.
- ~~M19: Multi-Room Tabs~~ ✅ (Sprint 11) — TabSync BroadcastChannel module for cross-tab coordination, cross-tab PIN lock broadcast with infinite-loop prevention, tab-aware cleanup (deregister on destroy), room page integration (TabSync lifecycle). Per-tab Olm/Megolm isolation (no cross-tab key sharing). Zero new dependencies. +36 unit, +6 E2E tests. Gates first pass. Delegation ratio 28.0%.

---

## Production Hardening (post-M19)

The numbered milestones ended at M19 and the app worked. What followed is roughly twenty merged pull requests with no milestone number, because it was not feature work. It divides in two.

### Making it survive production

- **Stateless relay** (#77). Room state was held in the relay process, so every deploy destroyed every live room. The relay now rebuilds room membership from what reconnecting clients tell it.
- **Bounded fan-out** (#78). A full room cost every other room. Fan-out gained backpressure on `bufferedAmount` and terminates a socket that will not drain. At 5,000 connections in full rooms this took delivery from 63% to 100%, p95 latency from 9,468 ms to 1,544 ms, and peak memory from 463 MiB to 238 MiB. Attribution matters: the cap cut did nearly all of it, and backpressure never fired in that run.
- **Multi-member key exchange**. Rooms of three or more had a member who could never decrypt. Every existing member claimed the same single-use one-time key, so the first key share consumed it and the rest failed inside a silent catch. It survived nineteen milestones because the only multi-member test always involved the room creator, who was never the member that failed. Now covered by a full-mesh suite over 2, 3, 4, and 5 members.
- **Relay container, heartbeat, graceful shutdown, real client IP**. The relay builds, boots, and is probed in CI.
- **Capacity measured, not estimated**. `docs/CAPACITY.md` records the before and after, states which change caused which improvement, and lists what cannot be measured from here.
- **Per-address cap raised to 50, with an honest refusal message** (#90).

### Making the claims true

The README was audited line by line against the code. Where the two disagreed, whichever was wrong got fixed.

- **Display names left the wire** (#81). They had travelled in clear text and now sit inside the Olm payload.
- **Per-room identity** (#83). The PRF salt was a constant, so one device had one identity across every room. It is now per-room, and the relay cannot correlate two rooms to one device.
- **Blind SSRF closed** (#80). Push endpoints were unvalidated. They are now checked against an allow-list of schemes and hosts, with DNS resolution pinned so the socket connects to the address that was checked.
- **Push is contentless** (#85, and the M16 design). The relay sends no payload at all. The service worker composes a fixed generic string locally.
- **Custom agent upload left the UI** (#87). The control existed and nothing behind it worked. It moved to the roadmap, guarded by a test that keeps it out until it ships.
- **Documentation corrected** (#84, #86, #88). Claims that could not be supported were removed or rewritten, and a "Planned, not built" section was added.

## Upcoming

### M20 — Tor Hidden Service (deployment)

Run the relay as an optional .onion hidden service alongside the normal endpoint. Closes the IP metadata gap for users who need metadata protection without affecting the default experience.

- Tor hidden service configuration for the relay (deployment-only)
- .onion hostname serves identical client pre-configured for the .onion relay — navigate to it in Tor Browser and it just works, no settings field
- Self-hosters: `?relay=wss://custom.example` URL parameter for custom relay endpoints (no UI surface, documented in self-hosting docs)
- Documentation for self-hosters to enable .onion alongside clearnet

**Done when**: Relay is reachable via .onion address. .onion client auto-configures without user input. Self-hosting docs cover Tor setup and `?relay=` parameter.

### Backlog

Filed and tracked, not scheduled.

| Issue | Item | Blocked on |
|-------|------|------------|
| [#92](https://github.com/smledbetter/Weaveto.do/issues/92) | Federation between independently run nodes | Design, no sync protocol exists |
| [#93](https://github.com/smledbetter/Weaveto.do/issues/93) | A supported path to load custom agents | Developer tooling and a trust decision |
| [#94](https://github.com/smledbetter/Weaveto.do/issues/94) | Enforce the per-address cap only under pressure | Nothing |
| [#95](https://github.com/smledbetter/Weaveto.do/issues/95) | Privacy policy | A contact address |
| [#96](https://github.com/smledbetter/Weaveto.do/issues/96) | `SECURITY.md` and `security.txt` | A contact address |
| [#97](https://github.com/smledbetter/Weaveto.do/issues/97) | Point `weaveto.do` at the app | #95 and #96 |
| [#69](https://github.com/smledbetter/Weaveto.do/issues/69) | Mobile pinch-zoom ejects the user from the room | A physical iOS device |

`#69` is the only open bug. The auto-zoom that triggers it is fixed and tested. The ejection has no diagnosis that held up, and it cannot be reproduced in CI because Playwright's WebKit is not iOS Safari.
