import { describe, it, expect } from "vitest";
import { selectOneTimeKey } from "$lib/room/session";

/**
 * Olm one-time keys are single use. Every existing member used to claim
 * Object.values(oneTimeKeys)[0], so the first key share to reach a joiner
 * consumed that key and every later one failed inside a silent catch. The
 * property that matters is DISJOINTNESS: no two members may claim the same key.
 */

/** Twenty published keys, as a joiner sends them. */
function keys(n = 20): Record<string, string> {
  return Object.fromEntries(
    Array.from({ length: n }, (_, i) => [`AAAA${String(i).padStart(2, "0")}`, `key-${i}`]),
  );
}

/** Realistic 43-char base64 Curve25519 identity keys. */
function identity(seed: string): string {
  return seed.padEnd(43, "x");
}

describe("selectOneTimeKey", () => {
  describe("disjointness — the property the old code violated", () => {
    it("gives two existing members different keys", () => {
      const otks = keys();
      const alice = identity("alice");
      const bob = identity("bob");

      const forAlice = selectOneTimeKey(otks, alice, [bob]);
      const forBob = selectOneTimeKey(otks, bob, [alice]);

      expect(forAlice).not.toBe(forBob);
    });

    it("reproduces the Bob-and-Carol case: three members, all distinct", () => {
      // Alice creates, Bob joins, Carol joins. Alice and Bob both receive
      // new_member(Carol) and both pick from Carol's keys.
      const otks = keys();
      const alice = identity("alice");
      const bob = identity("bob");
      const carol = identity("carol");

      const claimed = [
        selectOneTimeKey(otks, alice, [bob]),
        selectOneTimeKey(otks, bob, [alice]),
      ];

      expect(new Set(claimed).size).toBe(2);
      expect(claimed).not.toContain(null);
      expect(carol).toBeTruthy(); // the joiner is not a claimer
    });

    it("keeps every claim distinct up to the published key count", () => {
      const otks = keys(20);
      const members = Array.from({ length: 20 }, (_, i) => identity(`member${i}`));

      const claimed = members.map((self) =>
        selectOneTimeKey(otks, self, members.filter((m) => m !== self)),
      );

      expect(new Set(claimed).size).toBe(20);
    });

    it("the old strategy collides, which is why this function exists", () => {
      // Object.values(otks)[0] for everyone: one key, every member.
      const otks = keys();
      const oldStrategy = () => Object.values(otks)[0];
      const collided = [oldStrategy(), oldStrategy(), oldStrategy()];
      expect(new Set(collided).size).toBe(1);
    });
  });

  describe("agreement — every member must compute the same assignment", () => {
    it("does not depend on the order peers are listed in", () => {
      const otks = keys();
      const self = identity("alice");
      const peers = [identity("bob"), identity("carol"), identity("dave")];

      const a = selectOneTimeKey(otks, self, peers);
      const b = selectOneTimeKey(otks, self, [...peers].reverse());

      expect(a).toBe(b);
    });

    it("does not depend on the order the key ids arrive in", () => {
      const forward = keys(5);
      const reversed = Object.fromEntries(Object.entries(forward).reverse());
      const self = identity("alice");
      const peers = [identity("bob")];

      expect(selectOneTimeKey(forward, self, peers)).toBe(
        selectOneTimeKey(reversed, self, peers),
      );
    });

    it("is stable across repeated calls", () => {
      const otks = keys();
      const self = identity("alice");
      const peers = [identity("bob"), identity("carol")];
      const first = selectOneTimeKey(otks, self, peers);
      expect(selectOneTimeKey(otks, self, peers)).toBe(first);
    });

    it("tolerates self appearing in the peer list", () => {
      const otks = keys();
      const self = identity("alice");
      const peers = [identity("bob"), self];
      expect(selectOneTimeKey(otks, self, peers)).toBe(
        selectOneTimeKey(otks, self, [identity("bob")]),
      );
    });
  });

  describe("edge cases", () => {
    it("returns null when the joiner published no keys", () => {
      expect(selectOneTimeKey({}, identity("alice"), [])).toBeNull();
    });

    it("works for the first member in an otherwise empty room", () => {
      const result = selectOneTimeKey(keys(), identity("alice"), []);
      expect(result).toBe("key-0");
    });

    it("still returns a key when the room exceeds the published count", () => {
      // Past OTK_PUBLISH_COUNT the index wraps and collisions return. That is
      // a known remaining gap, not silent breakage — assert it behaves, and
      // assert the collision is real so the limit stays visible.
      const otks = keys(5);
      const members = Array.from({ length: 7 }, (_, i) => identity(`m${i}`));
      const claimed = members.map((self) =>
        selectOneTimeKey(otks, self, members.filter((m) => m !== self)),
      );

      expect(claimed.every((k) => k !== null)).toBe(true);
      expect(new Set(claimed).size).toBe(5);
    });

    it("handles a single published key without throwing", () => {
      const otks = { AAAA00: "only-key" };
      expect(selectOneTimeKey(otks, identity("alice"), [identity("bob")])).toBe(
        "only-key",
      );
    });
  });
});
