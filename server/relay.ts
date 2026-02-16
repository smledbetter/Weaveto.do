/**
 * WebSocket relay server for weaveto.do.
 * Routes encrypted messages between room members.
 *
 * Security invariants:
 * - No plaintext inspection of messages
 * - No IP address logging
 * - No persistent storage (in-memory only)
 * - No sender identity tracking beyond routing
 * - All incoming messages validated against strict schemas
 * - Fingerprinting headers stripped on upgrade
 */

import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { parse } from "url";

const PORT = parseInt(process.env.PORT || "3001", 10);

// --- Validation constants ---

const MAX_IDENTITY_KEY_LENGTH = 64;
const MAX_DISPLAY_NAME_LENGTH = 32;
const MAX_CIPHERTEXT_LENGTH = 65536;
const MAX_SESSION_ID_LENGTH = 64;
const MAX_ONE_TIME_KEYS = 20;
const MAX_MESSAGE_SIZE = 131072; // 128KB
const ROOM_ID_PATTERN = /^[a-f0-9]{32}$/;

// --- Types ---

interface RoomClient {
  ws: WebSocket;
  identityKey: string;
  displayName: string;
}

interface Room {
  clients: Map<string, RoomClient>;
  creatorIdentityKey?: string;
  ephemeral?: boolean;
}

// --- Validated message types ---

interface ValidatedJoinMessage {
  type: "join";
  identityKey: string;
  ed25519Key: string;
  oneTimeKeys: Record<string, string>;
  displayName: string;
  create?: boolean;
  ephemeral?: boolean;
}

interface ValidatedKeyShareMessage {
  type: "key_share";
  targetIdentityKey: string;
  senderIdentityKey: string;
  olmMessage: { messageType: number; ciphertext: string };
}

interface ValidatedEncryptedMessage {
  type: "encrypted";
  senderIdentityKey: string;
  sessionId: string;
  ciphertext: string;
  timestamp: number;
}

interface ValidatedPurgeMessage {
  type: "purge";
  identityKey: string;
}

type ValidatedMessage =
  | ValidatedJoinMessage
  | ValidatedKeyShareMessage
  | ValidatedEncryptedMessage
  | ValidatedPurgeMessage;

// --- Input validation ---

function isNonEmptyString(val: unknown, maxLen: number): val is string {
  return typeof val === "string" && val.length > 0 && val.length <= maxLen;
}

function isNumber(val: unknown): val is number {
  return typeof val === "number" && Number.isFinite(val);
}

function isObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val);
}

function validateOneTimeKeys(keys: unknown): keys is Record<string, string> {
  if (!isObject(keys)) return false;
  const entries = Object.entries(keys);
  if (entries.length === 0 || entries.length > MAX_ONE_TIME_KEYS) return false;
  return entries.every(
    ([k, v]) =>
      typeof k === "string" &&
      k.length <= MAX_IDENTITY_KEY_LENGTH &&
      typeof v === "string" &&
      v.length <= MAX_IDENTITY_KEY_LENGTH,
  );
}

function validateMessage(raw: unknown): ValidatedMessage | null {
  if (!isObject(raw)) return null;

  switch (raw.type) {
    case "join": {
      if (!isNonEmptyString(raw.identityKey, MAX_IDENTITY_KEY_LENGTH))
        return null;
      if (!isNonEmptyString(raw.ed25519Key, MAX_IDENTITY_KEY_LENGTH))
        return null;
      if (!isNonEmptyString(raw.displayName, MAX_DISPLAY_NAME_LENGTH))
        return null;
      if (!validateOneTimeKeys(raw.oneTimeKeys)) return null;
      if (raw.create !== undefined && typeof raw.create !== "boolean")
        return null;
      if (raw.ephemeral !== undefined && typeof raw.ephemeral !== "boolean")
        return null;
      return raw as ValidatedJoinMessage;
    }
    case "key_share": {
      if (!isNonEmptyString(raw.targetIdentityKey, MAX_IDENTITY_KEY_LENGTH))
        return null;
      if (!isNonEmptyString(raw.senderIdentityKey, MAX_IDENTITY_KEY_LENGTH))
        return null;
      if (!isObject(raw.olmMessage)) return null;
      const olm = raw.olmMessage;
      if (!isNumber(olm.messageType)) return null;
      if (olm.messageType !== 0 && olm.messageType !== 1) return null;
      if (!isNonEmptyString(olm.ciphertext, MAX_CIPHERTEXT_LENGTH)) return null;
      return raw as ValidatedKeyShareMessage;
    }
    case "encrypted": {
      if (!isNonEmptyString(raw.senderIdentityKey, MAX_IDENTITY_KEY_LENGTH))
        return null;
      if (!isNonEmptyString(raw.sessionId, MAX_SESSION_ID_LENGTH)) return null;
      if (!isNonEmptyString(raw.ciphertext, MAX_CIPHERTEXT_LENGTH)) return null;
      if (!isNumber(raw.timestamp)) return null;
      return raw as ValidatedEncryptedMessage;
    }
    case "purge": {
      if (!isNonEmptyString(raw.identityKey, MAX_IDENTITY_KEY_LENGTH))
        return null;
      return raw as ValidatedPurgeMessage;
    }
    default:
      return null;
  }
}

// --- State (in-memory only) ---

const rooms = new Map<string, Room>();

// --- Server ---

const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("weaveto.do relay server");
});

const wss = new WebSocketServer({ noServer: true });

