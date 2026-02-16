# weaveto.do

Privacy-first, agent-augmented task coordination for decentralized teams.

weaveto.do enables trusted groups — caregiving collectives, event organizers, volunteer networks — to coordinate tasks securely without relying on centralized services. All communication is end-to-end encrypted. No accounts. No tracking. No persistence beyond what's necessary.

## Project Goals

- **Zero-knowledge relay**: The server only routes ciphertext. It cannot read messages, identify users, or correlate activity.
- **No accounts**: Identity is device-bound via WebAuthn PRF. No emails, no passwords, no social logins.
- **Ephemeral by design**: Encryption keys live in memory only. Close the tab, lose the keys. Rooms auto-delete when empty.
- **Agent automation**: WASM-sandboxed agents handle task splitting, reminders, and load balancing — without accessing plaintext.
- **Self-hostable and federable**: No cloud vendor lock-in. Run your own node, sync with others via encrypted P2P protocols.

## Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| Client UI | Svelte 5 / SvelteKit | Reactive UI with server-side rendering |
| Crypto | vodozemac (WASM) | Olm/Megolm E2EE — same protocol as Matrix |
| Identity | WebAuthn PRF | Device-bound identity, no accounts |
| Relay Server | Node.js + ws | WebSocket relay, zero plaintext inspection |
| Build | Vite | Dev server, HMR, production builds |
| Type Safety | TypeScript | End-to-end type checking |

### Key Dependencies

All open source. Zero paid APIs.

| Package | License | Role |
|---------|---------|------|
| `vodozemac-wasm-bindings` | Apache 2.0 | Olm/Megolm encryption via WASM |
| `@simplewebauthn/browser` | MIT | WebAuthn client-side ceremonies |
| `ws` | MIT | WebSocket server |
| `svelte` | MIT | UI framework |
| `vite` | MIT | Build toolchain |

## Milestones

### M0: E2EE Room Core ✓

Encrypted rooms with zero-account join and real-time messaging.

- Create an encrypted room with one click
- Share a link for others to join
- WebAuthn PRF ceremony derives device-bound crypto identity
- Olm key exchange between members, Megolm group encryption for messages
- Server relays only ciphertext — zero plaintext, zero IP logging

### M1: Task Management ✓

Create, assign, and automate tasks with privacy-preserving agents.

- Event-sourced task store with conflict resolution
- Task creation via modal and `/task` command, subtask support
- Auto-assignment based on member load and recency
- Encrypted reminders for approaching deadlines

### M2: Task Intelligence ✓

Dependencies, natural language dates, and productivity features.

- Task dependencies with DAG validation (cycle detection)
- Natural language due dates ("tomorrow", "next friday", "in 3 hours")
- Service worker reminders (survive tab close)
- Progress visibility, keyboard shortcuts, inline editing

### M3: Agent Infrastructure ✓

WASM sandboxing for user-uploaded agent modules.

- Upload and run custom WASM agent modules (raw WebAssembly API, zero dependencies)
- Host function imports: read tasks, emit events, persist state
- AES-256-GCM encrypted persistent state per agent
- Security hardened: hash verification, memory isolation, circuit breaker, bounds checking

### M3.5: Built-In Agent ✓

Ship a working agent so users get immediate value from the infrastructure.

- Auto-balance WAT agent: assigns unassigned tasks fairly (default-on)
- First-run disclosure toast on initial activation
- Agent description cards with last-run timestamp in AgentPanel

### M4: Task Polish ✓

Describe, sort, and triage tasks more effectively.

- Task descriptions (encrypted, displayed below titles)
- Due date sorting (3-state toggle), quick-pick date buttons (Today/Tomorrow/Next Week)
- Urgent flag (binary toggle, text badge, sorts urgent-first)
- Room-scoped task search (real-time filter on title + description)

### M5: Burn-After-Use ✓

Automatic data destruction after task completion.

- Auto-deletion: 24h grace period after all tasks complete (cancellable countdown banner)
- Manual `/burn` command with type-to-confirm friction (creator-only)
- Ephemeral mode: zero persistence, flame indicator, auto-purge on last disconnect
- 6-layer client cleanup orchestrator (session, sessionStorage, 3× IndexedDB, service worker)

### M5.5: UX Polish

Onboarding clarity, room identity, and mode explanations so new users can understand and navigate the app without prior context.

**Wave 1: First Impressions**
- Named room modes: "Standard" vs "Ephemeral" with radio buttons and use-case guidance
- Better onboarding copy on Join Room page (context for invited users, friendlier auth language)
- Agent panel explainer text (what agents are, where to find custom agents, more defaults coming)

