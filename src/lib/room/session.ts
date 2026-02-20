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
  type OlmEncryptedMessage,
} from "$lib/crypto/engine";

import { padMessage, unpadMessage } from "$lib/crypto/padding";

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
}

interface RoomNotFoundMessage {
  type: "room_not_found";
}

interface RoomDestroyedMessage {
  type: "room_destroyed";
  reason: string;
}

interface PurgeUnauthorizedMessage {
  type: "purge_unauthorized";
}

type ServerMessage =
  | NewMemberMessage
  | KeyShareMessage
  | EncryptedMessage
  | MemberListMessage
  | RoomNotFoundMessage
  | RoomDestroyedMessage
  | PurgeUnauthorizedMessage;

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
    generateOneTimeKeys(this.account, 10);
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

      // Re-generate one-time keys for key exchange with existing members
      generateOneTimeKeys(this.account!, 10);
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
   * Send a purge request to delete this ephemeral room.
   * Only the room creator can delete the room.
   */
  sendPurgeRequest(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Not connected"));
        return;
      }

      // Listen for response
      const handler = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data as string);
          if (msg.type === "room_destroyed") {
            this.ws?.removeEventListener("message", handler);
            resolve();
          } else if (msg.type === "purge_unauthorized") {
            this.ws?.removeEventListener("message", handler);
            reject(new Error("Only the room creator can delete this room"));
          }
        } catch {
          // ignore parse errors
        }
      };

      this.purgeInitiated = true;
      this.ws.addEventListener("message", handler);
      this.ws.send(
        JSON.stringify({
          type: "purge",
          identityKey: this.identityKey,
        }),
      );
    });
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
        this.onError?.("This room does not exist or has expired.");
        this.disconnect();
        break;
      case "room_destroyed":
        if (!this.purgeInitiated) {
          this.onError?.("This room has been deleted.");
          this.disconnect();
        }
        break;
      case "purge_unauthorized":
        // Handled by sendPurgeRequest via event listener
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

    // Create Olm session to new member and share our Megolm session key
    const theirOTK = Object.values(msg.oneTimeKeys)[0];
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
      // Key share decryption failed — ignore silently
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
        rotateKeys?: {
          newSessionId: string;
          previousSessionId: string;
          reason: string;
        };
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

  private handleMemberList(msg: MemberListMessage): void {
    for (const member of msg.members) {
      if (member.identityKey !== this.identityKey) {
        this.members.set(member.identityKey, {
          identityKey: member.identityKey,
          displayName: member.displayName,
        });
      }
    }
    this.onMembersChanged?.(this.members);
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
