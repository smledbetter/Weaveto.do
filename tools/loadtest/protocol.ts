/**
 * Identifier and message builders for the relay load-test harness.
 *
 * Pure and deterministic so the unit test can check that every value the
 * harness puts on the wire satisfies the relay's own validation rules. A
 * harness that generates rejected joins would report a capacity of zero and
 * blame the relay, so these builders are guarded by tests.
 *
 * The limits below are copied from server/relay.ts. They are not documentation:
 * the harness predicts the relay's refusals from them, so a stale copy makes it
 * measure a relay that is not the relay and report the difference as capacity.
 * tests/unit/loadtest-limits-sync.test.ts fails the build if they drift.
 */

export const RELAY_LIMITS = Object.freeze({
  MAX_IDENTITY_KEY_LENGTH: 64,
  MAX_DISPLAY_NAME_LENGTH: 32,
  MAX_CIPHERTEXT_LENGTH: 65536,
  MAX_SESSION_ID_LENGTH: 64,
  MAX_ONE_TIME_KEYS: 20,
  MAX_MESSAGE_SIZE: 131072,
  MAX_ROOMS: 5_000,
  MAX_CONNECTIONS: 5_000,
  MAX_CLIENTS_PER_ROOM: 10,
  MAX_CONNECTIONS_PER_IP: 10,
  MSG_RATE_LIMIT: 20,
  BROADCAST_RATE_LIMIT: 5,
  BROADCAST_WINDOW_MS: 4000,
  PUSH_COOLDOWN_MS: 30000,
  MAX_PUSH_IN_FLIGHT: 64,
});

/**
 * Frames of type `encrypted` allowed per BROADCAST_WINDOW_MS.
 *
 * Derived exactly as the relay derives it, so a change to either input cannot
 * leave a stale literal here. It sits outside RELAY_LIMITS because every entry
 * in that table is checked against a numeric literal in server/relay.ts, and
 * this one is a computed expression there too.
 */
/**
 * Push subscriptions kept per room. Derived exactly as the relay derives it.
 * A subscription is only useful to a member, and a room can never hold more
 * members than MAX_CLIENTS_PER_ROOM at once.
 */
export const MAX_PUSH_SUBS_PER_ROOM = RELAY_LIMITS.MAX_CLIENTS_PER_ROOM;

export const BROADCAST_BUDGET =
  RELAY_LIMITS.BROADCAST_RATE_LIMIT * (RELAY_LIMITS.BROADCAST_WINDOW_MS / 1000);

/** The relay's room-id pattern, copied verbatim from server/relay.ts. */
export const ROOM_ID_PATTERN = /^[a-f0-9]{32}$/;

// --- Deterministic identifiers ---------------------------------------------

/** FNV-1a, 32 bit. Deterministic across runs so a failing run can be replayed. */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic 32-character lowercase hex room id for a room index.
 *
 * Four salted 32-bit hashes concatenated. Matches ROOM_ID_PATTERN by
 * construction: each hash contributes exactly 8 hex characters.
 */
export function roomIdFor(index: number): string {
  let out = "";
  for (let salt = 0; salt < 4; salt++) {
    out += fnv1a(`weaveto-loadtest:${salt}:${index}`)
      .toString(16)
      .padStart(8, "0");
  }
  return out;
}

/**
 * Pad an identifier out to a key-like length without destroying uniqueness.
 *
 * The terminator matters. Padding "ltid0x1" and "ltid0x10" with zeros produces
 * the same string, and identical identity keys in one room make the relay close
 * the older socket with code 4005. That reads as the relay shedding load. The
 * "_" ends the variable part, so no two distinct inputs can pad to one output.
 */
function padKey(base: string): string {
  const terminated = `${base}_`;
  return terminated.length >= 43
    ? terminated.slice(0, RELAY_LIMITS.MAX_IDENTITY_KEY_LENGTH)
    : terminated.padEnd(43, "0");
}

/** Deterministic identity key, unique per (worker, client), within the 64-char limit. */
export function identityKeyFor(workerId: number, clientIndex: number): string {
  return padKey(`ltid${workerId}x${clientIndex}`);
}

/** Deterministic Ed25519 key stand-in. Distinct from the identity key, same limit. */
export function ed25519KeyFor(workerId: number, clientIndex: number): string {
  return padKey(`lted${workerId}x${clientIndex}`);
}

