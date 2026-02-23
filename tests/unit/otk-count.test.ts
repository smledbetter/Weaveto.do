/**
 * Unit tests for getOneTimeKeyCount — verifies the property-access API contract
 * with vodozemac's one_time_keys getter.
 *
 * These tests call the REAL getOneTimeKeys/getOneTimeKeyCount from engine.ts.
 * Neither function calls ensureInit() or touches the vodozemac WASM module —
 * they only access the `account.one_time_keys` property and parse the result.
 * So we can test them with fake account objects that replicate vodozemac's
 * getter-property API without initializing WASM.
 *
 * vodozemac's Account.one_time_keys is a getter property (not a method).
 * The original bug called it as `account.one_time_keys()` which threw TypeError.
 */

import { describe, it, expect } from "vitest";
import { getOneTimeKeys, getOneTimeKeyCount } from "$lib/crypto/engine";

// Verify we're testing real functions, not mocks
// (getOneTimeKeyCount should delegate to getOneTimeKeys internally)

describe("getOneTimeKeyCount (real implementation, no WASM needed)", () => {
  it("returns 0 for an account with empty curve25519 Map", () => {
    const account = {
      one_time_keys: new Map([["curve25519", new Map<string, string>()]]),
    };
    expect(getOneTimeKeyCount(account as never)).toBe(0);
  });

  it("returns correct count for a Map with 3 entries", () => {
    const curve = new Map([
      ["AAAAAQ", "base64key1"],
      ["AAAAAg", "base64key2"],
      ["AAAAAw", "base64key3"],
    ]);
    const account = {
      one_time_keys: new Map([["curve25519", curve]]),
    };
    expect(getOneTimeKeyCount(account as never)).toBe(3);
  });

  it("returns correct count for plain object format", () => {
    const account = {
      one_time_keys: {
        curve25519: {
          "AAAAAQ": "key1",
          "AAAAAg": "key2",
        },
      },
    };
    expect(getOneTimeKeyCount(account as never)).toBe(2);
  });

  it("returns 0 when one_time_keys is an empty plain object", () => {
    const account = { one_time_keys: {} };
    expect(getOneTimeKeyCount(account as never)).toBe(0);
  });

  it("works with non-callable one_time_keys property (vodozemac API contract)", () => {
    // vodozemac wasm-bindgen exposes one_time_keys as a getter-only property
    // descriptor. The value it returns (a Map) is NOT callable. The original
    // bug did `account.one_time_keys()` — this works on JS getters (getter
    // fires, returns Map, then `()` tries to call the Map → TypeError), but
    // only fails at the `()` step. To truly simulate vodozemac's API where
    // one_time_keys is a data property (not a function), we use
    // Object.defineProperty with only a `get` and no `value`/`set`.
    //
    // This test WILL FAIL if getOneTimeKeyCount is changed back to call
    // `account.one_time_keys()` because the getter returns a Map (not callable).
    const fakeAccount = Object.create(null);
    Object.defineProperty(fakeAccount, "one_time_keys", {
      get() {
        return new Map([["curve25519", new Map([["k1", "v1"], ["k2", "v2"]])]]);
      },
      enumerable: true,
      configurable: false,
    });

    // This succeeds because getOneTimeKeyCount uses property access
    expect(getOneTimeKeyCount(fakeAccount as never)).toBe(2);

    // Verify the contract: calling as function DOES throw (this is the bug we fixed)
    expect(() => (fakeAccount.one_time_keys as unknown as () => void)()).toThrow(TypeError);
  });
});

describe("getOneTimeKeys (real implementation, no WASM needed)", () => {
  it("parses nested Map (vodozemac serde_wasm_bindgen format)", () => {
    const inner = new Map([
      ["AAAAAQ", "curve25519-key-base64"],
      ["AAAAAg", "another-key-base64"],
    ]);
    const account = {
      one_time_keys: new Map([["curve25519", inner]]),
    };
    const keys = getOneTimeKeys(account as never);
    expect(keys).toEqual({
      "AAAAAQ": "curve25519-key-base64",
      "AAAAAg": "another-key-base64",
    });
  });

  it("parses plain object format", () => {
    const account = {
      one_time_keys: {
        curve25519: { "k1": "v1", "k2": "v2" },
      },
    };
    expect(getOneTimeKeys(account as never)).toEqual({ k1: "v1", k2: "v2" });
  });

  it("parses JSON string format", () => {
    const account = {
      one_time_keys: JSON.stringify({
        curve25519: { "k1": "v1" },
      }),
    };
    expect(getOneTimeKeys(account as never)).toEqual({ k1: "v1" });
  });

  it("returns empty record for null/undefined one_time_keys", () => {
    expect(getOneTimeKeys({ one_time_keys: null } as never)).toEqual({});
    expect(getOneTimeKeys({ one_time_keys: undefined } as never)).toEqual({});
  });
});
