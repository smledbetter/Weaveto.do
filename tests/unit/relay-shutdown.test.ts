// @vitest-environment node
/**
 * Defect: no SIGTERM handler. A deploy hard-killed every socket, and because
 * rooms live in one in-process Map, every live room died with no warning that
 * it was coming back.
 */
import { describe, it, expect } from "vitest";
import { WebSocket } from "ws";
import {
  buildRestartNotice,
  notifyRestart,
  closeRemaining,
} from "../../server/relay";
import type { ServerRestartingMessage } from "../../server/relay";

interface FakeSocket {
  readyState: number;
  sent: string[];
  closedWith: Array<{ code?: number; reason?: string }>;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

function fakeSocket(readyState: number = WebSocket.OPEN): FakeSocket {
  return {
    readyState,
    sent: [],
    closedWith: [],
    send(data: string) {
      this.sent.push(data);
    },
    close(code?: number, reason?: string) {
      this.closedWith.push({ code, reason });
      this.readyState = WebSocket.CLOSED;
    },
  };
}

describe("buildRestartNotice", () => {
  it("is valid JSON", () => {
    expect(() => JSON.parse(buildRestartNotice())).not.toThrow();
  });

  it("has type server_restarting", () => {
    const notice = JSON.parse(buildRestartNotice()) as ServerRestartingMessage;
    expect(notice.type).toBe("server_restarting");
  });

  it("carries a positive reconnect hint", () => {
    const notice = JSON.parse(buildRestartNotice()) as ServerRestartingMessage;
    expect(typeof notice.reconnectAfterMs).toBe("number");
    expect(notice.reconnectAfterMs).toBeGreaterThan(0);
  });

  it("carries exactly the two documented fields", () => {
    // The relay must not start leaking extra state into a shutdown broadcast.
    const notice = JSON.parse(buildRestartNotice());
    expect(Object.keys(notice).sort()).toEqual(["reconnectAfterMs", "type"]);
  });

  it("accepts an explicit hint", () => {
    const notice = JSON.parse(
      buildRestartNotice(1234),
    ) as ServerRestartingMessage;
    expect(notice.reconnectAfterMs).toBe(1234);
  });

  it("is distinguishable from the permanent room_destroyed message", () => {
    // A restart means come back; room_destroyed means the room is gone.
    const notice = JSON.parse(buildRestartNotice());
    expect(notice.type).not.toBe("room_destroyed");
    expect(notice.reason).toBeUndefined();
  });

  it("carries no room, identity, or ciphertext data", () => {
    const raw = buildRestartNotice();
    for (const field of [
      "roomId",
      "identityKey",
      "ciphertext",
      "displayName",
      "ip",
    ]) {
      expect(raw).not.toContain(field);
    }
  });
});

describe("notifyRestart", () => {
  it("tells every open connection before the process goes away", () => {
    const sockets = [fakeSocket(), fakeSocket(), fakeSocket()];
    const notice = buildRestartNotice();

    expect(notifyRestart(sockets, notice)).toBe(3);
    for (const socket of sockets) {
      expect(socket.sent).toEqual([notice]);
    }
  });

  it("skips sockets that are not open", () => {
    const open = fakeSocket(WebSocket.OPEN);
    const closing = fakeSocket(WebSocket.CLOSING);
    const closed = fakeSocket(WebSocket.CLOSED);
    const connecting = fakeSocket(WebSocket.CONNECTING);

    expect(notifyRestart([open, closing, closed, connecting], "x")).toBe(1);
    expect(closing.sent).toEqual([]);
    expect(closed.sent).toEqual([]);
    expect(connecting.sent).toEqual([]);
  });

  it("handles no connections at all", () => {
    expect(notifyRestart([], buildRestartNotice())).toBe(0);
  });

  it("accepts a Set, matching wss.clients", () => {
    const socket = fakeSocket();
    expect(notifyRestart(new Set([socket]), "x")).toBe(1);
  });
});

describe("closeRemaining", () => {
  it("closes stragglers with 1001 Going Away", () => {
    const socket = fakeSocket();
    expect(closeRemaining([socket])).toBe(1);
    expect(socket.closedWith).toEqual([
      { code: 1001, reason: "Server restarting" },
    ]);
  });

  it("uses a protocol close code, not an application 4xxx code", () => {
    // 4000-4999 are this relay's application codes (room purged, rate limit,
    // and so on). A restart is a transport event, so it uses the RFC code.
    const socket = fakeSocket();
    closeRemaining([socket]);
    const code = socket.closedWith[0].code as number;
    expect(code).toBeLessThan(4000);
  });

  it("leaves a client that already disconnected alone", () => {
    const gone = fakeSocket(WebSocket.CLOSED);
    expect(closeRemaining([gone])).toBe(0);
    expect(gone.closedWith).toEqual([]);
  });

  it("handles no connections at all", () => {
    expect(closeRemaining([])).toBe(0);
  });
});

describe("drain sequence", () => {
  it("notifies first, then closes only whoever stayed", () => {
    // The whole point of the drain window: a client that acts on the notice
    // closes itself and is never force-closed.
    const leaves = fakeSocket();
    const stays = fakeSocket();
    const notice = buildRestartNotice();

    expect(notifyRestart([leaves, stays], notice)).toBe(2);

    // The obedient client reads the notice and disconnects during the window.
    leaves.readyState = WebSocket.CLOSED;

    expect(closeRemaining([leaves, stays])).toBe(1);
    expect(leaves.closedWith).toEqual([]);
    expect(stays.closedWith[0].code).toBe(1001);
  });

  it("delivers the notice before any close, so the client can read it", () => {
    const socket = fakeSocket();
    const notice = buildRestartNotice();
    notifyRestart([socket], notice);
    closeRemaining([socket]);

    expect(socket.sent).toEqual([notice]);
    expect(socket.closedWith).toHaveLength(1);
  });
});
