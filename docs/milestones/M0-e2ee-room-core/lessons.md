# M0 Lessons Learned: E2EE Room Core (Alpha)

**Milestone**: M0 — E2EE Room Core
**Pushed**: 2026-02-14
**Scope**: 29 files, ~5,200 lines. Zero-account encrypted rooms with WebAuthn PRF identity, Olm/Megolm crypto, WebSocket relay.

---

## Crypto / WASM

1. **vodozemac `serde_wasm_bindgen` returns JS `Map`, not plain objects.** Rust `BTreeMap` serialized via `serde_wasm_bindgen` becomes a JavaScript `Map`. Code that does `Object.keys(result)` or `result.curve25519` will get `undefined` and crash. Always check `instanceof Map` and use `.get()` / `.forEach()`.

2. **vodozemac identity keys are properties, not methods.** `account.curve25519_key` not `account.curve25519_key()`. The WASM bindings expose them as getters.

3. **WASM modules can inject DOM elements.** vodozemac's WASM binary contains `"Hello from Rust!"` and appends a `<p>` to `document.body` on init. Clean up after `await vodozemac.default()` by removing rogue elements.

4. **Pickle keys need HKDF derivation.** Raw PRF output should not be used directly as a pickle key. Derive a purpose-specific key via HKDF-SHA256 with distinct salt/info strings.

5. **`Uint8Array.buffer` needs casting.** TypeScript strict mode doesn't accept `Uint8Array` directly for `crypto.subtle.importKey` — cast via `seed.buffer as ArrayBuffer`.

## WebSocket Relay

6. **`ws` library: `noServer: true` avoids duplicate upgrade handlers.** Using `new WebSocketServer({ server })` auto-registers an upgrade handler. If you also add `server.on('upgrade', ...)`, you get two handlers competing, causing connection drops (close code 1006). Use `noServer: true` with a single manual `handleUpgrade`.

7. **Room creation needs an explicit `create` flag.** Without it, any URL guess creates a room. The relay should only create rooms when the join message includes `create: true`; otherwise respond with `room_not_found` and close code 4004.

## WebAuthn

8. **Dev-mode bypass must use `import.meta.env.DEV`, not hostname checks.** `hostname === 'localhost'` survives production builds. `import.meta.env.DEV` is a build-time constant that Vite strips entirely from production bundles — zero attack surface.

## Security

9. **Never trust decrypted payload for sender identity.** A malicious sender can put any `sender` field in the encrypted payload. Use the envelope's `senderIdentityKey` (validated by the relay's key registry) for identity, and only use the payload for display name.

10. **Remove all `console.log` from crypto paths.** Debug logging that prints key material, session IDs, or ciphertext is a real leak vector. Strip all console statements from `src/` before shipping.

## SvelteKit / Svelte 5

11. **Svelte 5 reactivity: `$state`, `$derived`, `$effect`, `$props`.** No more `export let` for props — use `let { x } = $props()`. Reactive declarations use `$derived()`. Side effects use `$effect()`. State uses `$state()`.

12. **CSP with SvelteKit: use `svelte.config.js` CSP block, not `hooks.server.ts`.** SvelteKit auto-generates nonces for inline scripts when CSP is configured in the kit config. Manual CSP headers in hooks will conflict.

13. **`wasm-unsafe-eval` is required for WASM.** Standard `unsafe-eval` is too broad. The `wasm-unsafe-eval` CSP directive allows WASM compilation without opening the door to `eval()`.

## Testing (Playwright)

14. **SvelteKit client-side navigation doesn't fire `load` events.** `page.waitForURL()` defaults to waiting for a `load` event, which SvelteKit's `goto()` doesn't trigger. Instead, wait for a DOM element on the target page to become visible.

15. **Headless Chromium can click before hydration.** In headless mode, Playwright clicks the button before SvelteKit hydrates the `onclick` handler. Fix: use `page.goto('/', { waitUntil: 'networkidle' })` and `await expect(btn).toBeEnabled()` before clicking.

16. **Dual `webServer` config for SvelteKit + relay.** Playwright supports an array of `webServer` entries. Use `reuseExistingServer: !process.env.CI` so tests work both with pre-running dev servers and in CI.

## Process

17. **Security audit should happen before PM acceptance testing.** Fixing security issues (debug logging, bypass vectors, trust boundaries) often changes behavior that PM scenarios depend on. Audit first, then validate acceptance criteria.

18. **vodozemac docs are sparse — test empirically.** The WASM bindings have minimal documentation. The only reliable way to understand the API shape (Map vs object, property vs method, pickle format) is to log and inspect at runtime.

---

## Quick Reference: Key Files

| File | Role |
|------|------|
| `src/lib/crypto/engine.ts` | All vodozemac operations, pickle/unpickle, HKDF |
| `src/lib/room/session.ts` | Room lifecycle: connect, key exchange, encrypt/decrypt messages |
| `server/relay.ts` | WebSocket relay, room registry, header stripping |
| `src/routes/room/[id]/+page.svelte` | Room UI, WebAuthn ceremony, message rendering |
| `src/lib/webauthn/prf.ts` | WebAuthn PRF credential creation + assertion |
| `playwright.config.ts` | E2E test config with dual webServer |
