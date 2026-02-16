import { describe, it, expect } from "vitest";
import {
  qrSvg,
  selectVersion,
  encodeData,
  rsEncode,
  interleave,
} from "$lib/qr/encoder";

describe("QR encoder", () => {
  describe("selectVersion", () => {
    it("selects version 1 for short data", () => {
      const v = selectVersion(5);
      expect(v.version).toBe(1);
      expect(v.size).toBe(21);
    });

    it("selects version 2 for ~20-30 byte data", () => {
      const v = selectVersion(25);
      expect(v.version).toBe(2);
      expect(v.size).toBe(25);
    });

    it("selects version 3 for ~50 byte data", () => {
      const v = selectVersion(50);
      expect(v.version).toBe(3);
      expect(v.size).toBe(29);
    });

    it("selects version 4 for ~60 byte data", () => {
      const v = selectVersion(60);
      expect(v.version).toBe(4);
      expect(v.size).toBe(33);
    });

    it("selects version 6 for data near the limit", () => {
      const v = selectVersion(130);
      expect(v.version).toBe(6);
      expect(v.size).toBe(41);
    });

    it("throws for data exceeding version 6 capacity", () => {
      expect(() => selectVersion(200)).toThrow("Data too long");
    });
  });

  describe("encodeData", () => {
    it("produces correct number of data codewords", () => {
      const ver = selectVersion(10);
      const codewords = encodeData("HELLOWORLD", ver);
      expect(codewords.length).toBe(ver.dataBytes);
    });

    it("starts with byte mode indicator (0100 = 0x4x)", () => {
      const ver = selectVersion(5);
      const codewords = encodeData("Hello", ver);
      // First nibble should be 0100 (byte mode = 4)
      expect((codewords[0] >> 4) & 0xf).toBe(4);
    });

    it("pads with 0xEC 0x11 alternating pattern", () => {
      const ver = selectVersion(3);
      const codewords = encodeData("Hi", ver);
      // After data + terminator, remaining should alternate 0xEC, 0x11
      const lastTwo = codewords.slice(-2);
      expect(lastTwo[0] === 0xec || lastTwo[0] === 0x11).toBe(true);
    });
  });

  describe("rsEncode", () => {
    it("returns correct number of EC codewords", () => {
      const data = [
        0x40, 0x44, 0x86, 0x56, 0xc6, 0xc6, 0xf2, 0x07, 0x26, 0xc6, 0x42, 0x00,
        0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec,
      ];
      const ec = rsEncode(data, 7);
      expect(ec.length).toBe(7);
    });

    it("produces non-zero EC codewords for non-zero data", () => {
      const data = [1, 2, 3, 4, 5];
      const ec = rsEncode(data, 10);
      expect(ec.some((b) => b !== 0)).toBe(true);
    });

    it("produces all-zero EC for all-zero data", () => {
      const data = [0, 0, 0, 0, 0];
      const ec = rsEncode(data, 7);
      expect(ec.every((b) => b === 0)).toBe(true);
    });
  });

  describe("interleave", () => {
    it("returns data + EC codewords for single block", () => {
      const ver = selectVersion(10);
      const data = encodeData("ABCDEFGHIJ", ver);
      const result = interleave(data, ver);
      expect(result.length).toBe(ver.dataBytes + ver.ecPerBlock * ver.blocks);
    });

    it("interleaves multiple blocks for version 6", () => {
      const ver = selectVersion(130);
      expect(ver.blocks).toBe(2);
      const data = encodeData("A".repeat(130), ver);
      const result = interleave(data, ver);
      expect(result.length).toBe(ver.dataBytes + ver.ecPerBlock * ver.blocks);
    });
  });

  describe("qrSvg", () => {
    it("returns valid SVG string", () => {
      const svg = qrSvg("https://weaveto.do/room/abc123");
      expect(svg).toContain("<svg");
      expect(svg).toContain("</svg>");
      expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    });

    it("contains a background rect and foreground path", () => {
      const svg = qrSvg("test");
      expect(svg).toContain("<rect");
      expect(svg).toContain("<path");
    });

    it("respects custom size option", () => {
      const svg = qrSvg("test", { size: 300 });
      expect(svg).toContain('width="300"');
      expect(svg).toContain('height="300"');
    });

    it("respects custom colors", () => {
      const svg = qrSvg("test", { fg: "#fff", bg: "#000" });
      expect(svg).toContain('fill="#000"'); // background
      expect(svg).toContain('fill="#fff"'); // foreground path
    });

    it("produces different SVGs for different data", () => {
      const svg1 = qrSvg("https://weaveto.do/room/abc123");
      const svg2 = qrSvg("https://weaveto.do/room/xyz789");
      expect(svg1).not.toBe(svg2);
    });

    it("produces correct viewBox dimensions", () => {
      const svg = qrSvg("test", { size: 200 });
      expect(svg).toContain('viewBox="0 0 200 200"');
    });

    it("handles a realistic room URL", () => {
      const url =
        "https://weaveto.do/room/a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      const svg = qrSvg(url);
      expect(svg).toContain("<svg");
      expect(svg).toContain("<path");
      // Path should have content (not empty)
      const pathMatch = svg.match(/d="([^"]+)"/);
      expect(pathMatch).not.toBeNull();
      expect(pathMatch![1].length).toBeGreaterThan(0);
    });

    it("handles short input", () => {
      const svg = qrSvg("A");
      expect(svg).toContain("<svg");
    });

    it("throws for data exceeding capacity", () => {
      expect(() => qrSvg("x".repeat(200))).toThrow("Data too long");
    });
  });
});
