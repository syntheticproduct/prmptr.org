#!/usr/bin/env node
// Run every e2e/*.mjs script in this directory, sequentially. Each
// individual script self-reports PASS/FAIL and exits non-zero on failure;
// this wrapper just chains them and aggregates the exit codes.
//
// Run from project root:
//   node tests/e2e/run-all.mjs
//   URL=http://localhost:3000 node tests/e2e/run-all.mjs
//
// In CI, start `npm run dev` in the background first (the scripts assume
// a running dev server on $URL).

import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const me = basename(fileURLToPath(import.meta.url));

const specs = readdirSync(here)
  .filter((f) => f.endsWith(".mjs") && f !== me)
  .sort();

if (specs.length === 0) {
  console.error("no e2e specs found in", here);
  process.exit(1);
}

let failed = 0;
const failures = [];
for (const spec of specs) {
  console.log(`\n=== ${spec} ===`);
  const r = spawnSync(process.execPath, [resolve(here, spec)], {
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    failed += 1;
    failures.push(spec);
  }
}

console.log(`\n=== summary ===`);
console.log(`  ran: ${specs.length}`);
console.log(`  failed: ${failed}`);
if (failures.length > 0) {
  console.log(`  failures: ${failures.join(", ")}`);
  process.exit(1);
}
