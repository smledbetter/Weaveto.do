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

/**
 * Bounded by MAX_CONNECTIONS in practice: a room is deleted when its last
 * client leaves, so live rooms can never exceed live connections. Kept, and
 * set to the number that actually binds, so it means what a reader assumes.
 */
const MAX_ROOMS = 5_000;
const MAX_CONNECTIONS = 5_000;
/**
 * Every message to a room of n is relayed n-1 times, so this constant is the
 * amplification factor. At 50 the measured relay lost a third of all messages
 * inside its own caps. Ten holds amplification to 9x, and a shared to-do list
 * with more than ten people in it is a different product.
 */
const MAX_CLIENTS_PER_ROOM = 10;
const MAX_CONNECTIONS_PER_IP = 10;
/**
 * Messages per second per connection, counted before the frame is parsed.
 *
 * This is a cheap guard against a client burning CPU, not the thing that
 * bounds fan-out. It has to clear the protocol's own worst burst: joining or
 * re-keying sends one `key_share` per member in a tight loop, so a client in a
 * full room legitimately emits MAX_CLIENTS_PER_ROOM - 1 frames back to back.
 * Set below that and key rotation disconnects itself with 4029, which is what
 * a first pass at cutting this constant to 5 actually did.
 */
const MSG_RATE_LIMIT = 20;

/**
 * Encrypted messages per second per connection, counted after parsing.
 *
 * `encrypted` is the only type the relay broadcasts, so it is the only type
 * that multiplies: one frame in becomes MAX_CLIENTS_PER_ROOM - 1 frames out.
 * Every other type is routed to a single peer or handled locally, so counting
 * them against the same budget would price a 1x path like a 9x one.
 *
 * This is the constant that bounds the aggregate. With MAX_CONNECTIONS at
 * 5,000 and MAX_CLIENTS_PER_ROOM at 10, the worst case the caps permit is
 * 5,000 x 5 x 9 = 225,000 outbound per second, against a measured loss
 * threshold near 240,000. See docs/CAPACITY.md.
 */
const BROADCAST_RATE_LIMIT = 5;

/**
 * The window the broadcast budget is averaged over.
 *
 * A one-second window with no burst allowance cannot tell sustained abuse from
 * a client whose timer slipped. Measured: senders pacing themselves at 4/s
 * against a 5-per-second budget still collected 6,317 disconnects, and they
 * started at exactly the load where p95 crossed a second — the relay slowing
 * down is what bunched the sends that then looked like abuse. A real client
 * bunches for duller reasons: a GC pause, a backgrounded tab, a flaky radio.
 *
 * Averaging keeps the sustained rate, and with it the aggregate bound, exactly
 * the same. It only stops charging a client for the arrival pattern of its
 * packets. A burst inside the window is still bounded by MSG_RATE_LIMIT per
 * second and by MAX_BUFFERED_BYTES per socket, so widening it costs nothing
 * the caps were relying on.
 *
 * Four seconds, which is the configuration every number in docs/CAPACITY.md
 * was measured against. Widening it was tried as a way to survive bulk task
 * creation and abandoned: the client sends fewer frames now instead, so the
 * relay ships the configuration that was actually measured.
 */
const BROADCAST_WINDOW_MS = 4_000;

/** Frames of type `encrypted` allowed per BROADCAST_WINDOW_MS. */
const BROADCAST_BUDGET =
  BROADCAST_RATE_LIMIT * (BROADCAST_WINDOW_MS / 1000);

/**
 * How many bytes may be queued for one connection before it is dropped.
 *
 * `handleEncrypted` used to send to every member without ever asking whether
 * the last send had left the process. A member who cannot drain as fast as
 * their room produces then accumulates an unbounded queue, and there can be
 * MAX_CONNECTIONS of them. Under a load every declared cap permitted, that
 * reached 463 MiB on a 1 GB machine with 31% of messages never arriving. See
 * docs/CAPACITY.md.
 *
 * Eight frames of headroom: enough that an ordinary burst rides through, small
 * enough that the aggregate stays bounded by a number worth stating.
 */
const MAX_BUFFERED_BYTES = 8 * MAX_MESSAGE_SIZE;

