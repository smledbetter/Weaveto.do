# M0 Plan: E2EE Room Core

Status: **Complete**

## Scope

Secure, ephemeral rooms for encrypted messaging. Zero accounts, zero plaintext on server.

## Key Components

| File | Purpose |
|------|---------|
| `src/lib/crypto/engine.ts` | vodozemac WASM wrapper: Olm accounts, Megolm sessions, HKDF key derivation |
| `src/lib/crypto/padding.ts` | PKCS#7 message padding to 256-byte blocks |
| `src/lib/webauthn/prf.ts` | WebAuthn PRF ceremony for device-bound identity |
| `src/lib/room/session.ts` | Room session: WebSocket, Olm key exchange, Megolm encrypt/decrypt |
| `server/relay.ts` | WebSocket relay: ciphertext routing, room registry, header stripping |
| `src/routes/+page.svelte` | Homepage with "New Room" button |
| `src/routes/room/[id]/+page.svelte` | Room UI: auth, connect, chat phases |

## Design Decisions

1. **vodozemac WASM** for Olm/Megolm — same algorithms as Matrix, Rust implementation
2. **WebAuthn PRF** for key derivation — device-bound identity, no passwords
3. **HKDF-SHA256** for pickle keys — purpose-specific derivation from PRF seed
4. **noServer WebSocket** — single manual `handleUpgrade` to avoid duplicate handlers
5. **Explicit room creation** — `create: true` flag required, no URL guessing
6. **Dev-mode WebAuthn bypass** — `import.meta.env.DEV` (build-time stripped)

## Data Flow

1. Homepage -> generate room ID -> navigate to `/room/{id}?create=1`
2. WebAuthn PRF -> derive pickle key -> create Olm account
3. WebSocket JOIN with `create: true` -> relay creates room
4. Members create Olm sessions -> share Megolm key via Olm
5. Messages: JSON -> PKCS#7 pad -> Megolm encrypt -> relay broadcast -> decrypt -> render
