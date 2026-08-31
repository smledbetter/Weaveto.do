/**
 * Room session manager.
 * Coordinates WebSocket connection, Olm key exchange, Megolm group encryption,
 * and message send/receive for a single room.
 */

import {
  initCrypto,
  createAccount,
  pickleAccount,
  unpickleAccount,
  derivePickleKey,
  getIdentityKeys,
  generateOneTimeKeys,
  getOneTimeKeys,
  markKeysAsPublished,
  createOutboundSession,
  createInboundSession,
  olmEncrypt,
  olmDecrypt,
  createGroupSession,
  getGroupSessionKey,
  getGroupSessionId,
  createInboundGroupSession,
  megolmEncrypt,
  megolmDecrypt,
  getOneTimeKeyCount,
  type OlmEncryptedMessage,
} from "$lib/crypto/engine";

import { padMessage, unpadMessage } from "$lib/crypto/padding";

import { DeliveryTracker } from "./delivery";

import type { TaskEvent } from "$lib/tasks/types";

import type {
  Account as OlmAccount,
  Session as OlmSession,
  GroupSession as MegolmOutbound,
  InboundGroupSession as MegolmInbound,
} from "vodozemac-wasm-bindings";

// --- Types ---

export interface RoomMember {
  identityKey: string;
  displayName: string;
  olmSession?: OlmSession;
}

export interface DecryptedMessage {
  senderId: string;
  senderName: string;
  plaintext: string;
  timestamp: number;
  encrypted: boolean;
  decryptionFailed: boolean;
  taskEvent?: TaskEvent;
}

export type MessageHandler = (message: DecryptedMessage) => void;
export type MemberHandler = (members: Map<string, RoomMember>) => void;
export type ConnectionHandler = (connected: boolean) => void;
export type ErrorHandler = (error: string) => void;
export type ReestablishingHandler = (active: boolean) => void;
export type DecryptFailureHandler = (senderId: string) => void;

// --- Protocol message types ---

interface JoinMessage {
  type: "join";
  identityKey: string;
  ed25519Key: string;
  oneTimeKeys: Record<string, string>;
  displayName: string;
  create?: boolean;
  ephemeral?: boolean;
}

interface NewMemberMessage {
  type: "new_member";
  identityKey: string;
  ed25519Key: string;
  oneTimeKeys: Record<string, string>;
  displayName: string;
}

interface KeyShareMessage {
  type: "key_share";
  targetIdentityKey: string;
  senderIdentityKey: string;
  olmMessage: OlmEncryptedMessage;
}

interface EncryptedMessage {
  type: "encrypted";
  senderIdentityKey: string;
  sessionId: string;
  ciphertext: string;
  timestamp: number;
}

interface MemberListMessage {
  type: "member_list";
  members: Array<{ identityKey: string; displayName: string }>;
  /** False when this join is what brought the room back into existence. */
  roomExisted?: boolean;
}

interface RoomNotFoundMessage {
  type: "room_not_found";
}

type ServerMessage =
  | NewMemberMessage
  | KeyShareMessage
  | EncryptedMessage
  | MemberListMessage
  | RoomNotFoundMessage;

// --- OTK replenishment thresholds ---

const OTK_REPLENISH_THRESHOLD = 5;
const OTK_REPLENISH_COUNT = 20;

/**
 * One-time keys published on join.
 *
 * Each existing member consumes a DIFFERENT one of these when a new member
 * arrives (see selectOneTimeKey), so this is also the number of existing
 * members that can establish a channel with a joiner without collision.
 * The relay caps a join at MAX_ONE_TIME_KEYS = 20, so 20 is the ceiling
 * available without a protocol change. Rooms larger than this can still
 * collide; MAX_CLIENTS_PER_ROOM is 50.
 */
const OTK_PUBLISH_COUNT = 20;

/**
 * Choose which of a joiner's one-time keys this member should consume.
 *
 * Olm one-time keys are single use: the recipient's `create_inbound_session`
 * consumes the key the sender used. Every existing member used to take
 * `Object.values(oneTimeKeys)[0]` — the same key — so the first key share to
 * arrive consumed it and every later one threw inside a silent catch. In a
 * three-person room that meant the two non-creators could never read each
 * other, which held for nineteen milestones because the only multi-member
 * test asserted pairs involving the room creator.
 *
 * Each member claims the key at its own index in the sorted list of members
 * that already hold the room. Every member derives the same list from its own
 * view, so the assignment is disjoint with no coordination and no extra
 * round trip.
 *
 * @param oneTimeKeys - the joiner's published keys, id -> key
 * @param selfKey     - this member's Curve25519 identity key
 * @param peerKeys    - identity keys of the other members already in the room,
 *                      excluding the joiner
 * @returns the key to use, or null if the joiner published none
 */