**Wave 2: Room Identity**
- Memorable 2-word room names derived from hash (e.g. "swift-falcon")
- Shortened URLs (`/swift-falcon` instead of `/room/[hex hash]`)
- Show user's own display name in room header
- Join page shows room name instead of generic "Join Room"

### M6: Session Security

PIN-based endpoint compromise containment. If one member's device is compromised, the attacker can't access future room content after key rotation.

**Wave 1: PIN Setup & Key Derivation**
- Optional 6-digit PIN during room join (creator can require for all members)
- PIN → PBKDF2-SHA256 (600K iterations) → 256-bit PIN key (zero new dependencies)
- PIN key stored encrypted under PRF-derived key in IndexedDB
- Creator policy: "Require PIN for all members" (encrypted room metadata)

**Wave 2: Session Gating**
- PIN required on reconnect (after disconnect, browser restart, or inactivity timeout)
- Configurable inactivity timeout (5/15/30 min) clears Megolm keys from memory
- Lock overlay with blurred room content and PIN entry
- Rate limiting: 3 failures → 30s wait, exponential backoff, 10 failures → session cleared

**Wave 3: Megolm Key Rotation with PIN Gating**
- New session keys encrypted under each member's PIN-derived key
- Creator-forced rotation ("Rotate keys now" when compromise suspected)
- Members without valid PIN can't decrypt new session keys
- Forget PIN → rejoin as new identity (no recovery codes, preserves no-account model)

### M7: Agent Hardening

Harden the agent infrastructure with true preemption, module signatures, and runtime improvements.

- Web Worker preemption for WASM execution (replace main-thread timeout)
- Ed25519 module signature verification
- Agent event validation against known taskIds

### M8: Penetration Testing

Security penetration testing across all shipped milestones.

- E2EE protocol audit
- WebAuthn PRF identity testing
- WASM sandbox escape testing
- Relay server hardening
- Client-side crypto review

### M9: Encrypted Notifications

Privacy-preserving notifications so members know when tasks are assigned or due, even with the browser closed. Zero plaintext in any notification payload.

**Wave 1: Expanded Service Worker Notifications**
- Notify on task assignment ("You have a new task in [room-name]")
- Notify on task status changes for owned tasks
- Notification grouping (batch multiple events into one)
- All payloads generic — no task titles, member names, or content

**Wave 2: Local Notification Rules**
- Per-room notification toggle (enable/disable)
- Urgency filter (only notify for urgent tasks)
- Do Not Disturb mode (1h / until tomorrow / custom)
- Moon icon in room header when DND active

**Wave 3: Web Push API (Encrypted)**
- Web Push API with VAPID (RFC 8291 — browser-standard encrypted push)
- Relay sends encrypted push on room events (ciphertext only)
- Push subscription stored locally, endpoint registered with relay
- Subscription cleanup on room destruction (burn/auto-delete/ephemeral purge)
- Just-in-time permission prompt (no nagging if denied)

### M10: Offline & Sync

Work offline and sync when reconnected.

- IndexedDB-backed offline task store
- Conflict resolution on reconnect
- Optimistic UI updates

## Development

```sh
# Install dependencies
npm install

# Start both the relay server and dev server
npm run dev:all

# Or run them separately:
npm run relay    # WebSocket relay on port 3001
npm run dev      # Vite dev server on port 5173

# Type check
npm run check

# Production build
npm run build
```

## Architecture

```
CLIENT (Svelte 5 / SvelteKit)
├── WebAuthn PRF Module      — device-bound identity via PRF seed
├── Crypto Engine (vodozemac) — Olm accounts, Megolm sessions, HKDF key derivation
├── Room Session Manager      — WebSocket connection, key exchange, message pipeline
├── Message Padding           — PKCS#7 padding to 256-byte blocks (metadata minimization)
└── Room UI                   — create, join, message, encryption indicators

SERVER (Node.js)
├── WebSocket Relay           — route ciphertext between room members
├── Room Registry             — in-memory map of room ID to connected clients
├── Input Validation          — strict schema checks on all messages
└── Header Stripping          — remove fingerprinting headers on upgrade
```

### Security Properties

- All messages encrypted client-side with Megolm before transmission
- Olm (Double Ratchet) used for 1:1 key exchange between members
- PRF seed derives pickle key via HKDF-SHA256 for identity continuity
- Message padding prevents length-based traffic analysis
- Server stores zero plaintext, zero IP addresses, zero analytics
- CSP headers with auto-nonces in production builds
- All user-visible text rendered as escaped text nodes (no innerHTML)

## License

All dependencies are MIT or Apache 2.0 licensed.