/** Display name inside the 32-char limit. Truncated rather than rejected. */
export function displayNameFor(workerId: number, clientIndex: number): string {
  return `lt${workerId}-${clientIndex}`.slice(0, RELAY_LIMITS.MAX_DISPLAY_NAME_LENGTH);
}

/** One-time keys shaped like a real client's batch. `count` is clamped to 1..20. */
export function oneTimeKeysFor(
  workerId: number,
  clientIndex: number,
  count: number,
): Record<string, string> {
  const n = Math.min(Math.max(Math.trunc(count), 1), RELAY_LIMITS.MAX_ONE_TIME_KEYS);
  const keys: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    keys[`AAAA${i}`] = padKey(`otk${workerId}x${clientIndex}x${i}`);
  }
  return keys;
}

// --- Message builders -------------------------------------------------------

export interface JoinMessage {
  type: "join";
  identityKey: string;
  ed25519Key: string;
  oneTimeKeys: Record<string, string>;
  displayName: string;
  create: boolean;
  ephemeral?: boolean;
}

/**
 * Build a join message.
 *
 * `create` is true for every virtual client on purpose. handleJoin only reads
 * `create` when the room does not exist yet, so setting it everywhere removes
 * a race where the second client of a room arrives first and is closed with
 * 4004 "room not found". That race would be measured as a relay capacity
 * failure when it is really a harness ordering artefact.
 */
export function buildJoin(
  workerId: number,
  clientIndex: number,
  oneTimeKeyCount: number,
): JoinMessage {
  return {
    type: "join",
    identityKey: identityKeyFor(workerId, clientIndex),
    ed25519Key: ed25519KeyFor(workerId, clientIndex),
    oneTimeKeys: oneTimeKeysFor(workerId, clientIndex, oneTimeKeyCount),
    displayName: displayNameFor(workerId, clientIndex),
    create: true,
  };
}

export interface EncryptedMessage {
  type: "encrypted";
  senderIdentityKey: string;
  sessionId: string;
  ciphertext: string;
  timestamp: number;
}

/**
 * Build the probe message.
 *
 * The relay relays the validated object verbatim, so `sessionId` carries the
 * probe token back out to the receiving client. That is how a round trip is
 * matched to its send time.
 */
export function buildProbe(
  senderIdentityKey: string,
  token: string,
  ciphertextBytes: number,
  now: number,
): EncryptedMessage {
  const size = Math.min(Math.max(Math.trunc(ciphertextBytes), 1), RELAY_LIMITS.MAX_CIPHERTEXT_LENGTH);
  return {
    type: "encrypted",
    senderIdentityKey,
    sessionId: token.slice(0, RELAY_LIMITS.MAX_SESSION_ID_LENGTH),
    ciphertext: "x".repeat(size),
    timestamp: now,
  };
}

// --- Independent re-check of the relay's validation rules -------------------

export type RuleViolation = string;

/**
 * Re-check a join message against the relay's documented rules.
 *
 * This is deliberately a second, independent reading of validateMessage() in
 * server/relay.ts rather than a call into it, because relay.ts does not export
 * its validator and starts a listening server on import. It guards the
 * builders, not the relay.
 */
export function checkJoinAgainstRelayRules(msg: JoinMessage): RuleViolation[] {
  const bad: RuleViolation[] = [];
  const str = (v: unknown, max: number, name: string) => {
    if (typeof v !== "string" || v.length === 0 || v.length > max) {
      bad.push(`${name} must be a string of 1..${max} chars`);
    }
  };
  if (msg.type !== "join") bad.push('type must be "join"');
  str(msg.identityKey, RELAY_LIMITS.MAX_IDENTITY_KEY_LENGTH, "identityKey");
  str(msg.ed25519Key, RELAY_LIMITS.MAX_IDENTITY_KEY_LENGTH, "ed25519Key");
  str(msg.displayName, RELAY_LIMITS.MAX_DISPLAY_NAME_LENGTH, "displayName");

  const entries = Object.entries(msg.oneTimeKeys ?? {});
  if (entries.length === 0 || entries.length > RELAY_LIMITS.MAX_ONE_TIME_KEYS) {
    bad.push(`oneTimeKeys must have 1..${RELAY_LIMITS.MAX_ONE_TIME_KEYS} entries`);
  }
  for (const [k, v] of entries) {
    if (k.length > RELAY_LIMITS.MAX_IDENTITY_KEY_LENGTH) bad.push(`oneTimeKeys key "${k}" too long`);
    if (typeof v !== "string" || v.length > RELAY_LIMITS.MAX_IDENTITY_KEY_LENGTH) {
      bad.push(`oneTimeKeys value for "${k}" too long or not a string`);
    }
  }
  if (typeof msg.create !== "boolean") bad.push("create must be a boolean when present");
  if (JSON.stringify(msg).length > RELAY_LIMITS.MAX_MESSAGE_SIZE) {
    bad.push(`serialized join exceeds MAX_MESSAGE_SIZE`);
  }
  return bad;
}