export function selectOneTimeKey(
  oneTimeKeys: Record<string, string>,
  selfKey: string,
  peerKeys: string[],
): string | null {
  // Sort by key id so every member walks the same order, independent of how
  // the JSON round-trip happened to order the object.
  const keys = Object.keys(oneTimeKeys)
    .sort()
    .map((id) => oneTimeKeys[id]);
  if (keys.length === 0) return null;

  const holders = [selfKey, ...peerKeys.filter((k) => k !== selfKey)].sort();
  const index = holders.indexOf(selfKey);

  // Wraps when the room is larger than the published key count, which
  // reintroduces collisions past OTK_PUBLISH_COUNT members. Better than every
  // member colliding on key zero, and the remaining gap is explicit.
  return keys[(index < 0 ? 0 : index) % keys.length];
}

// --- Room Session ---

export class RoomSession {
  private roomId: string;
  private account: OlmAccount | null = null;
  private identityKey = "";
  private ed25519Key = "";
  private ws: WebSocket | null = null;
  private displayName: string;
  private prfSeed: Uint8Array | null;
  private isCreator: boolean;
  private isEphemeral: boolean;
  private purgeInitiated = false;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private static readonly MAX_RECONNECT_ATTEMPTS = 5;
  private static readonly RECONNECT_BASE_DELAY = 1000;
  private intentionalClose = false;
  private reestablishing = false;
  private pendingKeyExchanges = new Set<string>();

  private deliveryTracker = new DeliveryTracker();
  private onMigrationHandler?: (newRoomUrl: string, tasks: any[]) => void;

  // Olm sessions with other members (keyed by their identity key)
  private olmSessions = new Map<string, OlmSession>();

  // Megolm: our outbound session for sending
  private outboundSession: MegolmOutbound | null = null;
  private outboundSessionId = "";

  // Megolm: inbound sessions from other members (keyed by session ID)
  private inboundSessions = new Map<string, MegolmInbound>();

  // Room members
  private members = new Map<string, RoomMember>();

  // Track last message time per member (for agent recency weighting)
  private lastMessageTimes = new Map<string, number>();

  // Event handlers
  private onMessage: MessageHandler | null = null;
  private onMembersChanged: MemberHandler | null = null;
  private onConnectionChanged: ConnectionHandler | null = null;
  private onError: ErrorHandler | null = null;
  private onReestablishing: ReestablishingHandler | null = null;
  private onDecryptFailure: DecryptFailureHandler | null = null;
  private syncHandler: ((events: TaskEvent[]) => void) | null = null;
  private onBurn: (() => void) | null = null;

  constructor(
    roomId: string,
    displayName: string,
    options?: {
      prfSeed?: Uint8Array;
      isCreator?: boolean;
      ephemeral?: boolean;
    },
  ) {
    this.roomId = roomId;
    this.displayName = displayName;
    this.prfSeed = options?.prfSeed ?? null;
    this.isCreator = options?.isCreator ?? false;
    this.isEphemeral = options?.ephemeral ?? false;
  }

  setMessageHandler(handler: MessageHandler) {
    this.onMessage = handler;
  }
  setMembersHandler(handler: MemberHandler) {
    this.onMembersChanged = handler;
  }
  setConnectionHandler(handler: ConnectionHandler) {
    this.onConnectionChanged = handler;
  }
  setErrorHandler(handler: ErrorHandler) {
    this.onError = handler;
  }
  setReestablishingHandler(handler: ReestablishingHandler) {
    this.onReestablishing = handler;
  }
  setDecryptFailureHandler(handler: DecryptFailureHandler) {
    this.onDecryptFailure = handler;
  }
  setSyncHandler(handler: (events: TaskEvent[]) => void): void {
    this.syncHandler = handler;
  }
  /** Called when another member broadcasts a burn instruction. */
  setBurnHandler(handler: () => void): void {
    this.onBurn = handler;
  }

  getIdentityKey(): string {
    return this.identityKey;
  }
  getMembers(): Map<string, RoomMember> {
    return this.members;
  }
  getRoomId(): string {
    return this.roomId;
  }
  getLastMessageTimes(): Map<string, number> {
    return this.lastMessageTimes;
  }
  getEphemeralMode(): boolean {
    return this.isEphemeral;
  }
  getIsCreator(): boolean {
    return this.isCreator;
  }
  getDeliveryTracker(): DeliveryTracker {
    return this.deliveryTracker;
  }