// Handle upgrade manually so we can strip fingerprinting headers
// and validate the path before completing the WebSocket handshake
server.on("upgrade", (request, socket, head) => {
  // Strip headers that could fingerprint clients
  delete request.headers["user-agent"];
  delete request.headers["referer"];
  delete request.headers["accept-language"];

  const url = parse(request.url || "", true);
  const pathParts = (url.pathname || "").split("/").filter(Boolean);

  // Validate path: must be /room/{roomId}
  if (pathParts.length !== 2 || pathParts[0] !== "room") {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  const roomId = pathParts[1];
  if (!ROOM_ID_PATTERN.test(roomId)) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request, roomId);
  });
});

wss.on("connection", (ws: WebSocket, _req: unknown, roomId: string) => {
  let client: RoomClient | null = null;

  ws.on("message", (data) => {
    // Enforce max message size
    const raw = data.toString();
    if (raw.length > MAX_MESSAGE_SIZE) {
      ws.close(4001, "Message too large");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      ws.close(4002, "Invalid JSON");
      return;
    }

    const msg = validateMessage(parsed);
    if (!msg) {
      ws.close(4003, "Invalid message schema");
      return;
    }

    handleMessage(roomId, ws, msg, client, (c) => {
      client = c;
    });
  });

  ws.on("close", () => {
    if (client) {
      removeClient(roomId, client.identityKey);
    }
  });
});

function handleMessage(
  roomId: string,
  ws: WebSocket,
  msg: ValidatedMessage,
  client: RoomClient | null,
  setClient: (c: RoomClient) => void,
): void {
  switch (msg.type) {
    case "join":
      handleJoin(roomId, ws, msg, setClient);
      break;
    case "key_share":
      handleKeyShare(roomId, msg);
      break;
    case "encrypted":
      handleEncrypted(roomId, msg, client);
      break;
    case "purge":
      handlePurge(roomId, ws, msg);
      break;
  }
}

function handleJoin(
  roomId: string,
  ws: WebSocket,
  msg: ValidatedJoinMessage,
  setClient: (c: RoomClient) => void,
): void {
  // Look up or create room
  let room = rooms.get(roomId);
  if (!room) {
    if (!msg.create) {
      // Room doesn't exist and this isn't a creation request
      ws.send(JSON.stringify({ type: "room_not_found" }));
      ws.close(4004, "Room not found");
      return;
    }
    room = {
      clients: new Map(),
      creatorIdentityKey: msg.identityKey,
      ephemeral: msg.ephemeral ?? false,
    };
    rooms.set(roomId, room);
  }

  const client: RoomClient = {
    ws,
    identityKey: msg.identityKey,
    displayName: msg.displayName,
  };
  setClient(client);

  // Notify existing members about the new member
  const newMemberMsg = JSON.stringify({
    type: "new_member",
    identityKey: msg.identityKey,
    ed25519Key: msg.ed25519Key,
    oneTimeKeys: msg.oneTimeKeys,
    displayName: msg.displayName,
  });

  for (const [, existingClient] of room.clients) {
    if (existingClient.ws.readyState === WebSocket.OPEN) {
      existingClient.ws.send(newMemberMsg);
    }
  }

  // Send current member list to the new member
  const memberList = Array.from(room.clients.values()).map((c) => ({
    identityKey: c.identityKey,
    displayName: c.displayName,
  }));

  ws.send(
    JSON.stringify({
      type: "member_list",
      members: memberList,
    }),
  );

  // Add new client to room
  room.clients.set(msg.identityKey, client);
}

function handleKeyShare(roomId: string, msg: ValidatedKeyShareMessage): void {
  const room = rooms.get(roomId);
  if (!room) return;

  const target = room.clients.get(msg.targetIdentityKey);
  if (target && target.ws.readyState === WebSocket.OPEN) {
    // Relay the key share directly — server cannot read it (Olm encrypted)
    target.ws.send(JSON.stringify(msg));
  }
}

function handleEncrypted(
  roomId: string,
  msg: ValidatedEncryptedMessage,
  sender: RoomClient | null,
): void {
  const room = rooms.get(roomId);
  if (!room || !sender) return;

  // Relay ciphertext to all other members — server cannot decrypt
  const serialized = JSON.stringify(msg);
  for (const [key, client] of room.clients) {
    if (key !== sender.identityKey && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(serialized);
    }
  }
}

function handlePurge(
  roomId: string,
  ws: WebSocket,
  msg: ValidatedPurgeMessage,
): void {
  const room = rooms.get(roomId);
  if (!room) {
    ws.close(4004, "Room not found");
    return;
  }

  // Only the creator can purge
  if (room.creatorIdentityKey !== msg.identityKey) {
    ws.send(JSON.stringify({ type: "purge_unauthorized" }));
    return;
  }

  // Broadcast destruction to all clients
  const destroyMsg = JSON.stringify({
    type: "room_destroyed",
    reason: "manual",
  });

  for (const [, client] of room.clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(destroyMsg);
    }
  }

  // Delete room from registry
  rooms.delete(roomId);

  // Close all client connections
  for (const [, client] of room.clients) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.close(4000, "Room purged");
    }
  }
}

function removeClient(roomId: string, identityKey: string): void {
  const room = rooms.get(roomId);
  if (!room) return;

  room.clients.delete(identityKey);

  // Clean up empty rooms
  if (room.clients.size === 0) {
    rooms.delete(roomId);
  } else {
    // Notify remaining members
    const leaveMsg = JSON.stringify({
      type: "member_left",
      identityKey,
    });
    for (const [, client] of room.clients) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(leaveMsg);
      }
    }
  }
}

server.listen(PORT, () => {
  console.log(`weaveto.do relay server listening on port ${PORT}`);
  console.log("No plaintext inspection. No IP logging. No persistent storage.");
});
