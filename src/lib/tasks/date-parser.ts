/**
 * Natural language date parser. Zero external dependencies.
 * Supports: "tomorrow", "next friday", "in 3 hours", "30m", "2h", "1d"
 */

const DAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];
const SHORT_DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function dayIndex(name: string): number {
  const lower = name.toLowerCase();
  const idx = DAY_NAMES.indexOf(lower);
  if (idx !== -1) return idx;
  return SHORT_DAY_NAMES.indexOf(lower);
}

/**
 * Parse natural language or duration string to absolute timestamp.
 * Returns null if the input cannot be parsed.
 */
export function parseNaturalDate(input: string): { timestamp: number } | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  const now = new Date();

  // 1. Duration format: 30m, 2h, 1d (M1 backward compat)
  const durationMatch = trimmed.match(/^(\d+)(m|h|d)$/);
  if (durationMatch) {
    const value = parseInt(durationMatch[1], 10);
    const unit = durationMatch[2];
    const multipliers: Record<string, number> = {
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return { timestamp: Date.now() + value * multipliers[unit] };
  }

  // 2. "in X minutes/hours/days"
  const inMatch = trimmed.match(
    /^in\s+(\d+)\s+(minutes?|mins?|hours?|h|days?|d)$/,
  );
  if (inMatch) {
    const value = parseInt(inMatch[1], 10);
    const unit = inMatch[2];
    let ms = 0;
    if (/^min/.test(unit) || unit === "minute") {
      ms = value * 60_000;
    } else if (/^h/.test(unit) || unit === "hour" || unit === "hours") {
      ms = value * 3_600_000;
    } else if (/^d/.test(unit) || unit === "day" || unit === "days") {
      ms = value * 86_400_000;
    }
    return { timestamp: Date.now() + ms };
  }

  // 3. "tomorrow" — same time +24h
  if (trimmed === "tomorrow") {
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return { timestamp: tomorrow.getTime() };
  }

  // 4. "today" — end of day
  if (trimmed === "today") {
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    return { timestamp: endOfDay.getTime() };
  }

  // 5. "next week" — next Monday
  if (trimmed === "next week") {
    const result = new Date(now);
    const currentDay = result.getDay();
    // Days until next Monday (1)
    let daysToAdd = 1 - currentDay;
    if (daysToAdd <= 0) daysToAdd += 7;
    result.setDate(result.getDate() + daysToAdd);
    return { timestamp: result.getTime() };
  }

  // 6. "next monday/tue/..." — always next week
  const nextDayMatch = trimmed.match(
    /^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)$/,
  );
  if (nextDayMatch) {
    const targetDay = dayIndex(nextDayMatch[1]);
    if (targetDay !== -1) {
      const result = new Date(now);
      const currentDay = result.getDay();
      let daysToAdd = targetDay - currentDay;
      if (daysToAdd <= 0) daysToAdd += 7;
      result.setDate(result.getDate() + daysToAdd);
      return { timestamp: result.getTime() };
    }
  }

  // 6. Bare day name: "friday", "mon" — this week if future, next occurrence if past
  const bareDayMatch = trimmed.match(
    /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)$/,
  );
  if (bareDayMatch) {
    const targetDay = dayIndex(bareDayMatch[1]);
    if (targetDay !== -1) {
      const currentDay = now.getDay();
      if (targetDay === currentDay) {
        // Same day → end of today
        const endOfDay = new Date(now);
        endOfDay.setHours(23, 59, 59, 999);
        return { timestamp: endOfDay.getTime() };
      }
      const result = new Date(now);
      let daysToAdd = targetDay - currentDay;
      if (daysToAdd < 0) daysToAdd += 7;
      result.setDate(result.getDate() + daysToAdd);
      return { timestamp: result.getTime() };
    }
  }

  return null;
}

/**
 * Format a timestamp as a human-readable relative string.
 */
export function formatDueDate(timestamp: number): string {
  const now = Date.now();
  const diff = timestamp - now;

  if (diff < 0) return "overdue";

  if (diff < 3_600_000) {
    const minutes = Math.floor(diff / 60_000);
    return minutes <= 1 ? "in 1 minute" : `in ${minutes} minutes`;
  }

  if (diff < 86_400_000) {
    const hours = Math.floor(diff / 3_600_000);
    return hours === 1 ? "in 1 hour" : `in ${hours} hours`;
  }

  if (diff < 604_800_000) {
    const days = Math.floor(diff / 86_400_000);
    if (days === 1) {
      return `tomorrow at ${new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }
    return `in ${days} days`;
  }

  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
