// @vitest-environment node
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The threat model has to keep describing the code that exists.
 *
 * It drifted badly and in the direction nobody audits. Six gaps stayed under
 * "Open Gaps & Planned Mitigations", each with a "Planned mitigation" heading,
 * long after the mitigation shipped. Two were marked High. A reviewer reading
 * it would have concluded the app carried an unmitigated MITM vector it had
 * closed months earlier.
 *
 * Overclaiming gets caught, because someone tries the feature and it is not
 * there. Underclaiming sits untouched, because nothing fails and nobody is
 * disappointed. That asymmetry is why this file exists.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const doc = readFileSync(resolve(ROOT, "docs/THREAT-MODEL.md"), "utf8");

/** The body of a top-level section, from its heading to the next one. */
function section(title: string): string {
  const start = doc.indexOf(`## ${title}`);
  expect(start, `section "${title}" not found`).toBeGreaterThan(-1);
  const rest = doc.slice(start + 3);
  const next = rest.indexOf("\n## ");
  return next === -1 ? rest : rest.slice(0, next);
}

describe("the threat model describes the code that exists", () => {
  it("has no duplicate gap numbers", () => {
    // Inserting a section by anchoring on the heading that should follow it
    // produced two "### 5" headings, which shipped. Numbers are identifiers
    // and the document tells readers to cite them, so a collision makes a
    // citation ambiguous.
    const numbers = [...doc.matchAll(/^### (\d+)\. /gm)].map((m) => m[1]);
    expect(numbers.length).toBeGreaterThan(0);
    expect(new Set(numbers).size, `duplicate gap numbers in ${numbers}`).toBe(
      numbers.length,
    );
  });

  it("keeps closed gaps out of the open section", () => {
    const open = section("Open Gaps");
    for (const closed of [
      "No Key Verification UI",
      "No Member Revocation",
      "No Message Delivery Confirmation",
      "Display Name Spoofing",
      "Timestamp Manipulation",
      "Reconnect Olm Session Divergence",
    ]) {
      expect(open, `"${closed}" shipped and must not sit under Open Gaps`).not.toContain(
        closed,
      );
    }
  });

  it("does not call a shipped mitigation 'planned'", () => {
    // The exact phrasing that made six closed gaps read as future work.
    expect(section("Closed Gaps")).not.toMatch(/\*\*Planned mitigation\*\*/);
  });

  it("cites a real file for every closed gap", () => {
    // A closed gap is only a claim until it names the thing that closed it.
    // Paths rot when code moves, and a citation to a file that no longer
    // exists is how a document starts describing a system that is gone.
    const closed = section("Closed Gaps");
    const paths = [...closed.matchAll(/`((?:src|tests|server)\/[\w./[\]-]+)`/g)].map(
      (m) => m[1],
    );
    expect(paths.length, "no source citations found in Closed Gaps").toBeGreaterThan(5);
    for (const rel of paths) {
      expect(existsSync(resolve(ROOT, rel)), `cited but missing: ${rel}`).toBe(true);
    }
  });

  it("lists the mitigations that moved into Defended", () => {
    // These five sat under Undefended with "no detection mechanism currently"
    // and similar, while the detection mechanism was already shipped.
    const defended = section("Defended Threats");
    expect(defended).toMatch(/MITM via fake identity key injection/);
    expect(defended).toMatch(/Display name spoofing/);
    expect(defended).toMatch(/Relay selectively drops messages/);
    expect(defended).toMatch(/Timestamp manipulation in task events/);
    expect(defended).toMatch(/Reconnect Olm session divergence/);
  });

  it("keeps the genuinely open gaps open", () => {
    // The inverse failure. A document that quietly marks everything closed is
    // no more honest than one that marks everything open.
    const open = section("Open Gaps");
    expect(open).toMatch(/No Relay Authenticity Proof/);
    expect(open).toMatch(/Burn Is Authorized By Membership/);
    expect(open).toMatch(/The Address Is Minimized, Not Hidden/);
  });
});
