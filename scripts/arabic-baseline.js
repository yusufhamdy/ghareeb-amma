#!/usr/bin/env node
/*
 * arabic-baseline.js - Stage A: read-only Arabic-content preservation baseline.
 *
 * This module is the single source of truth for the Stage A preservation check.
 * It NEVER writes to any inspected file. Its only write (CLI mode) is the new
 * baseline fixture at test/fixtures/arabic-baseline.json.
 *
 * Method (no Unicode normalization anywhere):
 *   - class1 (whole content files): SHA-256 over raw on-disk bytes + size.
 *   - class2 (mixed-content files): every maximal run of Arabic-range code
 *     points is captured as an exact integer code-point array (verbatim, no
 *     normalization), with a run index and 1-based line number.
 *
 * The baseline stores hashes and integer arrays only; it embeds no Arabic text
 * and no private file contents (private files are class1 hash-only).
 *
 * CLI: node scripts/arabic-baseline.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(ROOT, "test", "fixtures", "arabic-baseline.json");

// Arabic and Quranic code-point ranges (inclusive). Kept verbatim; never normalized.
const ARABIC_RANGES = [
  [0x0600, 0x06ff],
  [0x0610, 0x061a],
  [0x06d6, 0x06ed],
  [0x0750, 0x077f],
  [0x08a0, 0x08ff],
  [0xfb50, 0xfdff],
  [0xfe70, 0xfeff],
];

// Explicit whole-file protected content (relative POSIX paths).
const CLASS1_PATHS = [
  "public/words.json",
  "public/challenge.json",
  "data/words.json",
  "data/challenge.json",
  "data/redirects.json",
  "data/challenge-notes-private.json",
  "ghareeb-handoff/data/words.json",
  "ghareeb-handoff/data/challenge.json",
  "ghareeb-handoff/data/redirects.json",
  "ghareeb-handoff/data/challenge-notes-private.json",
  "ghareeb-handoff/data/challenge-plan-30-days.docx",
];

// Mixed-content scan roots (relative POSIX paths). Prompt files are excluded.
const CLASS2_ROOTS = [
  "public",
  "functions",
  "src",
  "data",
  "test",
  "tools",
  "design",
  "reference",
  "ghareeb-handoff/data",
  "ghareeb-handoff/design",
  "ghareeb-handoff/reference",
  "ghareeb-handoff/tools",
];
const CLASS2_ROOT_FILES = ["firebase.json", ".gitignore"];

const TEXT_EXT = new Set([
  ".html", ".htm", ".js", ".mjs", ".cjs", ".json", ".css", ".xml",
  ".txt", ".md", ".rules", ".svg", ".webmanifest", ".yml", ".yaml",
]);

const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "backup", ".firebase", ".agents", ".vscode",
]);
const EXCLUDE_REL = new Set([
  "ghareeb-handoff/prompts",
  "design/baseline",
]);

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function isArabic(cp) {
  for (let i = 0; i < ARABIC_RANGES.length; i++) {
    const r = ARABIC_RANGES[i];
    if (cp >= r[0] && cp <= r[1]) return true;
  }
  return false;
}

// Capture maximal runs of Arabic-range code points as exact code-point arrays.
function extractRuns(text) {
  const runs = [];
  let cur = null;
  let line = 1;
  let runLine = 1;
  let idx = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 0x0a) line++;
    if (isArabic(cp)) {
      if (!cur) { cur = []; runLine = line; }
      cur.push(cp);
    } else if (cur) {
      runs.push({ i: idx++, line: runLine, cp: cur });
      cur = null;
    }
  }
  if (cur) runs.push({ i: idx++, line: runLine, cp: cur });
  return runs;
}

function listClass1() {
  const files = CLASS1_PATHS.slice();
  const wordDir = path.join(ROOT, "public", "word");
  if (fs.existsSync(wordDir)) {
    for (const name of fs.readdirSync(wordDir)) {
      if (name.toLowerCase().endsWith(".html")) files.push("public/word/" + name);
    }
  }
  files.sort();
  return files;
}

function collectClass1() {
  const data = {};
  const missing = [];
  for (const rel of listClass1()) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { missing.push(rel); continue; }
    const buf = fs.readFileSync(abs);
    data[rel] = { sha256: sha256(buf), size: buf.length };
  }
  return { data, missing };
}

function walkFiles(absDir, acc) {
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
  catch (e) { return; }
  for (const e of entries) {
    const abs = path.join(absDir, e.name);
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name) || EXCLUDE_REL.has(rel)) continue;
      walkFiles(abs, acc);
    } else {
      if (!TEXT_EXT.has(path.extname(e.name).toLowerCase())) continue;
      acc.push(rel);
    }
  }
}

function collectClass2() {
  const class1 = new Set(listClass1());
  const files = [];
  for (const r of CLASS2_ROOTS) {
    const abs = path.join(ROOT, r);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) walkFiles(abs, files);
  }
  for (const f of CLASS2_ROOT_FILES) {
    if (fs.existsSync(path.join(ROOT, f))) files.push(f);
  }
  const out = {};
  for (const rel of files) {
    if (class1.has(rel)) continue;
    const abs = path.join(ROOT, rel);
    let buf;
    try { buf = fs.readFileSync(abs); } catch (e) { continue; }
    const runs = extractRuns(buf.toString("utf8"));
    if (runs.length === 0) continue;
    out[rel] = { sha256: sha256(buf), runs };
  }
  return out;
}

function git(args) {
  try { return execFileSync("git", args, { cwd: ROOT }).toString("utf8").trim(); }
  catch (e) { return ""; }
}

function buildBaseline() {
  const c1 = collectClass1();
  const c2 = collectClass2();
  return {
    meta: {
      phase: "5B-StageA",
      generatedAtUtc: new Date().toISOString(),
      branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
      headCommit: git(["rev-parse", "HEAD"]),
      method: "sha256-raw-bytes(class1); exact-codepoint-runs(class2); no-normalization",
      arabicRanges: ARABIC_RANGES.map((r) =>
        r[0].toString(16).padStart(4, "0") + "-" + r[1].toString(16).padStart(4, "0")),
      missingClass1: c1.missing,
    },
    class1: c1.data,
    class2: c2,
  };
}

function sameCp(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return { at: i, expected: b[i], actual: a[i] };
  }
  return { at: n, expected: b.length > n ? b[n] : null, actual: a.length > n ? a[n] : null };
}

// Compare actual runs (a) against expected runs (b) by exact code points.
function diffRuns(a, b) {
  const out = [];
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (!a[i]) { out.push({ i, reason: "missing-run" }); continue; }
    if (!b[i]) { out.push({ i, reason: "extra-run" }); continue; }
    if (!sameCp(a[i].cp, b[i].cp)) {
      out.push({
        i,
        reason: "run-changed",
        expectedLen: b[i].cp.length,
        actualLen: a[i].cp.length,
        diff: firstDiff(a[i].cp, b[i].cp),
      });
    }
  }
  return out;
}

function compareBaseline(baseline) {
  const result = {
    ok: true,
    class1: { missing: [], changed: [], added: [] },
    class2: { missing: [], changed: [], added: [] },
  };
  const base1 = baseline.class1 || {};
  const base2 = baseline.class2 || {};

  const c1 = collectClass1();
  for (const rel of Object.keys(base1)) {
    const got = c1.data[rel];
    if (!got) result.class1.missing.push(rel);
    else if (got.sha256 !== base1[rel].sha256 || got.size !== base1[rel].size) result.class1.changed.push(rel);
  }
  for (const rel of Object.keys(c1.data)) if (!base1[rel]) result.class1.added.push(rel);

  const c2 = collectClass2();
  for (const rel of Object.keys(base2)) {
    const got = c2[rel];
    if (!got) { result.class2.missing.push(rel); continue; }
    const diffs = diffRuns(got.runs, base2[rel].runs);
    if (diffs.length) result.class2.changed.push({ path: rel, diffs });
  }
  for (const rel of Object.keys(c2)) if (!base2[rel]) result.class2.added.push(rel);

  result.ok =
    result.class1.missing.length === 0 &&
    result.class1.changed.length === 0 &&
    result.class1.added.length === 0 &&
    result.class2.missing.length === 0 &&
    result.class2.changed.length === 0 &&
    result.class2.added.length === 0;
  return result;
}

function main() {
  const baseline = buildBaseline();
  fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n");
  const c1 = Object.keys(baseline.class1).length;
  const c2 = Object.keys(baseline.class2).length;
  let runs = 0;
  for (const rel of Object.keys(baseline.class2)) runs += baseline.class2[rel].runs.length;
  console.log("arabic-baseline: wrote " + path.relative(ROOT, BASELINE_PATH).split(path.sep).join("/"));
  console.log("arabic-baseline: class1=" + c1 + " files, class2=" + c2 + " files, class2 runs=" + runs);
  if (baseline.meta.missingClass1.length) {
    console.log("arabic-baseline: class1 missing (not present on disk): " + baseline.meta.missingClass1.join(", "));
  }
}

module.exports = {
  ROOT,
  BASELINE_PATH,
  ARABIC_RANGES,
  sha256,
  isArabic,
  extractRuns,
  listClass1,
  collectClass1,
  collectClass2,
  buildBaseline,
  diffRuns,
  compareBaseline,
};

if (require.main === module) main();
