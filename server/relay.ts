/**
 * WebSocket relay server for weaveto.do.
 * Routes encrypted messages between room members.
 *
 * Security invariants:
 * - No plaintext inspection of messages
 * - No IP address logging
 * - Client address is a rate-limit key only: held in memory, never logged,
 *   never persisted, released when the connection ends
 * - No persistent storage (in-memory only)
 * - No sender identity tracking beyond routing
 * - All incoming messages validated against strict schemas
 * - Fingerprinting headers stripped on upgrade
 */

import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import type { IncomingHttpHeaders } from "http";
import { parse } from "url";
import { initVapid, getVapidPublicKey, sendPushNotification } from "./vapid.js";
import type { PushSubscriptionData } from "./push-types.js";

const PORT = parseInt(process.env.PORT || "3001", 10);

// --- Validation constants ---

const MAX_IDENTITY_KEY_LENGTH = 64;
const MAX_DISPLAY_NAME_LENGTH = 32;
const MAX_CIPHERTEXT_LENGTH = 65536;
const MAX_SESSION_ID_LENGTH = 64;
const MAX_ONE_TIME_KEYS = 20;
const MAX_MESSAGE_SIZE = 131072; // 128KB
const MAX_IP_KEY_LENGTH = 45; // longest textual IPv6 address
const ROOM_ID_PATTERN = /^[a-f0-9]{32}$/;

// --- Rate limiting / connection limit constants ---

const MAX_ROOMS = 10_000;
const MAX_CONNECTIONS = 5_000;
const MAX_CLIENTS_PER_ROOM = 50;
const MAX_CONNECTIONS_PER_IP = 10;
const MSG_RATE_LIMIT = 30; // messages per second per connection

// --- Liveness and shutdown constants ---

/** How often every connection is pinged to prove it is still there. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * How long clients get to act on a restart notice before the relay closes on
 * them. SHUTDOWN_DRAIN_MS + SHUTDOWN_CLOSE_GRACE_MS must stay comfortably
 * under the platform's kill timeout (fly.io defaults to 5s), otherwise the
 * process is SIGKILLed mid-drain and the notice buys nothing.
 */
const SHUTDOWN_DRAIN_MS = 2_000;

/** Time for close frames to reach the wire before the process exits. */
const SHUTDOWN_CLOSE_GRACE_MS = 250;

/** Reconnect hint carried by the restart notice. */
const RECONNECT_HINT_MS = 3_000;

// --- Types ---

export interface RoomClient {
  ws: WebSocket;
  identityKey: string;
  displayName: string;
}

export interface Room {
  clients: Map<string, RoomClient>;
  creatorIdentityKey?: string;
  ephemeral?: boolean;
}

/**
 * A socket carrying its own liveness flag. `ws` has no built-in dead-peer
 * detection, so the heartbeat stores the last pong result on the socket.
 */
type TrackedSocket = WebSocket & { isAlive?: boolean };

/** The parts of a socket the heartbeat sweep needs. Narrowed so tests can fake it. */
interface Pingable {
  isAlive?: boolean;
  ping(): void;
  terminate(): void;
}

