// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * What the app says about itself has to keep matching what it does.
 *
 * An audit of the public copy found four claims that were false and three that
 * were unearned. None of them was false because the app misbehaved. Each was
 * false because a sentence outlived the code it described, and nothing failed
 * when that happened.
 *
 * These pair each surviving claim with the fact that makes it true. Change the
 * code and the claim fails here rather than in public, which is the only
 * mechanism that has ever kept the two together.
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

const readme = read("README.md");
const landing = read("src/routes/+page.svelte");
const relay = read("server/relay.ts");
const prf = read("src/lib/webauthn/prf.ts");
const runtime = read("src/lib/agents/runtime.ts");
const page = read("src/routes/room/[id]/+page.svelte");
const threatModel = read("docs/THREAT-MODEL.md");

describe("claims that were retired stay retired", () => {
  it("does not say the relay cannot identify users", () => {
    // It still knows which keys are in which room and holds a push endpoint
    // for anyone who enabled notifications. Both are load-bearing.
    expect(readme).not.toMatch(/cannot read messages, identify users/);
  });

  it("does not promise keys live only in memory without qualification", () => {
    expect(readme).not.toMatch(/Close the tab, lose the keys/);
  });

  it("does not claim agents never touch plaintext", () => {
    // They run on decrypted task structure. What is true is that they are not
    // given the free text, and that nothing they see reaches the server.
    expect(readme).not.toMatch(/without accessing plaintext/);
  });

  it("does not describe federation as something that exists", () => {
    expect(readme).not.toMatch(/Self-hostable and federable/);
    expect(readme).toMatch(/Planned, not built/);
  });

  it("does not make a promise nobody can check", () => {
    expect(readme).not.toMatch(/No persistence beyond what's necessary/);
  });

  it("does not gate launch on a milestone that already shipped", () => {
    expect(readme).not.toMatch(/will go live after M8/);
  });

  it("does not claim all your data leaves the device encrypted", () => {
    // The push endpoint and the room id are sent in the clear, and have to be.
    expect(landing).not.toMatch(/Your data never leaves your device unencrypted/);
    expect(landing).toMatch(/messages and tasks never leave your device unencrypted/);
  });
});

describe("each surviving claim is paired with the code that makes it true", () => {
  it("the relay never receives display names", () => {
    expect(readme).toMatch(/never receives display names/);
    expect(relay).not.toMatch(/displayName/);
  });

  it("connections are counted under a hash rather than an address", () => {
    expect(readme).toMatch(/salted hash rather than an address/);
    expect(relay).toMatch(/const ip = hashClientIp\(/);
  });

  it("identity is different in every room", () => {
    expect(readme).toMatch(/different in every room/);
    expect(prf).toMatch(/const salt = prfSaltFor\(roomId\)/);
    expect(prf).toMatch(/identity-v2\|\$\{roomId\}/);
  });

  it("agents get structure rather than what anyone typed", () => {
    expect(readme).toMatch(/task structure rather than anything anyone typed/);
    expect(runtime).toMatch(/context\.tasks\.map\(projectTaskForAgent\)/);
  });

  it("nothing is stored on this device unless asked for", () => {
    expect(readme).toMatch(/Nothing is stored unless you ask/);
    // The join path must not write a seed on its own. Storing happens only
    // from the control that asks for a PIN first.
    const joinFlow = page.match(/async function joinRoom\(\)[\s\S]*?\n\t\}/);
    expect(joinFlow, "joinRoom not found").toBeTruthy();
    expect(joinFlow![0]).not.toMatch(/storeIdentitySeed/);
    expect(page).toMatch(/async function keepIdentityOnDevice\(\)/);
  });

  it("a room's entries are dropped when its last member leaves", () => {
    expect(readme).toMatch(/dropped when its last member leaves/);
    expect(relay).toMatch(/deleteRoomState\(/);
  });

  it("does not promise a Tor hidden service", () => {
    // It was planned as M20 and dropped, because it costs latency this app
    // cannot absorb, removes the per-address cap, and needs a browser that may
    // not run the WebAssembly the encryption is compiled to. A dropped plan
    // that stays in the copy is the same defect as a false capability claim:
    // a sentence outliving the decision it described.
    const planned = readme.match(/### Planned, not built[\s\S]*?(?=\n### |\n## )/);
    expect(planned, "Planned, not built section not found").toBeTruthy();
    // Word-bounded. A bare /[Tt]or/ matches inside "repository", which is how
    // the first version of this guard failed against correct copy.
    expect(planned![0]).not.toMatch(/\bTor\b|\bonion\b|hidden service/i);

    // The threat model must not point at it as the mitigation either. It used
    // to name a milestone number that never existed.
    expect(threatModel).not.toMatch(/M19 Tor|M20 Tor|Tor hidden service reduces/);
    expect(threatModel).toMatch(/Address minimized, not hidden/);
  });

  it("says what the address minimization is actually worth", () => {
    // The claim is narrow on purpose. The salted hash removes the address from
    // the relay's own memory and nothing else, and the salt lives in the same
    // process, so it stops enumeration rather than confirmation.
    expect(threatModel).toMatch(/random at boot and never written down/);
    expect(relay).toMatch(/const IP_HASH_SALT = randomBytes\(32\)/);
    expect(relay).toMatch(/createHmac\("sha256", salt\)/);
  });
});
