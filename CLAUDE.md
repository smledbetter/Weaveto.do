# CLAUDE.md

weaveto.do — privacy-first, E2E encrypted task coordination. See `docs/` for full documentation.

## Quick Links

- `docs/PROJECT.md` — vision, milestones, success metrics
- `docs/STATE.md` — current project state, what's done, what's next
- `docs/WORKFLOW.md` — sprint workflow, TDD process, quality gates, agent strategy
- `docs/milestones/M{N}-{name}/` — per-milestone plans, acceptance criteria, lessons
- `docs/templates/PLAN-TEMPLATE.md` — implementation plan template (must_haves, waves)

## Research Artifacts

Cached knowledge — load once per session instead of re-discovering:

- `docs/research/SVELTEKIT.md` — Svelte 5 runes, vodozemac quirks, test patterns, build conventions
- `docs/research/CRYPTO.md` — Olm/Megolm flow, HKDF patterns, AES-GCM usage, WebAuthn PRF
- `docs/research/WORKFLOW-PATTERNS.md` — GSD-derived efficiency patterns (waves, atomic commits, context budgets)

## Build & Dev Commands

```bash
npm run dev          # Vite dev server (port 5173)
npm run relay        # WebSocket relay (port 3001)
npm run dev:all      # Both relay + dev server
npm run build        # Production build
npm run check        # svelte-check + TypeScript
npm run test:unit    # Vitest unit tests with coverage
npm run test:e2e     # Playwright E2E tests
```

## Key Architecture

- **Client**: SvelteKit 5 with Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`)
- **Crypto**: vodozemac WASM (Olm/Megolm), WebAuthn PRF, HKDF-SHA256
- **Server**: Node.js WebSocket relay (ciphertext-only routing)
- **Tasks**: Event-sourced store, rides existing `encrypted` message type (zero relay changes)

### Critical Files

| File | Purpose |
|------|---------|
| `src/lib/crypto/engine.ts` | vodozemac WASM wrapper: Olm, Megolm, HKDF |
| `src/lib/room/session.ts` | Room session: WebSocket, key exchange, encrypt/decrypt, task events |
| `src/lib/tasks/store.svelte.ts` | Event-sourced task store with conflict resolution |
| `src/lib/tasks/agent.ts` | Auto-assign pure function (load balance + recency) |
| `server/relay.ts` | WebSocket relay: ciphertext routing, room registry |

### Key Conventions

- No `console.log`/`console.error` in client code (security requirement)
- vodozemac WASM is browser-only (needs `document` for init)
- vodozemac `one_time_keys` returns JS `Map` (not plain object) — use `.get()` / `.forEach()`
- `account.curve25519_key` / `account.ed25519_key` are properties, not methods
- `create_inbound_session` takes 3 args: `(identity_key, message_type, ciphertext)`
- All encryption uses `Uint8Array` for plaintext, `string` for ciphertext
- WebAuthn bypassed in dev via `import.meta.env.DEV` (build-time stripped)
- CSP in `svelte.config.js` with auto-nonces (production only)
- Tasks: highest timestamp wins conflicts, actorId lexicographic tiebreaker
- Duplicate event detection: `taskId:type:timestamp:actorId` key