/** The parts of a socket the shutdown drain needs. Narrowed so tests can fake it. */
interface Drainable {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** Live connection accounting. Both fields are released when a socket closes. */
interface ConnectionCounts {
  /** Total active WebSocket connections across all rooms. */
  total: number;
  /** Active connections keyed by client address. Rate-limit key only. */
  perIp: Map<string, number>;
}

/** Outcome of the upgrade gate: either a room to join or a status to refuse with. */
interface UpgradeDecision {
  accept: boolean;
  /** Set when the upgrade is refused. */
  status?: number;
  /** Reason phrase paired with `status`. */
  statusText?: string;
  /** Set when the upgrade is accepted. */
  roomId?: string;
}

// --- Server -> client messages ---

/**
 * Restart notice, sent to every open connection when the relay gets SIGTERM.
 *
 *   { "type": "server_restarting", "reconnectAfterMs": 3000 }
 *
 * Rooms live in this process and nowhere else, so a deploy destroys every one
 * of them. Without a notice the client sees an ordinary socket drop and cannot
 * tell a planned restart from a flaky network, or from `room_destroyed`, which
 * is permanent. This says "the room is coming back, come with it".
 *
 * `reconnectAfterMs` is a hint, not a contract: roughly how long to wait before
 * the first reconnect attempt. Clients should add their own jitter so a full
 * room does not reconnect in lockstep.
 */
export interface ServerRestartingMessage {
  type: "server_restarting";
  reconnectAfterMs: number;
}

// --- Validated message types ---

interface ValidatedPushSubscribeMessage {
  type: "push_subscribe";
  subscription: PushSubscriptionData;
  roomId: string;
  identityKey: string;
}

interface ValidatedPushUnsubscribeMessage {
  type: "push_unsubscribe";
  roomId: string;
  identityKey: string;
}

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
  | ValidatedPurgeMessage
  | ValidatedPushSubscribeMessage
  | ValidatedPushUnsubscribeMessage;

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

/**
 * The per-field checks in each branch are the real validation. TypeScript
 * cannot follow them, so the return casts go through `unknown`: the guarantee
 * comes from the checks above each one, not from the compiler.
 */
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
      return raw as unknown as ValidatedJoinMessage;
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
      return raw as unknown as ValidatedKeyShareMessage;
    }
    case "encrypted": {
      if (!isNonEmptyString(raw.senderIdentityKey, MAX_IDENTITY_KEY_LENGTH))
        return null;
      if (!isNonEmptyString(raw.sessionId, MAX_SESSION_ID_LENGTH)) return null;
      if (!isNonEmptyString(raw.ciphertext, MAX_CIPHERTEXT_LENGTH)) return null;
      if (!isNumber(raw.timestamp)) return null;
      return raw as unknown as ValidatedEncryptedMessage;
    }
    case "purge": {
      if (!isNonEmptyString(raw.identityKey, MAX_IDENTITY_KEY_LENGTH))
        return null;
      return raw as unknown as ValidatedPurgeMessage;
    }
    case "push_subscribe": {
      if (!isNonEmptyString(raw.roomId, 32)) return null;
      if (!isNonEmptyString(raw.identityKey, MAX_IDENTITY_KEY_LENGTH))
        return null;
      if (!isObject(raw.subscription)) return null;
      const sub = raw.subscription;
      if (!isNonEmptyString(sub.endpoint, 2048)) return null;
      if (!isObject(sub.keys)) return null;
      const keys = sub.keys;
      if (!isNonEmptyString(keys.p256dh, 256)) return null;
      if (!isNonEmptyString(keys.auth, 64)) return null;
      return raw as unknown as ValidatedPushSubscribeMessage;
    }
    case "push_unsubscribe": {
      if (!isNonEmptyString(raw.roomId, 32)) return null;
      if (!isNonEmptyString(raw.identityKey, MAX_IDENTITY_KEY_LENGTH))
        return null;
      return raw as unknown as ValidatedPushUnsubscribeMessage;
    }
    default:
      return null;
  }
}

// --- State (in-memory only) ---

const rooms = new Map<string, Room>();

// Push subscriptions per room: Map<roomId, Map<identityKey, PushSubscriptionData>>
const pushSubscriptions = new Map<string, Map<string, PushSubscriptionData>>();

// --- Connection tracking ---

const counts: ConnectionCounts = { total: 0, perIp: new Map() };

// --- Allowed origins ---

const ALLOWED_ORIGINS = new Set([
  "http://localhost:5173",
  "http://localhost:4173",
  "https://weaveto.do",
  ...(process.env.ALLOWED_ORIGINS?.split(",").filter(Boolean) ?? []),
]);

/**
 * Whether the proxy's client-address header can be believed.
 *
 * Fly injects FLY_APP_NAME into every machine it runs, so its presence is a
 * reliable "this process sits behind the fly proxy" signal. TRUST_PROXY_HEADER
 * is an explicit override for any other proxy that sets the same header.
 */
const TRUST_PROXY =
  process.env.FLY_APP_NAME !== undefined ||
  process.env.TRUST_PROXY_HEADER === "1";

// --- Connection accounting (pure, exported for tests) ---

