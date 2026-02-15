---
name: weave-architect
description: Architectural blueprint for weave.us — E2EE task coordination with agent teams, no accounts, burn-after-use.
---

## Core Principles

1. **Zero-Knowledge by Default** — All data encrypted client-side. No plaintext on server or agent.
2. **Architectural Privacy** — Privacy enforced by design, not policy. No trust in infrastructure.
3. **Ephemeral by Design** — Tasks and rooms auto-delete on completion. Keys wiped.
4. **User Sovereignty** — No accounts. Identity via WebAuthn PRF. Self-hosted or federated.
5. **Minimal Trust** — Nodes store encrypted shards. No single point of control.
6. **Cheapest Appropriate Model** — Haiku for mechanical work, sonnet for logic, opus for security only.
7. **Open Source First (Runtime)** — Runtime product agents use local open-source models. Dev-time uses Claude.
8. **No Fake Timelines** — Phases and dependencies, not dates or durations.

## System Layers

| Layer | Components | Responsibilities |
|------|------------|------------------|
| **Client** | Svelte, WebAuthn, vodozemac | Key generation, E2EE, UI |
| **Agents** | WebContainer (WASM), Noise Pipes | Auto-assign, reminders, cleanup |
| **Federation** | Matrix-like P2P sync | Shard routing, Merkle-verified consistency |
| **Hosting** | Node.js, Docker, VM | No long-term storage, no IP logs |

## Security Invariants

- **E2EE**: Olm/Megolm -> MLS. Keys ratcheted per message.
- **Authentication**: WebAuthn PRF only. No recovery.
- **Metadata Protection**: Rotating pseudonyms, traffic padding, no IP logging.
- **Burn-After-Use**: On completion or TTL expiry, wipe keys, state, and URL.

## Agent Contracts

- **TaskSplitter**: Decompose task -> subtasks (WASM sandbox)
- **LoadBalancer**: Assign based on client-side availability
- **ReminderAgent**: Send encrypted reminders (no cloud scheduling)
- **CleanupAgent**: Enforce burn — terminate agents, wipe keys

## Threat Model

| Adversary | Mitigation |
|---------|----------|
| Malicious node | E2EE, client-verified sync |
| Compromised agent | WASM sandbox, no persistent state |
| Device theft | WebAuthn PRF, no key export |
| Traffic analysis | Padding, batched sends, no IP logs |

## Quality Gates

- Unit test coverage >= 80% (Vitest + v8)
- All Playwright E2E tests pass (Chromium)
- TDD: failing test first, implement, verify coverage
- Security review (opus) for any crypto or sandbox changes
- `npm run check` (svelte-check) passes with zero errors

## Usage

Validate against principles when designing: E2EE flows, agent behavior, privacy guarantees, burn-after-use enforcement.
