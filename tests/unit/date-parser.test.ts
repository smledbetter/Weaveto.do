import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { parseNaturalDate, formatDueDate } from "$lib/tasks/date-parser";

describe("Date Parser", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Monday, Jan 15, 2024, 2:30 PM
    vi.setSystemTime(new Date("2024-01-15T14:30:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("parseNaturalDate", () => {
    describe("duration formats (M1 backward compat)", () => {
      it("parses 30m", () => {
        const result = parseNaturalDate("30m");
        expect(result).not.toBeNull();
        expect(result!.timestamp).toBe(Date.now() + 30 * 60_000);
      });

      it("parses 2h", () => {
        const result = parseNaturalDate("2h");
        expect(result!.timestamp).toBe(Date.now() + 2 * 3_600_000);
      });

      it("parses 1d", () => {
        const result = parseNaturalDate("1d");
        expect(result!.timestamp).toBe(Date.now() + 86_400_000);
      });
    });

    describe('"in X units" format', () => {
      it('parses "in 3 hours"', () => {
        const result = parseNaturalDate("in 3 hours");
        expect(result!.timestamp).toBe(Date.now() + 3 * 3_600_000);
      });

      it('parses "in 30 minutes"', () => {
        const result = parseNaturalDate("in 30 minutes");
        expect(result!.timestamp).toBe(Date.now() + 30 * 60_000);
      });

      it('parses "in 2 days"', () => {
        const result = parseNaturalDate("in 2 days");
        expect(result!.timestamp).toBe(Date.now() + 2 * 86_400_000);
      });

      it('parses "in 1 hour"', () => {
        const result = parseNaturalDate("in 1 hour");
        expect(result!.timestamp).toBe(Date.now() + 3_600_000);
      });

      it('parses "in 1 minute"', () => {
        const result = parseNaturalDate("in 1 minute");
        expect(result!.timestamp).toBe(Date.now() + 60_000);
      });
    });

    describe("relative day names", () => {
      it('parses "tomorrow"', () => {
        const result = parseNaturalDate("tomorrow");
        const expected = new Date("2024-01-16T14:30:00").getTime();
        expect(result!.timestamp).toBe(expected);
      });

      it('parses "today"', () => {
        const result = parseNaturalDate("today");
        const expected = new Date("2024-01-15T23:59:59.999").getTime();
        expect(result!.timestamp).toBe(expected);
      });
    });

    describe("next weekday", () => {
      it('parses "next monday" (always next week)', () => {
        // Current: Monday Jan 15 → next Monday: Jan 22
        const result = parseNaturalDate("next monday");
        const expected = new Date("2024-01-22T14:30:00").getTime();
        expect(result!.timestamp).toBe(expected);
      });

      it('parses "next friday"', () => {
        // Current: Monday Jan 15 → next Friday: Jan 19
        const result = parseNaturalDate("next friday");
        const expected = new Date("2024-01-19T14:30:00").getTime();
        expect(result!.timestamp).toBe(expected);
      });

      it('parses "next sunday"', () => {
        // Current: Monday Jan 15 → next Sunday: Jan 21
        const result = parseNaturalDate("next sunday");
        const expected = new Date("2024-01-21T14:30:00").getTime();
        expect(result!.timestamp).toBe(expected);
      });
    });

    describe("weekday without 'next'", () => {
      it('parses "friday" (this week, future)', () => {
        // Current: Monday Jan 15 → Friday: Jan 19
        const result = parseNaturalDate("friday");
        const expected = new Date("2024-01-19T14:30:00").getTime();
        expect(result!.timestamp).toBe(expected);
      });

      it('parses "monday" (today → end of day)', () => {
        const result = parseNaturalDate("monday");
        const expected = new Date("2024-01-15T23:59:59.999").getTime();
        expect(result!.timestamp).toBe(expected);
      });

      it('parses "sunday" (past this week → next occurrence)', () => {
        // Current: Monday Jan 15 → Sunday: Jan 21
        const result = parseNaturalDate("sunday");
        const expected = new Date("2024-01-21T14:30:00").getTime();
        expect(result!.timestamp).toBe(expected);
      });
    });

    describe("short day names", () => {
      it('parses "fri"', () => {
        const result = parseNaturalDate("fri");
        const expected = new Date("2024-01-19T14:30:00").getTime();
        expect(result!.timestamp).toBe(expected);
      });

      it('parses "next tue"', () => {
        const result = parseNaturalDate("next tue");
        const expected = new Date("2024-01-16T14:30:00").getTime();
        expect(result!.timestamp).toBe(expected);
      });
    });

    describe("case insensitivity", () => {
      it('parses "TOMORROW"', () => {
        expect(parseNaturalDate("TOMORROW")).not.toBeNull();
      });

      it('parses "Next Friday"', () => {
        expect(parseNaturalDate("Next Friday")).not.toBeNull();
      });

      it('parses "In 3 Hours"', () => {
        expect(parseNaturalDate("In 3 Hours")).not.toBeNull();
      });
    });

    describe("whitespace handling", () => {
      it("trims leading/trailing whitespace", () => {
        expect(parseNaturalDate("  tomorrow  ")).not.toBeNull();
      });
    });

    describe("invalid inputs", () => {
      it("returns null for empty string", () => {
        expect(parseNaturalDate("")).toBeNull();
      });

      it("returns null for unrecognized format", () => {
        expect(parseNaturalDate("next year")).toBeNull();
      });

      it("returns null for random text", () => {
        expect(parseNaturalDate("flibbertigibbet")).toBeNull();
      });

      it("returns null for whitespace only", () => {
        expect(parseNaturalDate("   ")).toBeNull();
      });
    });
  });

  describe("formatDueDate", () => {
    it("formats overdue dates", () => {
      expect(formatDueDate(Date.now() - 3_600_000)).toBe("overdue");
    });

    it("formats minutes", () => {
      expect(formatDueDate(Date.now() + 60_000)).toBe("in 1 minute");
      expect(formatDueDate(Date.now() + 30 * 60_000)).toBe("in 30 minutes");
    });

    it("formats hours", () => {
      expect(formatDueDate(Date.now() + 3_600_000)).toBe("in 1 hour");
      expect(formatDueDate(Date.now() + 5 * 3_600_000)).toBe("in 5 hours");
    });

    it('formats tomorrow with "tomorrow"', () => {
      const result = formatDueDate(Date.now() + 86_400_000);
      expect(result).toContain("tomorrow");
    });

    it("formats days", () => {
      expect(formatDueDate(Date.now() + 3 * 86_400_000)).toBe("in 3 days");
    });

    it("formats distant dates as absolute", () => {
      const in10Days = Date.now() + 10 * 86_400_000;
      const result = formatDueDate(in10Days);
      expect(result).toContain("Jan");
    });
  });
});
