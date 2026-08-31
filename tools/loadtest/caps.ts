/**
 * Targeted checks of each declared cap in server/relay.ts.
 *
 * The ramp answers "how much fits". These checks answer "does the guard rail
 * exist, and where exactly does it sit". Each check states the value it
 * expects from reading relay.ts and records what the relay actually did, so a
 * silently broken cap shows up as a mismatch rather than as a good number.
 */

import { WebSocket } from "ws";
import { startRelay, stopRelay } from "./relay-process.js";
import type { RelayHandle } from "./relay-process.js";
import { buildJoin, buildProbe, roomIdFor, RELAY_LIMITS } from "./protocol.js";
import { classifyRelayFrame, parseUpgradeFailure } from "./metrics.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface CapCheck {
  cap: string;
  declared: number | string;
  observed: number | string;
  matches: boolean;
  note: string;
}

interface Connected {
  ws: WebSocket;
  identityKey: string;
}

/** Open a socket and join. Resolves with the socket, or with why it failed. */
function connectAndJoin(
  url: string,
  roomIndex: number,
  clientIndex: number,
  opts: { create?: boolean; timeoutMs?: number } = {},
): Promise<{ ok: true; conn: Connected } | { ok: false; reason: string }> {
  const join = buildJoin(0, clientIndex, 5);
  if (opts.create === false) join.create = false;
  const timeoutMs = opts.timeoutMs ?? 8000;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: { ok: true; conn: Connected } | { ok: false; reason: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const ws = new WebSocket(`${url}/room/${roomIdFor(roomIndex)}`, { perMessageDeflate: false });
    const timer = setTimeout(() => {
      ws.terminate();
      finish({ ok: false, reason: "timeout" });
    }, timeoutMs);

    ws.on("open", () => ws.send(JSON.stringify(join)));
    ws.on("message", (data: Buffer) => {
      const frame = classifyRelayFrame(data.toString());
      if (frame.kind === "member_list") finish({ ok: true, conn: { ws, identityKey: join.identityKey } });
      else if (frame.kind !== "new_member" && frame.kind !== "member_left") finish({ ok: false, reason: frame.kind });
    });
    ws.on("error", (err: Error & { code?: string }) => {
      const f = parseUpgradeFailure(err.message, err.code);
      finish({ ok: false, reason: f.status === null ? `transport:${f.code}` : `http:${f.status}` });
    });
    ws.on("close", (code) => finish({ ok: false, reason: `close:${code}` }));
  });
}