/**
 * Pick the rate-limit key for a connection.
 *
 * Behind the fly.io proxy every socket reports the proxy's own address, so
 * keying MAX_CONNECTIONS_PER_IP on `socket.remoteAddress` puts the entire
 * internet into a single bucket of ten. Fly sets Fly-Client-IP to the real
 * client address and overwrites whatever the client sent, so it is trustworthy
 * exactly when we know we are behind that proxy — and only then. Trusting it
 * unconditionally would let any client mint a fresh bucket per connection and
 * walk straight past the cap, so an unproxied deployment keeps using the socket
 * address.
 *
 * X-Forwarded-For is deliberately not consulted. Fly appends to whatever the
 * client already put there, so the trustworthy entry is the last one, and
 * reading the wrong end of that list is the same spoofable bypass.
 *
 * The return value is a rate-limit key. It is never logged and never stored.
 */
export function resolveClientIp(
  headers: IncomingHttpHeaders,
  socketAddress: string | undefined,
  trustProxy: boolean,
): string {
  if (trustProxy) {
    const header = headers["fly-client-ip"];
    const value = Array.isArray(header) ? header[0] : header;
    // Length-bounded so a hostile header cannot grow an unbounded map key.
    if (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= MAX_IP_KEY_LENGTH
    ) {
      return value;
    }
  }
  return socketAddress ?? "unknown";
}

/** Claim a connection slot for `ip`. Pairs with releaseConnection. */
export function acquireConnection(state: ConnectionCounts, ip: string): void {
  state.perIp.set(ip, (state.perIp.get(ip) ?? 0) + 1);
  state.total++;
}

/**
 * Give back a connection slot.
 *
 * Every path that removes a socket has to reach this, including the heartbeat
 * reaping a half-open one. A slot that is claimed and never released is a slot
 * lost for the lifetime of the process.
 */
export function releaseConnection(state: ConnectionCounts, ip: string): void {
  const current = state.perIp.get(ip) ?? 1;
  if (current <= 1) {
    state.perIp.delete(ip);
  } else {
    state.perIp.set(ip, current - 1);
  }
  state.total = Math.max(0, state.total - 1);
}

/**
 * Decide whether to complete a WebSocket handshake.
 *
 * Checks run in the same order, and refuse with the same statuses, as they did
 * when this logic was inline in the upgrade handler.
 */
export function evaluateUpgrade(
  request: { origin: string | undefined; pathname: string; ip: string },
  state: ConnectionCounts,
  allowedOrigins: ReadonlySet<string>,
): UpgradeDecision {
  // Origin validation — allow browser origins we serve and non-browser clients
  if (request.origin !== undefined && !allowedOrigins.has(request.origin)) {
    return { accept: false, status: 403, statusText: "Forbidden" };
  }

  if (state.total >= MAX_CONNECTIONS) {
    return { accept: false, status: 503, statusText: "Service Unavailable" };
  }

  if ((state.perIp.get(request.ip) ?? 0) >= MAX_CONNECTIONS_PER_IP) {
    return { accept: false, status: 429, statusText: "Too Many Requests" };
  }

  // Validate path: must be /room/{roomId}
  const pathParts = request.pathname.split("/").filter(Boolean);
  if (pathParts.length !== 2 || pathParts[0] !== "room") {
    return { accept: false, status: 400, statusText: "Bad Request" };
  }

  const roomId = pathParts[1];
  if (!ROOM_ID_PATTERN.test(roomId)) {
    return { accept: false, status: 400, statusText: "Bad Request" };
  }

  return { accept: true, roomId };
}

// --- Liveness and shutdown (pure, exported for tests) ---

/**
 * Run one heartbeat sweep. Returns the number of sockets reaped.
 *
 * A half-open TCP socket never fires `close`, so without a sweep its slot in
 * `counts` is never released and the caps ratchet closed until live clients get
 * 429s and 503s from a relay with no real load on it. `terminate()` makes `ws`
 * emit `close`, and that is what returns the slot.
 *
 * A socket with no flag yet is treated as alive: it has not been asked, so it
 * cannot have failed to answer.
 */
export function sweepHeartbeat(sockets: Iterable<Pingable>): number {
  let reaped = 0;
  for (const socket of sockets) {
    if (socket.isAlive === false) {
      socket.terminate();
      reaped++;
      continue;
    }
    // Mark unanswered before asking. The pong handler sets it back to true.
    socket.isAlive = false;
    socket.ping();
  }
  return reaped;
}

