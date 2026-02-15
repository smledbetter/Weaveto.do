# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project

Weave.us — privacy-first, agent-augmented task coordination for decentralized teams. End-to-end encrypted rooms with zero accounts, powered by WebAuthn PRF identity and vodozemac (Olm/Megolm) cryptography.

## Build & Dev Commands

- `npm run dev` — start Vite dev server (port 5173)
- `npm run relay` — start WebSocket relay server (port 3001)
- `npm run dev:all` — start both relay and dev server
- `npm run build` — production build
- `npm run check` — TypeScript and Svelte type checking
- `npm run preview` — preview production build

## Architecture

### Client (Svelte 5 / SvelteKit)

- `src/lib/crypto/engine.ts` — Crypto engine wrapping vodozemac WASM. Olm accounts, Megolm sessions, pickle/unpickle with HKDF-derived keys. All operations browser-only.
- `src/lib/crypto/padding.ts` — PKCS#7 message padding to 256-byte blocks for metadata minimization.
- `src/lib/webauthn/prf.ts` — WebAuthn PRF ceremony for device-bound identity. Derives seed used for Olm account pickle key. Uses `localhost` as rpId in dev.
- `src/lib/room/session.ts` — Room session manager. Coordinates WebSocket, Olm key exchange, Megolm key sharing, encrypted messaging. Accepts PRF seed and isCreator flag.
- `src/routes/+page.svelte` — Homepage. "New Room" button generates random room ID, navigates to `/room/{id}?create=1`.
- `src/routes/room/[id]/+page.svelte` — Room view with phases: name entry, auth, connecting, connected, error. Handles WebAuthn ceremony (skipped in dev via `import.meta.env.DEV`).

### Server (Node.js)

- `server/relay.ts` — WebSocket relay. Routes ciphertext between room members. Validates all messages against strict schemas. Strips fingerprinting headers. Uses `noServer` mode with manual `handleUpgrade`. Rooms only created when join message includes `create: true`.

### Data Flow

- **Room Creation**: Homepage → generate room ID → navigate to `/room/{id}?create=1` → WebAuthn PRF → derive pickle key → create Olm account → pickled with PRF key → WebSocket JOIN with `create: true` → relay creates room
- **Room Join**: Open link → WebAuthn PRF → Olm account → WebSocket JOIN → relay sends member list → existing members create Olm sessions → share Megolm key via Olm
- **Messaging**: Type → JSON payload → PKCS#7 pad → Megolm encrypt → WebSocket send → relay broadcasts ciphertext → recipients Megolm decrypt → unpad → render

### Key Conventions

- vodozemac WASM is browser-only (calls `main()` which needs `document`)
- vodozemac `one_time_keys` returns JS `Map` objects (serde_wasm_bindgen), not plain objects — use `Map.get()` and `Map.forEach()`
- `account.curve25519_key` and `account.ed25519_key` are readonly properties, not methods
- `create_inbound_session` takes 3 args: `(identity_key, message_type, ciphertext)`
- All encryption/decryption uses `Uint8Array` for plaintext, `string` for ciphertext
- No `console.log`/`console.error` in client code (security auditor requirement)
- CSP configured in `svelte.config.js` with auto-nonces (only applies in production builds)
- WebAuthn bypassed in dev mode via `import.meta.env.DEV` (build-time stripped)
