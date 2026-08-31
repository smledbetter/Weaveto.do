/**
 * Load-test worker. Holds a share of the virtual clients.
 *
 * The parent forks several of these so client-side CPU is spread across cores
 * and the relay stays the only single-threaded component in the measurement.
 * Sender and receiver of a round-trip probe always live in the same worker, so
 * both timestamps come from one clock and the latency needs no clock skew
 * correction.
 *
 * Worker `w` of `W` owns room indices w, w+W, w+2W, ... so no two workers ever
 * share a room.
 */

import { WebSocket } from "ws";
import { CloseTally, parseUpgradeFailure } from "./metrics.js";
import type { CloseCount } from "./metrics.js";
import { buildJoin, buildProbe, roomIdFor } from "./protocol.js";

interface WorkerConfig {
  workerId: number;
  workerCount: number;
  relayUrl: string;
  clientsPerRoom: number;
  oneTimeKeyCount: number;
  connectBatch: number;
  connectGapMs: number;
  connectTimeoutMs: number;
}

interface VirtualClient {
  index: number;
  roomIndex: number;
  slot: number;
  identityKey: string;
  ws: WebSocket;
  joined: boolean;
  /** Resolvers keyed by probe token, used when this client is a receiver. */
  pending: Map<string, (arrivalMs: number) => void>;
}

let config: WorkerConfig;
const clients: VirtualClient[] = [];
const byRoom = new Map<number, VirtualClient[]>();
const closes = new CloseTally();
let nextIndex = 0;
let unexpectedClosesSinceLastReport = 0;

function send(msg: unknown): void {
  process.send?.(msg);
}

function roomIndexForClient(index: number): number {
  return config.workerId + config.workerCount * Math.floor(index / config.clientsPerRoom);
}

/** Open one connection and complete the join handshake. */
function openClient(index: number): Promise<{ ok: true } | { ok: false; cap: string }> {
  const roomIndex = roomIndexForClient(index);
  const slot = index % config.clientsPerRoom;
  const roomId = roomIdFor(roomIndex);
  const join = buildJoin(config.workerId, index, config.oneTimeKeyCount);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: { ok: true } | { ok: false; cap: string }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const ws = new WebSocket(`${config.relayUrl}/room/${roomId}`, {
      perMessageDeflate: false,
    });

    const client: VirtualClient = {
      index,
      roomIndex,
      slot,
      identityKey: join.identityKey,
      ws,
      joined: false,
      pending: new Map(),
    };

    const timer = setTimeout(() => {
      try {
        ws.terminate();
      } catch {
        /* already gone */
      }
      finish({ ok: false, cap: "join-timeout" });
    }, config.connectTimeoutMs);

    ws.on("open", () => {
      ws.send(JSON.stringify(join));
    });

    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      const raw = data.toString();
      // Hot path: avoid full classification for the frames we do not consume.
      // A probe echo carries the token in sessionId; a join ack is member_list.
      if (!client.joined) {
        if (raw.includes('"member_list"')) {
          client.joined = true;
          clients.push(client);
          const list = byRoom.get(roomIndex) ?? [];
          list.push(client);
          byRoom.set(roomIndex, list);
          finish({ ok: true });
          return;
        }
        if (raw.includes('"room_not_found"')) return finish({ ok: false, cap: "room-not-found" });
        if (raw.includes('"room_full"')) return finish({ ok: false, cap: "room-full" });
        if (raw.includes('"server_full"')) return finish({ ok: false, cap: "server-full" });
        return;
      }
      if (client.pending.size > 0 && raw.includes('"encrypted"')) {
        const arrival = performance.now();
        const m = /"sessionId":"([^"]+)"/.exec(raw);
        if (m) {
          const resolver = client.pending.get(m[1]);
          if (resolver) {
            client.pending.delete(m[1]);
            resolver(arrival);
          }
        }
      }
    });

    ws.on("error", (err: Error & { code?: string }) => {
      const failure = parseUpgradeFailure(err.message, err.code);
      finish({ ok: false, cap: failure.cap === "transport" ? `transport:${failure.code}` : failure.cap });
    });

    ws.on("close", (code: number) => {
      closes.record(code);
      if (client.joined) {
        client.joined = false;
        unexpectedClosesSinceLastReport += 1;
        const i = clients.indexOf(client);
        if (i >= 0) clients.splice(i, 1);
        const list = byRoom.get(roomIndex);
        if (list) {
          const j = list.indexOf(client);
          if (j >= 0) list.splice(j, 1);
        }
      }
      finish({ ok: false, cap: `closed:${code}` });
    });
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function connectMore(count: number): Promise<{
  established: number;
  failures: number;
  failuresByCap: Record<string, number>;
}> {
  let established = 0;
  let failures = 0;
  const failuresByCap: Record<string, number> = {};

  let remaining = count;
  while (remaining > 0) {
    const batch = Math.min(config.connectBatch, remaining);
    const promises: Array<Promise<{ ok: true } | { ok: false; cap: string }>> = [];
    for (let i = 0; i < batch; i++) {
      promises.push(openClient(nextIndex++));
    }
    const results = await Promise.all(promises);
    for (const r of results) {
      if (r.ok) established++;
      else {
        failures++;
        failuresByCap[r.cap] = (failuresByCap[r.cap] ?? 0) + 1;
      }
    }
    remaining -= batch;
    if (remaining > 0 && config.connectGapMs > 0) await sleep(config.connectGapMs);
  }

  return { established, failures, failuresByCap };
}

