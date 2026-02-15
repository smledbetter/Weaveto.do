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

type ServerMessage =
  | NewMemberMessage
  | KeyShareMessage
  | EncryptedMessage
  | MemberListMessage
  | RoomNotFoundMessage;

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
    options?: { prfSeed?: Uint8Array; isCreator?: boolean },
  ) {
    this.roomId = roomId;
    this.displayName = displayName;
    this.prfSeed = options?.prfSeed ?? null;
    this.isCreator = options?.isCreator ?? false;
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
      };

      ws.onerror = () => {
        this.onConnectionChanged?.(false);
        reject(new Error("WebSocket connection failed"));
      };
    });
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
   * Disconnect and clean up.
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.account = null;
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
    } catch (e) {
      // Olm session establishment failed — member won't receive our Megolm key
    }
  }

  private handleKeyShare(msg: KeyShareMessage): void {
    if (!this.account) return;
    if (msg.targetIdentityKey !== this.identityKey) return;

    try {
      // Create inbound Olm session and decrypt the key share
      const { session, plaintext } = createInboundSession(
        this.account,
        msg.senderIdentityKey,
        msg.olmMessage,
      );

      this.olmSessions.set(msg.senderIdentityKey, session);

      // Parse the Megolm session key
      const keyData = JSON.parse(plaintext) as {
        sessionId: string;
        sessionKey: string;
        senderIdentityKey: string;
      };

      // Create inbound Megolm session
      const inbound = createInboundGroupSession(keyData.sessionKey);
      this.inboundSessions.set(keyData.sessionId, inbound);
    } catch (e) {
      // Key share decryption failed — won't be able to decrypt this sender's messages
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
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = window.location.hostname;
    const port = 3001; // Relay server port
    return `${protocol}//${host}:${port}/room/${this.roomId}`;
  }
}
