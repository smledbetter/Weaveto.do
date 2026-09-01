// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateUpgrade } from "../../server/relay";

/**
 * A person turned away has to be told something true.
 *
 * The per-address cap is keyed on the real client address, so everyone in one
 * office shares it. At 10 the eleventh colleague could not connect, and the
 * app told them: "Could not connect to relay server. Make sure it is running
 * (npm run relay)." A developer instruction, in production, to someone who had
 * done nothing wrong.
 *
 * The client cannot see why the upgrade failed, because the WebSocket API
 * withholds the status on purpose. So the relay exposes the reason on a path
 * the refused client can ask, and the client asks.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");
const relay = read("server/relay.ts");
const page = read("src/routes/room/[id]/+page.svelte");

/**
 * Strip comments, so the check below is about what a person can read. A
 * comment recording the old message is how the next author learns why it was
 * removed, and a guard that forbids explaining itself gets worked around.
 */
function visibleText(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function constant(name: string): number {
  const m = relay.match(new RegExp(`^const ${name} = ([\\d_]+)`, "m"));
  expect(m, `${name} not found`).toBeTruthy();
  return Number(m![1].replace(/_/g, ""));
}

describe("the per-address cap", () => {
  it("allows a co-located group to connect", () => {
    // A shared office, school or cafe is one address. Ten was below any
    // plausible group of colleagues.
    expect(constant("MAX_CONNECTIONS_PER_IP")).toBeGreaterThanOrEqual(50);
  });

  it("still bounds one source's share of the relay", () => {
    // Raising it is a real trade, so the trade is asserted rather than left
    // implicit: one address must not be able to take the whole server.
    const addresses = constant("MAX_CONNECTIONS") / constant("MAX_CONNECTIONS_PER_IP");
    expect(addresses).toBeGreaterThanOrEqual(100);
  });

  it("refuses past the cap, with the status the client can look up", () => {
    const counts = { total: 0, perIp: new Map([["abc", 50]]) };
    const decision = evaluateUpgrade(
      { origin: "https://weaveto.do", pathname: "/room/" + "a".repeat(32), ip: "abc" },
      counts as never,
      new Set(["https://weaveto.do"]),
    );
    expect(decision.accept).toBe(false);
    expect(decision.status).toBe(429);
  });

  it("admits the connection one below the cap", () => {
    const counts = { total: 0, perIp: new Map([["abc", 49]]) };
    const decision = evaluateUpgrade(
      { origin: "https://weaveto.do", pathname: "/room/" + "a".repeat(32), ip: "abc" },
      counts as never,
      new Set(["https://weaveto.do"]),
    );
    expect(decision.accept).toBe(true);
  });
});

describe("a refused client can find out why", () => {
  it("the relay answers on a path that does not need a socket", () => {
    // It has to be plain HTTP. The upgrade is the thing being refused.
    expect(relay).toMatch(/"\/connection-status"/);
    expect(relay).toMatch(/atAddressLimit/);
  });

  it("reports only the caller's own address", () => {
    // Anything else would tell one client about another's traffic.
    const handler = relay.match(/if \(req\.url === "\/connection-status"[\s\S]*?\n  \}/);
    expect(handler, "handler not found").toBeTruthy();
    expect(handler![0]).toMatch(/resolveClientIp\(req\.headers/);
    expect(handler![0]).not.toMatch(/perIp\.size|Array\.from|entries\(\)/);
  });

  it("the client asks, rather than guessing", () => {
    // Assert the call, not the definition. A first version matched the
    // function's own name, so deleting the only call to it left this green
    // while the app went back to guessing.
    const handler = page.match(/setConnectionHandler\(\(c\) => \{[\s\S]*?\n\t\t\t\}\);/);
    expect(handler, "connection handler not found").toBeTruthy();
    expect(handler![0]).toMatch(/explainConnectionFailure\(/);
    expect(page).toMatch(/connection-status/);
  });

  it("never tells a person in production to run npm", () => {
    // The whole point. This string was shown to every refused user.
    expect(visibleText(page)).not.toMatch(/npm run relay/);
  });
});
