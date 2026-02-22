/**
 * Unit tests for RoomSession reconnect Olm session clearing and
 * re-establishment tracking (Wave 2, M11).
 *
 * RoomSession depends on vodozemac WASM which is browser-only, so we mock
 * the entire crypto engine module and drive the session's private message
 * handlers via the WebSocket mock.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock crypto engine — all functions are no-ops / identity stubs.
// ---------------------------------------------------------------------------
vi.mock("$lib/crypto/engine", () => ({
  initCrypto: vi.fn().mockResolvedValue(undefined),
  createAccount: vi.fn().mockReturnValue({ id: "mock-account" }),
  pickleAccount: vi.fn().mockReturnValue("pickled"),
  unpickleAccount: vi.fn().mockReturnValue({ id: "mock-account" }),
  derivePickleKey: vi.fn().mockResolvedValue(new Uint8Array(32)),
  getIdentityKeys: vi
    .fn()
    .mockReturnValue({ curve25519: "my-identity-key", ed25519: "my-ed25519" }),
  generateOneTimeKeys: vi.fn(),
  getOneTimeKeys: vi.fn().mockReturnValue({ key1: "otk-value" }),
  markKeysAsPublished: vi.fn(),
  createOutboundSession: vi.fn().mockReturnValue({ id: "olm-outbound" }),
  createInboundSession: vi.fn().mockReturnValue({
    session: { id: "olm-inbound" },
    plaintext: JSON.stringify({
      sessionId: "mgm-session-1",
      sessionKey: "mgm-key-1",
      senderIdentityKey: "peer-identity-key",
    }),
  }),
  olmEncrypt: vi.fn().mockReturnValue({ type: 1, body: "encrypted" }),
  // Default: returns something parseable; specific tests can override to throw
  olmDecrypt: vi.fn().mockReturnValue(JSON.stringify({
    sessionId: "sess-x",
    sessionKey: "key-x",
    senderIdentityKey: "peer",
  })),
  createGroupSession: vi.fn().mockReturnValue({ id: "mgm-group" }),
  getGroupSessionKey: vi.fn().mockReturnValue("session-key"),
  getGroupSessionId: vi.fn().mockReturnValue("session-id"),
  createInboundGroupSession: vi.fn().mockReturnValue({ id: "mgm-inbound" }),
  megolmEncrypt: vi.fn().mockReturnValue("ciphertext"),
  megolmDecrypt: vi
    .fn()
    .mockReturnValue({ plaintext: '{"text":"hi","sender":"x","senderName":"X"}' }),
  // Return a count above the replenishment threshold so OTK replenishment
  // never fires as a side effect inside handleKeyShare during these tests.
  getOneTimeKeyCount: vi.fn().mockReturnValue(10),
}));

// Padding is a no-op in tests
vi.mock("$lib/crypto/padding", () => ({
  padMessage: vi.fn((s: string) => s),
  unpadMessage: vi.fn((s: string) => s),
}));

// ---------------------------------------------------------------------------
// Minimal WebSocket mock — must be a real class so `new WebSocket()` works.
// ---------------------------------------------------------------------------
class MockWebSocket {
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static CONNECTING = 0;

  readyState = MockWebSocket.OPEN;
  sent: string[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_url: string) {}

  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  /** Deliver a server message to session's onmessage handler. */
  deliver(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }

  /** Simulate WebSocket open event. */
  open() {
    this.onopen?.();
  }
}

// Track the most recently created MockWebSocket instance
let currentWs: MockWebSocket;
const OriginalMockWebSocket = MockWebSocket;

class TrackingWebSocket extends OriginalMockWebSocket {
  constructor(url: string) {
    super(url);
    currentWs = this;
  }
}

// Install the mock before importing the session module
// @ts-expect-error — replacing browser global for test environment
globalThis.WebSocket = TrackingWebSocket;

// Stub sessionStorage (not available in Node)
globalThis.sessionStorage = {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn().mockReturnValue(null),
};

// ---------------------------------------------------------------------------
// Import subject under test AFTER mocks are installed
// ---------------------------------------------------------------------------
import { RoomSession } from "$lib/room/session";
import { olmDecrypt as mockOlmDecrypt } from "$lib/crypto/engine";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a session with crypto state pre-seeded, bypassing connect() to avoid
 * real async / browser API dependencies.
 */