/** Serialize the restart notice. */
export function buildRestartNotice(
  reconnectAfterMs: number = RECONNECT_HINT_MS,
): string {
  const notice: ServerRestartingMessage = {
    type: "server_restarting",
    reconnectAfterMs,
  };
  return JSON.stringify(notice);
}

/** Send the restart notice to every open socket. Returns how many were told. */
export function notifyRestart(
  sockets: Iterable<Drainable>,
  notice: string,
): number {
  let notified = 0;
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(notice);
      notified++;
    }
  }
  return notified;
}

/**
 * Close whatever is still connected once the drain window is up.
 *
 * 1001 Going Away is the close code for a server shutting down, which lets a
 * client distinguish this from the application-level 4xxx codes used elsewhere.
 */
export function closeRemaining(sockets: Iterable<Drainable>): number {
  let closed = 0;
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN) {
      socket.close(1001, "Server restarting");
      closed++;
    }
  }
  return closed;
}

// --- Server ---

const server = createServer((req, res) => {
  if (req.url === "/vapid-key" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ publicKey: getVapidPublicKey() }));
    return;
  }
  res.writeHead(200);
  res.end("OK");
});

const wss = new WebSocketServer({ noServer: true });

// Handle upgrade manually so we can strip fingerprinting headers
// and validate the path before completing the WebSocket handshake
server.on("upgrade", (request, socket, head) => {
  // Strip headers that could fingerprint clients
  delete request.headers["user-agent"];
  delete request.headers["referer"];
  delete request.headers["accept-language"];

  const ip = resolveClientIp(
    request.headers,
    request.socket.remoteAddress,
    TRUST_PROXY,
  );
  const url = parse(request.url || "", true);

  const decision = evaluateUpgrade(
    { origin: request.headers.origin, pathname: url.pathname || "", ip },
    counts,
    ALLOWED_ORIGINS,
  );

  if (!decision.accept) {
    socket.write(`HTTP/1.1 ${decision.status} ${decision.statusText}\r\n\r\n`);
    socket.destroy();
    return;
  }

  // evaluateUpgrade always sets roomId on the accepting path.
  const roomId = decision.roomId as string;

  // Track IP and total before handing off
  acquireConnection(counts, ip);

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request, roomId, ip);
  });
});

wss.on(
  "connection",
  (ws: WebSocket, _req: unknown, roomId: string, ip: string) => {
    let client: RoomClient | null = null;

    // Heartbeat liveness. A pong is the only proof the peer is still reachable;
    // a half-open socket stays "open" forever otherwise.
    const tracked = ws as TrackedSocket;
    tracked.isAlive = true;
    ws.on("pong", () => {
      tracked.isAlive = true;
    });

    // Per-connection message timestamps for rate limiting
    const msgTimestamps: number[] = [];

    ws.on("message", (data) => {
      // Rate limiting: allow at most MSG_RATE_LIMIT messages per second
      const now = Date.now();
      // Drop timestamps older than 1 second
      while (msgTimestamps.length > 0 && now - msgTimestamps[0] > 1000) {
        msgTimestamps.shift();
      }
      if (msgTimestamps.length >= MSG_RATE_LIMIT) {
        ws.close(4029, "Rate limit exceeded");
        return;
      }
      msgTimestamps.push(now);

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
      releaseConnection(counts, ip);

      if (client) {
        removeClient(roomId, client.identityKey, rooms, pushSubscriptions);
      }
    });
  },
);

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
      handleKeyShare(roomId, msg, client);
      break;
    case "encrypted":
      handleEncrypted(roomId, msg, client);
      break;
    case "purge":
      handlePurge(roomId, ws, msg, client);
      break;
    case "push_subscribe":
      handlePushSubscribe(msg, client);
      break;
    case "push_unsubscribe":
      handlePushUnsubscribe(msg, client);
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
    // Enforce room count limit
    if (rooms.size >= MAX_ROOMS) {
      ws.send(JSON.stringify({ type: "server_full" }));
      ws.close(4008, "Server full");
      return;
    }
    room = {
      clients: new Map(),
      creatorIdentityKey: msg.identityKey,
      ephemeral: msg.ephemeral ?? false,
    };
    rooms.set(roomId, room);
  }

  // Enforce per-room client limit
  if (room.clients.size >= MAX_CLIENTS_PER_ROOM) {
    ws.send(JSON.stringify({ type: "room_full" }));
    ws.close(4009, "Room full");
    return;
  }

  // Identity key collision: close the old connection before inserting the new one
  const existing = room.clients.get(msg.identityKey);
  if (existing) {
    existing.ws.close(4005, "Replaced by new connection");
    room.clients.delete(msg.identityKey);
  }

  const client: RoomClient = {
    ws,
    identityKey: msg.identityKey,
    displayName: msg.displayName,
  };
  setClient(client);

  // Send current member list to the new member (before adding them to the room)
  const memberList = Array.from(room.clients.values()).map((c) => ({
    identityKey: c.identityKey,
    displayName: c.displayName,
  }));

  // Add new client to room BEFORE notifying existing members, so that
  // key_share responses targeting this client can be routed immediately.
  room.clients.set(msg.identityKey, client);

  // Notify existing members about the new member
  const newMemberMsg = JSON.stringify({
    type: "new_member",
    identityKey: msg.identityKey,
    ed25519Key: msg.ed25519Key,
    oneTimeKeys: msg.oneTimeKeys,
    displayName: msg.displayName,
  });

  for (const [, existingClient] of room.clients) {
    // Skip the new client — they don't need their own new_member notification
    if (existingClient.identityKey === msg.identityKey) continue;
    if (existingClient.ws.readyState === WebSocket.OPEN) {
      existingClient.ws.send(newMemberMsg);
    }
  }

  ws.send(
    JSON.stringify({
      type: "member_list",
      members: memberList,
    }),
  );
}

