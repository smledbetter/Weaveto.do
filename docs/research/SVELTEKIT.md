# SvelteKit Patterns & Pitfalls

Verified patterns for weaveto.do. Load this once per session instead of re-discovering.

Last updated: 2026-02-15

## Svelte 5 Runes

- `$state(initialValue)` — reactive state declaration
- `$derived(expression)` — computed values, replaces `$:` reactive statements
- `$effect(() => { ... })` — side effects, runs after DOM update
- `$props()` — component props declaration, replaces `export let`
- `$bindable()` — two-way bindable props
- Component events: use callback props (`onEvent`), not `createEventDispatcher`
- Snippets replace slots: `{#snippet name()}...{/snippet}` + `{@render name()}`
- `$derived` values are proxied — **never mutate in-place** (e.g., `.sort()` on a derived array). Always spread first: `[...derivedArray].sort(...)` or use `.filter()` which creates a new array. Calling `.sort()` directly on a `$derived` proxy silently fails to reorder.

## vodozemac WASM Quirks

- Browser-only: needs `document` for WASM init
- `one_time_keys` returns JS `Map` (not plain object) — use `.get()` / `.forEach()`
- `account.curve25519_key` / `account.ed25519_key` are properties, not methods
- `create_inbound_session` takes 3 args: `(identity_key, message_type, ciphertext)`
- All encryption: `Uint8Array` for plaintext, `string` for ciphertext

## Testing Patterns

- **Vitest + jsdom** for DOM-aware unit tests (default environment)
- **`@vitest-environment node`** needed for `crypto.subtle` tests (jsdom has broken `BufferSource`)
- **Playwright + Chromium** for E2E; WebAuthn bypassed in dev mode
- Coverage: `v8` provider in `vitest.config.ts`, 80%+ threshold enforced
- Mock WebSocket/IndexedDB with `vi.fn()` — no special libraries needed

## Build & Environment

- Node managed via fnm: `/Users/stevo/.local/share/fnm/aliases/default/bin`
- PATH must be set for `npx`/`npm`: `export PATH="/Users/stevo/.local/share/fnm/aliases/default/bin:$PATH"`
- Dev mode: `import.meta.env.DEV` bypasses WebAuthn (build-time stripped)
- CSP in `svelte.config.js` with auto-nonces (production only)
- `wasm-unsafe-eval` in CSP for WASM execution
- Type checking: `npx svelte-check --threshold error`

## Component Conventions

- AgentPanel prop is `activeAgents` (not `activeAgentIds`) — check Props interface
- Task events flow through `handleTaskEvent()` in room page — single entry point
- Mobile layout: tab switching via `mobileTab` state, `class:mobile-hidden` directive
- Theme: `isDark()` + `toggleTheme()` from `$lib/theme.svelte`

## Event Sourcing Pattern

- `TaskEvent` stream applied via `TaskStore.applyEvent()`
- Conflict resolution: highest timestamp wins, actorId lexicographic tiebreaker
- Duplicate detection key: `taskId:type:timestamp:actorId`
- Tasks ride existing `encrypted` message type — zero relay changes
- Agent events use same path, actorId prefixed with `agent:`
