# Crypto Patterns & Conventions

Verified cryptographic patterns for Weave.us. Load this once per session.

Last updated: 2026-02-15

## Olm/Megolm Key Exchange Flow

1. **Identity**: WebAuthn PRF ceremony derives device-bound seed
2. **Olm Account**: Created from PRF seed, generates Curve25519 + Ed25519 key pairs
3. **One-Time Keys**: Pre-published for forward secrecy; consumed on first message
4. **Olm Session**: Established per-peer via `create_outbound_session` / `create_inbound_session`
5. **Megolm Session**: Group encryption for room messages; rotated periodically
6. **Message Flow**: plaintext -> Megolm encrypt -> Olm encrypt (per recipient) -> relay

## HKDF Key Derivation

- All key derivation uses `HKDF-SHA256` via `crypto.subtle`
- Import PRF seed as HKDF base key material
- Salt: purpose-specific string (e.g., `"weave-agent-state-v1"`)
- Info: scope string (e.g., `"agent-state:" + moduleId`)
- Output: 256-bit AES key

```typescript
// Pattern for deriving scoped keys
const baseKey = await crypto.subtle.importKey("raw", seed, "HKDF", false, ["deriveKey"]);
const derived = await crypto.subtle.deriveKey(
  { name: "HKDF", hash: "SHA-256", salt: encode(salt), info: encode(info) },
  baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]
);
```

## AES-256-GCM Usage

- **IV**: Random 12 bytes per encryption (`crypto.getRandomValues`)
- **Never reuse IVs** with the same key — random generation prevents this
- **Storage format**: `{ iv: base64, ciphertext: base64 }` in IndexedDB
- **Authentication**: GCM provides built-in authentication — tampered ciphertext fails
- **Max size**: 1MB per agent state blob (enforced before encryption)

## WebAuthn PRF Ceremony

- `createCredential()`: New device registration, returns PRF seed
- `assertWithPrf(credentialId)`: Existing device login, returns PRF seed
- Stored credential ID in localStorage (`getStoredCredentialId()`)
- Dev mode bypasses WebAuthn entirely — identity is random per session
- PRF seed is the root of all key derivation — never stored, never transmitted

## Security Rules

- No `console.log`/`console.error` in client code (may leak sensitive data)
- Agent never sees room keys — only host function imports exposed
- Host-pull model: sandbox reads data via imports, host never writes to sandbox memory
- Eager key derivation: derive CryptoKey at activation, discard raw seed
- All encryption uses `Uint8Array` for plaintext, `string` for ciphertext (vodozemac convention)
- Relay server is ciphertext-only — no plaintext, no metadata beyond room membership
