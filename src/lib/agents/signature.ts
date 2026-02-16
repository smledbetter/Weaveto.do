/**
 * Ed25519 module signature verification.
 * Verifies that custom agent WASM modules are signed by a trusted developer.
 * Uses WebCrypto Ed25519 (available in Chrome 137+, Firefox, Edge).
 *
 * Signature scheme:
 * - Developer signs the WASM SHA-256 hash (hex string, UTF-8 encoded) with their Ed25519 private key
 * - Manifest includes base64-encoded signature
 * - Loader verifies signature against a trusted public key before activation
 * - Built-in agents bypass signature checks (hash-only verification)
 */

const encoder = new TextEncoder();

/**
 * Verify an Ed25519 signature on a WASM module hash.
 *
 * @param wasmHash - SHA-256 hex digest of the WASM binary (the signed message)
 * @param signature - Base64-encoded Ed25519 signature
 * @param publicKeyBase64 - Base64-encoded Ed25519 public key (raw, 32 bytes)
 * @returns true if signature is valid, false otherwise
 */
export async function verifyModuleSignature(
  wasmHash: string,
  signature: string,
  publicKeyBase64: string,
): Promise<boolean> {
  try {
    const publicKeyBytes = base64ToUint8(publicKeyBase64);
    if (publicKeyBytes.length !== 32) {
      return false;
    }

    const signatureBytes = base64ToUint8(signature);
    if (signatureBytes.length !== 64) {
      return false;
    }

    const key = await crypto.subtle.importKey(
      "raw",
      publicKeyBytes,
      { name: "Ed25519" },
      false,
      ["verify"],
    );

    const message = encoder.encode(wasmHash);

    return await crypto.subtle.verify(
      { name: "Ed25519" },
      key,
      signatureBytes,
      message,
    );
  } catch {
    return false;
  }
}

/**
 * Sign a WASM module hash with an Ed25519 private key.
 * Used for testing and by module developers.
 *
 * @param wasmHash - SHA-256 hex digest of the WASM binary
 * @param privateKeyPkcs8 - PKCS#8-encoded Ed25519 private key (ArrayBuffer)
 * @returns Base64-encoded signature
 */
export async function signModuleHash(
  wasmHash: string,
  privateKeyPkcs8: ArrayBuffer,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyPkcs8,
    { name: "Ed25519" },
    false,
    ["sign"],
  );

  const message = encoder.encode(wasmHash);
  const signature = await crypto.subtle.sign(
    { name: "Ed25519" },
    key,
    message,
  );

  return uint8ToBase64(new Uint8Array(signature));
}

/**
 * Generate an Ed25519 keypair for testing.
 * Returns the raw public key (32 bytes, base64) and PKCS#8 private key.
 */
export async function generateSigningKeypair(): Promise<{
  publicKeyBase64: string;
  privateKeyPkcs8: ArrayBuffer;
}> {
  const keypair = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"],
  );

  const publicKeyRaw = await crypto.subtle.exportKey("raw", keypair.publicKey);
  const privateKeyPkcs8 = await crypto.subtle.exportKey(
    "pkcs8",
    keypair.privateKey,
  );

  return {
    publicKeyBase64: uint8ToBase64(new Uint8Array(publicKeyRaw)),
    privateKeyPkcs8,
  };
}

// --- Base64 Helpers ---

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