/**
 * Push subscriptions kept for one room.
 *
 * The map is keyed by identity key, so it grows with every distinct identity
 * that has ever subscribed while the room lived, not with the current member
 * count. MAX_CLIENTS_PER_ROOM does not bound it. Without a cap, a long-lived
 * room accumulates endpoints without limit, and every one of them costs an
 * outbound HTTPS request on every message.
 *
 * A push subscription is only useful to a member, and a room can never hold
 * more than MAX_CLIENTS_PER_ROOM members at once, so that is the cap.
 */
const MAX_PUSH_SUBS_PER_ROOM = MAX_CLIENTS_PER_ROOM;

/**
 * How long to wait before pushing to the same subscriber again.
 *
 * The push carries no payload. sendPushNotification posts an empty body, so
 * twenty messages produce twenty identical contentless notifications. That is
 * twenty outbound HTTPS requests to tell someone the same thing once.
 *
 * A cooldown bounds the push rate independently of the message rate, which is
 * the property that matters: without it, one chatty room turns into an
 * unbounded outbound request rate against a third-party push service.
 */
const PUSH_COOLDOWN_MS = 30_000;

/**
 * Most push requests in flight at once, across every room.
 *
 * These are fire-and-forget fetches. Nothing awaited them and nothing counted
 * them, so a burst could open an unbounded number of sockets and hold their
 * buffers. Push is best-effort by nature, so shedding past the cap is the
 * correct behaviour rather than a compromise.
 */
const MAX_PUSH_IN_FLIGHT = 64;

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

/**
 * A room is the set of connections currently holding it, and nothing else.
 *
 * It is a derived view, not a record. The relay keeps this index to route
 * messages, but losing it costs only a reconnect: any well-formed join
 * reconstitutes the room from whoever arrives. That is what makes a restart
 * survivable and what lets a second process serve a different room without
 * any shared store.
 *
 * There is deliberately no creator and no ephemeral flag. Ephemeral mode is a
 * client behaviour, and burn is an encrypted message between members that the
 * relay never sees. See docs/RELAY-DESIGN.md.
 */
export interface Room {
  clients: Map<string, RoomClient>;
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

type ValidatedMessage =
  | ValidatedJoinMessage
  | ValidatedKeyShareMessage
  | ValidatedEncryptedMessage
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
      // `create` and `ephemeral` are accepted and ignored for older clients.
      // Any join reconstitutes the room, and ephemeral mode is client-side.
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

/**
 * When each subscriber was last pushed to, per room.
 *
 * Nested rather than keyed on a joined string so deleteRoomState can drop a
 * room's cooldowns in one operation. A third registry keyed independently of
 * `rooms` is exactly the leak deleteRoomState was written to fix, and a flat
 * map would have reintroduced it in a form no existing test covered.
 */
const lastPushAt = new Map<string, Map<string, number>>();

/** Push requests currently in flight. See MAX_PUSH_IN_FLIGHT. */
let pushInFlight = 0;

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

    // Per-connection message timestamps for rate limiting. Two windows: every
    // frame counts against the first, only broadcasts against the second.
    const msgTimestamps: number[] = [];
    const broadcastTimestamps: number[] = [];

    ws.on("message", (data) => {
      // Rate limiting: allow at most MSG_RATE_LIMIT messages per second.
      // Checked before parsing, so an abusive client is rejected cheaply.
      const now = Date.now();
      if (!admitToWindow(msgTimestamps, now, MSG_RATE_LIMIT)) {
        ws.close(4029, "Rate limit exceeded");
        return;
      }

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

      // The broadcast budget is separate and much tighter, because an
      // `encrypted` frame is the only one the relay multiplies. It can only be
      // charged after the type is known, which is why it sits after the parse.
      if (msg.type === "encrypted") {
        if (
          !admitToWindow(
            broadcastTimestamps,
            now,
            BROADCAST_BUDGET,
            BROADCAST_WINDOW_MS,
          )
        ) {
          ws.close(4029, "Rate limit exceeded");
          return;
        }
      }

      handleMessage(roomId, ws, msg, client, (c) => {
        client = c;
      });
    });

