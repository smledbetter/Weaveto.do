// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  admitPushSubscription,
  selectPushRecipients,
  deleteRoomState,
} from "../../server/relay";
import type { PushSubscriptionData } from "../../server/push-types";

/**
 * Push is the second amplifying path in handleEncrypted, and the only one that
 * leaves the machine.
 *
 * Every relayed message fired one outbound HTTPS request per absent
 * subscriber, fire and forget, with no cap on the subscription list, no cap on
 * requests in flight, and no rate limit of any kind. The push carries no
 * payload, so those requests were also identical: twenty messages told the
 * same person the same nothing twenty times.
 *
 * docs/CAPACITY.md measured the relay with this path dormant, because no load
 * test ever created a subscription.
 */

const ROOM = "0123456789abcdef0123456789abcdef";

function sub(id: string): PushSubscriptionData {
  return {
    endpoint: `https://push.example/${id}`,
    keys: { p256dh: `p-${id}`, auth: `a-${id}` },
  };
}

function subsFor(...ids: string[]): Map<string, PushSubscriptionData> {
  return new Map(ids.map((id) => [id, sub(id)]));
}

const nobodyConnected = () => false;

describe("the subscription list is bounded", () => {
  it("keeps subscriptions up to the cap", () => {
    const subs = new Map<string, PushSubscriptionData>();
    for (let i = 0; i < 5; i++) admitPushSubscription(subs, `k${i}`, sub(`k${i}`), 5);
    expect(subs.size).toBe(5);
    expect([...subs.keys()]).toEqual(["k0", "k1", "k2", "k3", "k4"]);
  });

  it("evicts the oldest rather than refusing the newest", () => {
    // Refusing means a new member gets no notifications because identities
    // that already left hold every slot.
    const subs = subsFor("a", "b", "c");
    const evicted = admitPushSubscription(subs, "d", sub("d"), 3);
    expect(evicted).toBe("a");
    expect([...subs.keys()]).toEqual(["b", "c", "d"]);
  });

  it("moves a re-subscribing identity to the back", () => {
    // Otherwise an active member keeps its original position and is evicted
    // ahead of identities that have not been seen since.
    const subs = subsFor("a", "b", "c");
    expect(admitPushSubscription(subs, "a", sub("a"), 3)).toBeNull();
    expect([...subs.keys()]).toEqual(["b", "c", "a"]);
    expect(subs.size).toBe(3);
  });

  it("replaces the endpoint when an identity re-subscribes", () => {
    const subs = subsFor("a");
    const fresh = { ...sub("a"), endpoint: "https://push.example/new" };
    admitPushSubscription(subs, "a", fresh, 3);
    expect(subs.get("a")!.endpoint).toBe("https://push.example/new");
  });
});

describe("who gets pushed to", () => {
  it("skips the sender", () => {
    const cooldowns = new Map<string, number>();
    const got = selectPushRecipients(
      subsFor("alice", "bob"),
      nobodyConnected,
      "alice",
      1000,
      cooldowns,
    );
    expect(got.map(([k]) => k)).toEqual(["bob"]);
  });

  it("skips anyone currently connected", () => {
    // They are reading the message over the socket already.
    const cooldowns = new Map<string, number>();
    const got = selectPushRecipients(
      subsFor("bob", "carol"),
      (k) => k === "bob",
      "alice",
      1000,
      cooldowns,
    );
    expect(got.map(([k]) => k)).toEqual(["carol"]);
  });

  it("pushes an absent subscriber once, not once per message", () => {
    // This is the property that bounds the outbound request rate. Without it
    // the push rate is the message rate multiplied by the absent members.
    const cooldowns = new Map<string, number>();
    const send = (now: number) =>
      selectPushRecipients(subsFor("bob"), nobodyConnected, "alice", now, cooldowns, 30_000);

    expect(send(1000)).toHaveLength(1);
    for (let t = 1100; t < 31_000; t += 100) expect(send(t)).toHaveLength(0);
  });

  it("pushes again once the cooldown has passed", () => {
    const cooldowns = new Map<string, number>();
    const send = (now: number) =>
      selectPushRecipients(subsFor("bob"), nobodyConnected, "alice", now, cooldowns, 30_000);

    send(1000);
    expect(send(31_001)).toHaveLength(1);
  });

  it("charges the cooldown to every recipient it returns", () => {
    // The caller may drop a request when too many are in flight. It still pays
    // the cooldown, because retrying a shed request immediately is how load
    // shedding turns into a hot loop.
    const cooldowns = new Map<string, number>();
    selectPushRecipients(subsFor("bob", "carol"), nobodyConnected, "alice", 1000, cooldowns);
    expect([...cooldowns.entries()].sort()).toEqual([
      ["bob", 1000],
      ["carol", 1000],
    ]);
  });

  it("tracks each subscriber's cooldown separately", () => {
    const cooldowns = new Map<string, number>();
    selectPushRecipients(subsFor("bob"), nobodyConnected, "alice", 1000, cooldowns, 30_000);
    const got = selectPushRecipients(
      subsFor("bob", "carol"),
      nobodyConnected,
      "alice",
      2000,
      cooldowns,
      30_000,
    );
    expect(got.map(([k]) => k)).toEqual(["carol"]);
  });
});

describe("deleting a room clears every registry keyed by it", () => {
  it("clears all the registries it is given", () => {
    const a = new Map<string, unknown>([[ROOM, 1]]);
    const b = new Map<string, unknown>([[ROOM, 2]]);
    const c = new Map<string, unknown>([[ROOM, 3]]);
    deleteRoomState(ROOM, a, b, c);
    expect([a.size, b.size, c.size]).toEqual([0, 0, 0]);
  });

  it("passes every room-keyed registry in the relay to deleteRoomState", () => {
    // Adding a registry and forgetting to clear it is the exact bug
    // deleteRoomState exists to fix, and it has now been made twice: once for
    // push subscriptions, once for push cooldowns. Enumerate the module-level
    // maps keyed by room id and assert each reaches the call.
    const src = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../server/relay.ts"),
      "utf8",
    );

    const roomKeyed = [...src.matchAll(/^const (\w+) = new Map<string, /gm)]
      .map((m) => m[1])
      // `rooms` is the registry the others are keyed alongside.
      .filter((name) => name !== "rooms");

    expect(roomKeyed.length, "no room-keyed registries found").toBeGreaterThan(0);

    const call = src.match(/deleteRoomState\(\s*roomId,[\s\S]*?\);/);
    expect(call, "deleteRoomState call not found").toBeTruthy();
    const passed = call![0];

    // Each registry reaches the call, either directly or through the parameter
    // it is passed as at the single call site in the connection handler.
    const wiring = src.match(/removeClient\(\s*roomId,[\s\S]*?\);/);
    expect(wiring, "removeClient call not found").toBeTruthy();

    for (const name of roomKeyed) {
      expect(
        wiring![0].includes(name),
        `${name} is keyed by room id but is not passed to removeClient, so it survives the room`,
      ).toBe(true);
    }
    expect(passed).toMatch(/Registry/);
  });
});
