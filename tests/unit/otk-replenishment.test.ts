/**
 * Unit tests for OTK monitoring and replenishment (Wave 3, M11).
 *
 * Covers:
 *   A. getOneTimeKeyCount — counts entries from a Map-returning account
 *   B. checkAndReplenishOTKs — triggers generateOneTimeKeys + markKeysAsPublished below threshold
 *   C. No replenishment when OTK count is at or above threshold
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock crypto engine
// ---------------------------------------------------------------------------

const mockGenerateOneTimeKeys = vi.fn();
const mockMarkKeysAsPublished = vi.fn();
const mockGetOneTimeKeyCount = vi.fn();

vi.mock("$lib/crypto/engine", () => ({
  initCrypto: vi.fn().mockResolvedValue(undefined),
  createAccount: vi.fn().mockReturnValue({ id: "mock-account" }),
  pickleAccount: vi.fn().mockReturnValue("pickled"),
  unpickleAccount: vi.fn().mockReturnValue({ id: "mock-account" }),
  derivePickleKey: vi.fn().mockResolvedValue(new Uint8Array(32)),
  getIdentityKeys: vi
    .fn()
    .mockReturnValue({ curve25519: "my-identity-key", ed25519: "my-ed25519" }),
  generateOneTimeKeys: (...args: unknown[]) => mockGenerateOneTimeKeys(...args),
  getOneTimeKeys: vi.fn().mockReturnValue({ key1: "otk-value" }),
  markKeysAsPublished: (...args: unknown[]) => mockMarkKeysAsPublished(...args),
  getOneTimeKeyCount: (...args: unknown[]) => mockGetOneTimeKeyCount(...args),
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
  olmDecrypt: vi.fn().mockReturnValue(
    JSON.stringify({
      sessionId: "sess-x",
      sessionKey: "key-x",
      senderIdentityKey: "peer",
    }),
  ),
  createGroupSession: vi.fn().mockReturnValue({ id: "mgm-group" }),
  getGroupSessionKey: vi.fn().mockReturnValue("session-key"),
  getGroupSessionId: vi.fn().mockReturnValue("session-id"),
  createInboundGroupSession: vi.fn().mockReturnValue({ id: "mgm-inbound" }),
  megolmEncrypt: vi.fn().mockReturnValue("ciphertext"),
  megolmDecrypt: vi
    .fn()
    .mockReturnValue({ plaintext: '{"text":"hi","sender":"x","senderName":"X"}' }),
}));

// Padding is a no-op in tests
vi.mock("$lib/crypto/padding", () => ({
  padMessage: vi.fn((s: string) => s),
  unpadMessage: vi.fn((s: string) => s),
}));

// ---------------------------------------------------------------------------
// Minimal WebSocket mock
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

  deliver(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

// @ts-expect-error — replacing browser global for test environment
globalThis.WebSocket = MockWebSocket;

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
// Import subjects under test AFTER mocks are installed
// ---------------------------------------------------------------------------

import { getOneTimeKeyCount } from "$lib/crypto/engine";
import { RoomSession } from "$lib/room/session";

// ---------------------------------------------------------------------------
// Part A: getOneTimeKeyCount
// ---------------------------------------------------------------------------

// NOTE: getOneTimeKeyCount real implementation is tested in otk-count.test.ts
// (without module mock, verifying property-access API contract with vodozemac).
// These tests only verify the mock integration used by checkAndReplenishOTKs.
describe("getOneTimeKeyCount (mock integration)", () => {
  it("mock returns configured value for checkAndReplenishOTKs tests", () => {
    mockGetOneTimeKeyCount.mockReturnValue(3);
    expect(getOneTimeKeyCount({} as never)).toBe(3);
  });

  it("mock returns 0 to trigger replenishment path", () => {
    mockGetOneTimeKeyCount.mockReturnValue(0);
    expect(getOneTimeKeyCount({} as never)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(myIdentityKey = "my-identity-key"): RoomSession {
  const session = new RoomSession("room-1", "Alice");
  const s = session as unknown as Record<string, unknown>;
  s.identityKey = myIdentityKey;
  s.ed25519Key = "my-ed25519";
  s.account = { id: "mock-account" };
  s.outboundSession = { id: "mgm-group" };
  s.outboundSessionId = "session-id";

  // Attach a live WS so handleKeyShare can send reciprocal key_share
  const ws = new MockWebSocket("ws://test");
  s.ws = ws;

  return session;
}

// ---------------------------------------------------------------------------
// Part B: replenishment fires when count drops below threshold
// ---------------------------------------------------------------------------

describe("checkAndReplenishOTKs — replenishment below threshold", () => {
  let session: RoomSession;

  beforeEach(() => {
    vi.clearAllMocks();
    // Restore the real counting logic for getOneTimeKeyCount
    mockGetOneTimeKeyCount.mockImplementation((acc: { one_time_keys(): Map<string, string> }) => {
      const keys = acc.one_time_keys();
      let count = 0;
      keys.forEach(() => { count++; });
      return count;
    });
    session = makeSession();
  });

  it("calls generateOneTimeKeys and markKeysAsPublished when count < 5", () => {
    // Account has 4 OTKs — below the threshold of 5
    const s = session as unknown as Record<string, unknown>;
    s.account = {
      one_time_keys: () =>
        new Map([
          ["k1", "v1"],
          ["k2", "v2"],
          ["k3", "v3"],
          ["k4", "v4"],
        ]),
    };

    const checkAndReplenish = (
      session as unknown as { checkAndReplenishOTKs(): void }
    ).checkAndReplenishOTKs.bind(session);

    checkAndReplenish();

    expect(mockGenerateOneTimeKeys).toHaveBeenCalledWith(s.account, 10);
    expect(mockMarkKeysAsPublished).toHaveBeenCalledWith(s.account);
  });

  it("replenishes with exactly OTK_REPLENISH_COUNT=10 keys", () => {
    const s = session as unknown as Record<string, unknown>;
    s.account = {
      one_time_keys: () => new Map([["k1", "v1"]]), // count=1, well below threshold
    };

    const checkAndReplenish = (
      session as unknown as { checkAndReplenishOTKs(): void }
    ).checkAndReplenishOTKs.bind(session);

    checkAndReplenish();

    const [, count] = mockGenerateOneTimeKeys.mock.calls[0] as [unknown, number];
    expect(count).toBe(10);
  });

  it("triggers replenishment when count is exactly 4 (one below threshold)", () => {
    const s = session as unknown as Record<string, unknown>;
    s.account = {
      one_time_keys: () =>
        new Map([
          ["k1", "v1"],
          ["k2", "v2"],
          ["k3", "v3"],
          ["k4", "v4"],
        ]),
    };

    const checkAndReplenish = (
      session as unknown as { checkAndReplenishOTKs(): void }
    ).checkAndReplenishOTKs.bind(session);

    checkAndReplenish();

    expect(mockGenerateOneTimeKeys).toHaveBeenCalledTimes(1);
    expect(mockMarkKeysAsPublished).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Part C: no replenishment when count >= threshold
// ---------------------------------------------------------------------------

describe("checkAndReplenishOTKs — no replenishment at or above threshold", () => {
  let session: RoomSession;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOneTimeKeyCount.mockImplementation((acc: { one_time_keys(): Map<string, string> }) => {
      const keys = acc.one_time_keys();
      let count = 0;
      keys.forEach(() => { count++; });
      return count;
    });
    session = makeSession();
  });

  it("does NOT call generateOneTimeKeys when count === threshold (5)", () => {
    const s = session as unknown as Record<string, unknown>;
    s.account = {
      one_time_keys: () =>
        new Map([
          ["k1", "v1"],
          ["k2", "v2"],
          ["k3", "v3"],
          ["k4", "v4"],
          ["k5", "v5"],
        ]),
    };

    const checkAndReplenish = (
      session as unknown as { checkAndReplenishOTKs(): void }
    ).checkAndReplenishOTKs.bind(session);

    checkAndReplenish();

    expect(mockGenerateOneTimeKeys).not.toHaveBeenCalled();
    expect(mockMarkKeysAsPublished).not.toHaveBeenCalled();
  });

  it("does NOT call generateOneTimeKeys when count is well above threshold (10)", () => {
    const s = session as unknown as Record<string, unknown>;
    s.account = {
      one_time_keys: () =>
        new Map(
          Array.from({ length: 10 }, (_, i) => [`k${i}`, `v${i}`]),
        ),
    };

    const checkAndReplenish = (
      session as unknown as { checkAndReplenishOTKs(): void }
    ).checkAndReplenishOTKs.bind(session);

    checkAndReplenish();

    expect(mockGenerateOneTimeKeys).not.toHaveBeenCalled();
    expect(mockMarkKeysAsPublished).not.toHaveBeenCalled();
  });

  it("does nothing when account is null", () => {
    const s = session as unknown as Record<string, unknown>;
    s.account = null;

    const checkAndReplenish = (
      session as unknown as { checkAndReplenishOTKs(): void }
    ).checkAndReplenishOTKs.bind(session);

    // Should not throw
    expect(() => checkAndReplenish()).not.toThrow();
    expect(mockGenerateOneTimeKeys).not.toHaveBeenCalled();
    expect(mockMarkKeysAsPublished).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Integration: replenishment triggered via handleKeyShare (inbound OTK use)
// ---------------------------------------------------------------------------

describe("checkAndReplenishOTKs — triggered after inbound session creation", () => {
  let session: RoomSession;

  beforeEach(() => {
    vi.clearAllMocks();
    session = makeSession();
  });

  it("calls checkAndReplenishOTKs after a successful createInboundSession", () => {
    // Spy on the private method via prototype interception
    const spy = vi.spyOn(
      session as unknown as { checkAndReplenishOTKs(): void },
      "checkAndReplenishOTKs",
    );

    // Set getOneTimeKeyCount to return 3 (below threshold)
    mockGetOneTimeKeyCount.mockReturnValue(3);

    // Invoke handleKeyShare directly (bypass WS transport — the injected MockWebSocket
    // has no onmessage handler set by the session since connect() was never called).
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

    // No existing Olm session for this peer → createInboundSession path → OTK consumed
    handleKeyShare({
      type: "key_share",
      targetIdentityKey: "my-identity-key",
      senderIdentityKey: "peer-identity-key",
      olmMessage: { type: 0, body: "prekey-body" },
    });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does NOT call checkAndReplenishOTKs on the olmDecrypt (existing session) path", () => {
    const spy = vi.spyOn(
      session as unknown as { checkAndReplenishOTKs(): void },
      "checkAndReplenishOTKs",
    );

    // Seed an existing Olm session — handleKeyShare will take the olmDecrypt branch
    const s = session as unknown as Record<string, unknown>;
    (s.olmSessions as Map<string, unknown>).set("peer-identity-key", {
      id: "existing-olm",
    });

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
      senderIdentityKey: "peer-identity-key",
      olmMessage: { type: 1, body: "normal-msg" },
    });

    expect(spy).not.toHaveBeenCalled();
  });
});
