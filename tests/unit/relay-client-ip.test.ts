// @vitest-environment node
/**
 * Defect: the per-IP connection cap keyed on `request.socket.remoteAddress`.
 * Behind the fly.io proxy that address IS the proxy, identical for every
 * client, so the whole internet shared one bucket of ten.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveClientIp,
  acquireConnection,
  releaseConnection,
  evaluateUpgrade, hashClientIp } from "../../server/relay";

/** A valid room path — the upgrade gate rejects anything else. */
const ROOM_PATH = "/room/0123456789abcdef0123456789abcdef";

const ORIGINS: ReadonlySet<string> = new Set(["https://weaveto.do"]);

/** Every socket arriving through the fly proxy reports this same address. */
const PROXY_ADDRESS = "172.19.0.1";

function emptyCounts() {
  return { total: 0, perIp: new Map<string, number>() };
}

function upgrade(ip: string, state: ReturnType<typeof emptyCounts>) {
  return evaluateUpgrade(
    { origin: undefined, pathname: ROOM_PATH, ip },
    state,
    ORIGINS,
  );
}

/** Open connections from `ip` until the gate refuses. Returns how many landed. */
function fillBucket(ip: string, state: ReturnType<typeof emptyCounts>): number {
  let accepted = 0;
  // Bounded so a broken cap fails the assertion instead of hanging the suite.
  while (accepted < 1000 && upgrade(ip, state).accept) {
    acquireConnection(state, ip);
    accepted++;
  }
  return accepted;
}

/**
 * The per-address cap, read from the relay rather than written down here.
 *
 * These assertions used to hardcode 10 and broke when the cap was raised to
 * 50, which is the wrong kind of failure: the behaviour was still correct and
 * only the number had moved. Reading it means the tests check the property and
 * survive the value changing.
 */
function perIpCap(): number {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../server/relay.ts"),
    "utf8",
  );
  const m = src.match(/^const MAX_CONNECTIONS_PER_IP = (\d+)/m);
  if (!m) throw new Error("MAX_CONNECTIONS_PER_IP not found");
  return Number(m[1]);
}

describe("resolveClientIp", () => {
  it("reads the fly proxy header when the deployment is behind the proxy", () => {
    const ip = resolveClientIp(
      { "fly-client-ip": "203.0.113.4" },
      PROXY_ADDRESS,
      true,
    );
    expect(ip).toBe("203.0.113.4");
  });

  it("falls back to the socket address when the header is absent (local dev)", () => {
    expect(resolveClientIp({}, "127.0.0.1", true)).toBe("127.0.0.1");
    expect(resolveClientIp({}, "127.0.0.1", false)).toBe("127.0.0.1");
  });

  it("ignores the header when the deployment is not behind a trusted proxy", () => {
    // Otherwise any client could mint a fresh rate-limit bucket per connection
    // simply by sending a different value, walking past the per-IP cap.
    const ip = resolveClientIp(
      { "fly-client-ip": "attacker-chosen" },
      "198.51.100.9",
      false,
    );
    expect(ip).toBe("198.51.100.9");
  });

  it("ignores X-Forwarded-For entirely", () => {
    // The proxy appends to whatever the client already put there, so reading
    // the wrong end of the list is the same spoofable bypass.
    const ip = resolveClientIp(
      { "x-forwarded-for": "1.2.3.4, 5.6.7.8" },
      PROXY_ADDRESS,
      true,
    );
    expect(ip).toBe(PROXY_ADDRESS);
  });

  it("takes the first value when the header arrives repeated", () => {
    const ip = resolveClientIp(
      { "fly-client-ip": ["203.0.113.4", "203.0.113.5"] },
      PROXY_ADDRESS,
      true,
    );
    expect(ip).toBe("203.0.113.4");
  });

  it("rejects an over-long header value so map keys stay bounded", () => {
    const ip = resolveClientIp(
      { "fly-client-ip": "9".repeat(4096) },
      PROXY_ADDRESS,
      true,
    );
    expect(ip).toBe(PROXY_ADDRESS);
  });

  it("rejects an empty header value", () => {
    expect(resolveClientIp({ "fly-client-ip": "" }, PROXY_ADDRESS, true)).toBe(
      PROXY_ADDRESS,
    );
  });

  it("returns a placeholder when there is no address at all", () => {
    expect(resolveClientIp({}, undefined, false)).toBe("unknown");
  });
});