/**
 * Build sender/receiver pairs from connected rooms.
 *
 * `sendersPerRoom` controls how many members of one room send at once. It is
 * the lever that separates message rate from fan-out: every message a sender
 * puts in still reaches every other member of the room, so a room of 50 with 25
 * senders carries 25 times the inbound rate at the same 49-way amplification.
 * One member is timed per sender, which is enough to measure the delay the
 * whole broadcast is subject to.
 */
function probePairs(
  maxPairs: number,
  sendersPerRoom: number,
): Array<{ sender: VirtualClient; receiver: VirtualClient }> {
  const pairs: Array<{ sender: VirtualClient; receiver: VirtualClient }> = [];
  const perRoom = Math.max(1, Math.trunc(sendersPerRoom));
  for (const list of byRoom.values()) {
    if (pairs.length >= maxPairs) break;
    const usable = Math.min(perRoom, Math.floor(list.length / 2));
    for (let k = 0; k < usable && pairs.length < maxPairs; k++) {
      const sender = list[2 * k];
      const receiver = list[2 * k + 1];
      if (sender.ws.readyState !== WebSocket.OPEN) continue;
      if (receiver.ws.readyState !== WebSocket.OPEN) continue;
      pairs.push({ sender, receiver });
    }
  }
  return pairs;
}

interface ProbeRequest {
  pairs: number;
  sendersPerRoom: number;
  messagesPerPair: number;
  intervalMs: number;
  ciphertextBytes: number;
  timeoutMs: number;
}

async function runProbe(req: ProbeRequest): Promise<{
  samples: number[];
  sent: number;
  received: number;
  pairsUsed: number;
}> {
  const pairs = probePairs(req.pairs, req.sendersPerRoom ?? 1);
  const samples: number[] = [];
  let sent = 0;
  const inFlight: Array<Promise<void>> = [];

  // Guard the relay's own rate limit. Exceeding MSG_RATE_LIMIT closes the
  // connection, which would be recorded as capacity loss caused by the harness.
  const perSecond = req.intervalMs > 0 ? 1000 / req.intervalMs : Infinity;
  if (perSecond > 25) {
    throw new Error(
      `probe interval ${req.intervalMs}ms is ${perSecond.toFixed(1)} msg/s per connection, ` +
        `too close to the relay's MSG_RATE_LIMIT of 30/s`,
    );
  }

  for (let round = 0; round < req.messagesPerPair; round++) {
    for (let p = 0; p < pairs.length; p++) {
      const { sender, receiver } = pairs[p];
      if (sender.ws.readyState !== WebSocket.OPEN) continue;
      const token = `p${config.workerId}_${round}_${p}_${Date.now() % 100000}`;
      const started = performance.now();
      const settled = new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          receiver.pending.delete(token);
          resolve();
        }, req.timeoutMs);
        receiver.pending.set(token, (arrival) => {
          clearTimeout(timer);
          samples.push(arrival - started);
          resolve();
        });
      });
      inFlight.push(settled);
      sender.ws.send(JSON.stringify(buildProbe(sender.identityKey, token, req.ciphertextBytes, Date.now())));
      sent++;
    }
    if (round < req.messagesPerPair - 1) await sleep(req.intervalMs);
  }

  await Promise.all(inFlight);
  return { samples, sent, received: samples.length, pairsUsed: pairs.length };
}

function closeAll(): void {
  for (const c of [...clients]) {
    try {
      c.ws.close(1000, "loadtest done");
    } catch {
      /* already closing */
    }
  }
  clients.length = 0;
  byRoom.clear();
}

interface StatsReport {
  live: number;
  rooms: number;
  closes: CloseCount[];
  unexpectedCloses: number;
}

function stats(): StatsReport {
  const snapshot = closes.snapshot();
  const report: StatsReport = {
    live: clients.filter((c) => c.ws.readyState === WebSocket.OPEN).length,
    rooms: [...byRoom.values()].filter((l) => l.length > 0).length,
    closes: snapshot,
    unexpectedCloses: unexpectedClosesSinceLastReport,
  };
  unexpectedClosesSinceLastReport = 0;
  return report;
}

process.on("message", (raw: unknown) => {
  const msg = raw as { id: number; cmd: string; [k: string]: unknown };
  const reply = (payload: Record<string, unknown>) => send({ id: msg.id, ...payload });

  void (async () => {
    try {
      switch (msg.cmd) {
        case "init":
          config = msg.config as WorkerConfig;
          reply({ ok: true });
          break;
        case "connect":
          reply({ ok: true, ...(await connectMore(msg.count as number)) });
          break;
        case "probe":
          reply({ ok: true, ...(await runProbe(msg.request as ProbeRequest)) });
          break;
        case "stats":
          reply({ ok: true, stats: stats() });
          break;
        case "closeAll":
          closeAll();
          reply({ ok: true });
          break;
        case "shutdown":
          closeAll();
          reply({ ok: true });
          setTimeout(() => process.exit(0), 200);
          break;
        default:
          reply({ ok: false, error: `unknown command ${msg.cmd}` });
      }
    } catch (err) {
      reply({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
});

send({ ready: true });
