/**
 * VAPID JWT generation and Web Push notification sending for weaveto.do relay.
 * Uses Node.js built-in crypto — no external web-push library.
 *
 * Security invariants:
 * - No console.log in production paths
 * - VAPID private key never leaves this module
 * - Subscription endpoints treated as opaque URLs
 */

import * as crypto from "crypto";
import type { PushSubscriptionData } from "./push-types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VapidKeys {
  /** Base64url-encoded uncompressed EC public key (65 bytes: 04 || x || y) */
  publicKey: string;
  /** Base64url-encoded raw EC private key (32 bytes) */
  privateKey: string;
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let vapidKeys: VapidKeys | null = null;

// Set to true only during development debugging — never in production.
const _debug = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialize VAPID keys from environment variables or generate ephemeral keys
 * for development when no env vars are set.
 *
 * Must be called once at server startup before any push notifications are sent.
 */
export function initVapid(): VapidKeys {
  const envPublic = process.env.VAPID_PUBLIC_KEY;
  const envPrivate = process.env.VAPID_PRIVATE_KEY;

  if (envPublic && envPrivate) {
    vapidKeys = { publicKey: envPublic, privateKey: envPrivate };
  } else {
    // Dev mode: generate ephemeral keys. These are not persisted — push
    // subscriptions created against ephemeral keys will not survive a relay restart.
    const { publicKey: pubDer, privateKey: privDer } =
      crypto.generateKeyPairSync("ec", {
        namedCurve: "P-256",
        publicKeyEncoding: { type: "spki", format: "der" },
        privateKeyEncoding: { type: "pkcs8", format: "der" },
      });

    vapidKeys = {
      publicKey: base64urlEncode(extractRawPublicKey(pubDer)),
      privateKey: base64urlEncode(extractRawPrivateKey(privDer)),
    };
  }

  return vapidKeys;
}

/** Return the Base64url-encoded uncompressed public key for client subscription. */
export function getVapidPublicKey(): string {
  if (!vapidKeys) throw new Error("VAPID not initialized — call initVapid() first");
  return vapidKeys.publicKey;
}

/**
 * Send a Web Push notification (ping-only, no encrypted payload).
 *
 * Returns:
 *  - 'ok'    — push service accepted the notification (201)
 *  - 'gone'  — subscription has expired and should be removed (410)
 *  - 'error' — transient failure; caller may retry with back-off
 */
export async function sendPushNotification(
  subscription: PushSubscriptionData,
  _payload: string,
): Promise<"ok" | "gone" | "error"> {
  if (!vapidKeys) throw new Error("VAPID not initialized — call initVapid() first");

  const aud = new URL(subscription.endpoint).origin;
  const jwt = generateVapidJwt(aud);

  try {
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        Authorization: `vapid t=${jwt}, k=${vapidKeys.publicKey}`,
        "Content-Length": "0",
        TTL: "86400",
        Urgency: "normal",
      },
    });

    if (response.status === 201) return "ok";
    if (response.status === 410) return "gone"; // Subscription has expired
    return "error";
  } catch {
    return "error";
  }
}

// ---------------------------------------------------------------------------
// JWT generation
// ---------------------------------------------------------------------------

function generateVapidJwt(aud: string): string {
  if (!vapidKeys) throw new Error("VAPID not initialized");

  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    sub: "mailto:noreply@weaveto.do",
    aud,
    exp: Math.floor(Date.now() / 1000) + 86400, // 24 hours
  };

  const headerB64 = base64urlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64urlEncode(Buffer.from(JSON.stringify(payload)));
  const unsigned = `${headerB64}.${payloadB64}`;

  // Reconstruct a PKCS8 DER key object from the raw 32-byte private key scalar
  // so that Node.js crypto.createSign() can import it.
  const rawPrivKey = base64urlDecode(vapidKeys.privateKey);
  const pkcs8Der = buildPkcs8DerForP256(rawPrivKey);

  const sign = crypto.createSign("SHA256");
  sign.update(unsigned);

  // dsaEncoding: 'ieee-p1363' produces fixed-length r||s (64 bytes) required by
  // JWT ES256, rather than the default variable-length DER encoding.
  const signature = sign.sign({
    key: crypto.createPrivateKey({ key: pkcs8Der, format: "der", type: "pkcs8" }),
    dsaEncoding: "ieee-p1363",
  });

  return `${unsigned}.${base64urlEncode(signature)}`;
}

// ---------------------------------------------------------------------------
// DER key extraction helpers
// ---------------------------------------------------------------------------

/**
 * Extract the 65-byte uncompressed public key (04 || x || y) from a
 * SubjectPublicKeyInfo (SPKI) DER buffer produced by generateKeyPairSync.
 *
 * SPKI for EC P-256:
 *   SEQUENCE {
 *     SEQUENCE { OID ecPublicKey, OID prime256v1 }
 *     BIT STRING { 00, <65 bytes uncompressed point> }
 *   }
 *
 * The uncompressed point is always the last 65 bytes of the SPKI DER.
 */
