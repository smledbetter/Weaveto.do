/**
 * PIN key derivation using PBKDF2-SHA256.
 * Uses 600K iterations per OWASP 2024 recommendation for SHA-256.
 *
 * RFC 6070 Test Vectors (for verification in tests):
 * - P="password", S="salt", c=1, dkLen=32
 *   => 0x120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b
 * - P="password", S="salt", c=2, dkLen=32
 *   => 0xae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43
 */

const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 32; // bytes
const KEY_LENGTH = 256; // bits

/**
 * Generate a cryptographically random salt for PBKDF2.
 */
export function generatePinSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

/**
 * Derive a 256-bit key from a PIN using PBKDF2-SHA256.
 * Uses 600K iterations per OWASP 2024 recommendation for SHA-256.
 *
 * @param pin - The 6-digit PIN string
 * @param salt - Random salt (32 bytes)
 * @returns CryptoKey suitable for AES-GCM wrapping operations
 */
export async function derivePinKey(
  pin: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    { name: "AES-GCM", length: KEY_LENGTH },
    true, // extractable — needed for wrapping/export
    ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
  );
}

/**
 * Derive raw key bytes from a PIN (for hashing/verification).
 */
export async function derivePinKeyRaw(
  pin: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
    },
    keyMaterial,
    KEY_LENGTH,
  );

  return new Uint8Array(bits);
}

/**
 * Hash a derived PIN key for quick verification.
 * Uses SHA-256 on the raw key bytes.
 */
export async function hashPinKey(rawKey: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest("SHA-256", rawKey as BufferSource);
  return new Uint8Array(hash);
}

/**
 * Verify a PIN against a stored hash.
 * Derives the key, hashes it, and compares to the stored hash.
 * Returns the CryptoKey if verification succeeds, null otherwise.
 */
export async function verifyPin(
  pin: string,
  salt: Uint8Array,
  expectedHash: Uint8Array,
): Promise<CryptoKey | null> {
  const rawKey = await derivePinKeyRaw(pin, salt);
  const actualHash = await hashPinKey(rawKey);

  // Constant-time comparison to prevent timing attacks
  if (actualHash.length !== expectedHash.length) return null;
  let diff = 0;
  for (let i = 0; i < actualHash.length; i++) {
    diff |= actualHash[i] ^ expectedHash[i];
  }

  if (diff !== 0) return null;

  // Re-derive as CryptoKey for use
  return derivePinKey(pin, salt);
}

// Export constants for testing
export { PBKDF2_ITERATIONS, SALT_LENGTH, KEY_LENGTH };
