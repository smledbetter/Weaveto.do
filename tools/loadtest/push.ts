/**
 * Measurement of the relay's push notification fan-out.
 *
 * `handleEncrypted` relays a message to every connected member and then fires
 * one outbound HTTPS request per subscribed member who is absent. The second
 * path is the one that leaves the machine, and until now no load test had ever
 * executed it: every figure in docs/CAPACITY.md was measured with zero push
 * subscriptions, so the whole path was dormant.
 *
 * This drives it with a stub push service on this host, so the cost is real
 * without depending on a third party. The stub also answers slowly on demand,
 * which is how the in-flight ceiling is observed rather than assumed.
 */

import { WebSocket } from "ws";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { startRelay, stopRelay } from "./relay-process.js";
import type { RelayHandle } from "./relay-process.js";
import {
  buildJoin,
  buildProbe,
  roomIdFor,
  RELAY_LIMITS,
  MAX_PUSH_SUBS_PER_ROOM,
} from "./protocol.js";
import { classifyRelayFrame } from "./metrics.js";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface PushCheck {
  check: string;
  expected: number | string;
  observed: number | string;
  matches: boolean;
  note: string;
}

export interface PushReport {
  checks: PushCheck[];
  relayLimits: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Stub push service
// ---------------------------------------------------------------------------

/**
 * The hostname subscriptions are registered under.
 *
 * A real https URL, because the relay now refuses anything else and refuses
 * any literal address that is not publicly routable. The relay never connects
 * to it: the load-test hook gives requests for this host a socket to the stub
 * below. Kept in step with PUSH_STUB_HOST in relay-hook.mjs.
 */
const PUSH_STUB_HOST = "push-stub.loadtest.example";

interface StubPushService {
  /** Port the hook redirects the relay's push connections to. */
  port: number;
  /** Every request the relay has made, in arrival order. */
  hits: Array<{ path: string; at: number }>;
  /** Highest number of requests the stub held open at once. */
  peakConcurrent: number;
  /** Hold each response open this long, to make concurrency observable. */
  setDelay(ms: number): void;
  /** Answer 410 for these paths, so stale-subscription cleanup can be driven. */
  setGone(paths: Set<string>): void;
  reset(): void;
  close(): Promise<void>;
}

async function startStubPushService(): Promise<StubPushService> {
  const hits: Array<{ path: string; at: number }> = [];
  let delayMs = 0;
  let gone = new Set<string>();
  let concurrent = 0;
  let peakConcurrent = 0;

  const server = http.createServer(async (req, res) => {
    const path = req.url ?? "";
    hits.push({ path, at: Date.now() });

    concurrent++;
    if (concurrent > peakConcurrent) peakConcurrent = concurrent;

    if (delayMs > 0) await sleep(delayMs);

    concurrent--;
    // 201 is what a real push service returns on accept. 410 means the
    // subscription is dead and the relay should forget it.
    res.writeHead(gone.has(path) ? 410 : 201).end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    port,
    hits,
    get peakConcurrent() {
      return peakConcurrent;
    },
    setDelay: (ms) => {
      delayMs = ms;
    },
    setGone: (paths) => {
      gone = paths;
    },
    reset: () => {
      hits.length = 0;
      peakConcurrent = 0;
      concurrent = 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

// ---------------------------------------------------------------------------
// Client helpers
// ---------------------------------------------------------------------------

interface Joined {
  ws: WebSocket;
  identityKey: string;
}

function connectAndJoin(
  url: string,
  roomIndex: number,
  clientIndex: number,
): Promise<Joined | null> {
  const join = buildJoin(0, clientIndex, 5);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: Joined | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const ws = new WebSocket(`${url}/room/${roomIdFor(roomIndex)}`, {
      perMessageDeflate: false,
    });
    const timer = setTimeout(() => {
      ws.terminate();
      finish(null);
    }, 8000);
    ws.on("open", () => ws.send(JSON.stringify(join)));
    ws.on("message", (data: Buffer) => {
      if (classifyRelayFrame(data.toString()).kind === "member_list") {
        finish({ ws, identityKey: join.identityKey });
      }
    });
    ws.on("error", () => finish(null));
    ws.on("close", () => finish(null));
  });
}

/** Subscribe this client to push for its room, pointed at the stub. */
function subscribe(
  client: Joined,
  roomIndex: number,
  stub: StubPushService,
  tag: string,
): void {
  client.ws.send(
    JSON.stringify({
      type: "push_subscribe",
      roomId: roomIdFor(roomIndex),
      identityKey: client.identityKey,
      subscription: {
        endpoint: `https://${PUSH_STUB_HOST}/p/${tag}`,
        keys: { p256dh: "x".repeat(87), auth: "y".repeat(22) },
      },
    }),
  );
}

/** Close a socket and wait for the relay to notice, so the member counts absent. */
async function goAbsent(client: Joined): Promise<void> {
  client.ws.close();
  await sleep(150);
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/**
 * An absent subscriber is pushed once, not once per message.
 *
 * Without a cooldown the push rate is the message rate multiplied by the
 * number of absent subscribers, and every one of those is an outbound HTTPS
 * request. The push carries no payload, so the repeats say the same nothing.
 */
async function checkCooldown(
  url: string,
  stub: StubPushService,
): Promise<PushCheck> {
  const roomIndex = 100;
  stub.reset();

  const sender = await connectAndJoin(url, roomIndex, 1002);
  const absent = await connectAndJoin(url, roomIndex, 1001);
  if (!absent || !sender) {
    return {
      check: "push cooldown",
      expected: 1,
      observed: "could not set up the room",
      matches: false,
      note: "",
    };
  }

  subscribe(absent, roomIndex, stub, "cooldown");
  await sleep(200);
  await goAbsent(absent);

  // Send at a legal rate for several seconds. Every message would have been a
  // push before the cooldown existed.
  const messages = 12;
  for (let i = 0; i < messages; i++) {
    sender.ws.send(
      JSON.stringify(buildProbe(sender.identityKey, `cd${i}`, 256, Date.now())),
    );
    await sleep(260);
  }
  await sleep(600);
  sender.ws.close();

  const pushes = stub.hits.filter((h) => h.path.endsWith("/cooldown")).length;
  return {
    check: "push cooldown",
    expected: 1,
    observed: pushes,
    matches: pushes === 1,
    note:
      `sent ${messages} messages over about ${Math.round((messages * 260) / 1000)}s with one absent ` +
      `subscriber. Without a cooldown that is ${messages} outbound HTTPS requests carrying no payload. ` +
      `PUSH_COOLDOWN_MS is ${RELAY_LIMITS.PUSH_COOLDOWN_MS}ms.`,
  };
}

/**
 * The subscription list per room is bounded.
 *
 * It is keyed by identity, so it grows with every identity that has ever
 * subscribed while the room lived, not with the member count. Nothing bounded
 * it, and every entry costs a request on every message.
 */
async function checkSubscriptionCap(
  url: string,
  stub: StubPushService,
): Promise<PushCheck> {
  const roomIndex = 200;
  stub.reset();

  const cap = MAX_PUSH_SUBS_PER_ROOM;
  const attempted = cap + 5;

  // The sender joins FIRST and stays. A room is deleted the moment its last
  // client leaves, and its push subscriptions go with it, so subscribers who
  // leave an empty room take their own subscriptions with them. Holding the
  // room open is what makes an accumulating subscription list possible at all.
  const sender = await connectAndJoin(url, roomIndex, 2999);
  if (!sender) {
    return {
      check: "MAX_PUSH_SUBS_PER_ROOM",
      expected: cap,
      observed: "sender could not join",
      matches: false,
      note: "",
    };
  }

  // Subscribe more identities than the cap allows. They cannot all be in the
  // room at once, so they subscribe and leave in turn, which is exactly how a
  // long-lived room accumulates endpoints.
  for (let i = 0; i < attempted; i++) {
    const c = await connectAndJoin(url, roomIndex, 2000 + i);
    if (!c) continue;
    subscribe(c, roomIndex, stub, `cap${i}`);
    await sleep(60);
    await goAbsent(c);
  }
  stub.reset();
  sender.ws.send(
    JSON.stringify(buildProbe(sender.identityKey, "cap", 256, Date.now())),
  );
  await sleep(1200);
  sender.ws.close();

  const pushed = new Set(stub.hits.map((h) => h.path)).size;
  return {
    check: "MAX_PUSH_SUBS_PER_ROOM",
    expected: cap,
    observed: pushed,
    matches: pushed === cap,
    note:
      `${attempted} identities subscribed to one room in turn. One message then reached ${pushed} ` +
      `of them. The oldest subscriptions are evicted, so the survivors are the most recent.`,
  };
}

/**
 * The number of push requests in flight is bounded.
 *
 * They were fire-and-forget fetches that nothing awaited and nothing counted,
 * so a burst could open an unbounded number of sockets. The stub holds each
 * response open so the ceiling is observable from outside.
 */
async function checkInFlightCeiling(
  url: string,
  stub: StubPushService,
): Promise<PushCheck> {
  const ceiling = RELAY_LIMITS.MAX_PUSH_IN_FLIGHT;
  stub.reset();
  stub.setDelay(1500);

  // Fill several rooms with absent subscribers, then have every room post at
  // once, so far more pushes are due than the ceiling allows.
  const rooms = 8;
  const perRoom = MAX_PUSH_SUBS_PER_ROOM;
  const senders: Joined[] = [];

  for (let r = 0; r < rooms; r++) {
    const roomIndex = 300 + r;
    // Sender first, and it stays, so the room survives its subscribers
    // leaving. See checkSubscriptionCap for why that matters.
    const sender = await connectAndJoin(url, roomIndex, 3900 + r);
    if (sender) senders.push(sender);

    for (let i = 0; i < perRoom; i++) {
      const c = await connectAndJoin(url, roomIndex, 3000 + r * 100 + i);
      if (!c) continue;
      subscribe(c, roomIndex, stub, `inflight-${r}-${i}`);
      await sleep(20);
      await goAbsent(c);
    }
  }

  stub.reset();
  const due = rooms * perRoom;
  for (const s of senders) {
    s.ws.send(JSON.stringify(buildProbe(s.identityKey, "inflight", 256, Date.now())));
  }
  await sleep(2500);
  for (const s of senders) s.ws.close();
  stub.setDelay(0);

  const peak = stub.peakConcurrent;
  return {
    check: "MAX_PUSH_IN_FLIGHT",
    expected: `at most ${ceiling}`,
    observed: peak,
    matches: peak > 0 && peak <= ceiling,
    note:
      `${due} pushes were due at once against a stub holding each response open for 1.5s. ` +
      `Peak concurrent in-flight requests was ${peak}. Push is best-effort, so shedding past the ` +
      `ceiling is the intended behaviour rather than queueing.`,
  };
}

/** A subscription the push service reports as dead is forgotten. */
async function checkGoneIsForgotten(
  url: string,
  stub: StubPushService,
): Promise<PushCheck> {
  const roomIndex = 400;
  stub.reset();
  stub.setGone(new Set(["/p/gone"]));

  const sender = await connectAndJoin(url, roomIndex, 4002);
  const absent = await connectAndJoin(url, roomIndex, 4001);
  if (!absent || !sender) {
    return { check: "410 Gone", expected: 1, observed: "setup failed", matches: false, note: "" };
  }

  subscribe(absent, roomIndex, stub, "gone");
  await sleep(200);
  await goAbsent(absent);

  // First message pushes and gets 410. Later messages, after the cooldown has
  // passed, must not push at all because the subscription is gone.
  sender.ws.send(JSON.stringify(buildProbe(sender.identityKey, "g0", 256, Date.now())));
  await sleep(RELAY_LIMITS.PUSH_COOLDOWN_MS + 1500);
  sender.ws.send(JSON.stringify(buildProbe(sender.identityKey, "g1", 256, Date.now())));
  await sleep(1000);
  sender.ws.close();
  stub.setGone(new Set());

  const pushes = stub.hits.filter((h) => h.path.endsWith("/gone")).length;
  return {
    check: "410 Gone",
    expected: 1,
    observed: pushes,
    matches: pushes === 1,
    note:
      "the second message was sent after the cooldown expired, so a subscription that was not " +
      "forgotten would have been pushed to again.",
  };
}

/**
 * An endpoint the relay must never POST to is refused when it is offered.
 *
 * The relay used to accept any string up to 2048 characters as an endpoint and
 * POST to it, which let a client aim it at addresses inside the network the
 * relay runs in. Refusing at subscribe time means such an endpoint is never
 * stored and never retried.
 */
async function checkBlockedEndpointsRefused(url: string): Promise<PushCheck> {
  const roomIndex = 500;
  const blocked = [
    "http://push-stub.loadtest.example/p/plain",
    "https://127.0.0.1/p/loopback",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/p/loopback6",
    "https://10.0.0.1/p/private",
  ];

  const refused: string[] = [];
  for (const endpoint of blocked) {
    const c = await connectAndJoin(url, roomIndex, 5000 + refused.length);
    if (!c) continue;

    const closed = new Promise<number | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 2500);
      c.ws.once("close", (code: number) => {
        clearTimeout(timer);
        resolve(code);
      });
    });

    c.ws.send(
      JSON.stringify({
        type: "push_subscribe",
        roomId: roomIdFor(roomIndex),
        identityKey: c.identityKey,
        subscription: {
          endpoint,
          keys: { p256dh: "x".repeat(87), auth: "y".repeat(22) },
        },
      }),
    );

    const code = await closed;
    if (code !== null) refused.push(endpoint);
    if (c.ws.readyState === WebSocket.OPEN) c.ws.close();
    await sleep(100);
  }

  return {
    check: "blocked endpoints refused",
    expected: blocked.length,
    observed: refused.length,
    matches: refused.length === blocked.length,
    note:
      "each endpoint was offered on its own connection. A refusal closes the socket, the same as " +
      "any other message the relay will not accept, so it is visible rather than silent. " +
      "169.254.169.254 is the cloud metadata address, which answers unauthenticated requests.",
  };
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export async function runPushChecks(
  port: number,
  verbose: boolean,
): Promise<PushReport> {
  const url = `ws://127.0.0.1:${port}`;
  const stub = await startStubPushService();
  console.log(
    `stub push service on 127.0.0.1:${stub.port}, answering for https://${PUSH_STUB_HOST}`,
  );

  let relay: RelayHandle = await startRelay({
    port,
    statusPort: port + 1000,
    ipSpread: true,
    ipPerAddr: 1,
    verbose,
    pushStubPort: stub.port,
  });

  const checks: PushCheck[] = [];
  try {
    checks.push(await checkCooldown(url, stub));
    checks.push(await checkSubscriptionCap(url, stub));
    checks.push(await checkInFlightCeiling(url, stub));
    checks.push(await checkGoneIsForgotten(url, stub));
    checks.push(await checkBlockedEndpointsRefused(url));
  } finally {
    await stopRelay(relay);
    await stub.close();
  }

  console.log("");
  for (const c of checks) {
    console.log(`${c.matches ? "MATCH  " : "DIFFERS"} ${c.check}`);
    console.log(`        expected: ${c.expected}`);
    console.log(`        observed: ${c.observed}`);
    if (c.note) console.log(`        ${c.note}`);
  }

  return {
    checks,
    relayLimits: {
      MAX_PUSH_SUBS_PER_ROOM: MAX_PUSH_SUBS_PER_ROOM,
      PUSH_COOLDOWN_MS: RELAY_LIMITS.PUSH_COOLDOWN_MS,
      MAX_PUSH_IN_FLIGHT: RELAY_LIMITS.MAX_PUSH_IN_FLIGHT,
    },
  };
}
