/**
 * Every way a Megolm key can fail to reach a peer must be observable.
 *
 * The failures are invisible one at a time, which is why five of them sat
 * silent. If our key never reaches a member, nothing we send is readable by
 * them for the life of the session. They cannot report it, because from their
 * side no message ever arrived to be missed. We do not notice, because the
 * send succeeded from our point of view. And no sequence gap appears, because
 * a message that was never decryptable was never counted.
 *
 * The M8 audit deferred this whole category as "catch blocks that swallow
 * errors without logging (intentional per security policy)". The policy is
 * right and this does not add logging. The category deferral was wrong: it
 * already contained gap 7, a High, and the dead-handler defect from #98.
 *
 * Each test drives one failure path and asserts the room's delivery health
 * goes amber. See #103.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

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
  olmDecrypt: vi.fn().mockReturnValue(
    JSON.stringify({ sessionId: "s", sessionKey: "k", senderIdentityKey: "p" }),
  ),
  createGroupSession: vi.fn().mockReturnValue({ id: "mgm-group" }),
  getGroupSessionKey: vi.fn().mockReturnValue("session-key"),
  getGroupSessionId: vi.fn().mockReturnValue("session-id"),
  createInboundGroupSession: vi.fn().mockReturnValue({ id: "mgm-inbound" }),
  megolmEncrypt: vi.fn().mockReturnValue("ciphertext"),
  megolmDecrypt: vi
    .fn()
    .mockReturnValue({ plaintext: '{"text":"hi","sender":"x","senderName":"X"}' }),
  getOneTimeKeyCount: vi.fn().mockReturnValue(10),
}));

vi.mock("$lib/crypto/padding", () => ({
  padMessage: vi.fn((s: string) => s),
  unpadMessage: vi.fn((s: string) => s),
}));

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(_url: string) {}
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
}

// @ts-expect-error — replacing a browser global for the test environment
globalThis.WebSocket = MockWebSocket;
globalThis.sessionStorage = {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn().mockReturnValue(null),
};

import { RoomSession } from "$lib/room/session";
import {
  olmEncrypt as mockOlmEncrypt,
  createOutboundSession as mockCreateOutbound,
} from "$lib/crypto/engine";

type Priv = Record<string, unknown>;

function makeSession(): RoomSession {
  const session = new RoomSession("room-1", "Alice");
  const s = session as unknown as Priv;
  s.identityKey = "my-identity-key";
  s.ed25519Key = "my-ed25519";
  s.account = { id: "mock-account" };
  s.outboundSession = { id: "mgm-group" };
  s.outboundSessionId = "session-id";
  s.ws = new MockWebSocket("ws://test");
  return session;
}

/** Whether the room is currently reporting degraded delivery. */
const degraded = (s: RoomSession) => s.getDeliveryTracker().hasGap();

/** Give the session an Olm session with one peer, as a live room would have. */
function withPeer(session: RoomSession, key = "peer-1") {
  (
    (session as unknown as Priv).olmSessions as Map<string, unknown>
  ).set(key, { id: "olm-existing" });
  ((session as unknown as Priv).members as Map<string, unknown>).set(key, {
    displayName: "Peer",
    identityKey: key,
  });
}

describe("a Megolm key that never reaches a peer is observable", () => {
  let session: RoomSession;

  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks resets call history, not implementations. Without this a
    // mockImplementation that throws survives into the next test, and the
    // "leaves the room healthy" case below fails for the wrong reason. It did.
    (mockOlmEncrypt as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      type: 1,
      body: "encrypted",
    }));
    (mockCreateOutbound as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      id: "olm-outbound",
    }));
    session = makeSession();
  });

  it("starts healthy, so every assertion below means something", () => {
    // Without this the suite would pass against a tracker stuck on true.
    expect(degraded(session)).toBe(false);
  });

  it("key rotation: encryption throws for an existing member", async () => {
    // The member keeps the old key and cannot read anything sent under the
    // new one, which is the worst of the five because the room looks re-keyed.
    withPeer(session);
    (mockOlmEncrypt as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("olm session exhausted");
    });

    await session.rotateGroupSession();

    expect(degraded(session)).toBe(true);
  });

  it("a joiner who published no usable one-time key", () => {
    // selectOneTimeKey returns null, so no Olm session can ever be built and
    // the joiner will never read us. This path was a bare `return`.
    const handleNewMember = (
      session as unknown as {
        handleNewMember(msg: {
          type: string;
          identityKey: string;
          ed25519Key: string;
          oneTimeKeys: Record<string, string>;
          displayName?: string;
        }): void;
      }
    ).handleNewMember.bind(session);

    handleNewMember({
      type: "new_member",
      identityKey: "joiner",
      ed25519Key: "joiner-ed",
      oneTimeKeys: {}, // published nothing
    });

    expect(degraded(session)).toBe(true);
  });

  it("building the Olm session for a joiner throws", () => {
    (mockCreateOutbound as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error("bad one-time key");
    });

    const handleNewMember = (
      session as unknown as {
        handleNewMember(msg: {
          type: string;
          identityKey: string;
          ed25519Key: string;
          oneTimeKeys: Record<string, string>;
        }): void;
      }
    ).handleNewMember.bind(session);

    handleNewMember({
      type: "new_member",
      identityKey: "joiner",
      ed25519Key: "joiner-ed",
      oneTimeKeys: { k1: "otk" },
    });

    expect(degraded(session)).toBe(true);
  });

  it("a successful key share leaves the room healthy", () => {
    // The inverse. A tracker that latches on anything is no more useful than
    // one that never latches, and both would pass the tests above.
    const handleNewMember = (
      session as unknown as {
        handleNewMember(msg: {
          type: string;
          identityKey: string;
          ed25519Key: string;
          oneTimeKeys: Record<string, string>;
        }): void;
      }
    ).handleNewMember.bind(session);

    handleNewMember({
      type: "new_member",
      identityKey: "joiner",
      ed25519Key: "joiner-ed",
      oneTimeKeys: { k1: "otk" },
    });

    expect(degraded(session)).toBe(false);
  });
});