function handleKeyShare(
  roomId: string,
  msg: ValidatedKeyShareMessage,
  client: RoomClient | null,
): void {
  const room = rooms.get(roomId);
  if (!room) return;

  // Verify the sender is actually in the room and is who they claim to be
  if (!client || !room.clients.has(client.identityKey)) return;
  if (msg.senderIdentityKey !== client.identityKey) return;

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

  // Verify the sender is who they claim to be
  if (msg.senderIdentityKey !== sender.identityKey) return;

  // Relay ciphertext to all other members — server cannot decrypt
  const serialized = JSON.stringify(msg);
  for (const [key, client] of room.clients) {
    if (key !== sender.identityKey && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(serialized);
    }
  }

  // Send push notifications to subscribed clients who are NOT connected via WebSocket
  const roomSubs = pushSubscriptions.get(roomId);
  if (roomSubs) {
    for (const [subIdentityKey, subscription] of roomSubs) {
      // Don't push to the sender
      if (subIdentityKey === sender.identityKey) continue;
      // Don't push to clients currently connected via WebSocket
      if (room.clients.has(subIdentityKey)) continue;
      // Fire-and-forget: handle 410 Gone to remove stale subscriptions
      sendPushNotification(subscription, "").then((result) => {
        if (result === "gone") {
          roomSubs.delete(subIdentityKey);
          if (roomSubs.size === 0) pushSubscriptions.delete(roomId);
        }
      });
    }
  }
}

function handlePurge(
  roomId: string,
  ws: WebSocket,
  msg: ValidatedPurgeMessage,
  client: RoomClient | null,
): void {
  const room = rooms.get(roomId);
  if (!room) {
    ws.close(4004, "Room not found");
    return;
  }

  // Only the creator can purge — use the connection's actual identity, not self-reported msg.identityKey
  if (room.creatorIdentityKey !== client?.identityKey) {
    ws.send(JSON.stringify({ type: "purge_unauthorized" }));
    return;
  }

  // Broadcast destruction to all clients
  const destroyMsg = JSON.stringify({
    type: "room_destroyed",
    reason: "manual",
  });

  for (const [, c] of room.clients) {
    if (c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(destroyMsg);
    }
  }

  // Delete room from registry and clean up push subscriptions
  deleteRoomState(roomId, rooms, pushSubscriptions);

  // Close all client connections after a short delay
  // to allow clients to process the room_destroyed message
  const clientsToClose = Array.from(room.clients.values());
  setTimeout(() => {
    for (const c of clientsToClose) {
      if (c.ws.readyState === WebSocket.OPEN) {
        c.ws.close(4000, "Room purged");
      }
    }
  }, 100);
}

