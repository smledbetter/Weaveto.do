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
// ---------------------------------------------------------------------------
// Tests — Part C: undecryptable key shares degrade delivery health
// ---------------------------------------------------------------------------

/**
 * A key share that will not decrypt is the worst delivery failure available
 * and the only one nothing else can see. The peer's Megolm key never arrives,
 * so their messages are never counted, leave no sequence gap, and the room
 * reads as healthy while that member is silently unreadable.
 *
 * This used to fire a `setDecryptFailureHandler` callback that nothing in the
 * app ever subscribed to. The tests passed, the accessor was dead, and the
 * catch was silent in production. It now marks the delivery tracker, which
 * the room page already polls to drive the shield icon.
 */
describe("RoomSession — undecryptable key share marks delivery degraded", () => {
  let session: RoomSession;

  beforeEach(() => {
    vi.clearAllMocks();
    session = makeSession();

    const ws = new TrackingWebSocket("ws://test");
    const s = session as unknown as Record<string, unknown>;
    s.ws = ws;
    s.outboundSession = { id: "mgm-group" };
  });

  /** Invoke handleKeyShare directly. The hand-built WS has no onmessage. */
  function callHandleKeyShare(targetIdentityKey: string) {
    (
      session as unknown as {
        handleKeyShare(msg: {
          type: "key_share";
          targetIdentityKey: string;
          senderIdentityKey: string;
          olmMessage: { type: number; body: string };
        }): void;
      }
    ).handleKeyShare.bind(session)({
      type: "key_share",
      targetIdentityKey,
      senderIdentityKey: "bad-peer",
      olmMessage: { type: 1, body: "corrupted" },
    });
  }

  it("starts healthy, so the assertions below mean something", () => {
    expect(session.getDeliveryTracker().hasGap()).toBe(false);
  });

  it("marks delivery degraded when Olm decryption throws on an existing session", () => {
    (mockOlmDecrypt as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("olmDecrypt: simulated failure");
    });

    // Seed an existing Olm session so handleKeyShare takes the
    // "existingOlm -> olmDecrypt" branch rather than createInboundSession.
    const s = session as unknown as Record<string, unknown>;
    (s.olmSessions as Map<string, unknown>).set("bad-peer", { id: "existing-olm" });

    callHandleKeyShare("my-identity-key");

    expect(session.getDeliveryTracker().hasGap()).toBe(true);
  });

  it("leaves delivery healthy for key shares not addressed to us", () => {
    (mockOlmDecrypt as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("olmDecrypt: simulated failure");
    });
    const s = session as unknown as Record<string, unknown>;
    (s.olmSessions as Map<string, unknown>).set("bad-peer", { id: "existing-olm" });

    callHandleKeyShare("someone-else");

    expect(session.getDeliveryTracker().hasGap()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Tests — Part D: the join frame differs correctly between connect and reconnect
// ---------------------------------------------------------------------------

/**
 * `create` and `ephemeral` belong to a first join only. A reconnect that
 * claimed to create the room it is rejoining would ask the relay to make a new
 * room under the same id, and an ephemeral flag replayed on every reconnect
 * would re-arm purge-on-last-disconnect against a room already in progress.
 *
 * That distinction used to live in the difference between two hand-written
 * object literals in two methods, which is where a field added to one and not
 * the other would hide. Both now go through buildJoinMessage. These pin the
 * behaviour rather than the structure, so the guard survives a refactor.
 */
describe("RoomSession — the join frame", () => {
  function joinFrameFrom(ws: MockWebSocket) {
    const raw = ws.sent.find((m) => JSON.parse(m).type === "join");
    expect(raw, "no join frame was sent").toBeTruthy();
    return JSON.parse(raw!) as Record<string, unknown>;
  }

  it("omits create and ephemeral on reconnect, even for an ephemeral creator", () => {
    const session = new RoomSession("room-1", "Alice", {
      isCreator: true,
      ephemeral: true,
    });
    const s = session as unknown as Record<string, unknown>;
    s.identityKey = "my-identity-key";
    s.ed25519Key = "my-ed25519";
    s.account = { id: "mock-account" };
    s.outboundSession = { id: "mgm-group" };
    s.outboundSessionId = "session-id";

    const ws = triggerReconnectOpen(session);
    const join = joinFrameFrom(ws);

    expect(join.create, "a reconnect must not claim to create the room").toBeUndefined();
    expect(join.ephemeral, "a reconnect must not re-arm ephemeral purge").toBeUndefined();
  });

  it("still carries identity and fresh one-time keys on reconnect", () => {
    // The inverse. A join frame stripped of everything would pass the test
    // above and break key exchange for every existing member.
    const session = makeSession();
    const ws = triggerReconnectOpen(session);
    const join = joinFrameFrom(ws);

    expect(join.type).toBe("join");
    expect(join.identityKey).toBe("my-identity-key");
    // Not toBeTruthy: `{}` is truthy, so that version passed against a join
    // frame carrying no keys at all, which would break key exchange for every
    // existing member. Assert the keys are actually there.
    expect(Object.keys(join.oneTimeKeys as Record<string, string>).length)
      .toBeGreaterThan(0);
  });
});
