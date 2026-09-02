// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The identity decision, tested without a browser.
 *
 * This logic used to sit inside `joinRoom()` in the room page. The only way to
 * reach it was Playwright, against a production build, with WebAuthn patched
 * to throw, which is why `tests/e2e/identity-integration.spec.ts` runs on its
 * own config and takes minutes. The cases below took milliseconds and cover
 * combinations that suite never reached.
 *
 * What is under test is a policy, not an algorithm: a security key if there is
 * one, else a seed saved behind a PIN, else this session only. The dangerous
 * mistakes are all silent. Returning a stored seed for a wrong PIN would be a
 * security hole; marking a PRF identity temporary would tell people their
 * identity is disposable when it is not; throwing anywhere would turn a
 * recoverable situation into a room that will not open.
 */

vi.mock("$lib/webauthn/prf", () => ({
  assertWithPrf: vi.fn(),
  createCredential: vi.fn(),
  getStoredCredentialId: vi.fn(),
}));
vi.mock("$lib/identity/store", () => ({
  loadIdentitySeed: vi.fn(),
}));

import { resolveIdentity, generateSessionSeed } from "$lib/identity/resolve";
import {
  assertWithPrf,
  createCredential,
  getStoredCredentialId,
} from "$lib/webauthn/prf";
import { loadIdentitySeed } from "$lib/identity/store";

const mockAssert = assertWithPrf as ReturnType<typeof vi.fn>;
const mockCreate = createCredential as ReturnType<typeof vi.fn>;
const mockStoredCred = getStoredCredentialId as ReturnType<typeof vi.fn>;
const mockLoadSeed = loadIdentitySeed as ReturnType<typeof vi.fn>;

const PRF_SEED = new Uint8Array(32).fill(1);
const SAVED_SEED = new Uint8Array(32).fill(2);
const CREDENTIAL = new Uint8Array([9, 9, 9]);

/** The common case: a device with no security key. */
function withoutSecurityKey() {
  mockStoredCred.mockReturnValue(null);
  mockCreate.mockRejectedValue(new Error("WebAuthn not supported"));
  mockAssert.mockRejectedValue(new Error("WebAuthn not supported"));
}

const base = {
  roomId: "room-1",
  bypassWebAuthn: false,
  hasStoredSeed: false,
  pin: null as string | null,
};

describe("resolveIdentity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks keeps implementations, so every case sets its own.
    mockStoredCred.mockReset();
    mockCreate.mockReset();
    mockAssert.mockReset();
    mockLoadSeed.mockReset();
  });

  describe("a device with a security key", () => {
    it("asserts with an existing credential and is not temporary", async () => {
      mockStoredCred.mockReturnValue(CREDENTIAL);
      mockAssert.mockResolvedValue({ seed: PRF_SEED });

      const r = await resolveIdentity(base);

      expect(r.seed).toEqual(PRF_SEED);
      expect(r.temporary).toBe(false);
      expect(r.source).toBe("prf");
      expect(mockAssert).toHaveBeenCalledWith("room-1", CREDENTIAL);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("creates a credential when there is none yet", async () => {
      mockStoredCred.mockReturnValue(null);
      mockCreate.mockResolvedValue({ seed: PRF_SEED });

      const r = await resolveIdentity(base);

      expect(r.source).toBe("prf");
      expect(mockCreate).toHaveBeenCalledWith("room-1");
      expect(mockAssert).not.toHaveBeenCalled();
    });

    it("never reads a saved seed when the key works", async () => {
      // Reaching for storage here would write a device-bound identity into a
      // path that deliberately keeps nothing.
      mockStoredCred.mockReturnValue(CREDENTIAL);
      mockAssert.mockResolvedValue({ seed: PRF_SEED });

      await resolveIdentity({ ...base, hasStoredSeed: true, pin: "123456" });

      expect(mockLoadSeed).not.toHaveBeenCalled();
    });
  });

  describe("a device without one", () => {
    beforeEach(withoutSecurityKey);

    it("uses a saved seed when the PIN unwraps it", async () => {
      mockLoadSeed.mockResolvedValue(SAVED_SEED);

      const r = await resolveIdentity({
        ...base,
        hasStoredSeed: true,
        pin: "123456",
      });

      expect(r.seed).toEqual(SAVED_SEED);
      expect(r.temporary).toBe(false);
      expect(r.source).toBe("stored");
    });

    it("falls through to a session identity on the wrong PIN", async () => {
      // loadIdentitySeed returns null rather than throwing for a bad PIN.
      // Returning the saved seed here would be the security hole this whole
      // scheme exists to close.
      mockLoadSeed.mockResolvedValue(null);

      const r = await resolveIdentity({
        ...base,
        hasStoredSeed: true,
        pin: "999999",
      });

      expect(r.seed).not.toEqual(SAVED_SEED);
      expect(r.temporary).toBe(true);
      expect(r.source).toBe("session");
    });

    it("does not touch storage when no PIN was given", async () => {
      const r = await resolveIdentity({ ...base, hasStoredSeed: true, pin: null });

      expect(mockLoadSeed).not.toHaveBeenCalled();
      expect(r.temporary).toBe(true);
    });

    it("does not touch storage when nothing was saved", async () => {
      const r = await resolveIdentity({ ...base, hasStoredSeed: false, pin: "123456" });

      expect(mockLoadSeed).not.toHaveBeenCalled();
      expect(r.temporary).toBe(true);
    });

    it("gives a temporary identity when nothing is available", async () => {
      const r = await resolveIdentity(base);

      expect(r.seed).toHaveLength(32);
      expect(r.temporary).toBe(true);
      expect(r.source).toBe("session");
    });
  });

  describe("bypass", () => {
    it("skips WebAuthn entirely and is not temporary", async () => {
      // Dev and the bypass flag mean a ceremony cannot complete. The identity
      // is per session, but the banner telling people so would be noise in a
      // context where it is the intended behaviour.
      const r = await resolveIdentity({ ...base, bypassWebAuthn: true });

      expect(r.source).toBe("bypass");
      expect(r.temporary).toBe(false);
      expect(mockStoredCred).not.toHaveBeenCalled();
      expect(mockCreate).not.toHaveBeenCalled();
      expect(mockAssert).not.toHaveBeenCalled();
    });
  });

  describe("it never throws", () => {
    it("survives every dependency failing at once", async () => {
      // A room that will not open is worse than a room opened as someone new.
      mockStoredCred.mockImplementation(() => {
        throw new Error("storage exploded");
      });
      mockLoadSeed.mockRejectedValue(new Error("idb exploded"));

      const r = await resolveIdentity({
        ...base,
        hasStoredSeed: true,
        pin: "123456",
      });

      expect(r.seed).toHaveLength(32);
      expect(r.temporary).toBe(true);
    });
  });
});

describe("generateSessionSeed", () => {
  it("returns 32 bytes", async () => {
    expect(await generateSessionSeed("room-1")).toHaveLength(32);
  });

  it("differs on every call, so a second visit is a different person", async () => {
    const a = await generateSessionSeed("room-1");
    const b = await generateSessionSeed("room-1");
    expect(a).not.toEqual(b);
  });

  it("differs between rooms", async () => {
    expect(await generateSessionSeed("room-a")).not.toEqual(
      await generateSessionSeed("room-b"),
    );
  });
});