function makeSession(myIdentityKey = "my-identity-key"): RoomSession {
  const session = new RoomSession("room-1", "Alice");
  const s = session as unknown as Record<string, unknown>;
  s.identityKey = myIdentityKey;
  s.ed25519Key = "my-ed25519";
  s.account = { id: "mock-account" };
  s.outboundSession = { id: "mgm-group" };
  s.outboundSessionId = "session-id";
  s.ws = null;
  return session;
}

/**
 * Invoke scheduleReconnect() then run timers so attemptReconnect() fires,
 * then open the resulting WebSocket.  Returns the new MockWebSocket.
 */
function triggerReconnectOpen(session: RoomSession): MockWebSocket {
  vi.useFakeTimers();
  (session as unknown as { scheduleReconnect(): void }).scheduleReconnect();
  vi.runAllTimers();
  vi.useRealTimers();
  // currentWs is set by TrackingWebSocket constructor inside attemptReconnect()
  currentWs.open();
  return currentWs;
}

// ---------------------------------------------------------------------------
// Tests — Part A: clearing stale Olm sessions
// ---------------------------------------------------------------------------

describe("RoomSession reconnect — Olm session clearing", () => {
  let session: RoomSession;

  beforeEach(() => {
    vi.clearAllMocks();
    session = makeSession();

    // Pre-populate olmSessions with stale entries
    const s = session as unknown as Record<string, unknown>;
    (s.olmSessions as Map<string, unknown>).set("peer-key-1", { id: "stale-olm-1" });
    (s.olmSessions as Map<string, unknown>).set("peer-key-2", { id: "stale-olm-2" });

    // Pre-populate members with an olmSession reference
    (s.members as Map<string, object>).set("peer-key-1", {
      identityKey: "peer-key-1",
      displayName: "Bob",
      olmSession: { id: "stale-olm-1" },
    });
  });

  it("clears the olmSessions map on reconnect open", () => {
    const s = session as unknown as Record<string, unknown>;
    expect((s.olmSessions as Map<string, unknown>).size).toBe(2);

    triggerReconnectOpen(session);

    expect((s.olmSessions as Map<string, unknown>).size).toBe(0);
  });

  it("clears olmSession on each member entry on reconnect open", () => {
    triggerReconnectOpen(session);

    const members = (session as unknown as Record<string, unknown>)
      .members as Map<string, { olmSession: unknown }>;
    for (const member of members.values()) {
      expect(member.olmSession).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — Part B: re-establishment tracking
// ---------------------------------------------------------------------------

describe("RoomSession reconnect — re-establishment tracking", () => {
  let session: RoomSession;
  let reestablishingCalls: boolean[];

  beforeEach(() => {
    vi.clearAllMocks();
    session = makeSession();
    reestablishingCalls = [];
    session.setReestablishingHandler((active) => reestablishingCalls.push(active));
  });

  it("sets reestablishing=true and fires handler(true) on reconnect open", () => {
    triggerReconnectOpen(session);

    const s = session as unknown as Record<string, unknown>;
    expect(s.reestablishing).toBe(true);
    expect(reestablishingCalls).toEqual([true]);
  });

  it("clears pendingKeyExchanges on reconnect open", () => {
    const s = session as unknown as Record<string, unknown>;
    (s.pendingKeyExchanges as Set<string>).add("leftover-key");

    triggerReconnectOpen(session);

    expect((s.pendingKeyExchanges as Set<string>).size).toBe(0);
  });

  it("adds each non-self member to pendingKeyExchanges on member_list during re-establishment", () => {
    triggerReconnectOpen(session);

    currentWs.deliver({
      type: "member_list",
      members: [
        { identityKey: "peer-a", displayName: "Alice" },
        { identityKey: "peer-b", displayName: "Bob" },
        { identityKey: "my-identity-key", displayName: "Me" }, // should be skipped
      ],
    });

    const pending = (session as unknown as Record<string, unknown>)
      .pendingKeyExchanges as Set<string>;
    expect(pending.has("peer-a")).toBe(true);
    expect(pending.has("peer-b")).toBe(true);
    expect(pending.has("my-identity-key")).toBe(false);
  });

  it("does NOT add members to pendingKeyExchanges when not in re-establishing mode", () => {
    // No reconnect — reestablishing stays false
    const s = session as unknown as Record<string, unknown>;
    expect(s.reestablishing).toBe(false);

    // Call handleMemberList directly — bypass the WS transport
    const handleMemberList = (
      session as unknown as {
        handleMemberList(msg: {
          type: "member_list";
          members: Array<{ identityKey: string; displayName: string }>;
        }): void;
      }
    ).handleMemberList.bind(session);

    handleMemberList({
      type: "member_list",
      members: [{ identityKey: "peer-a", displayName: "Alice" }],
    });

    expect((s.pendingKeyExchanges as Set<string>).size).toBe(0);
  });

  it("sets reestablishing=false and fires handler(false) when last pending key exchange completes", () => {
    triggerReconnectOpen(session);

    // Server announces one member
    currentWs.deliver({
      type: "member_list",
      members: [{ identityKey: "peer-identity-key", displayName: "Bob" }],
    });

    const s = session as unknown as Record<string, unknown>;
    expect((s.pendingKeyExchanges as Set<string>).size).toBe(1);
    expect(s.reestablishing).toBe(true);

    // Key share from that member (type:0 = pre-key → createInboundSession path)
    currentWs.deliver({
      type: "key_share",
      targetIdentityKey: "my-identity-key",
      senderIdentityKey: "peer-identity-key",
      olmMessage: { type: 0, body: "prekey-body" },
    });

    expect((s.pendingKeyExchanges as Set<string>).size).toBe(0);
    expect(s.reestablishing).toBe(false);
    expect(reestablishingCalls).toEqual([true, false]);
  });

  it("keeps reestablishing=true if other peers still have pending exchanges", () => {
    triggerReconnectOpen(session);

    currentWs.deliver({
      type: "member_list",
      members: [
        { identityKey: "peer-identity-key", displayName: "Bob" },
        { identityKey: "peer-other", displayName: "Carol" },
      ],
    });

    // Only one key share arrives
    currentWs.deliver({
      type: "key_share",
      targetIdentityKey: "my-identity-key",
      senderIdentityKey: "peer-identity-key",
      olmMessage: { type: 0, body: "prekey-body" },
    });

    const s = session as unknown as Record<string, unknown>;
    expect((s.pendingKeyExchanges as Set<string>).has("peer-other")).toBe(true);
    expect(s.reestablishing).toBe(true);
    // Handler should only have fired once (with true), not with false yet
    expect(reestablishingCalls).toEqual([true]);
  });
});

// ---------------------------------------------------------------------------
// Tests — Part C: decrypt failure callback
// ---------------------------------------------------------------------------

describe("RoomSession — decrypt failure callback", () => {
  let session: RoomSession;
  let decryptFailures: string[];

  beforeEach(() => {
    vi.clearAllMocks();
    session = makeSession();
    decryptFailures = [];
    session.setDecryptFailureHandler((senderId) => decryptFailures.push(senderId));

    // Provide a live WS on the session
    const ws = new TrackingWebSocket("ws://test");
    const s = session as unknown as Record<string, unknown>;
    s.ws = ws;
    s.outboundSession = { id: "mgm-group" };
  });

  it("fires onDecryptFailure when Olm decryption throws on an existing session", () => {
    // Override olmDecrypt to throw for this test
    (mockOlmDecrypt as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("olmDecrypt: simulated failure");
    });

    // Seed an existing Olm session so handleKeyShare takes the
    // "existingOlm → olmDecrypt" branch (not createInboundSession).
    const s = session as unknown as Record<string, unknown>;
    (s.olmSessions as Map<string, unknown>).set("bad-peer", { id: "existing-olm" });

    // Call handleKeyShare directly via reflection — the manually-created WS
    // above has no session onmessage handler attached to it, so we bypass
    // the transport layer entirely and invoke the method directly.
    const handleKeyShare = (
      session as unknown as {
        handleKeyShare(msg: {
          type: "key_share";
          targetIdentityKey: string;
          senderIdentityKey: string;
          olmMessage: { type: number; body: string };
        }): void;
      }
    ).handleKeyShare.bind(session);

    handleKeyShare({
      type: "key_share",
      targetIdentityKey: "my-identity-key",
      senderIdentityKey: "bad-peer",
      olmMessage: { type: 1, body: "corrupted" },
    });

    expect(decryptFailures).toEqual(["bad-peer"]);
  });

  it("does not fire onDecryptFailure for key_share messages not addressed to us", () => {
    const handleKeyShare = (
      session as unknown as {
        handleKeyShare(msg: {
          type: "key_share";
          targetIdentityKey: string;
          senderIdentityKey: string;
          olmMessage: { type: number; body: string };
        }): void;
      }
    ).handleKeyShare.bind(session);

    handleKeyShare({
      type: "key_share",
      targetIdentityKey: "someone-else",
      senderIdentityKey: "bad-peer",
      olmMessage: { type: 1, body: "corrupted" },
    });

    // Message was not for us — handler must not fire
    expect(decryptFailures).toHaveLength(0);
  });
});