/** Re-check an encrypted probe message against the relay's documented rules. */
export function checkProbeAgainstRelayRules(msg: EncryptedMessage): RuleViolation[] {
  const bad: RuleViolation[] = [];
  if (msg.type !== "encrypted") bad.push('type must be "encrypted"');
  if (msg.senderIdentityKey.length === 0 || msg.senderIdentityKey.length > RELAY_LIMITS.MAX_IDENTITY_KEY_LENGTH) {
    bad.push("senderIdentityKey must be 1..64 chars");
  }
  if (msg.sessionId.length === 0 || msg.sessionId.length > RELAY_LIMITS.MAX_SESSION_ID_LENGTH) {
    bad.push("sessionId must be 1..64 chars");
  }
  if (msg.ciphertext.length === 0 || msg.ciphertext.length > RELAY_LIMITS.MAX_CIPHERTEXT_LENGTH) {
    bad.push("ciphertext must be 1..65536 chars");
  }
  if (!Number.isFinite(msg.timestamp)) bad.push("timestamp must be a finite number");
  if (JSON.stringify(msg).length > RELAY_LIMITS.MAX_MESSAGE_SIZE) {
    bad.push("serialized probe exceeds MAX_MESSAGE_SIZE");
  }
  return bad;
}

/**
 * A key_share frame addressed to one peer.
 *
 * Joining or re-keying sends one of these per member in a tight loop, so a
 * client in a full room legitimately emits MAX_CLIENTS_PER_ROOM - 1 of them
 * back to back. The relay routes each to a single target, so unlike an
 * `encrypted` frame it does not multiply. The caps profile uses this to check
 * that the protocol's own burst is not treated as abuse.
 */
export interface KeyShareMessage {
  type: "key_share";
  targetIdentityKey: string;
  senderIdentityKey: string;
  olmMessage: { messageType: number; ciphertext: string };
}

export function buildKeyShare(
  senderIdentityKey: string,
  targetIdentityKey: string,
): KeyShareMessage {
  return {
    type: "key_share",
    targetIdentityKey,
    senderIdentityKey,
    // messageType 0 is an Olm pre-key message. The relay checks the shape, not
    // the crypto, so a well-formed placeholder ciphertext is enough.
    olmMessage: { messageType: 0, ciphertext: "x".repeat(256) },
  };
}

/**
 * Re-check a key_share against the relay's documented rules.
 *
 * The first version of buildKeyShare used `{type, body}` for the Olm payload
 * where the relay wants `{messageType, ciphertext}`. The relay closed 4003 and
 * the burst check reported the relay as broken. A harness that sends malformed
 * frames does not measure a cap, it measures itself.
 */
export function checkKeyShareAgainstRelayRules(msg: KeyShareMessage): RuleViolation[] {
  const bad: RuleViolation[] = [];
  if (msg.type !== "key_share") bad.push('type must be "key_share"');
  if (msg.targetIdentityKey.length === 0 || msg.targetIdentityKey.length > RELAY_LIMITS.MAX_IDENTITY_KEY_LENGTH) {
    bad.push("targetIdentityKey must be 1..64 chars");
  }
  if (msg.senderIdentityKey.length === 0 || msg.senderIdentityKey.length > RELAY_LIMITS.MAX_IDENTITY_KEY_LENGTH) {
    bad.push("senderIdentityKey must be 1..64 chars");
  }
  if (msg.olmMessage.messageType !== 0 && msg.olmMessage.messageType !== 1) {
    bad.push("olmMessage.messageType must be 0 or 1");
  }
  if (msg.olmMessage.ciphertext.length === 0 || msg.olmMessage.ciphertext.length > RELAY_LIMITS.MAX_CIPHERTEXT_LENGTH) {
    bad.push("olmMessage.ciphertext must be 1..65536 chars");
  }
  if (JSON.stringify(msg).length > RELAY_LIMITS.MAX_MESSAGE_SIZE) {
    bad.push("serialized key_share exceeds MAX_MESSAGE_SIZE");
  }
  return bad;
}
