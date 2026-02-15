# weave.us

Privacy-first, agent-augmented task coordination for decentralized teams.

Weave.us enables trusted groups — caregiving collectives, event organizers, volunteer networks — to coordinate tasks securely without relying on centralized services. All communication is end-to-end encrypted. No accounts. No tracking. No persistence beyond what's necessary.

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

### M3.5: Built-In Agent — current

Ship a working agent so users get immediate value from the infrastructure.

- Auto-balance WAT agent: assigns unassigned tasks fairly (default-on)
- First-run disclosure toast on initial activation
- Agent description cards with last-run timestamp in AgentPanel

### M4: Task Polish

Describe, sort, and triage tasks more effectively.

- Task descriptions (encrypted, expandable)
- Due date sorting, quick-pick date buttons
- Urgent flag (binary)
- Room-scoped task search

### M5: Burn-After-Use

Automatic data destruction after task completion.

- Rooms auto-delete after all tasks complete (with grace period)
- Manual `/burn` command for immediate destruction
- Ephemeral mode (in-memory only, no persistence)

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
