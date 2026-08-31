import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The relay must hold no authoritative state.
 *
 * Every room field the relay used to keep was either dead, derivable from live
 * connections, or re-sent by clients on connect. Keeping any of them is what
 * made a deploy destroy every room and made a second process impossible.
 *
 * These are structural assertions over the source rather than behavioural
 * tests, because the property is "this state does not exist". Behaviour is
 * covered by tests/e2e/relay-restart.spec.ts, which restarts a real relay
 * mid-session.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const relaySource = readFileSync(resolve(ROOT, "server/relay.ts"), "utf8");
const sessionSource = readFileSync(
  resolve(ROOT, "src/lib/room/session.ts"),
  "utf8",
);

/** Source with comments stripped, so prose about a removed field does not count. */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const relayCode = code(relaySource);
const sessionCode = code(sessionSource);

describe("the relay holds no authoritative state", () => {
  it("has no creator identity on a room", () => {
    // Used for exactly one thing: authorising purge. Burn is now an encrypted
    // message between members, so the relay needs no notion of a creator.
    expect(relayCode).not.toMatch(/creatorIdentityKey/);
  });

  it("has no ephemeral flag on a room", () => {
    // It was written once and never read. Ephemeral mode is client behaviour.
    expect(relayCode).not.toMatch(/\bephemeral\b\s*[:?]/);
  });

  it("has no purge handler", () => {
    expect(relayCode).not.toMatch(/handlePurge/);
    expect(relayCode).not.toMatch(/purge_unauthorized/);
  });

  it("never tells a client a room was destroyed", () => {
    // The relay is not a witness to a burn any more.
    expect(relayCode).not.toMatch(/room_destroyed/);
  });

  it("keeps only the routing table on a Room", () => {
    const roomInterface = relaySource.match(
      /export interface Room \{([\s\S]*?)\n\}/,
    );
    expect(roomInterface, "Room interface not found").toBeTruthy();
    const fields = [...roomInterface![1].matchAll(/^\s*(\w+)[?]?:/gm)].map(
      (m) => m[1],
    );
    expect(fields).toEqual(["clients"]);
  });
});

describe("a join reconstitutes a forgotten room", () => {
  it("does not refuse a join for an unknown room", () => {
    // The old code sent room_not_found whenever `create` was absent, which is
    // what turned every deploy into "this room does not exist or has expired".
    expect(relayCode).not.toMatch(/room_not_found/);
  });

  it("does not gate room creation on a create flag", () => {
    expect(relayCode).not.toMatch(/msg\.create/);
  });

  it("still enforces the room cap when creating one", () => {
    // Reconstituting a room must not become an unbounded allocation path.
    expect(relayCode).toMatch(/rooms\.size >= MAX_ROOMS/);
  });

  it("tells the joiner whether the room already existed", () => {
    // Without this a stale link silently drops someone into an empty room
    // instead of saying the room has expired.
    expect(relayCode).toMatch(/roomExisted/);
  });
});

describe("the client no longer depends on relay-side destruction", () => {
  it("sends a burn instruction instead of a purge request", () => {
    expect(sessionCode).toMatch(/sendBurnInstruction/);
    expect(sessionCode).not.toMatch(/sendPurgeRequest/);
  });

  it("acts on a burn instruction received from another member", () => {
    expect(sessionCode).toMatch(/payload\.burn/);
  });

  it("records whether the room existed on first join", () => {
    expect(sessionCode).toMatch(/firstJoinFoundRoom/);
  });

  it("does not treat a reconnect into an empty room as a stale link", () => {
    // After a restart the room is legitimately empty. Only the FIRST
    // member_list may set the flag.
    expect(sessionCode).toMatch(/firstJoinFoundRoom === null/);
  });
});