    ws.on("close", () => {
      releaseConnection(counts, ip);

      if (client) {
        removeClient(
          roomId,
          client.identityKey,
          rooms,
          pushSubscriptions,
          lastPushAt,
        );
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
  // Any well-formed join reconstitutes the room. The room ID is 128 bits of
  // client-generated randomness and the relay holds no secret about it, so
  // there is nothing for the relay to authorise here — it is a routing key.
  //
  // This is what makes a restart survivable: members reconnect, the first one
  // back recreates the routing entry, and the rest join it. Refusing a join
  // for a room the relay has forgotten is how a deploy used to end every
  // conversation with "this room does not exist or has expired".
  let room = rooms.get(roomId);
  const roomExisted = room !== undefined;

  if (!room) {
    if (rooms.size >= MAX_ROOMS) {
      ws.send(JSON.stringify({ type: "server_full" }));
      ws.close(4008, "Server full");
      return;
    }
    room = { clients: new Map() };
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

  // `roomExisted` lets the client tell "you are the first one here" from "you
  // joined four people". Without it a stale link would silently drop someone
  // into an empty room instead of saying the room has expired.
  ws.send(
    JSON.stringify({
      type: "member_list",
      members: memberList,
      roomExisted,
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

/**
 * Charge one event against a one-second sliding window.
 *
 * Returns false when the window is already full, in which case nothing is
 * recorded — a refused event must not extend the window it was refused by.
 * Mutates `timestamps` in place, dropping anything older than a second.
 */
export function admitToWindow(
  timestamps: number[],
  now: number,
  limit: number,
  windowMs: number = 1000,
): boolean {
  while (timestamps.length > 0 && now - timestamps[0] > windowMs) {
    timestamps.shift();
  }
  if (timestamps.length >= limit) return false;
  timestamps.push(now);
  return true;
}

/**
 * Record a push subscription, evicting the oldest if the room is full.
 *
 * Evicts rather than refuses. Refusing means a new member cannot get
 * notifications because identities that left still hold every slot, which
 * fails in favour of the people least likely to still want them. Insertion
 * order is subscription order, so the first key is the oldest.
 *
 * Re-subscribing moves an identity to the back, so an active member is never
 * the one evicted.
 *
 * Returns the identity key evicted, or null.
 */
export function admitPushSubscription(
  roomSubs: Map<string, PushSubscriptionData>,
  identityKey: string,
  subscription: PushSubscriptionData,
  limit: number = MAX_PUSH_SUBS_PER_ROOM,
): string | null {
  roomSubs.delete(identityKey);

  let evicted: string | null = null;
  if (roomSubs.size >= limit) {
    const oldest = roomSubs.keys().next();
    if (!oldest.done) {
      evicted = oldest.value;
      roomSubs.delete(evicted);
    }
  }

  roomSubs.set(identityKey, subscription);
  return evicted;
}

/**
 * Choose which absent subscribers to push to, and charge them a cooldown.
 *
 * Skips the sender, anyone currently connected, and anyone pushed to inside
 * the cooldown. That last one is what bounds the outbound request rate: the
 * push carries no payload, so repeated notifications say the same thing, and
 * without a cooldown one busy room produces an unbounded rate of outbound
 * HTTPS requests to a third-party service.
 *
 * Mutates `cooldowns` for the recipients it returns, so a caller that drops a
 * request still pays the cooldown. That is deliberate. Push is best-effort,
 * and retrying immediately is how a shed load turns into a hot loop.
 */
export function selectPushRecipients(
  roomSubs: Map<string, PushSubscriptionData>,
  isConnected: (identityKey: string) => boolean,
  senderIdentityKey: string,
  now: number,
  cooldowns: Map<string, number>,
  cooldownMs: number = PUSH_COOLDOWN_MS,
): Array<[string, PushSubscriptionData]> {
  const recipients: Array<[string, PushSubscriptionData]> = [];
  for (const [identityKey, subscription] of roomSubs) {
    if (identityKey === senderIdentityKey) continue;
    if (isConnected(identityKey)) continue;

    const last = cooldowns.get(identityKey);
    if (last !== undefined && now - last < cooldownMs) continue;

    cooldowns.set(identityKey, now);
    recipients.push([identityKey, subscription]);
  }
  return recipients;
}

/** The part of a WebSocket that fan-out needs, so it can be exercised directly. */
export interface FanOutSocket {
  readyState: number;
  bufferedAmount: number;
  send(data: string): void;
  terminate(): void;
}

/**
 * Relay one frame to every member of a room except its sender.
 *
 * Drops any member whose outbound queue has already passed
 * `MAX_BUFFERED_BYTES` rather than adding to it. Returns the identity keys
 * dropped, for the caller to log or assert on. Removal from the room happens
 * through the ordinary close handler, which `terminate()` triggers.
 *
 * Two decisions worth keeping:
 *
 * `terminate()`, not `close()`. A peer that has not drained a megabyte will
 * not drain a close frame either. `close()` queues that frame behind the
 * backlog and leaves the memory pinned, which is the thing being fixed.
 *
 * Disconnect, not silent skip. docs/THREAT-MODEL.md lists silent message
 * suppression as an undefended threat, so a relay that quietly dropped
 * messages would be performing that attack on itself. A disconnect is visible
 * and the client reconnects and re-syncs.
 *
 * This bounds one connection, not the total. MAX_CONNECTIONS sockets each
 * holding the full allowance is still more memory than the machine has, so
 * this change is only half a fix — the room and rate caps are the other half.
 */
export function fanOut(
  clients: Map<string, { ws: FanOutSocket }>,
  senderIdentityKey: string,
  serialized: string,
  limit: number = MAX_BUFFERED_BYTES,
): string[] {
  const dropped: string[] = [];
  for (const [key, client] of clients) {
    if (key === senderIdentityKey) continue;
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (client.ws.bufferedAmount > limit) {
      client.ws.terminate();
      dropped.push(key);
      continue;
    }
    client.ws.send(serialized);
  }
  return dropped;
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
  fanOut(room.clients, sender.identityKey, serialized);

  // Push to subscribed members who are not connected. One outbound HTTPS
  // request each, so this is the second amplifying path in this function and
  // the one that leaves the machine.
  const roomSubs = pushSubscriptions.get(roomId);
  if (roomSubs) {
    const cooldowns = lastPushAt.get(roomId) ?? new Map<string, number>();
    lastPushAt.set(roomId, cooldowns);
    const recipients = selectPushRecipients(
      roomSubs,
      (identityKey) => room.clients.has(identityKey),
      sender.identityKey,
      Date.now(),
      cooldowns,
    );

    for (const [subIdentityKey, subscription] of recipients) {
      // Shed rather than queue. Push is best-effort, and an unbounded number
      // of in-flight fetches is the failure this cap exists to prevent.
      if (pushInFlight >= MAX_PUSH_IN_FLIGHT) break;

      pushInFlight++;
      sendPushNotification(subscription, "")
        .then((result) => {
          if (result === "gone") {
            roomSubs.delete(subIdentityKey);
            cooldowns.delete(subIdentityKey);
            if (roomSubs.size === 0) pushSubscriptions.delete(roomId);
          }
        })
        .finally(() => {
          pushInFlight--;
        });
    }
  }
}

function handlePushSubscribe(
  msg: ValidatedPushSubscribeMessage,
  client: RoomClient | null,
): void {
  // Verify the authenticated client matches the claimed identity key
  if (!client || client.identityKey !== msg.identityKey) return;

  const roomSubs =
    pushSubscriptions.get(msg.roomId) ?? new Map<string, PushSubscriptionData>();
  const evicted = admitPushSubscription(
    roomSubs,
    msg.identityKey,
    msg.subscription,
  );
  if (evicted !== null) lastPushAt.get(msg.roomId)?.delete(evicted);
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
    lastPushAt.get(msg.roomId)?.delete(msg.identityKey);
    if (roomSubs.size === 0) pushSubscriptions.delete(msg.roomId);
  }
}

/**
 * Drop every trace of a room from memory.
 *
 * Every room-keyed registry is keyed independently of `rooms`, so deleting the
 * room alone strands its entries for the life of the process. For push
 * endpoints that is an unbounded leak and retention of contact data the
 * privacy policy says is not retained. The stranded entries are also
 * unreachable: once the room is gone handleEncrypted returns early, so nothing
 * can ever reach them again.
 *
 * Variadic on purpose. Adding a registry and forgetting to clear it here is
 * the exact bug this function was written to fix, and it has now been made
 * twice. tests/unit/relay-room-cleanup.test.ts enumerates the room-keyed maps
 * in this file and fails if one of them is not passed in.
 */
export function deleteRoomState(
  roomId: string,
  ...registries: Array<Map<string, unknown>>
): void {
  for (const registry of registries) registry.delete(roomId);
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
  cooldownRegistry: Map<string, Map<string, number>> = new Map(),
): void {
  const room = roomRegistry.get(roomId);
  if (!room) return;

  room.clients.delete(identityKey);

  // Clean up empty rooms
  if (room.clients.size === 0) {
    deleteRoomState(
      roomId,
      roomRegistry as Map<string, unknown>,
      pushRegistry as Map<string, unknown>,
      cooldownRegistry as Map<string, unknown>,
    );
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
