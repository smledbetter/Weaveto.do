// @vitest-environment node
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The security contact and the privacy policy have to stay reachable and
 * consistent.
 *
 * These are the two documents someone reads when they have found a problem or
 * when they are deciding whether to trust the app, and both are easy to break
 * without noticing: a route renamed, a footer reworded, an address changed in
 * one file and not the others, an `Expires` date quietly going stale.
 *
 * `security.txt` expiring is the one that will actually happen. RFC 9116 says
 * a consumer should ignore an expired file, so the effect is that the contact
 * silently stops existing on a date nobody has in their calendar.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const CONTACT = "weaveto.dosecurity.scribing608@passinbox.com";

const securityMd = read("SECURITY.md");
const securityTxt = read("static/.well-known/security.txt");
const privacy = read("src/routes/privacy/+page.svelte");
const home = read("src/routes/+page.svelte");
const room = read("src/routes/room/[id]/+page.svelte");

describe("security.txt", () => {
  it("is served from the well-known path", () => {
    // Anywhere else and scanners will not find it. SvelteKit serves `static/`
    // from the site root, so this path is the deployed path.
    expect(existsSync(resolve(ROOT, "static/.well-known/security.txt"))).toBe(true);
  });

  it("has the two fields RFC 9116 requires", () => {
    expect(securityTxt).toMatch(/^Contact:\s*mailto:/m);
    expect(securityTxt).toMatch(/^Expires:\s*/m);
  });

  it("has not expired, and is not more than a year out", () => {
    // A file past its Expires should be ignored by consumers, so letting it
    // lapse removes the contact without removing the file. The upper bound is
    // the spec's, and it is what forces this to be revisited.
    const line = securityTxt.match(/^Expires:\s*(\S+)/m);
    expect(line, "no Expires field").toBeTruthy();

    const expires = new Date(line![1]);
    expect(Number.isNaN(expires.getTime()), `unparseable date: ${line![1]}`).toBe(false);

    const now = new Date();
    const daysOut = (expires.getTime() - now.getTime()) / 86_400_000;

    expect(daysOut, "security.txt has expired — update the Expires field").toBeGreaterThan(0);
    expect(daysOut, "Expires is more than a year out, which RFC 9116 disallows").toBeLessThanOrEqual(366);
  });

  it("points at the policy that explains how to report", () => {
    expect(securityTxt).toMatch(/^Policy:\s*https:\/\//m);
    expect(securityTxt).toContain("SECURITY.md");
  });
});

describe("one contact address, spelled the same way everywhere", () => {
  // Changing it in one place and not the others is the ordinary way this
  // breaks, and the failure is silent: mail goes to an address nobody reads.
  it("appears in SECURITY.md", () => {
    expect(securityMd).toContain(CONTACT);
  });

  it("appears in security.txt", () => {
    expect(securityTxt).toContain(CONTACT);
  });

  it("appears in the privacy policy", () => {
    expect(privacy).toContain(CONTACT);
  });

  it("is the only address in any of them", () => {
    // A stray second address is worse than none: it is a coin flip over which
    // inbox a vulnerability report lands in.
    const addresses = new Set(
      [securityMd, securityTxt, privacy]
        .join("\n")
        .match(/[\w.+-]+@[\w.-]+\.\w+/g) ?? [],
    );
    expect([...addresses]).toEqual([CONTACT]);
  });
});

describe("the privacy policy is reachable", () => {
  it("exists as a route", () => {
    expect(existsSync(resolve(ROOT, "src/routes/privacy/+page.svelte"))).toBe(true);
  });

  it("is linked from the homepage", () => {
    expect(home).toMatch(/href="\/privacy"/);
  });

  it("is linked from inside a room", () => {
    expect(room).toMatch(/href="\/privacy"/);
  });

  it("opens the room's link in a new tab", () => {
    // Following it in place tears down a live room and its session keys with
    // it. Reading the policy should not cost you the conversation.
    const link = room.match(/<a href="\/privacy"[^>]*>/);
    expect(link, "privacy link not found in the room").toBeTruthy();
    expect(link![0]).toContain('target="_blank"');
    expect(link![0]).toContain("noopener");
  });
});

describe("the policy does not claim more than the app does", () => {
  // The standard #95 set: every factual claim points at the threat model or at
  // code. These pin the handful that would be actively misleading if the
  // behaviour behind them changed.
  it("does not promise the address is hidden", () => {
    // It is minimized, not hidden. Gap 9 of the threat model is explicit, and
    // the Tor work that would have hidden it was dropped in #37.
    expect(privacy).not.toMatch(/never sees? your (IP|address)/i);
    expect(privacy).toMatch(/minimized, not hidden/i);
  });

  it("says the offline cache key sits beside the data", () => {
    // Gap 10. The cache is encrypted, and describing it as encrypted without
    // this sentence is the overstatement the threat model exists to prevent.
    expect(privacy).toMatch(/beside it|beside the data/i);
  });

  it("admits push links a device across rooms", () => {
    expect(privacy).toMatch(/same endpoint under both/i);
  });

  it("names the third parties rather than implying there are none", () => {
    expect(privacy).toContain("Vercel");
    expect(privacy).toContain("Fly.io");
  });
});
