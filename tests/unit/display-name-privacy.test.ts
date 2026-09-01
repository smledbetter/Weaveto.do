// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { placeholderName } from "../../src/lib/room/session";

/**
 * A display name is the one piece of personal data a member supplies, and it
 * used to travel to the relay in the clear.
 *
 * It rode in the `join` message, the relay stored it on every RoomClient, and
 * it went back out in `member_list` and `new_member`. So the server held a
 * name for every person in every room, next to their address and their
 * activity. That is the thing "the server cannot identify users" was supposed
 * to rule out, and people put their real names in that box.
 *
 * It now rides in the Olm-encrypted key share instead, which every member
 * exchanges at join anyway. The relay routes that as opaque ciphertext.
 *
 * Structural assertions over the relay, because the property is "this data
 * does not reach here". Behaviour is covered by
 * tests/e2e/display-name-privacy.spec.ts, which reads the frames on the wire.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/** Source with comments stripped, so prose about a removed field does not count. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const relayCode = code(read("server/relay.ts"));
const sessionCode = code(read("src/lib/room/session.ts"));

describe("the relay never handles a display name", () => {
  it("does not mention one anywhere", () => {
    // Not stored, not validated, not forwarded. The strongest form of the
    // assertion, and it is affordable because the relay has no reason to know.
    expect(relayCode).not.toMatch(/displayName/);
  });

  it("does not carry a length limit for a field it never sees", () => {
    expect(relayCode).not.toMatch(/MAX_DISPLAY_NAME_LENGTH/);
  });

  it("keeps only the identity key on a room client", () => {
    const iface = read("server/relay.ts").match(
      /export interface RoomClient \{([\s\S]*?)\n\}/,
    );
    expect(iface, "RoomClient not found").toBeTruthy();
    const fields = [...iface![1].matchAll(/^\s*(\w+)[?]?:/gm)].map((m) => m[1]);
    expect(fields.sort()).toEqual(["identityKey", "ws"]);
  });
});

describe("the client sends its name only over Olm", () => {
  it("does not put a name in the join message", () => {
    // The join is the one message the relay reads in full.
    const joins = [...sessionCode.matchAll(/type: "join"[\s\S]{0,320}?\};/g)];
    expect(joins.length, "no join message construction found").toBeGreaterThan(0);
    for (const join of joins) {
      expect(join[0]).not.toMatch(/displayName/);
    }
  });

  it("puts the name in every Megolm key payload", () => {
    // Four of them: first share, rotation, reply to a new member, and the
    // reciprocal share. A member whose name rides in only some of those is
    // named for some peers and anonymous to others.
    const payloads = [...sessionCode.matchAll(/JSON\.stringify\(\{[^}]*sessionKey[^}]*\}\)/g)];
    expect(payloads.length).toBe(4);
    for (const p of payloads) {
      expect(p[0]).toMatch(/displayName: this\.displayName/);
    }
  });

  it("reads a peer's name back out of the key share", () => {
    expect(sessionCode).toMatch(/recordDisplayName\(/);
  });

  it("enforces the length the relay can no longer enforce", () => {
    // The cap used to live in the relay's join validator. It moved here with
    // the data, because a name now arrives inside ciphertext.
    expect(sessionCode).toMatch(/MAX_DISPLAY_NAME_LENGTH/);
    expect(sessionCode).toMatch(/slice\(0, MAX_DISPLAY_NAME_LENGTH\)/);
  });
});

describe("what a member is called before their name arrives", () => {
  it("is derived from the identity key, so it is stable", () => {
    const key = "abcDEF123456xyz";
    expect(placeholderName(key)).toBe(placeholderName(key));
    expect(placeholderName(key)).toContain("abcDEF");
  });

  it("distinguishes two unnamed members", () => {
    // An empty space for everyone would make a two-person room ambiguous.
    expect(placeholderName("aaaaaa111")).not.toBe(placeholderName("bbbbbb222"));
  });

  it("drops characters that are not safe to show", () => {
    // Identity keys are base64 and can carry + / =.
    expect(placeholderName("++//==abcdef")).toBe("Member abcdef");
  });

  it("still returns something for an empty key", () => {
    expect(placeholderName("")).toBe("Member");
    expect(placeholderName("+++")).toBe("Member");
  });
});
