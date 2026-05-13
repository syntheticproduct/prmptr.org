#!/usr/bin/env node
// Sync the project's version across the three files that carry it:
//   - package.json
//   - src-tauri/Cargo.toml ([package].version)
//   - src-tauri/tauri.conf.json (top-level "version")
//
// Usage:
//   node scripts/bump-version.mjs <new-version>
//   node scripts/bump-version.mjs patch | minor | major
//
// Reads the canonical version from package.json. After writing, prints a
// summary suitable for a commit message and exits non-zero if any file was
// left out of sync.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const PKG = resolve(root, "package.json");
const CARGO = resolve(root, "src-tauri/Cargo.toml");
const TAURI = resolve(root, "src-tauri/tauri.conf.json");

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[\w.+-]+)?$/;

function readPkg() {
  return JSON.parse(readFileSync(PKG, "utf8"));
}

function resolveTarget(arg, current) {
  if (!arg) {
    throw new Error("usage: bump-version.mjs <version> | patch | minor | major");
  }
  if (arg === "patch" || arg === "minor" || arg === "major") {
    const m = SEMVER_RE.exec(current);
    if (!m) {
      throw new Error(`current version "${current}" is not semver-shaped`);
    }
    let [, maj, min, pat] = m;
    maj = Number(maj);
    min = Number(min);
    pat = Number(pat);
    if (arg === "major") return `${maj + 1}.0.0`;
    if (arg === "minor") return `${maj}.${min + 1}.0`;
    return `${maj}.${min}.${pat + 1}`;
  }
  if (!SEMVER_RE.test(arg)) {
    throw new Error(`"${arg}" is not a valid semver`);
  }
  return arg;
}

function bumpPackageJson(next) {
  const txt = readFileSync(PKG, "utf8");
  const updated = txt.replace(
    /("version"\s*:\s*")[^"]+(")/,
    (_, a, b) => `${a}${next}${b}`,
  );
  writeFileSync(PKG, updated);
}

function bumpCargoToml(next) {
  const txt = readFileSync(CARGO, "utf8");
  // Match only the top-level [package].version, not any dependency = "X.Y.Z".
  // [package] is the first table; replace the first `version = "..."` after it.
  const re = /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+(")/;
  if (!re.test(txt)) {
    throw new Error("could not locate [package].version in Cargo.toml");
  }
  writeFileSync(CARGO, txt.replace(re, (_, a, b) => `${a}${next}${b}`));
}

function bumpTauriConf(next) {
  const txt = readFileSync(TAURI, "utf8");
  // tauri.conf.json's top-level "version" is the second top-level key in our
  // file; match precisely on its line shape to avoid touching nested versions.
  const re = /("version"\s*:\s*")[^"]+(",\n  "identifier")/;
  if (!re.test(txt)) {
    throw new Error("could not locate top-level version in tauri.conf.json");
  }
  writeFileSync(TAURI, txt.replace(re, (_, a, b) => `${a}${next}${b}`));
}

function verify(next) {
  const pkg = JSON.parse(readFileSync(PKG, "utf8")).version;
  const cargo = (
    readFileSync(CARGO, "utf8").match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/) ?? []
  )[1];
  const tauri = (readFileSync(TAURI, "utf8").match(/"version"\s*:\s*"([^"]+)"/) ?? [])[1];
  const all = { "package.json": pkg, "Cargo.toml": cargo, "tauri.conf.json": tauri };
  let ok = true;
  for (const [name, v] of Object.entries(all)) {
    if (v !== next) {
      console.error(`MISMATCH ${name}: ${v} (expected ${next})`);
      ok = false;
    }
  }
  if (!ok) process.exit(1);
  return all;
}

const current = readPkg().version;
const next = resolveTarget(process.argv[2], current);

if (current === next) {
  console.log(`Already at ${current}; nothing to do.`);
  process.exit(0);
}

bumpPackageJson(next);
bumpCargoToml(next);
bumpTauriConf(next);
const all = verify(next);

console.log(`Bumped: ${current} → ${next}`);
for (const [name, v] of Object.entries(all)) {
  console.log(`  ${name}: ${v}`);
}
console.log(`\nSuggested commit:\n  chore: bump version to ${next}`);
