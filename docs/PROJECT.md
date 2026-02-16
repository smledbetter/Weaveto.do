# weaveto.do

Privacy-first, agent-augmented task coordination for decentralized teams. End-to-end encrypted rooms with zero accounts, powered by WebAuthn PRF identity and vodozemac (Olm/Megolm) cryptography.

## Vision

weaveto.do enables trusted groups — caregiving collectives, event organizers, volunteer networks — to coordinate tasks securely and efficiently without relying on centralized services.

All communication and task data remain private by default: end-to-end encryption, minimal metadata, ephemeral state. Automation is handled by lightweight, sandboxed agent teams that act on behalf of users without ever accessing plaintext.

No accounts, no tracking, no persistence beyond what's necessary.

## Unique Value Proposition

- **E2E encrypted by default** — all data encrypted client-side; servers only relay ciphertext
- **No user accounts or identifiers** — access via secure links and WebAuthn
- **Agent teams** — WASM-based modules automate task splitting, reminders, and load balancing
- **Ephemeral by design** — rooms and tasks auto-delete on completion
- **Federated hosting** — users can self-host or join community-run nodes
- **No mobile apps or telemetry** — web-only, works in private browsers

## Milestones

| Milestone | Name | Status | Description |
|-----------|------|--------|-------------|
| M0 | E2EE Room Core | Complete | Encrypted rooms, WebAuthn PRF, WebSocket relay, messaging |
| M1 | Task Management | Complete | Event-sourced tasks, auto-assign agent, in-tab reminders |
| M2 | Task Intelligence | Complete | Natural language dates, task dependencies, progress visibility, service worker reminders, keyboard shortcuts, inline editing |
| M3 | Agent Infrastructure | Complete | WASM agent sandboxing, persistent encrypted state, agent module upload, security hardening |
| M3.5 | Built-In Agent | Complete | Auto-balance WAT agent (default-on), first-run toast, built-in badge, binary host helpers |
| M4 | Task Polish | Complete | Task descriptions, due date sorting, quick-pick dates, urgent flag, room search |
| M5 | Burn-After-Use | Complete | Auto-deletion (24h grace period), manual `/burn` (creator-only), ephemeral mode, 6-layer cleanup |

See `docs/milestones/M{N}-{name}/` for per-milestone plans, acceptance criteria, and lessons learned.

## Non-Functional Requirements

| Category | Requirement |
|----------|-------------|
| Security | E2EE via Olm/Megolm (-> MLS), WebAuthn for key derivation, no plaintext on server |
| Privacy | No user IDs, no IP logging, no analytics, no tracking |
| Availability | Works offline; sync resumes when online |
| Performance | <500ms crypto ops in browser; agent startup <1s |
| Compliance | Designed to meet GDPR, CCPA data minimization principles |

## Success Metrics

| Metric | Target |
|--------|--------|
| Time to first encrypted message | <15 seconds |
| Agent task assignment accuracy | >90% (distribution variance <=1) |
| Room creation to deletion (avg) | 7 days |
| Client-side crypto failure rate | <0.1% |
| Federated sync latency (P95) | <2s |

## Out of Scope

- Mobile applications
- Email/SMS notifications
- File attachments (future)
- Voice/video calling
- Public directories or search
