// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The relay-restart suite must not leave a relay behind.
 *
 * `handBackRelay` restores a relay after each test so the next one has
 * something to connect to, and it used to throw the handle away. Playwright
 * could not clean it up either: its own webServer relay is the one the first
 * test kills, so by the end there was nothing left for it to stop. Every local
 * run left a relay listening.
 *
 * That is worse than untidy. The next run reuses whatever is on the port, so a
 * stale process silently serves the suite, and a green result then describes
 * code nobody is looking at. It cost a real debugging session before the
 * staleness guard existed, and it is what put an unkillable relay in the way of
 * verifying this very fix.
 *
 * Nothing detected it, which is the point of the assertions below. CI destroys
 * its runner after each job, so a leak never failed anything.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const control = read("tests/e2e/utils/relay-control.ts");
const spec = read("tests/e2e/relay-restart.spec.ts");

describe("relays the helper starts are tracked", () => {
  it("records every one it spawns", () => {
    // handBackRelay discards the return value, so the module has to keep its
    // own record or the relay it starts is unreachable.
    const start = control.match(/export async function startRelay\(\)[\s\S]*?\n\}/);
    expect(start, "startRelay not found").toBeTruthy();
    expect(start![0]).toMatch(/started\.push\(child\)/);
  });

  it("gives each one its own process group", () => {
    // tsx runs the relay in a grandchild. Killing the direct child leaves the
    // grandchild holding the port, which is how a "stopped" relay kept serving.
    const start = control.match(/export async function startRelay\(\)[\s\S]*?\n\}/);
    expect(start![0]).toMatch(/detached: true/);
  });

  it("kills the group rather than the direct child", () => {
    const stop = control.match(/export async function stopRelay\(\)[\s\S]*?\n\}/);
    expect(stop, "stopRelay not found").toBeTruthy();
    expect(stop![0]).toMatch(/process\.kill\(-child\.pid/);
  });

  it("still sweeps the port for anything it did not start", () => {
    const stop = control.match(/export async function stopRelay\(\)[\s\S]*?\n\}/);
    expect(stop![0]).toMatch(/pidsOnPort\(\)/);
  });
});

describe("the suite proves it left nothing behind", () => {
  it("fails rather than warns when the port is still served", () => {
    // A warning in a teardown is a warning nobody reads. The leak survived for
    // months precisely because nothing failed.
    const release = control.match(/export async function releaseRelay\(\)[\s\S]*?\n\}/);
    expect(release, "releaseRelay not found").toBeTruthy();
    expect(release![0]).toMatch(/throw new Error/);
  });

  it("is actually called when the file finishes", () => {
    // Assert the call, not the definition. A cleanup nothing invokes is the
    // same as no cleanup, and reads identically in the source.
    const afterAll = spec.match(/test\.afterAll\(async \(\) => \{[\s\S]*?\n\}\);/);
    expect(afterAll, "afterAll not found in the spec").toBeTruthy();
    expect(afterAll![0]).toMatch(/releaseRelay\(\)/);
  });

  it("cleans up after every test as well as after the file", () => {
    // afterEach hands the relay back for the next test; afterAll is what stops
    // the last one. Both are needed and neither replaces the other.
    expect(spec).toMatch(/test\.afterEach\(/);
    expect(spec).toMatch(/handBackRelay\(spawned\)/);
  });
});
