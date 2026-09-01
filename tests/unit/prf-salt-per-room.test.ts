// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prfSaltFor } from "../../src/lib/webauthn/prf";

/**
 * A device must not have the same identity in every room.
 *
 * The Olm identity key the relay routes by is derived from the WebAuthn PRF
 * output, and the PRF salt was the constant "weaveto.do-identity-v1". So one
 * device produced one identity key, in every room, forever, and the relay
 * could link a person across every room they joined. That is the strongest
 * form of the thing "the server cannot identify users" denies.
 *
 * Both non-PRF paths were already per-room: generateRandomSeed hashes the room
 * id with a nonce, and stored seeds are keyed by room. The main path was the
 * exception.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = readFileSync(resolve(ROOT, "src/lib/webauthn/prf.ts"), "utf8");

const decode = (b: Uint8Array) => new TextDecoder().decode(b);
const ROOM_A = "0123456789abcdef0123456789abcdef";
const ROOM_B = "fedcba9876543210fedcba9876543210";

describe("the PRF salt is per room", () => {
  it("differs between rooms", () => {
    expect(prfSaltFor(ROOM_A)).not.toEqual(prfSaltFor(ROOM_B));
  });

  it("is stable for one room, so rejoining keeps the same identity", () => {
    // The point of deriving from an authenticator rather than storing a seed.
    expect(prfSaltFor(ROOM_A)).toEqual(prfSaltFor(ROOM_A));
  });

  it("actually contains the room", () => {
    expect(decode(prfSaltFor(ROOM_A))).toContain(ROOM_A);
  });

  it("is namespaced, so the room id alone is not the whole input", () => {
    const text = decode(prfSaltFor(ROOM_A));
    expect(text).not.toBe(ROOM_A);
    expect(text).toMatch(/weaveto\.do/);
  });

  it("no longer uses the constant that made one identity per device", () => {
    expect(source).not.toContain('"weaveto.do-identity-v1"');
  });

  it("is what the assertion actually passes to the authenticator", () => {
    // A per-room salt that nothing uses would leave the identity global while
    // this file looked correct.
    expect(source).toMatch(/const salt = prfSaltFor\(roomId\)/);
    expect(source).toMatch(/first: salt/);
  });

  it("is reached from both entry points", () => {
    // createCredential delegates to assertWithPrf for the seed, so a roomId
    // that stopped at createCredential would silently do nothing.
    expect(source).toMatch(/createCredential\(roomId: string\)/);
    expect(source).toMatch(/return assertWithPrf\(roomId, credentialId\)/);
  });
});
