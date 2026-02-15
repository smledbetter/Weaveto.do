import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { isBuiltIn, BUILTIN_PREFIX } from "../../src/lib/agents/builtin";

describe("isBuiltIn", () => {
  it("returns true for built-in module IDs", () => {
    expect(isBuiltIn("room123:builtin:auto-balance")).toBe(true);
    expect(isBuiltIn("any-room:builtin:some-agent")).toBe(true);
  });

  it("returns false for user-uploaded module IDs", () => {
    expect(isBuiltIn("room123:my-custom-agent")).toBe(false);
    expect(isBuiltIn("room123:user-agent-v2")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isBuiltIn("")).toBe(false);
  });
});

describe("BUILTIN_PREFIX", () => {
  it("is 'builtin:'", () => {
    expect(BUILTIN_PREFIX).toBe("builtin:");
  });
});