/** Wait for a socket to close and report the code, or null if it stayed open. */
function waitForClose(ws: WebSocket, ms: number): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    ws.once("close", (code: number) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

// --- Individual checks ------------------------------------------------------

async function checkPerIpCap(url: string): Promise<CapCheck> {
  const open: Connected[] = [];
  let refusal = "none";
  // Each attempt uses a distinct room so a per-room cap cannot be mistaken for
  // the per-IP cap.
  for (let i = 0; i < RELAY_LIMITS.MAX_CONNECTIONS_PER_IP + 5; i++) {
    const r = await connectAndJoin(url, 9000 + i, 9000 + i);
    if (r.ok) open.push(r.conn);
    else {
      refusal = r.reason;
      break;
    }
  }
  const observed = open.length;
  for (const c of open) c.ws.close();
  await sleep(300);
  return {
    cap: "MAX_CONNECTIONS_PER_IP",
    declared: RELAY_LIMITS.MAX_CONNECTIONS_PER_IP,
    observed,
    matches: observed === RELAY_LIMITS.MAX_CONNECTIONS_PER_IP,
    note: `connection ${observed + 1} from the same address was refused with ${refusal}. Measured with the address-spread hook OFF.`,
  };
}

async function checkPerRoomCap(url: string): Promise<CapCheck> {
  const open: Connected[] = [];
  let refusal = "none";
  const roomIndex = 8000;
  for (let i = 0; i < RELAY_LIMITS.MAX_CLIENTS_PER_ROOM + 5; i++) {
    const r = await connectAndJoin(url, roomIndex, 8000 + i);
    if (r.ok) open.push(r.conn);
    else {
      refusal = r.reason;
      break;
    }
  }
  const observed = open.length;
  for (const c of open) c.ws.close();
  await sleep(500);
  return {
    cap: "MAX_CLIENTS_PER_ROOM",
    declared: RELAY_LIMITS.MAX_CLIENTS_PER_ROOM,
    observed,
    matches: observed === RELAY_LIMITS.MAX_CLIENTS_PER_ROOM,
    note: `client ${observed + 1} in the same room was refused with ${refusal}. Address-spread hook ON.`,
  };
}

async function checkRateLimit(url: string): Promise<CapCheck> {
  const roomIndex = 7000;
  const a = await connectAndJoin(url, roomIndex, 7001);
  const b = await connectAndJoin(url, roomIndex, 7002);
  if (!a.ok || !b.ok) {
    return {
      cap: "MSG_RATE_LIMIT",
      declared: RELAY_LIMITS.MSG_RATE_LIMIT,
      observed: "could not set up the pair",
      matches: false,
      note: `sender ${a.ok ? "ok" : a.reason}, receiver ${b.ok ? "ok" : b.reason}`,
    };
  }

  let delivered = 0;
  b.conn.ws.on("message", (data: Buffer) => {
    if (classifyRelayFrame(data.toString()).kind === "encrypted") delivered++;
  });

  // One synchronous burst, so every message lands inside the same 1s window.
  const burst = RELAY_LIMITS.MSG_RATE_LIMIT + 10;
  for (let i = 0; i < burst; i++) {
    a.conn.ws.send(JSON.stringify(buildProbe(a.conn.identityKey, `rl${i}`, 64, Date.now())));
  }
  const code = await waitForClose(a.conn.ws, 4000);
  await sleep(400);
  b.conn.ws.close();
  await sleep(200);

  // The join itself counts as the first message in the window, so the relay
  // accepts MSG_RATE_LIMIT - 1 further messages before it closes the socket.
  const expectedDelivered = RELAY_LIMITS.MSG_RATE_LIMIT - 1;
  return {
    cap: "MSG_RATE_LIMIT",
    declared: `${RELAY_LIMITS.MSG_RATE_LIMIT}/s, close 4029`,
    observed: `${delivered} relayed, close ${code ?? "none"}`,
    matches: code === 4029 && delivered === expectedDelivered,
    note: `sent ${burst} messages in one burst after joining. The join counts against the same window, so ${expectedDelivered} relayed messages is the expected value.`,
  };
}

async function checkMaxMessageSize(url: string): Promise<CapCheck> {
  const r = await connectAndJoin(url, 6000, 6001);
  if (!r.ok) {
    return { cap: "MAX_MESSAGE_SIZE", declared: RELAY_LIMITS.MAX_MESSAGE_SIZE, observed: r.reason, matches: false, note: "could not join" };
  }
  const oversized = JSON.stringify({
    type: "encrypted",
    senderIdentityKey: r.conn.identityKey,
    sessionId: "big",
    ciphertext: "x".repeat(RELAY_LIMITS.MAX_MESSAGE_SIZE + 20_000),
    timestamp: Date.now(),
  });
  r.conn.ws.send(oversized);
  const code = await waitForClose(r.conn.ws, 4000);
  return {
    cap: "MAX_MESSAGE_SIZE",
    declared: `${RELAY_LIMITS.MAX_MESSAGE_SIZE} bytes, close 4001`,
    observed: `${oversized.length} byte frame, close ${code ?? "none"}`,
    matches: code === 4001,
    note: "the size guard runs before JSON.parse, so an oversized frame is never parsed.",
  };
}

async function checkMaxCiphertext(url: string): Promise<CapCheck> {
  const r = await connectAndJoin(url, 5000, 5001);
  if (!r.ok) {
    return { cap: "MAX_CIPHERTEXT_LENGTH", declared: RELAY_LIMITS.MAX_CIPHERTEXT_LENGTH, observed: r.reason, matches: false, note: "could not join" };
  }
  // Over the ciphertext cap but under the frame cap, so it reaches the schema check.
  const frame = JSON.stringify({
    type: "encrypted",
    senderIdentityKey: r.conn.identityKey,
    sessionId: "long",
    ciphertext: "x".repeat(RELAY_LIMITS.MAX_CIPHERTEXT_LENGTH + 1),
    timestamp: Date.now(),
  });
  r.conn.ws.send(frame);
  const code = await waitForClose(r.conn.ws, 4000);
  return {
    cap: "MAX_CIPHERTEXT_LENGTH",
    declared: `${RELAY_LIMITS.MAX_CIPHERTEXT_LENGTH} chars, close 4003`,
    observed: `${frame.length} byte frame, close ${code ?? "none"}`,
    matches: code === 4003,
    note: "frame is under MAX_MESSAGE_SIZE, so the schema check is what rejects it.",
  };
}

function checkBadRoomId(url: string): Promise<CapCheck> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${url}/room/not-a-valid-room-id`, { perMessageDeflate: false });
    const done = (observed: string, matches: boolean) =>
      resolve({
        cap: "ROOM_ID_PATTERN",
        declared: "/^[a-f0-9]{32}$/, HTTP 400 at upgrade",
        observed,
        matches,
        note: "a malformed room id is rejected before the WebSocket handshake completes.",
      });
    ws.on("error", (err: Error & { code?: string }) => {
      const f = parseUpgradeFailure(err.message, err.code);
      done(`HTTP ${f.status ?? f.cap}`, f.status === 400);
    });
    ws.on("open", () => {
      ws.close();
      done("upgrade accepted", false);
    });
  });
}

async function checkEmptyRoomReclaimed(url: string): Promise<CapCheck> {
  const roomIndex = 4000;
  const creator = await connectAndJoin(url, roomIndex, 4001);
  if (!creator.ok) {
    return { cap: "MAX_ROOMS reachability", declared: RELAY_LIMITS.MAX_ROOMS, observed: creator.reason, matches: false, note: "could not create the room" };
  }

  // While occupied, a second client joins without create.
  const whileOccupied = await connectAndJoin(url, roomIndex, 4002, { create: false });
  const persisted = whileOccupied.ok;
  if (whileOccupied.ok) whileOccupied.conn.ws.close();
  await sleep(300);
  creator.conn.ws.close();
  await sleep(600);

  // With nobody left, the room should be gone.
  const afterEmpty = await connectAndJoin(url, roomIndex, 4003, { create: false });
  const reclaimed = !afterEmpty.ok && afterEmpty.reason === "room_not_found";
  if (afterEmpty.ok) afterEmpty.conn.ws.close();

  return {
    cap: "MAX_ROOMS reachability",
    declared: `${RELAY_LIMITS.MAX_ROOMS} rooms`,
    observed: `room persists while occupied: ${persisted}; deleted when empty: ${reclaimed}`,
    matches: persisted && reclaimed,
    note:
      "removeClient() deletes a room the moment its last client leaves, so the live room count can " +
      `never exceed the live joined-connection count. With MAX_CONNECTIONS at ${RELAY_LIMITS.MAX_CONNECTIONS}, ` +
      `MAX_ROOMS at ${RELAY_LIMITS.MAX_ROOMS} cannot bind before MAX_CONNECTIONS does.`,
  };
}

// --- Driver -----------------------------------------------------------------

export interface CapReport {
  profile: "caps";
  startedAt: string;
  relayLimits: typeof RELAY_LIMITS;
  checks: CapCheck[];
}

export async function runCapChecks(port: number, verbose: boolean): Promise<CapReport> {
  const url = `ws://127.0.0.1:${port}`;
  const checks: CapCheck[] = [];

  // Phase 1: the address-spread hook must be OFF to measure the per-IP cap.
  let relay: RelayHandle = await startRelay({
    port,
    statusPort: port + 1000,
    ipSpread: false,
    ipPerAddr: 1,
    verbose,
  });
  console.log("\nphase 1: address-spread hook OFF");
  checks.push(await checkPerIpCap(url));
  await stopRelay(relay);
  await sleep(600);

  // Phase 2: everything else needs more than 10 sockets from this host.
  relay = await startRelay({ port, statusPort: port + 1000, ipSpread: true, ipPerAddr: 1, verbose });
  console.log("phase 2: address-spread hook ON");
  checks.push(await checkPerRoomCap(url));
  checks.push(await checkRateLimit(url));
  checks.push(await checkMaxMessageSize(url));
  checks.push(await checkMaxCiphertext(url));
  checks.push(await checkBadRoomId(url));
  checks.push(await checkEmptyRoomReclaimed(url));
  await stopRelay(relay);

  console.log("");
  for (const c of checks) {
    console.log(`${c.matches ? "MATCH  " : "DIFFERS"} ${c.cap}`);
    console.log(`        declared: ${c.declared}`);
    console.log(`        observed: ${c.observed}`);
    console.log(`        ${c.note}`);
  }

  return { profile: "caps", startedAt: new Date().toISOString(), relayLimits: RELAY_LIMITS, checks };
}
