// @vitest-environment node
/**
 * Defect: removeClient() deleted an emptied room from `rooms` but never from
 * `pushSubscriptions`. Endpoints accumulated for the life of the process — an
 * unbounded leak, and retention of data the privacy policy says is not kept.
 */
import { describe, it, expect } from "vitest";
import { WebSocket } from "ws";
import { deleteRoomState, removeClient } from "../../server/relay";
import type { Room, RoomClient } from "../../server/relay";
import type { PushSubscriptionData } from "../../server/push-types";

const ROOM_A = "0123456789abcdef0123456789abcdef";
const ROOM_B = "fedcba9876543210fedcba9876543210";

function subscription(id: string): PushSubscriptionData {
  return {
    endpoint: `https://push.example/${id}`,
    keys: { p256dh: `p256dh-${id}`, auth: `auth-${id}` },
  };
}

/** A room client whose socket only records what was sent to it. */
function member(identityKey: string, readyState: number = WebSocket.OPEN) {
  const sent: string[] = [];
  const ws = {
    readyState,
    send: (data: string) => {
      sent.push(data);
    },
  };
  const client: RoomClient = {
    ws: ws as unknown as WebSocket,
    identityKey,
  };
  return { client, sent };
}

function roomWith(...identityKeys: string[]): Room {
  const clients = new Map<string, RoomClient>();
  for (const key of identityKeys) {
    clients.set(key, member(key).client);
  }
  return { clients };
}

describe("deleteRoomState", () => {
  it("clears both registries", () => {
    const rooms = new Map<string, unknown>([[ROOM_A, roomWith()]]);
    const push = new Map<string, unknown>([[ROOM_A, new Map()]]);

    deleteRoomState(ROOM_A, rooms, push);

    expect(rooms.has(ROOM_A)).toBe(false);
    expect(push.has(ROOM_A)).toBe(false);
  });

  it("leaves other rooms untouched", () => {
    const rooms = new Map<string, unknown>([
      [ROOM_A, roomWith()],
      [ROOM_B, roomWith()],
    ]);
    const push = new Map<string, unknown>([
      [ROOM_A, new Map()],
      [ROOM_B, new Map()],
    ]);

    deleteRoomState(ROOM_A, rooms, push);

    expect(rooms.has(ROOM_B)).toBe(true);
    expect(push.has(ROOM_B)).toBe(true);
  });

  it("is safe on a room that was never there", () => {
    const rooms = new Map<string, unknown>();
    const push = new Map<string, unknown>();
    expect(() => deleteRoomState(ROOM_A, rooms, push)).not.toThrow();
  });

  it("is idempotent", () => {
    const rooms = new Map<string, unknown>([[ROOM_A, roomWith()]]);
    const push = new Map<string, unknown>([[ROOM_A, new Map()]]);
    deleteRoomState(ROOM_A, rooms, push);
    deleteRoomState(ROOM_A, rooms, push);
    expect(rooms.size).toBe(0);
    expect(push.size).toBe(0);
  });
});

describe("removeClient", () => {
  it("keeps no push endpoints once the last member leaves", () => {
    const rooms = new Map<string, Room>([[ROOM_A, roomWith("alice")]]);
    const push = new Map([
      [
        ROOM_A,
        new Map([
          ["alice", subscription("alice")],
          ["bob", subscription("bob")],
        ]),
      ],
    ]);

    removeClient(ROOM_A, "alice", rooms, push);

    expect(rooms.has(ROOM_A)).toBe(false);
    expect(push.has(ROOM_A)).toBe(false);
    expect(push.size).toBe(0);
  });

  it("retains nothing across many rooms opening and emptying", () => {
    // The leak only shows at scale: every room that ever existed left its
    // endpoints behind for the life of the process.
    const rooms = new Map<string, Room>();
    const push = new Map<string, Map<string, PushSubscriptionData>>();

    for (let i = 0; i < 500; i++) {
      const roomId = i.toString(16).padStart(32, "0");
      rooms.set(roomId, roomWith("alice"));
      push.set(roomId, new Map([["alice", subscription("alice")]]));
      removeClient(roomId, "alice", rooms, push);
    }

    expect(rooms.size).toBe(0);
    expect(push.size).toBe(0);
  });

  it("keeps push subscriptions while the room still has members", () => {
    // A member who is offline but still subscribed is exactly who push exists
    // for, so an occupied room must keep its endpoints.
    const rooms = new Map<string, Room>([[ROOM_A, roomWith("alice", "bob")]]);
    const push = new Map([[ROOM_A, new Map([["bob", subscription("bob")]])]]);

    removeClient(ROOM_A, "alice", rooms, push);

    expect(rooms.get(ROOM_A)?.clients.size).toBe(1);
    expect(push.get(ROOM_A)?.get("bob")).toBeDefined();
  });

  it("does not disturb another room's subscriptions", () => {
    const rooms = new Map<string, Room>([
      [ROOM_A, roomWith("alice")],
      [ROOM_B, roomWith("carol")],
    ]);
    const push = new Map([
      [ROOM_A, new Map([["alice", subscription("alice")]])],
      [ROOM_B, new Map([["carol", subscription("carol")]])],
    ]);

    removeClient(ROOM_A, "alice", rooms, push);

    expect(push.get(ROOM_B)?.get("carol")).toBeDefined();
    expect(rooms.has(ROOM_B)).toBe(true);
  });

  it("tells the remaining members who left", () => {
    const alice = member("alice");
    const bob = member("bob");
    const clients = new Map([
      ["alice", alice.client],
      ["bob", bob.client],
    ]);
    const rooms = new Map<string, Room>([[ROOM_A, { clients }]]);
    const push = new Map<string, Map<string, PushSubscriptionData>>();

    removeClient(ROOM_A, "alice", rooms, push);

    expect(bob.sent).toHaveLength(1);
    expect(JSON.parse(bob.sent[0])).toEqual({
      type: "member_left",
      identityKey: "alice",
    });
    expect(alice.sent).toHaveLength(0);
  });

  it("skips members whose socket is no longer open", () => {
    const bob = member("bob", WebSocket.CLOSED);
    const clients = new Map([
      ["alice", member("alice").client],
      ["bob", bob.client],
    ]);
    const rooms = new Map<string, Room>([[ROOM_A, { clients }]]);

    removeClient(ROOM_A, "alice", rooms, new Map());

    expect(bob.sent).toHaveLength(0);
  });

  it("is safe when the room is already gone", () => {
    const rooms = new Map<string, Room>();
    const push = new Map([[ROOM_A, new Map([["alice", subscription("a")]])]]);

    expect(() => removeClient(ROOM_A, "alice", rooms, push)).not.toThrow();
    // A room that is not in the registry is not this call's to clean up.
    expect(push.has(ROOM_A)).toBe(true);
  });

  it("is safe when the member is not in the room", () => {
    const rooms = new Map<string, Room>([[ROOM_A, roomWith("alice")]]);
    const push = new Map<string, Map<string, PushSubscriptionData>>();
    removeClient(ROOM_A, "stranger", rooms, push);
    expect(rooms.get(ROOM_A)?.clients.size).toBe(1);
  });
});