describe("per-IP cap keyed on the real client", () => {
  it("does not lock the internet out of one shared bucket of ten", () => {
    const state = emptyCounts();

    // Ten different people connect through the proxy. Every one of their
    // sockets reports PROXY_ADDRESS, so keying on the socket address would
    // count them as ten connections from a single client.
    for (let i = 0; i < perIpCap(); i++) {
      const ip = resolveClientIp(
        { "fly-client-ip": `203.0.113.${i}` },
        PROXY_ADDRESS,
        true,
      );
      expect(upgrade(ip, state).accept).toBe(true);
      acquireConnection(state, ip);
    }

    // An eleventh person is not an eleventh connection from one client.
    const eleventh = resolveClientIp(
      { "fly-client-ip": "203.0.113.99" },
      PROXY_ADDRESS,
      true,
    );
    expect(upgrade(eleventh, state).accept).toBe(true);

    // Ten distinct buckets of one, not one bucket of ten.
    expect(state.perIp.size).toBe(perIpCap());
    expect(state.perIp.get("203.0.113.0")).toBe(1);
  });

  it("still caps a single real client at the declared limit", () => {
    // The point of reading the header is a correct key, not a weaker cap.
    const state = emptyCounts();
    const ip = resolveClientIp(
      { "fly-client-ip": "203.0.113.44" },
      PROXY_ADDRESS,
      true,
    );

    expect(fillBucket(ip, state)).toBe(perIpCap());
    expect(upgrade(ip, state).status).toBe(429);
  });

  it("caps on the socket address when no proxy header is trusted", () => {
    const state = emptyCounts();
    expect(fillBucket("127.0.0.1", state)).toBe(perIpCap());
    expect(upgrade("127.0.0.1", state).status).toBe(429);
  });

  it("frees the bucket again as connections close", () => {
    const state = emptyCounts();
    const ip = "203.0.113.44";
    fillBucket(ip, state);
    expect(upgrade(ip, state).accept).toBe(false);

    releaseConnection(state, ip);
    expect(upgrade(ip, state).accept).toBe(true);
  });
});

describe("evaluateUpgrade gate order and statuses", () => {
  it("refuses a disallowed origin with 403", () => {
    const d = evaluateUpgrade(
      { origin: "https://evil.example", pathname: ROOM_PATH, ip: "1.1.1.1" },
      emptyCounts(),
      ORIGINS,
    );
    expect(d.accept).toBe(false);
    expect(d.status).toBe(403);
    expect(d.statusText).toBe("Forbidden");
  });

  it("allows an allow-listed origin", () => {
    const d = evaluateUpgrade(
      { origin: "https://weaveto.do", pathname: ROOM_PATH, ip: "1.1.1.1" },
      emptyCounts(),
      ORIGINS,
    );
    expect(d.accept).toBe(true);
  });

  it("allows a non-browser client that sends no origin", () => {
    expect(upgrade("1.1.1.1", emptyCounts()).accept).toBe(true);
  });

  it("refuses with 503 once the global connection cap is reached", () => {
    const state = { total: 5_000, perIp: new Map<string, number>() };
    const d = upgrade("1.1.1.1", state);
    expect(d.status).toBe(503);
    expect(d.statusText).toBe("Service Unavailable");
  });

  it("checks the global cap before the per-IP cap", () => {
    // Order matters: a full server answers 503, not 429.
    const state = { total: 5_000, perIp: new Map([["1.1.1.1", 99]]) };
    expect(upgrade("1.1.1.1", state).status).toBe(503);
  });

  it("checks origin before either cap", () => {
    const state = { total: 5_000, perIp: new Map<string, number>() };
    const d = evaluateUpgrade(
      { origin: "https://evil.example", pathname: ROOM_PATH, ip: "1.1.1.1" },
      state,
      ORIGINS,
    );
    expect(d.status).toBe(403);
  });

  it.each([
    ["/", "empty path"],
    ["/room", "missing room id"],
    ["/room/abc/extra", "extra segment"],
    ["/lobby/0123456789abcdef0123456789abcdef", "wrong prefix"],
  ])("refuses %s with 400 (%s)", (pathname) => {
    const d = evaluateUpgrade(
      { origin: undefined, pathname, ip: "1.1.1.1" },
      emptyCounts(),
      ORIGINS,
    );
    expect(d.status).toBe(400);
    expect(d.statusText).toBe("Bad Request");
  });

  it.each([
    ["0123456789ABCDEF0123456789abcdef", "uppercase hex"],
    ["0123456789abcdef0123456789abcde", "31 chars"],
    ["0123456789abcdef0123456789abcdeff", "33 chars"],
    ["zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", "non-hex"],
  ])("refuses room id %s with 400 (%s)", (roomId) => {
    const d = evaluateUpgrade(
      { origin: undefined, pathname: `/room/${roomId}`, ip: "1.1.1.1" },
      emptyCounts(),
      ORIGINS,
    );
    expect(d.status).toBe(400);
  });

  it("returns the room id on acceptance", () => {
    const d = upgrade("1.1.1.1", emptyCounts());
    expect(d.roomId).toBe("0123456789abcdef0123456789abcdef");
  });
});

