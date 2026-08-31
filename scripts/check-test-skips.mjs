#!/usr/bin/env node
/**
 * Fail if a skipped test has no stated reason.
 *
 * A skipped test looks like coverage in the count and provides none. The rule
 * is not "never skip" — some tests genuinely cannot run in dev mode — it is
 * that a reader must be able to see why without archaeology.
 *
 * A skip passes if a comment within the 6 lines above it mentions a reason:
 * an issue reference (#123), or one of the reason keywords below.
 *
 * Usage: node scripts/check-test-skips.mjs
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const E2E_DIR = join(ROOT, "tests/e2e");
const UNIT_DIR = join(ROOT, "tests/unit");

const SKIP_RE = /\b(?:test|it|describe)\s*\.\s*(?:skip|fixme)\s*\(/;
const REASON_RE = /#\d+|NOTE:|TODO:|because|requires|blocked|not available|unsupported|known-broken/i;
const DESCRIBE_RE = /\b(?:test|describe)\s*\.?\s*describe\s*\(|^\s*describe\s*\(/;
const LOOKBACK = 6;

/**
 * Lines to search for a reason: from the enclosing describe block if there is
 * one, else a short lookback. A reason stated once for a group of skips covers
 * the whole group — that is normal and should not force copy-paste comments.
 */
function reasonScope(lines, skipLine) {
  let start = Math.max(0, skipLine - LOOKBACK);
  for (let i = skipLine - 1; i >= 0; i--) {
    if (DESCRIBE_RE.test(lines[i])) {
      start = Math.min(start, i);
      break;
    }
  }
  return lines.slice(start, skipLine + 1).join("\n");
}

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(spec|test)\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const offenders = [];
let total = 0;

for (const file of [...walk(E2E_DIR), ...walk(UNIT_DIR)]) {
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!SKIP_RE.test(line)) return;
    total++;
    const context = reasonScope(lines, i);
    if (!REASON_RE.test(context)) {
      offenders.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim().slice(0, 70)}`);
    }
  });
}

if (offenders.length > 0) {
  console.error(`${offenders.length} skipped test(s) with no stated reason:\n`);
  for (const o of offenders) console.error(`  ${o}`);
  console.error(
    "\nAdd a comment above the skip saying why it cannot run, or reference an" +
      "\nissue (#123). A skip without a reason is invisible lost coverage.",
  );
  process.exit(1);
}

console.log(`All ${total} skipped test(s) carry a stated reason.`);
