#!/usr/bin/env node
/**
 * CSP hash tool for the inline script in src/app.html.
 *
 * SvelteKit auto-generates nonces only for the scripts it injects. A
 * hand-written inline script in app.html is not one of those, so it has to be
 * allow-listed by hash in svelte.config.js. Nothing tied the two together, so
 * the script was edited, the hash went stale, and the browser blocked the
 * theme script on every production load for months.
 *
 * Usage:
 *   node scripts/csp-hash.mjs           print the hash for each inline script
 *   node scripts/csp-hash.mjs --check   exit 1 if svelte.config.js is stale
 *   node scripts/csp-hash.mjs --write   update svelte.config.js in place
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP_HTML = resolve(ROOT, "src/app.html");
const SVELTE_CONFIG = resolve(ROOT, "svelte.config.js");

/** Return the hash of every inline <script> body in app.html. */
export function inlineScriptHashes(html) {
  const hashes = [];
  // Only bodyless-src scripts are hashed; a script with src= is covered by 'self'.
  const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const body = m[1];
    if (body.trim() === "") continue;
    hashes.push("sha256-" + createHash("sha256").update(body, "utf8").digest("base64"));
  }
  return hashes;
}

/** Return the sha256- entries currently listed in the config's script-src. */
export function configuredHashes(configSource) {
  return [...configSource.matchAll(/"(sha256-[A-Za-z0-9+/=]+)"/g)].map((m) => m[1]);
}

function main() {
  const mode = process.argv[2];
  const html = readFileSync(APP_HTML, "utf8");
  const config = readFileSync(SVELTE_CONFIG, "utf8");

  const wanted = inlineScriptHashes(html);
  const listed = configuredHashes(config);

  if (mode === "--check") {
    const missing = wanted.filter((h) => !listed.includes(h));
    const stale = listed.filter((h) => !wanted.includes(h));

    if (missing.length === 0 && stale.length === 0) {
      console.log(`CSP hashes match (${wanted.length} inline script(s)).`);
      return 0;
    }
    console.error("CSP hash mismatch between src/app.html and svelte.config.js.\n");
    for (const h of missing) console.error(`  MISSING from config: ${h}`);
    for (const h of stale) console.error(`  STALE in config:     ${h}`);
    console.error("\nThe browser blocks any inline script whose hash is not listed.");
    console.error("Fix with: npm run csp:hash:write");
    return 1;
  }

  if (mode === "--write") {
    let updated = config;
    // Replace the existing sha256 entries with the current set, in place.
    if (listed.length > 0) {
      updated = updated.replace(
        /"sha256-[A-Za-z0-9+/=]+",?\n\s*/g,
        "",
      );
    }
    updated = updated.replace(
      /("script-src": \[\n)/,
      (match) => match + wanted.map((h) => `          "${h}",\n`).join(""),
    );
    writeFileSync(SVELTE_CONFIG, updated);
    console.log(`Wrote ${wanted.length} hash(es) to svelte.config.js`);
    return 0;
  }

  for (const h of wanted) console.log(h);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(main());
}