function extractRawPublicKey(spkiDer: Buffer): Buffer {
  // The 65-byte uncompressed point (04 || x || y) is always at the tail.
  return spkiDer.slice(spkiDer.length - 65);
}

/**
 * Extract the 32-byte raw private key scalar from a PKCS#8 DER buffer produced
 * by generateKeyPairSync with privateKeyEncoding: { type: 'pkcs8', format: 'der' }.
 *
 * PKCS#8 for EC P-256:
 *   SEQUENCE {
 *     INTEGER 0  (version)
 *     SEQUENCE { OID ecPrivateKey, OID prime256v1 }
 *     OCTET STRING {
 *       ECPrivateKey SEQUENCE {
 *         INTEGER 1  (version)
 *         OCTET STRING <32-byte private key scalar>
 *         [1] BIT STRING <uncompressed public key>  (optional)
 *       }
 *     }
 *   }
 *
 * Strategy: locate the 32-byte OCTET STRING containing the raw scalar.
 * The ECPrivateKey structure starts with 30 xx 02 01 01 04 20 <32 bytes>.
 * We find the sequence "02 01 01 04 20" and read the 32 bytes after it.
 */
function extractRawPrivateKey(pkcs8Der: Buffer): Buffer {
  // Marker bytes: INTEGER(1) followed immediately by OCTET STRING of length 32
  // 02 01 01  = INTEGER, length 1, value 1  (ECPrivateKey version)
  // 04 20     = OCTET STRING, length 32
  const marker = Buffer.from([0x02, 0x01, 0x01, 0x04, 0x20]);
  const idx = pkcs8Der.indexOf(marker);
  if (idx === -1) {
    throw new Error("Cannot locate raw private key scalar in PKCS8 DER");
  }
  const start = idx + marker.length;
  return pkcs8Der.slice(start, start + 32);
}

// ---------------------------------------------------------------------------
// PKCS#8 DER construction for a raw P-256 private key scalar
// ---------------------------------------------------------------------------

/**
 * Wrap a 32-byte raw EC private key scalar into a minimal PKCS#8 DER structure
 * suitable for import by Node.js crypto.createPrivateKey().
 *
 * Structure:
 *   SEQUENCE {
 *     INTEGER 0
 *     SEQUENCE { OID 1.2.840.10045.2.1 (ecPublicKey), OID 1.2.840.10045.3.1.7 (prime256v1) }
 *     OCTET STRING {
 *       SEQUENCE {                    <- ECPrivateKey
 *         INTEGER 1
 *         OCTET STRING <32 bytes>
 *       }
 *     }
 *   }
 *
 * We omit the optional public key from ECPrivateKey to keep the structure minimal.
 */
function buildPkcs8DerForP256(rawKey: Buffer): Buffer {
  if (rawKey.length !== 32) {
    throw new Error(`Expected 32-byte P-256 private key, got ${rawKey.length} bytes`);
  }

  // OID 1.2.840.10045.2.1 (id-ecPublicKey)
  const oidEcPublicKey = Buffer.from([
    0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
  ]);

  // OID 1.2.840.10045.3.1.7 (prime256v1 / P-256)
  const oidP256 = Buffer.from([
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07,
  ]);

  // AlgorithmIdentifier SEQUENCE { ecPublicKey, prime256v1 }
  const algorithmIdentifier = derSequence(Buffer.concat([oidEcPublicKey, oidP256]));

  // ECPrivateKey ::= SEQUENCE { version INTEGER (1), privateKey OCTET STRING }
  const ecPrivateKey = derSequence(
    Buffer.concat([
      Buffer.from([0x02, 0x01, 0x01]), // INTEGER 1
      derOctetString(rawKey), // private key scalar
    ]),
  );

  // PrivateKeyInfo ::= SEQUENCE { version INTEGER (0), algorithm, privateKey OCTET STRING }
  const privateKeyInfo = derSequence(
    Buffer.concat([
      Buffer.from([0x02, 0x01, 0x00]), // INTEGER 0  (PKCS#8 version)
      algorithmIdentifier,
      derOctetString(ecPrivateKey),
    ]),
  );

  return privateKeyInfo;
}

// ---------------------------------------------------------------------------
// Minimal DER encoding helpers
// ---------------------------------------------------------------------------

function derLength(len: number): Buffer {
  if (len < 0x80) {
    return Buffer.from([len]);
  }
  if (len <= 0xff) {
    return Buffer.from([0x81, len]);
  }
  return Buffer.from([0x82, (len >> 8) & 0xff, len & 0xff]);
}

function derSequence(contents: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x30]), derLength(contents.length), contents]);
}

function derOctetString(contents: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x04]), derLength(contents.length), contents]);
}

// ---------------------------------------------------------------------------
// Base64url helpers
// ---------------------------------------------------------------------------

function base64urlEncode(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}
