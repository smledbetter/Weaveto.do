// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The check that actually closes the hole.
 *
 * Validating a hostname when a subscription arrives and resolving it again
 * when the request is sent is not a check. The second answer can differ from
 * the first, and an attacker controls both. That gap is DNS rebinding, and the
 * only way to close it is to resolve once and connect to the address that was
 * resolved.
 *
 * guardedLookup is passed to https.request as its `lookup` option, so the
 * socket connects to whatever this returns. Refusing here means no connection
 * is made at all.
 */

const lookupMock = vi.fn();
vi.mock("node:dns", () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
  default: { lookup: (...args: unknown[]) => lookupMock(...args) },
}));

const { guardedLookup, sendPushNotification, initVapid } = await import(
  "../../server/vapid"
);

/** Drive guardedLookup and capture what it hands back to the socket. */
function resolveWith(
  answers: Array<{ address: string; family: number }> | Error,
  options: Record<string, unknown> = {},
): Promise<{ err: Error | null; address: unknown; family?: number }> {
  lookupMock.mockImplementation((...args: unknown[]) => {
    const cb = args.find((a) => typeof a === "function") as (
      err: Error | null,
      result: unknown,
    ) => void;
    if (answers instanceof Error) cb(answers, null);
    else cb(null, answers);
  });
  return new Promise((resolve) => {
    guardedLookup(
      "push.example",
      options as never,
      (err, address, family) => resolve({ err: err as Error | null, address, family }),
    );
  });
}

beforeEach(() => {
  // Block body on purpose. `mockReset()` returns the mock for chaining, and an
  // arrow with an expression body returns it, which vitest then treats as a
  // teardown function and calls with no arguments at the end of every test.
  // That shows up as a mystery extra call to the mock.
  lookupMock.mockReset();
});

describe("resolving a push endpoint at request time", () => {
  it("hands back a public address for the socket to dial", () => {
    return resolveWith([{ address: "13.107.42.14", family: 4 }]).then((r) => {
      expect(r.err).toBeNull();
      expect(r.address).toBe("13.107.42.14");
      expect(r.family).toBe(4);
    });
  });

  it("refuses a hostname that resolves to loopback", async () => {
    // The syntactic check cannot catch this. `https://evil.example/x` is a
    // perfectly well-formed https URL with a hostname, and it resolves here.
    const r = await resolveWith([{ address: "127.0.0.1", family: 4 }]);
    expect(r.err).toBeTruthy();
    expect(r.err!.message).toContain("127.0.0.1");
  });

  it("refuses a hostname that resolves to the cloud metadata address", async () => {
    const r = await resolveWith([{ address: "169.254.169.254", family: 4 }]);
    expect(r.err).toBeTruthy();
  });

  it("refuses when any answer is blocked, not just the first", async () => {
    // Picking the acceptable answer out of a mixed set turns a clear refusal
    // into a race the attacker gets to keep re-entering. A real push service
    // has no reason to resolve to a private address at all.
    const r = await resolveWith([
      { address: "13.107.42.14", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    expect(r.err).toBeTruthy();
    expect(r.err!.message).toContain("10.0.0.1");
  });

  it("refuses an empty answer rather than connecting to nothing", async () => {
    const r = await resolveWith([]);
    expect(r.err).toBeTruthy();
  });

  it("passes a resolver failure straight through", async () => {
    const r = await resolveWith(new Error("ENOTFOUND"));
    expect(r.err).toBeTruthy();
    expect(r.err!.message).toContain("ENOTFOUND");
  });

  it("always asks the resolver for every answer", async () => {
    // Asking for one address would let a blocked answer hide behind a public
    // one, which is the whole reason for checking them all.
    await resolveWith([{ address: "13.107.42.14", family: 4 }]);
    expect(lookupMock.mock.calls[0][1]).toMatchObject({ all: true });
  });

  it("returns the list shape when the caller asked for all", async () => {
    const answers = [{ address: "13.107.42.14", family: 4 }];
    const r = await resolveWith(answers, { all: true });
    expect(r.err).toBeNull();
    expect(r.address).toEqual(answers);
  });
});

// ---------------------------------------------------------------------------
// The guard has to be wired into the request, not merely correct
// ---------------------------------------------------------------------------

/**
 * A guard that is never called is not a guard.
 *
 * Every test above calls guardedLookup directly, so deleting
 * `lookup: guardedLookup` from the request options leaves all of them passing
 * while the relay resolves push hostnames with no check at all. That mutation
 * survived the first version of this file.
 *
 * This inspects what the real request hands to the agent. Executing the lookup
 * for real is not possible here: the option is consumed inside the connection
 * the agent makes, so any stub that replaces the connection also replaces the
 * step being tested. What can be proved without the network is that the
 * request carries the guard, and the tests above prove the guard is right.
 */
describe("the guard is wired into the outbound request", () => {
  it("passes guardedLookup to the request that goes out", async () => {
    initVapid();
    const https = await import("node:https");
    const agent = https.globalAgent as unknown as { createConnection: unknown };
    const original = agent.createConnection;

    // Resolve fast and unsuccessfully. The request outcome does not matter,
    // only what was handed to the agent to make it.
    lookupMock.mockImplementation((...args: unknown[]) => {
      const cb = args.find((a) => typeof a === "function") as (
        e: Error | null,
        r: unknown,
      ) => void;
      cb(new Error("ENOTFOUND"), null);
    });

    const captured: Array<Record<string, unknown>> = [];
    const original2 = original as (
      o: Record<string, unknown>,
      c: unknown,
    ) => unknown;
    agent.createConnection = (opts: Record<string, unknown>, cb: unknown) => {
      captured.push(opts);
      return original2.call(https.globalAgent, opts, cb);
    };

    try {
      await sendPushNotification(
        {
          endpoint: "https://push.invalid.test/p/x",
          keys: { p256dh: "x".repeat(87), auth: "y".repeat(22) },
        },
        "",
      );
    } finally {
      agent.createConnection = original;
    }

    expect(captured.length, "the request never reached the agent").toBeGreaterThan(0);
    expect(
      captured[0].lookup,
      "the push request went out without the address guard attached",
    ).toBe(guardedLookup);
  });
});
