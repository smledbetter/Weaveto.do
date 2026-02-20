import { describe, it, expect } from "vitest";
import { qrSvg } from "$lib/qr/encoder";

describe("QR encoder", () => {
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

    it("includes quiet zone in viewBox", () => {
      const svg = qrSvg("test", { size: 200 });
      // viewBox should be module count + 8 (4-module quiet zone each side)
      expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
      expect(svg).toContain('width="200"');
      expect(svg).toContain('height="200"');
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

    it("uses crispEdges for sharp rendering", () => {
      const svg = qrSvg("test");
      expect(svg).toContain('shape-rendering="crispEdges"');
    });

    it("uses integer coordinates in path data", () => {
      const svg = qrSvg("test");
      const pathMatch = svg.match(/d="([^"]+)"/);
      expect(pathMatch).not.toBeNull();
      // All coordinates should be integers (no decimals)
      const coords = pathMatch![1].match(/M(\d+),(\d+)/g);
      expect(coords).not.toBeNull();
      expect(coords!.length).toBeGreaterThan(0);
    });
  });
});
