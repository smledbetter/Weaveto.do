import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every Playwright project must actually be run, locally and in CI.
 *
 * The suite is split across projects for isolation, and both runners name the
 * projects explicitly: CI as a job matrix, the local script as two invocations
 * (relay-restart kills every process on the relay port, so it cannot share a
 * run with projects that use the shared relay).
 *
 * Explicit lists mean a new project silently never runs. That is a coverage
 * hole that reports itself as green, which is the worst kind. These assertions
 * fail the build instead.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/** Project names declared in the Playwright config. */
function configuredProjects(): string[] {
  const src = read("playwright.config.ts");
  const block = src.match(/projects:\s*\[([\s\S]*?)\n  \],/);
  expect(block, "projects array not found in playwright.config.ts").toBeTruthy();
  return [...block![1].matchAll(/^\s*name:\s*['"]([^'"]+)['"]/gm)].map(
    (m) => m[1],
  );
}

/** Projects named by `--project=` flags in one npm script. */
function projectsInScript(name: string): string[] {
  const pkg = JSON.parse(read("package.json"));
  const script = pkg.scripts[name];
  expect(script, `npm script ${name} not found`).toBeTruthy();
  return [...script.matchAll(/--project=([\w-]+)/g)].map((m) => m[1]);
}

/** Projects listed in the CI e2e job matrix. */
function ciMatrixProjects(): string[] {
  const src = read(".github/workflows/ci.yml");
  const line = src.match(/^\s*project:\s*\[([^\]]+)\]/m);
  expect(line, "e2e project matrix not found in ci.yml").toBeTruthy();
  return line![1].split(",").map((s) => s.trim());
}

describe("every Playwright project is run", () => {
  const configured = configuredProjects();

  it("finds the configured projects", () => {
    expect(configured.length).toBeGreaterThan(0);
    expect(configured).toContain("relay-restart");
  });

  it("CI runs all of them", () => {
    expect([...ciMatrixProjects()].sort()).toEqual([...configured].sort());
  });

  it("the local script runs all of them, each exactly once", () => {
    const local = [
      ...projectsInScript("test:e2e:shared"),
      ...projectsInScript("test:e2e:restart"),
    ];
    expect([...local].sort()).toEqual([...configured].sort());
    expect(new Set(local).size, "a project is run twice").toBe(local.length);
  });

  it("keeps relay-restart out of the shared-relay invocation", () => {
    // It SIGKILLs every process listening on the relay port. Playwright's
    // per-project `workers: 1` does not stop other projects running beside it,
    // so isolation has to come from the invocation.
    expect(projectsInScript("test:e2e:shared")).not.toContain("relay-restart");
    expect(projectsInScript("test:e2e:restart")).toEqual(["relay-restart"]);
  });

  it("every Playwright config is run by CI", () => {
    // The project guard above only looks inside playwright.config.ts, so a
    // whole second config could go unrun and it would stay green. That
    // happened: playwright-preview.config.ts builds the app for production and
    // is the only place the WebAuthn identity path is exercised, and nothing
    // ran it, so the one spec covering that path ran nowhere.
    const { readdirSync } = require("node:fs") as typeof import("node:fs");
    const configs = readdirSync(ROOT).filter((f) =>
      /^playwright.*\.config\.ts$/.test(f),
    );
    expect(configs.length).toBeGreaterThan(1);

    const ci = read(".github/workflows/ci.yml");
    for (const config of configs) {
      if (config === "playwright.config.ts") {
        // The default config is the one the --project matrix uses.
        expect(ci).toMatch(/--project=/);
        continue;
      }
      // Look for an actual invocation, not a mention. A first version of this
      // asserted the filename appeared anywhere in the workflow, which the
      // comment naming the config satisfied all by itself.
      const invoked = new RegExp(
        `playwright\\s+test[^\\n]*--config\\s+${config.replace(".", "\\.")}`,
      );
      expect(
        invoked.test(ci),
        `${config} is never run by CI, so the specs only it covers run nowhere`,
      ).toBe(true);
    }
  });

  it("test:e2e runs both halves", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.scripts["test:e2e"]).toContain("test:e2e:shared");
    expect(pkg.scripts["test:e2e"]).toContain("test:e2e:restart");
  });
});
