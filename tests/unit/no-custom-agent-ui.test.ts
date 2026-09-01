// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Custom agents are on the roadmap, not in the app.
 *
 * The upload UI was pulled a while ago, but the surfaces around it stayed: an
 * empty state that said "No agent modules uploaded", an author and upload date
 * that only a custom module would ever have, and a delete button that only
 * appeared for one. So the app kept describing a feature nobody could reach,
 * which is the same defect as a claim outliving its code.
 *
 * The README says so in one place, under Planned. This keeps it to one place.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/**
 * Strip comments, so this checks what a person can read rather than what a
 * developer wrote. A comment explaining why there is no upload path is useful
 * and should not be forbidden by the guard that keeps the path gone.
 */
function visibleText(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Every Svelte component and route, which is everything a user can read. */
function uiFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(resolve(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name);
    if (entry.isDirectory()) uiFiles(rel, acc);
    else if (entry.name.endsWith(".svelte")) acc.push(rel);
  }
  return acc;
}

describe("the app does not offer custom agents", () => {
  const files = [...uiFiles("src/lib/components"), ...uiFiles("src/routes")];

  it("finds the UI to check", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    it(`${file} does not mention uploading an agent`, () => {
      const text = visibleText(read(file));
      expect(text).not.toMatch(/upload/i);
      expect(text).not.toMatch(/custom agent/i);
    });
  }

  it("has no delete affordance for a module that cannot exist", () => {
    // Only a custom module was ever deletable. Built-ins never were.
    const panel = read("src/lib/components/AgentPanel.svelte");
    expect(panel).not.toMatch(/onDelete/);
    expect(panel).not.toMatch(/Delete agent module/);
  });
});

describe("the roadmap is where it is mentioned", () => {
  const readme = read("README.md");

  it("names it under Planned, not built", () => {
    const planned = readme.slice(readme.indexOf("### Planned, not built"));
    expect(planned).toMatch(/Custom agents/);
  });

  it("does not list uploading one as a shipped feature", () => {
    // Checked across the whole file. An earlier version only looked at the
    // text before the Planned heading, and the milestone list sits after it,
    // so the claim it was written to catch lived outside the slice.
    expect(readme).not.toMatch(/Upload and run custom WASM/);
    const milestones = readme.slice(readme.indexOf("## Milestones"));
    expect(milestones).not.toMatch(/^- Upload /m);
  });
});
