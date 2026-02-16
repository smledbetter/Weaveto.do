import { describe, it, expect } from "vitest";
import { getRoomName } from "$lib/room/names";

describe("getRoomName", () => {
  describe("Determinism", () => {
    it("returns the same name for the same roomId", () => {
      const roomId = "abcd1234";
      const name1 = getRoomName(roomId);
      const name2 = getRoomName(roomId);
      expect(name1).toBe(name2);
    });

    it("is deterministic across multiple calls", () => {
      const roomId = "12345678";
      const names = [
        getRoomName(roomId),
        getRoomName(roomId),
        getRoomName(roomId),
      ];
      expect(new Set(names).size).toBe(1);
    });
  });

  describe("Format", () => {
    it("returns lowercase hyphenated format", () => {
      const name = getRoomName("0102");
      expect(name).toMatch(/^[a-z]+-[a-z]+$/);
    });

    it("contains exactly one hyphen", () => {
      const name = getRoomName("ffff");
      const parts = name.split("-");
      expect(parts).toHaveLength(2);
    });

    it('produces "word-word" format', () => {
      const name = getRoomName("3344");
      const [adj, noun] = name.split("-");
      expect(adj).toBeTruthy();
      expect(noun).toBeTruthy();
      expect(adj).toMatch(/^[a-z]+$/);
      expect(noun).toMatch(/^[a-z]+$/);
    });
  });

  describe("Different inputs produce different outputs", () => {
    it("generates mostly unique names for 20 different hex values", () => {
      const roomIds = [
        "0000",
        "0101",
        "0202",
        "0303",
        "0404",
        "0505",
        "0606",
        "0707",
        "0808",
        "0909",
        "0a0a",
        "0b0b",
        "0c0c",
        "0d0d",
        "0e0e",
        "0f0f",
        "1010",
        "1111",
        "1212",
        "1313",
      ];

      const names = roomIds.map(getRoomName);
      const uniqueNames = new Set(names);

      // With 2 bytes, some collisions are mathematically possible (birthday paradox)
      // but 20 random values should mostly be unique
      expect(uniqueNames.size).toBeGreaterThan(18);
    });

    it("different hex values produce different names", () => {
      const name1 = getRoomName("0000");
      const name2 = getRoomName("0001");
      const name3 = getRoomName("0100");
      const name4 = getRoomName("0101");

      expect(new Set([name1, name2, name3, name4]).size).toBe(4);
    });
  });

  describe("Edge cases - Length validation", () => {
    it("accepts 4-character hex string (minimum)", () => {
      expect(() => getRoomName("0000")).not.toThrow();
    });

    it("accepts longer hex strings", () => {
      expect(() => getRoomName("00001234567890abcdef")).not.toThrow();
    });

    it("throws for 3-character hex string", () => {
      expect(() => getRoomName("000")).toThrow(
        "roomId must be at least 4 hex characters",
      );
    });

    it("throws for empty string", () => {
      expect(() => getRoomName("")).toThrow(
        "roomId must be at least 4 hex characters",
      );
    });

    it("throws for single character", () => {
      expect(() => getRoomName("a")).toThrow(
        "roomId must be at least 4 hex characters",
      );
    });
  });

  describe("Edge cases - Non-hex character validation", () => {
    it("throws for non-hex characters in first 4 chars", () => {
      expect(() => getRoomName("gggg")).toThrow("Invalid hex bytes in roomId");
    });

    it("throws for spaces in hex bytes", () => {
      // parseInt is lenient with leading/trailing whitespace, so test invalid chars
      expect(() => getRoomName("00 @")).toThrow("Invalid hex bytes in roomId");
    });

    it("throws for mixed case non-hex", () => {
      expect(() => getRoomName("zzz0")).toThrow("Invalid hex bytes in roomId");
    });

    it("accepts lowercase hex", () => {
      expect(() => getRoomName("abcd")).not.toThrow();
    });

    it("accepts uppercase hex", () => {
      expect(() => getRoomName("ABCD")).not.toThrow();
    });

    it("accepts mixed case hex", () => {
      expect(() => getRoomName("AbCd")).not.toThrow();
    });
  });

  describe("Boundary indices", () => {
    it("handles 0000 (index 0,0)", () => {
      const name = getRoomName("0000");
      expect(name).toBeTruthy();
      expect(name).toMatch(/^[a-z]+-[a-z]+$/);
    });

    it("handles ffff (index 255,255)", () => {
      const name = getRoomName("ffff");
      expect(name).toBeTruthy();
      expect(name).toMatch(/^[a-z]+-[a-z]+$/);
    });

    it("handles FFFF (uppercase boundary)", () => {
      const name = getRoomName("FFFF");
      expect(name).toBeTruthy();
    });

    it("returns different names for 0000 and ffff", () => {
      const name0000 = getRoomName("0000");
      const nameffff = getRoomName("ffff");
      expect(name0000).not.toBe(nameffff);
    });
  });

  describe("Known values", () => {
    it("0000 produces swift-falcon (first adjective, first noun)", () => {
      expect(getRoomName("0000")).toBe("swift-falcon");
    });

    it("0001 produces swift-oak (first adjective, second noun)", () => {
      expect(getRoomName("0001")).toBe("swift-oak");
    });

    it("0100 produces bright-falcon (second adjective, first noun)", () => {
      expect(getRoomName("0100")).toBe("bright-falcon");
    });

    it("0101 produces bright-oak (second adjective, second noun)", () => {
      expect(getRoomName("0101")).toBe("bright-oak");
    });

    it("uses first two bytes of roomId", () => {
      // 02 (second adjective 'bright'), 03 (fourth noun 'wolf')
      expect(getRoomName("0203")).toBe("calm-wolf");
    });

    it("ignores bytes after first 4 hex characters", () => {
      const name1 = getRoomName("0000");
      const name2 = getRoomName("000099999999");
      expect(name1).toBe(name2);
    });
  });

  describe("Consistency with word lists", () => {
    it("produces valid adjective from first byte", () => {
      const name = getRoomName("0a00");
      const [adj] = name.split("-");
      // 0a = 10 in decimal, adjective at index 10 is 'harsh'
      expect(adj).toBe("harsh");
    });

    it("produces valid noun from second byte", () => {
      const name = getRoomName("000a");
      const [, noun] = name.split("-");
      // 0a = 10 in decimal, noun at index 10 is 'brook'
      expect(noun).toBe("brook");
    });

    it("handles hex values with letters", () => {
      const name = getRoomName("ab12");
      const parts = name.split("-");
      expect(parts).toHaveLength(2);
      expect(parts[0]).toMatch(/^[a-z]+$/);
      expect(parts[1]).toMatch(/^[a-z]+$/);
    });
  });

  describe("Error messages", () => {
    it("provides clear error for short roomId", () => {
      try {
        getRoomName("ab");
      } catch (e) {
        expect(String(e)).toContain("at least 4 hex characters");
      }
    });

    it("provides clear error for invalid hex", () => {
      try {
        getRoomName("gggg");
      } catch (e) {
        expect(String(e)).toContain("Invalid hex bytes");
      }
    });
  });
});