describe("connection accounting", () => {
  it("acquire then release returns to zero", () => {
    const state = emptyCounts();
    acquireConnection(state, "a");
    acquireConnection(state, "a");
    releaseConnection(state, "a");
    releaseConnection(state, "a");
    expect(state.total).toBe(0);
    expect(state.perIp.size).toBe(0);
  });

  it("drops the map entry rather than leaving a zero behind", () => {
    const state = emptyCounts();
    acquireConnection(state, "a");
    releaseConnection(state, "a");
    expect(state.perIp.has("a")).toBe(false);
  });

  it("never drives the total below zero", () => {
    const state = emptyCounts();
    releaseConnection(state, "a");
    expect(state.total).toBe(0);
  });

  it("keeps buckets independent", () => {
    const state = emptyCounts();
    acquireConnection(state, "a");
    acquireConnection(state, "b");
    releaseConnection(state, "a");
    expect(state.perIp.get("b")).toBe(1);
    expect(state.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// The relay counts connections per client without holding the address
// ---------------------------------------------------------------------------

/**
 * `perIp` used to be keyed on the client address, so the relay held an address
 * for every live connection. The cap needs to know two connections came from
 * the same place. It does not need to know where that is.
 *
 * Narrow by design: the kernel still knows the peer address and so does
 * anything in front of the relay. This removes it from the one place this code
 * controls, so a heap dump or an accidental log of that map reveals nothing.
 */
describe("the connection key is a salted hash, not an address", () => {
  const salt = Buffer.alloc(32, 7);

  it("does not contain the address", () => {
    const key = hashClientIp("203.0.113.9", salt);
    expect(key).not.toContain("203");
    expect(key).not.toContain("113");
    expect(key).toMatch(/^[0-9a-f]{32}$/);
  });

  it("gives the same client the same key, so the cap still counts", () => {
    expect(hashClientIp("203.0.113.9", salt)).toBe(
      hashClientIp("203.0.113.9", salt),
    );
  });

  it("gives different clients different keys", () => {
    expect(hashClientIp("203.0.113.9", salt)).not.toBe(
      hashClientIp("203.0.113.10", salt),
    );
  });

  it("gives unrelated keys under a different salt", () => {
    // The salt is random per process, so the same address on two runs is not
    // linkable across them.
    const other = Buffer.alloc(32, 9);
    expect(hashClientIp("203.0.113.9", salt)).not.toBe(
      hashClientIp("203.0.113.9", other),
    );
  });

  it("hashes before the address reaches the connection map", () => {
    // A hash function nothing calls is not a fix. The upgrade handler must
    // pass the hashed value, not the resolved address.
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../server/relay.ts"),
      "utf8",
    );
    expect(src).toMatch(/const ip = hashClientIp\(\s*resolveClientIp\(/);
  });
});