function handlePushSubscribe(
  msg: ValidatedPushSubscribeMessage,
  client: RoomClient | null,
): void {
  // Verify the authenticated client matches the claimed identity key
  if (!client || client.identityKey !== msg.identityKey) return;

  const roomSubs =
    pushSubscriptions.get(msg.roomId) ?? new Map<string, PushSubscriptionData>();
  roomSubs.set(msg.identityKey, msg.subscription);
  pushSubscriptions.set(msg.roomId, roomSubs);
}

function handlePushUnsubscribe(
  msg: ValidatedPushUnsubscribeMessage,
  client: RoomClient | null,
): void {
  // Verify the authenticated client matches the claimed identity key
  if (!client || client.identityKey !== msg.identityKey) return;

  const roomSubs = pushSubscriptions.get(msg.roomId);
  if (roomSubs) {
    roomSubs.delete(msg.identityKey);
    if (roomSubs.size === 0) pushSubscriptions.delete(msg.roomId);
  }
}

/**
 * Drop every trace of a room from memory.
 *
 * `rooms` and `pushSubscriptions` are keyed independently, so deleting the room
 * alone strands its push endpoints for the life of the process — an unbounded
 * leak, and retention of contact data the privacy policy says is not retained.
 * The stranded entries are also unreachable: once the room is gone
 * handleEncrypted returns early, so nothing can ever push to them again.
 */
export function deleteRoomState(
  roomId: string,
  roomRegistry: Map<string, unknown>,
  pushRegistry: Map<string, unknown>,
): void {
  roomRegistry.delete(roomId);
  pushRegistry.delete(roomId);
}

/**
 * Remove a client from its room and clean up if that emptied the room.
 *
 * The registries are parameters rather than the module globals so this can be
 * exercised directly against known state.
 */
export function removeClient(
  roomId: string,
  identityKey: string,
  roomRegistry: Map<string, Room>,
  pushRegistry: Map<string, Map<string, PushSubscriptionData>>,
): void {
  const room = roomRegistry.get(roomId);
  if (!room) return;

  room.clients.delete(identityKey);

  // Clean up empty rooms
  if (room.clients.size === 0) {
    deleteRoomState(roomId, roomRegistry, pushRegistry);
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

// --- Bootstrap ---

let heartbeat: ReturnType<typeof setInterval> | null = null;
let shuttingDown = false;

/**
 * Wind down on SIGTERM instead of dropping every socket on the floor.
 *
 * Rooms exist only in this process, so a deploy takes all of them with it. The
 * restart notice is what lets a client come back to the room rather than treat
 * the drop as the room ending.
 */
function shutdown(): void {
  if (shuttingDown) {
    // A second signal means "stop waiting" — skip the drain and go.
    process.exit(0);
  }
  shuttingDown = true;

  if (heartbeat !== null) clearInterval(heartbeat);

  // Refuse new connections first, so nobody joins a room that is about to go.
  server.close();

  notifyRestart(wss.clients, buildRestartNotice());

  setTimeout(() => {
    closeRemaining(wss.clients);
    // Close frames are written asynchronously; let them reach the wire.
    setTimeout(() => process.exit(0), SHUTDOWN_CLOSE_GRACE_MS);
  }, SHUTDOWN_DRAIN_MS);
}

function main(): void {
  initVapid();

  heartbeat = setInterval(() => {
    sweepHeartbeat(wss.clients);
  }, HEARTBEAT_INTERVAL_MS);

  process.on("SIGTERM", shutdown);
  // Same path for a local Ctrl-C, so dev and production drain identically.
  process.on("SIGINT", shutdown);

  server.listen(PORT, () => {
    console.log(`weaveto.do relay server listening on port ${PORT}`);
    console.log(
      "No plaintext inspection. No IP logging. No persistent storage.",
    );
  });
}

// Vitest imports this module to exercise the exported helpers above. Binding a
// port there would collide between test files and hold the runner open, so the
// bootstrap is skipped under the test runner and only there. VITEST is unset in
// every real deployment, so the fail-safe direction is "start the server".
if (!process.env.VITEST) {
  main();
}
