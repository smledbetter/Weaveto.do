/**
 * Crypto engine wrapping vodozemac WASM.
 * Handles Olm accounts, Olm 1:1 sessions, and Megolm group sessions.
 * All operations are client-side only — no plaintext leaves the browser.
 */

import type {
  Account as OlmAccount,
  Session as OlmSession,
  GroupSession as MegolmOutbound,
  InboundGroupSession as MegolmInbound,
} from "vodozemac-wasm-bindings";

let vodozemac: typeof import("vodozemac-wasm-bindings");
let initialized = false;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function initCrypto(): Promise<void> {
  if (initialized) return;
  vodozemac = await import("vodozemac-wasm-bindings");
  await vodozemac.default();
  initialized = true;
}

function ensureInit() {
  if (!initialized)
    throw new Error("Call initCrypto() before using crypto operations");
}

// --- Olm Account ---

export function createAccount(): OlmAccount {
  ensureInit();
  return new vodozemac.Account();
}

/**
 * Pickle (serialize) an account, protected by a key derived from the PRF seed.
 * The pickle key ensures only the device with the PRF output can restore the identity.
 */
export function pickleAccount(
  account: OlmAccount,
  pickleKey: Uint8Array,
): string {
  return account.pickle(pickleKey);
}

/**
 * Unpickle (restore) an account from a previously pickled string.
 * Returns the same cryptographic identity as when it was pickled.
 */
export function unpickleAccount(
  pickle: string,
  pickleKey: Uint8Array,
): OlmAccount {
  ensureInit();
  return vodozemac.Account.from_pickle(pickle, pickleKey);
}

/**
 * Derive a 32-byte pickle key from a PRF seed using HKDF-SHA256.
 */
export async function derivePickleKey(seed: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    seed.buffer as ArrayBuffer,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("weave.us-pickle-key-v1"),
      info: encoder.encode("olm-account-pickle"),
    },
    keyMaterial,
    256,
  );
  return new Uint8Array(bits);
}

export function getIdentityKeys(account: OlmAccount): {
  curve25519: string;
  ed25519: string;
} {
  return {
    curve25519: account.curve25519_key,
    ed25519: account.ed25519_key,
  };
}

export function generateOneTimeKeys(account: OlmAccount, count: number): void {
  account.generate_one_time_keys(count);
}

export function getOneTimeKeys(account: OlmAccount): Record<string, string> {
  const raw = account.one_time_keys;

  // Helper: convert Map or plain object to Record<string, string>
  const toRecord = (val: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    if (val instanceof Map) {
      (val as Map<unknown, unknown>).forEach((v, k) => {
        out[String(k)] = String(v);
      });
    } else if (val && typeof val === "object") {
      for (const [k, v] of Object.entries(val)) {
        out[k] = String(v);
      }
    }
    return out;
  };

  let keys: unknown = raw;
  if (typeof keys === "string") {
    keys = JSON.parse(keys);
  }

  // serde_wasm_bindgen serializes Rust BTreeMap as JS Map, not plain object.
  // vodozemac returns { curve25519: { key_id: key_value } } where each level
  // may be a Map or a plain object depending on the wasm-bindgen version.
  if (keys instanceof Map) {
    const curve = (keys as Map<string, unknown>).get("curve25519");
    if (curve) return toRecord(curve);
    return toRecord(keys);
  }

  if (keys && typeof keys === "object") {
    const obj = keys as Record<string, unknown>;
    if ("curve25519" in obj) return toRecord(obj.curve25519);
    return toRecord(keys);
  }

  return {};
}

export function markKeysAsPublished(account: OlmAccount): void {
  account.mark_keys_as_published();
}

// --- Olm Sessions (1:1 key exchange) ---

export function createOutboundSession(
  account: OlmAccount,
  theirIdentityKey: string,
  theirOneTimeKey: string,
): OlmSession {
  ensureInit();
  return account.create_outbound_session(theirIdentityKey, theirOneTimeKey);
}

export interface OlmEncryptedMessage {
  messageType: number;
  ciphertext: string;
}

export function createInboundSession(
  account: OlmAccount,
  theirIdentityKey: string,
  message: OlmEncryptedMessage,
): { session: OlmSession; plaintext: string } {
  ensureInit();
  const result = account.create_inbound_session(
    theirIdentityKey,
    message.messageType,
    message.ciphertext,
  );
  return {
    session: result.session,
    plaintext: decoder.decode(result.plaintext),
  };
}

export function olmEncrypt(
  session: OlmSession,
  plaintext: string,
): OlmEncryptedMessage {
  const encrypted = session.encrypt(encoder.encode(plaintext));
  return {
    messageType: encrypted.message_type,
    ciphertext: encrypted.ciphertext,
  };
}

export function olmDecrypt(
  session: OlmSession,
  message: OlmEncryptedMessage,
): string {
  const decrypted = session.decrypt(message.messageType, message.ciphertext);
  return decoder.decode(decrypted);
}

// --- Megolm Group Sessions ---

export function createGroupSession(): MegolmOutbound {
  ensureInit();
  return new vodozemac.GroupSession();
}

export function getGroupSessionKey(session: MegolmOutbound): string {
  return session.session_key;
}

export function getGroupSessionId(session: MegolmOutbound): string {
  return session.session_id;
}

export function createInboundGroupSession(sessionKey: string): MegolmInbound {
  ensureInit();
  return new vodozemac.InboundGroupSession(sessionKey);
}

export function megolmEncrypt(
  session: MegolmOutbound,
  plaintext: string,
): string {
  return session.encrypt(encoder.encode(plaintext));
}

export function megolmDecrypt(
  session: MegolmInbound,
  ciphertext: string,
): { plaintext: string; messageIndex: number } {
  const result = session.decrypt(ciphertext);
  return {
    plaintext: decoder.decode(result.plaintext),
    messageIndex: result.message_index,
  };
}