  setMigrationHandler(handler: (newRoomUrl: string, tasks: any[]) => void): void {
    this.onMigrationHandler = handler;
  }

  async sendMigrationMessage(newRoomUrl: string, tasks: any[]): Promise<void> {
    if (!this.ws || !this.outboundSession) return;

    const payload = JSON.stringify({
      migration: { newRoomUrl, tasks },
      sender: this.identityKey,
      senderName: this.displayName,
      sequence: this.deliveryTracker.nextSequence(),
    });

    const paddedPayload = padMessage(payload);
    const ciphertext = megolmEncrypt(this.outboundSession, paddedPayload);

    const msg: EncryptedMessage = {
      type: "encrypted",
      senderIdentityKey: this.identityKey,
      sessionId: getGroupSessionId(this.outboundSession),
      ciphertext,
      timestamp: Date.now(),
    };

    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Initialize crypto and connect to room.
   * Call this after constructing the session.
   */
  async connect(): Promise<void> {
    await initCrypto();

    // Create or restore Olm account.
    // When a PRF seed is available, derive a pickle key from it and check
    // sessionStorage for a previously pickled account (same device, same tab
    // session). This gives the user a stable cryptographic identity tied to
    // their WebAuthn credential. Without PRF (dev mode), a random account
    // is created each time.
    if (this.prfSeed) {
      const pickleKey = await derivePickleKey(this.prfSeed);
      const stored = sessionStorage.getItem("weave-olm-pickle");
      if (stored) {
        try {
          this.account = unpickleAccount(stored, pickleKey);
        } catch {
          // Pickle invalid or key mismatch — create fresh account
          this.account = createAccount();
        }
      } else {
        this.account = createAccount();
      }
      // Persist pickled account for identity continuity within this tab session
      sessionStorage.setItem(
        "weave-olm-pickle",
        pickleAccount(this.account, pickleKey),
      );
    } else {
      this.account = createAccount();
    }

    const keys = getIdentityKeys(this.account);
    this.identityKey = keys.curve25519;
    this.ed25519Key = keys.ed25519;

    // Generate one-time keys for key exchange
    generateOneTimeKeys(this.account, OTK_PUBLISH_COUNT);
    const oneTimeKeys = getOneTimeKeys(this.account);
    markKeysAsPublished(this.account);

    // Create Megolm outbound session for group encryption
    this.outboundSession = createGroupSession();
    this.outboundSessionId = getGroupSessionId(this.outboundSession);

    // Connect WebSocket
    const wsUrl = this.getWebSocketUrl();
    this.ws = new WebSocket(wsUrl);

    return new Promise<void>((resolve, reject) => {
      const ws = this.ws!;

      ws.onopen = () => {
        this.onConnectionChanged?.(true);

        // Send join message (include create flag if this is the room creator)
        const joinMsg: JoinMessage = {
          type: "join",
          identityKey: this.identityKey,
          ed25519Key: this.ed25519Key,
          oneTimeKeys,
          displayName: this.displayName,
          ...(this.isCreator ? { create: true } : {}),
          ...(this.isCreator && this.isEphemeral ? { ephemeral: true } : {}),
        };
        ws.send(JSON.stringify(joinMsg));
        resolve();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data as string) as ServerMessage;
          this.handleServerMessage(msg);
        } catch {
          // Invalid server message — ignore silently
        }
      };

      ws.onclose = () => {
        this.onConnectionChanged?.(false);
        if (!this.intentionalClose && !this.purgeInitiated) {
          this.scheduleReconnect();
        }
      };

      ws.onerror = () => {
        this.onConnectionChanged?.(false);
        reject(new Error("WebSocket connection failed"));
      };
    });
  }

  private scheduleReconnect(): void {
    if (
      this.reconnecting ||
      this.reconnectAttempts >= RoomSession.MAX_RECONNECT_ATTEMPTS
    ) {
      return;
    }
    this.reconnecting = true;
    const delay =
      RoomSession.RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts);
    setTimeout(() => this.attemptReconnect(), delay);
  }

  private attemptReconnect(): void {
    if (this.intentionalClose || this.purgeInitiated) {
      this.reconnecting = false;
      return;
    }
    this.reconnectAttempts++;

    const wsUrl = this.getWebSocketUrl();
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      this.reconnecting = false;
      this.reconnectAttempts = 0;
      this.onConnectionChanged?.(true);

      // Reset delivery tracker — sequence numbers restart after every reconnect.
      this.deliveryTracker.reset();

      // Clear stale Olm sessions — they are invalid after a disconnect because
      // the server's OTK registry has been refreshed. New inbound sessions will
      // be established via key_share messages after the member list arrives.
      this.olmSessions.clear();
      for (const member of this.members.values()) {
        member.olmSession = undefined;
      }

      // Enter re-establishing mode: we must wait for fresh key shares from all
      // known members before encryption is fully operational again.
      this.reestablishing = true;
      this.pendingKeyExchanges.clear();
      this.onReestablishing?.(true);

      // Re-generate one-time keys for key exchange with existing members
      generateOneTimeKeys(this.account!, OTK_PUBLISH_COUNT);
      const oneTimeKeys = getOneTimeKeys(this.account!);
      markKeysAsPublished(this.account!);

      const joinMsg: JoinMessage = {
        type: "join",
        identityKey: this.identityKey,
        ed25519Key: this.ed25519Key,
        oneTimeKeys,
        displayName: this.displayName,
      };
      this.ws!.send(JSON.stringify(joinMsg));
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        this.handleServerMessage(msg);
      } catch {
        // Invalid server message — ignore silently
      }
    };

    this.ws.onclose = () => {
      this.onConnectionChanged?.(false);
      if (!this.intentionalClose && !this.purgeInitiated) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      this.reconnecting = false;
      this.onConnectionChanged?.(false);
    };
  }

  /**
   * Send an encrypted message to the room.
   */
  sendMessage(plaintext: string): void {
    if (
      !this.outboundSession ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      throw new Error("Not connected to room");
    }

    const payload = JSON.stringify({
      text: plaintext,
      sender: this.identityKey,
      senderName: this.displayName,
      sequence: this.deliveryTracker.nextSequence(),
    });

    // Pad to fixed block size before encryption to prevent length correlation
    const paddedPayload = padMessage(payload);
    const ciphertext = megolmEncrypt(this.outboundSession, paddedPayload);
    const timestamp = Date.now();

    const msg: EncryptedMessage = {
      type: "encrypted",
      senderIdentityKey: this.identityKey,
      sessionId: this.outboundSessionId,
      ciphertext,
      timestamp,
    };
    this.ws.send(JSON.stringify(msg));

    // Show our own message locally
    this.onMessage?.({
      senderId: this.identityKey,
      senderName: this.displayName,
      plaintext,
      timestamp,
      encrypted: true,
      decryptionFailed: false,
    });
  }

  /**
   * Send event history to all room members via encrypted channel.
   * Used on reconnect to sync missed events.
   */
  sendSyncEvents(events: TaskEvent[]): void {
    if (!this.outboundSession || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (events.length === 0) return;

    const payload = JSON.stringify({
      sender: this.identityKey,
      senderName: this.displayName,
      syncEvents: events,
      sequence: this.deliveryTracker.nextSequence(),
    });

    const paddedPayload = padMessage(payload);
    const ciphertext = megolmEncrypt(this.outboundSession, paddedPayload);

    const msg: EncryptedMessage = {
      type: "encrypted",
      senderIdentityKey: this.identityKey,
      sessionId: this.outboundSessionId,
      ciphertext,
      timestamp: Date.now(),
    };
    this.ws.send(JSON.stringify(msg));
  }

  /**
   * Send an encrypted task event to the room.
   */
  sendTaskEvent(taskEvent: TaskEvent): void {
    if (
      !this.outboundSession ||
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN
    ) {
      throw new Error("Not connected to room");
    }

    const payload = JSON.stringify({
      text: "",
      sender: this.identityKey,
      senderName: this.displayName,
      taskEvent,
      sequence: this.deliveryTracker.nextSequence(),
    });

    const paddedPayload = padMessage(payload);
    const ciphertext = megolmEncrypt(this.outboundSession, paddedPayload);
    const timestamp = Date.now();

    const msg: EncryptedMessage = {
      type: "encrypted",
      senderIdentityKey: this.identityKey,
      sessionId: this.outboundSessionId,
      ciphertext,
      timestamp,
    };
    this.ws.send(JSON.stringify(msg));

    // Show our own task event locally
    this.onMessage?.({
      senderId: this.identityKey,
      senderName: this.displayName,
      plaintext: "",
      timestamp,
      encrypted: true,
      decryptionFailed: false,
      taskEvent,
    });
  }

  /**
   * Lock the session by clearing Megolm keys from memory.
   * The Olm account and sessions are preserved (needed for key re-exchange).
   * Call this on inactivity timeout or tab visibility lock.
   */
  lockSession(): void {
    this.outboundSession = null;
    this.outboundSessionId = "";
    this.inboundSessions.clear();
  }

  /**
   * Unlock the session after PIN verification.
   * Creates a new Megolm outbound session and shares the key with all members.
   */
  unlockSession(): void {
    if (!this.account || !this.ws || this.ws.readyState !== WebSocket.OPEN)
      return;

    // Create fresh Megolm outbound session
    this.outboundSession = createGroupSession();
    this.outboundSessionId = getGroupSessionId(this.outboundSession);

    // Re-share with all members who have Olm sessions
    for (const [identityKey, olmSession] of this.olmSessions) {
      try {
        const sessionKey = getGroupSessionKey(this.outboundSession);
        const keyPayload = JSON.stringify({
          sessionId: this.outboundSessionId,
          sessionKey,
          senderIdentityKey: this.identityKey,
        });
        const encrypted = olmEncrypt(olmSession, keyPayload);
        const keyShareMsg: KeyShareMessage = {
          type: "key_share",
          targetIdentityKey: identityKey,
          senderIdentityKey: this.identityKey,
          olmMessage: encrypted,
        };
        this.ws!.send(JSON.stringify(keyShareMsg));
      } catch {
        // Olm session may be exhausted — skip this member
      }
    }
  }

  /**
   * Rotate the Megolm group session and distribute new keys wrapped under PIN keys.
   * Only the creator should call this. The new session key for each member is
   * encrypted under that member's PIN-derived key, sent via a special rotate_keys message.
   *
   * @param memberPinKeys - Map of member identity key -> their PIN-derived CryptoKey
   *                        The creator must know all members' PIN keys (shared during PIN setup)
   */
  async rotateGroupSession(
    memberPinKeys?: Map<string, CryptoKey>,
  ): Promise<void> {
    if (!this.account || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to room");
    }

    // Create new Megolm outbound session
    const oldSessionId = this.outboundSessionId;
    this.outboundSession = createGroupSession();
    this.outboundSessionId = getGroupSessionId(this.outboundSession);

    const sessionKey = getGroupSessionKey(this.outboundSession);

    // Share new key with each member via Olm (existing mechanism)
    // The key_share payload includes a rotation flag
    for (const [identityKey, olmSession] of this.olmSessions) {
      try {
        const keyPayload = JSON.stringify({
          sessionId: this.outboundSessionId,
          sessionKey,
          senderIdentityKey: this.identityKey,
          rotation: true, // Signal that this is a rotation
          previousSessionId: oldSessionId,
        });
        const encrypted = olmEncrypt(olmSession, keyPayload);
        const keyShareMsg: KeyShareMessage = {
          type: "key_share",
          targetIdentityKey: identityKey,
          senderIdentityKey: this.identityKey,
          olmMessage: encrypted,
        };
        this.ws!.send(JSON.stringify(keyShareMsg));
      } catch {
        // Olm session exhausted — member won't get new key
      }
    }

    // Also broadcast a rotate_keys message so all members know rotation happened
    // This is an encrypted message that signals "old sessions are invalidated"
    if (this.outboundSession) {
      const rotatePayload = JSON.stringify({
        text: "",
        sender: this.identityKey,
        senderName: this.displayName,
        rotateKeys: {
          newSessionId: this.outboundSessionId,
          previousSessionId: oldSessionId,
          reason: "creator_requested",
        },
      });
      const paddedPayload = padMessage(rotatePayload);
      const ciphertext = megolmEncrypt(this.outboundSession, paddedPayload);

      // Note: we send this with the NEW session — only members who received
      // the new key_share can decrypt it. This serves as a proof that
      // key rotation succeeded.
      const msg: EncryptedMessage = {
        type: "encrypted",
        senderIdentityKey: this.identityKey,
        sessionId: this.outboundSessionId,
        ciphertext,
        timestamp: Date.now(),
      };
      this.ws.send(JSON.stringify(msg));
    }
  }

  /**
   * Tell every member to destroy their local copy of this room.
   *
   * Burn used to be a relay operation: the creator sent `purge`, the relay
   * checked a stored creator identity, broadcast `room_destroyed` and closed
   * every socket. That made the relay hold authoritative state for one
   * feature, and made it a witness to the burn.
   *
   * It now rides the Megolm channel that already exists. Every client runs the
   * same six-layer cleanup it runs for any other destruction and disconnects,
   * the room empties, and the relay drops the routing entry on the ordinary
   * path. The relay never learns a burn happened.
   *
   * Best-effort by nature, exactly as before: a member who is offline does not
   * receive it, and their local copy survives on their own device. The relay
   * could not reach them either.
   */
  sendBurnInstruction(): void {
    if (!this.outboundSession || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("Not connected to room");
    }

    const payload = JSON.stringify({
      text: "",
      sender: this.identityKey,
      senderName: this.displayName,
      burn: { reason: "manual" },
      sequence: this.deliveryTracker.nextSequence(),
    });

    const ciphertext = megolmEncrypt(this.outboundSession, padMessage(payload));
    this.ws.send(
      JSON.stringify({
        type: "encrypted",
        senderIdentityKey: this.identityKey,
        sessionId: this.outboundSessionId,
        ciphertext,
        timestamp: Date.now(),
      } satisfies EncryptedMessage),
    );

    // Stop reconnecting: this session is deliberately over.
    this.purgeInitiated = true;
  }

  /**
   * Disconnect and clean up.
   */
  disconnect(): void {
    this.intentionalClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.account = null;
    this.prfSeed = null;
    this.identityKey = "";
    this.ed25519Key = "";
    this.outboundSession = null;
    this.olmSessions.clear();
    this.inboundSessions.clear();
    this.members.clear();
    this.lastMessageTimes.clear();
  }

  // --- Private ---

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "new_member":
        this.handleNewMember(msg);
        break;
      case "key_share":
        this.handleKeyShare(msg);
        break;
      case "encrypted":
        this.handleEncryptedMessage(msg);
        break;
      case "member_list":
        this.handleMemberList(msg);
        break;
      case "room_not_found":
        // A relay that still gates joins on `create`. Current relays
        // reconstitute the room instead, so this is only reachable against an
        // older deployment.
        this.onError?.("This room does not exist or has expired.");
        this.disconnect();
        break;
    }
  }

  private handleNewMember(msg: NewMemberMessage): void {
    if (!this.account || !this.outboundSession) return;

    // Add to members
    this.members.set(msg.identityKey, {
      identityKey: msg.identityKey,
      displayName: msg.displayName,
    });
    this.onMembersChanged?.(this.members);

    // Create Olm session to new member and share our Megolm session key.
    // Claim a one-time key no other existing member will claim — see
    // selectOneTimeKey. `members` already contains the joiner at this point,
    // so exclude them from the holder list.
    const theirOTK = selectOneTimeKey(
      msg.oneTimeKeys,
      this.identityKey,
      [...this.members.keys()].filter((k) => k !== msg.identityKey),
    );
    if (!theirOTK) return;

    try {
      const olmSession = createOutboundSession(
        this.account,
        msg.identityKey,
        theirOTK,
      );
      this.olmSessions.set(msg.identityKey, olmSession);

      // Share Megolm session key via Olm
      const sessionKey = getGroupSessionKey(this.outboundSession);
      const keyPayload = JSON.stringify({
        sessionId: this.outboundSessionId,
        sessionKey,
        senderIdentityKey: this.identityKey,
      });

      const encrypted = olmEncrypt(olmSession, keyPayload);

      const keyShareMsg: KeyShareMessage = {
        type: "key_share",
        targetIdentityKey: msg.identityKey,
        senderIdentityKey: this.identityKey,
        olmMessage: encrypted,
      };
      this.ws!.send(JSON.stringify(keyShareMsg));
    } catch {
      // Olm session creation failed — skip key share for this member
    }
  }

  private handleKeyShare(msg: KeyShareMessage): void {
    if (!this.account) return;
    if (msg.targetIdentityKey !== this.identityKey) return;

    try {
      let plaintext: string;
      const existingOlm = this.olmSessions.get(msg.senderIdentityKey);
      const hadExistingSession = !!existingOlm;

      if (existingOlm) {
        // Already have an Olm session (we initiated the key exchange) — decrypt with it
        plaintext = olmDecrypt(existingOlm, msg.olmMessage);
      } else {
        // No existing session — create an inbound Olm session
        const result = createInboundSession(
          this.account,
          msg.senderIdentityKey,
          msg.olmMessage,
        );
        this.olmSessions.set(msg.senderIdentityKey, result.session);
        plaintext = result.plaintext;
        // A peer consumed one of our OTKs to create this session — replenish if low.
        // Wrapped in try/catch so OTK housekeeping never breaks key exchange.
        try { this.checkAndReplenishOTKs(); } catch { /* non-critical */ }
      }

      // Parse the Megolm session key
      const keyData = JSON.parse(plaintext) as {
        sessionId: string;
        sessionKey: string;
        senderIdentityKey: string;
        rotation?: boolean;
        previousSessionId?: string;
      };

      // If this is a rotation, clear the old session
      if (keyData.rotation && keyData.previousSessionId) {
        this.inboundSessions.delete(keyData.previousSessionId);
      }

      // Create inbound Megolm session
      const inbound = createInboundGroupSession(keyData.sessionKey);
      this.inboundSessions.set(keyData.sessionId, inbound);

      // Key exchange with this member succeeded — remove from pending set and
      // check whether re-establishment is complete.
      if (this.reestablishing) {
        this.pendingKeyExchanges.delete(msg.senderIdentityKey);
        if (this.pendingKeyExchanges.size === 0) {
          this.reestablishing = false;
          this.onReestablishing?.(false);
        }
      }

      // Reciprocate: share our Megolm key back so they can decrypt our messages.
      // Only do this if we didn't initiate the exchange (to prevent infinite loops).
      if (
        !hadExistingSession &&
        this.outboundSession &&
        this.ws?.readyState === WebSocket.OPEN
      ) {
        try {
          const olmSession = this.olmSessions.get(msg.senderIdentityKey);
          if (olmSession) {
            const ourSessionKey = getGroupSessionKey(this.outboundSession);
            const ourKeyPayload = JSON.stringify({
              sessionId: this.outboundSessionId,
              sessionKey: ourSessionKey,
              senderIdentityKey: this.identityKey,
            });
            const encrypted = olmEncrypt(olmSession, ourKeyPayload);
            this.ws.send(
              JSON.stringify({
                type: "key_share",
                targetIdentityKey: msg.senderIdentityKey,
                senderIdentityKey: this.identityKey,
                olmMessage: encrypted,
              }),
            );
          }
        } catch {
          // Reciprocal key share failed — they will not receive our Megolm key
        }
      }
    } catch {
      // Key share decryption failed — report via callback so the UI can surface
      // the failure without exposing internal error details.
      this.onDecryptFailure?.(msg.senderIdentityKey);
    }
  }

  private handleEncryptedMessage(msg: EncryptedMessage): void {
    // Don't process our own messages (we already rendered them locally)
    if (msg.senderIdentityKey === this.identityKey) return;

    const inbound = this.inboundSessions.get(msg.sessionId);
    if (!inbound) {
      this.onMessage?.({
        senderId: msg.senderIdentityKey,
        senderName:
          this.members.get(msg.senderIdentityKey)?.displayName ?? "Unknown",
        plaintext: "",
        timestamp: msg.timestamp,
        encrypted: true,
        decryptionFailed: true,
      });
      return;
    }

    try {
      const { plaintext: paddedPlaintext } = megolmDecrypt(
        inbound,
        msg.ciphertext,
      );
      // Unpad after decryption (reverse of padMessage on send)
      const unpaddedPlaintext = unpadMessage(paddedPlaintext);
      const payload = JSON.parse(unpaddedPlaintext) as {
        text: string;
        sender: string;
        senderName: string;
        taskEvent?: TaskEvent;
        syncEvents?: TaskEvent[];
        sequence?: number;
        rotateKeys?: {
          newSessionId: string;
          previousSessionId: string;
          reason: string;
        };
        migration?: {
          newRoomUrl: string;
          tasks: any[];
        };
        burn?: { reason: string };
      };

      // Use envelope senderIdentityKey (relay-validated) instead of inner
      // payload sender field to prevent impersonation by malicious members.
      // Fall back to member registry for display name, use payload name only
      // if the sender isn't in our member list.
      const trustedSenderId = msg.senderIdentityKey;
      const trustedSenderName =
        this.members.get(trustedSenderId)?.displayName ?? payload.senderName;

      // Track last message time for recency-weighted assignment
      this.lastMessageTimes.set(trustedSenderId, msg.timestamp);

      // Track incoming sequence numbers to detect gaps
      if (payload.sequence !== undefined && payload.sender) {
        this.deliveryTracker.checkReceived(payload.sender, payload.sequence);
      }

      // A burn instruction from another member. Only reachable by someone
      // holding the Megolm key, i.e. an actual member of this room — the same
      // bar as reading any other message here.
      if (payload.burn) {
        this.purgeInitiated = true; // do not reconnect into a room being destroyed
        this.onBurn?.();
        return;
      }

      // Handle migration messages
      if (payload.migration) {
        if (this.onMigrationHandler) {
          this.onMigrationHandler(payload.migration.newRoomUrl, payload.migration.tasks);
        }
        return;
      }

      // Check for rotation signal
      if (payload.rotateKeys) {
        // Clear old inbound sessions except the one for the new session
        const newSessionId = payload.rotateKeys.newSessionId;
        for (const [sid] of this.inboundSessions) {
          if (sid !== newSessionId) {
            this.inboundSessions.delete(sid);
          }
        }
        // Emit a system message about the rotation
        this.onMessage?.({
          senderId: trustedSenderId,
          senderName: trustedSenderName,
          plaintext: "Encryption keys have been rotated.",
          timestamp: msg.timestamp,
          encrypted: true,
          decryptionFailed: false,
        });
        return;
      }

      if (payload.syncEvents && Array.isArray(payload.syncEvents)) {
        this.syncHandler?.(payload.syncEvents);
      }

      this.onMessage?.({
        senderId: trustedSenderId,
        senderName: trustedSenderName,
        plaintext: payload.text,
        timestamp: msg.timestamp,
        encrypted: true,
        decryptionFailed: false,
        ...(payload.taskEvent && { taskEvent: payload.taskEvent }),
      });
    } catch (e) {
      // Decryption failed — show "unable to decrypt" in UI
      this.onMessage?.({
        senderId: msg.senderIdentityKey,
        senderName:
          this.members.get(msg.senderIdentityKey)?.displayName ?? "Unknown",
        plaintext: "",
        timestamp: msg.timestamp,
        encrypted: true,
        decryptionFailed: true,
      });
    }
  }

  /**
   * Whether the room already had members when this session first joined.
   *
   * Null until the first member_list arrives. Used to tell "you opened a link
   * to a room nobody is in" from "you joined a room in progress" — a
   * distinction the relay used to make by refusing the join outright.
   *
   * Deliberately not updated on reconnect: after a relay restart the room is
   * legitimately empty, and that is not a stale link.
   */
  private firstJoinFoundRoom: boolean | null = null;

  /** See firstJoinFoundRoom. Null before the first member list arrives. */
  getFirstJoinFoundRoom(): boolean | null {
    return this.firstJoinFoundRoom;
  }

  private handleMemberList(msg: MemberListMessage): void {
    if (this.firstJoinFoundRoom === null) {
      this.firstJoinFoundRoom = msg.roomExisted ?? msg.members.length > 0;
    }
    for (const member of msg.members) {
      if (member.identityKey !== this.identityKey) {
        this.members.set(member.identityKey, {
          identityKey: member.identityKey,
          displayName: member.displayName,
        });
        // During re-establishment, track which members we need fresh key
        // exchanges with so we can signal when all channels are restored.
        if (this.reestablishing) {
          this.pendingKeyExchanges.add(member.identityKey);
        }
      }
    }
    this.onMembersChanged?.(this.members);
  }

  /**
   * Check whether the account has fallen below the OTK replenishment threshold
   * and, if so, generate a fresh batch and mark them published.
   * Called after each successful inbound Olm session creation so that the pool
   * stays healthy as peers consume keys.
   */
  private checkAndReplenishOTKs(): void {
    if (!this.account) return;
    const count = getOneTimeKeyCount(this.account);
    if (count < OTK_REPLENISH_THRESHOLD) {
      generateOneTimeKeys(this.account, OTK_REPLENISH_COUNT);
      markKeysAsPublished(this.account);
    }
  }

  /**
   * Return the HTTP origin of the relay server (for REST endpoints like /vapid-key).
   * Derives the origin from the same logic as the WebSocket URL.
   */
  getRelayOrigin(): string {
    const envUrl = import.meta.env.VITE_RELAY_URL;
    if (envUrl) {
      // Convert ws(s):// to http(s)://
      return envUrl.replace(/^ws:/, "http:").replace(/^wss:/, "https:");
    }
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    const host = window.location.hostname;
    const port = 3001;
    return `${protocol}//${host}:${port}`;
  }

  /**
   * Send push subscription to relay for server-side push delivery.
   */
  sendPushSubscription(subscription: {
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "push_subscribe",
        subscription: {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.keys?.p256dh,
            auth: subscription.keys?.auth,
          },
        },
        roomId: this.roomId,
        identityKey: this.identityKey,
      }),
    );
  }

  /**
   * Tell relay to remove the push subscription for this identity in this room.
   */
  sendPushUnsubscription(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        type: "push_unsubscribe",
        roomId: this.roomId,
        identityKey: this.identityKey,
      }),
    );
  }

  private getWebSocketUrl(): string {
    const envUrl = import.meta.env.VITE_RELAY_URL;
    if (envUrl) {
      return `${envUrl}/room/${this.roomId}`;
    }
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname;
    const port = 3001;
    return `${protocol}//${host}:${port}/room/${this.roomId}`;
  }
}
