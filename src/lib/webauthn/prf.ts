/**
 * WebAuthn PRF key derivation for weaveto.do.
 * Triggers a WebAuthn ceremony with the PRF extension to derive
 * a deterministic seed for cryptographic identity.
 *
 * No accounts, no passwords — identity is device-bound via WebAuthn.
 */

const RP_ID = "weaveto.do";
const RP_NAME = "weaveto.do";

export interface PrfResult {
  seed: Uint8Array;
  credentialId: Uint8Array;
}

export class WebAuthnUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebAuthnUnsupportedError";
  }
}

export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.PublicKeyCredential !== "undefined" &&
    typeof navigator.credentials !== "undefined"
  );
}

export async function isPrfSupported(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  try {
    // Check if the platform supports PRF via isUserVerifyingPlatformAuthenticatorAvailable
    // and the PRF extension. There's no direct API to check PRF support without
    // attempting a ceremony, so we check basic WebAuthn availability.
    const available =
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    return available;
  } catch {
    return false;
  }
}

/**
 * Create a new WebAuthn credential with PRF support.
 * Used when creating a room (first-time identity on this device).
 */
export async function createCredential(roomId: string): Promise<PrfResult> {
  if (!isWebAuthnSupported()) {
    throw new WebAuthnUnsupportedError(
      "WebAuthn is not supported in this browser. Try Chrome 120+ or Edge on a device with a fingerprint reader or security key.",
    );
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  const credential = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        id: getRpId(),
        name: RP_NAME,
      },
      user: {
        id: userId,
        name: "weave-user",
        displayName: "Weave User",
      },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" }, // ES256
        { alg: -257, type: "public-key" }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: "platform",
        userVerification: "required",
        residentKey: "preferred",
      },
      extensions: {
        prf: {},
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential;

  if (!credential) {
    throw new WebAuthnUnsupportedError(
      "Credential creation was cancelled or failed.",
    );
  }

  const prfSupported = (
    credential.getClientExtensionResults() as Record<string, unknown>
  ).prf;
  if (!prfSupported) {
    throw new WebAuthnUnsupportedError(
      "Your authenticator does not support the PRF extension. Try a different device or browser.",
    );
  }

  // Store credential ID for future assertions
  const credentialId = new Uint8Array(credential.rawId);
  storeCredentialId(credentialId);

  // Now do an assertion with PRF to get the actual seed
  return assertWithPrf(roomId, credentialId);
}

/**
 * The PRF input that decides which identity this device has.
 *
 * It includes the room, so a device gets a different identity in every room.
 * That is what stops the relay linking one person across rooms: the Olm
 * identity key it routes by is derived from this, and a constant salt made
 * that key the same everywhere, forever.
 *
 * Both non-PRF paths were already per-room. generateRandomSeed hashes the room
 * id with a nonce, and stored seeds are keyed by room. This one was the
 * exception, which is why it reads as an oversight rather than a decision.
 *
 * The v2 marks the change. Anyone with a v1 identity gets a new one, which is
 * the same thing that happens when someone joins from a new device, and the
 * app has never been deployed.
 */
export function prfSaltFor(roomId: string): Uint8Array {
  return new TextEncoder().encode(`weaveto.do-identity-v2|${roomId}`);
}

/**
 * Assert an existing credential with PRF to derive a seed.
 * Used when joining a room or re-establishing identity.
 */
export async function assertWithPrf(
  roomId: string,
  credentialId?: Uint8Array,
): Promise<PrfResult> {
  if (!isWebAuthnSupported()) {
    throw new WebAuthnUnsupportedError(
      "WebAuthn is not supported in this browser.",
    );
  }

  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const salt = prfSaltFor(roomId);

  const allowCredentials: PublicKeyCredentialDescriptor[] = credentialId
    ? [{ id: credentialId as BufferSource, type: "public-key" as const }]
    : [];

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: getRpId(),
      allowCredentials,
      userVerification: "required",
      extensions: {
        prf: {
          eval: {
            first: salt,
          },
        },
      } as AuthenticationExtensionsClientInputs,
    },
  })) as PublicKeyCredential;

  if (!assertion) {
    throw new WebAuthnUnsupportedError(
      "WebAuthn assertion was cancelled or failed.",
    );
  }

  const extResults = assertion.getClientExtensionResults() as Record<
    string,
    unknown
  >;
  const prfResults = extResults.prf as
    | { results?: { first?: ArrayBuffer } }
    | undefined;

  if (!prfResults?.results?.first) {
    throw new WebAuthnUnsupportedError(
      "PRF extension did not return a result. Your authenticator may not support PRF.",
    );
  }

  return {
    seed: new Uint8Array(prfResults.results.first),
    credentialId: new Uint8Array(assertion.rawId),
  };
}

/**
 * Store credential ID in both sessionStorage (fast access within tab) and
 * localStorage (persists across sessions for PRF assertion on return visits).
 */
function storeCredentialId(id: Uint8Array): void {
  const encoded = btoa(String.fromCharCode(...id));
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem("weave-credential-id", encoded);
  }
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("weave-credential-id", encoded);
  }
}

export function getStoredCredentialId(): Uint8Array | null {
  // Check sessionStorage first (faster, same tab), then localStorage (cross-session)
  const stored =
    (typeof sessionStorage !== "undefined"
      ? sessionStorage.getItem("weave-credential-id")
      : null) ??
    (typeof localStorage !== "undefined"
      ? localStorage.getItem("weave-credential-id")
      : null);
  if (!stored) return null;
  return Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
}

/**
 * Get the relying party ID. Uses localhost in dev, weaveto.do in production.
 */
function getRpId(): string {
  if (typeof window !== "undefined") {
    return window.location.hostname;
  }
  return RP_ID;
}
