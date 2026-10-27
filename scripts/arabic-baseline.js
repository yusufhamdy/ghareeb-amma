#!/usr/bin/env node
/*
 * arabic-baseline.js - the Arabic/Quranic content preservation baseline.
 *
 * Protects the committed source data, field by field, against any unintended change (no Unicode normalization
 * anywhere; one changed code point is a difference):
 *   - public/words.json: every surah name, word, meaning, source, ayah label and segment num/before/hl/after;
 *   - public/challenge.json: every day's word references and links;
 *   - data/redirects.json, data/quran/hafsData_v2-0.json (the official Hafs text) and public/admin/quran-hafs.json:
 *     whole-file SHA-256.
 * Only files committed to git are read (git ls-files), so the guard runs the same everywhere, with no external
 * bundle; it fails (never skips) when git, a protected file or the baseline fixture is missing. The generated pages
 * are checked against this data by test/static-arabic, quran-text, headword and mark-words tests.
 *
 * The fixture (test/fixtures/arabic-baseline.json) stores SHA-256 digests only, no text.
 * CLI: node scripts/arabic-baseline.js          write the fixture from the current data
 *      node scripts/arabic-baseline.js --diff   compare without writing
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const BASELINE_PATH = path.join(ROOT, "test", "fixtures", "arabic-baseline.json");
const VERSION = 2;

// Arabic and Quranic code-point ranges (used by extractRuns, kept for the guard's self-tests).
const ARABIC_RANGES = [[0x0600, 0x06ff], [0x0750, 0x077f], [0x08a0, 0x08ff], [0xfb50, 0xfdff], [0xfe70, 0xfeff]];
const FIELD_FILES = ["public/words.json", "public/challenge.json"];
const HASH_FILES = ["data/redirects.json", "data/quran/hafsData_v2-0.json", "public/admin/quran-hafs.json"];

function sha256(buf) { return crypto.createHash("sha256").update(buf).digest("hex"); }

function isArabic(cp) { return ARABIC_RANGES.some((r) => cp >= r[0] && cp <= r[1]); }

// Maximal runs of Arabic-range code points, as exact code-point arrays.
function extractRuns(text) {
  const runs = [];
  let cur = null, line = 1, runLine = 1, idx = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 0x0a) line++;
    if (isArabic(cp)) { if (!cur) { cur = []; runLine = line; } cur.push(cp); }
    else if (cur) { runs.push({ i: idx++, line: runLine, cp: cur }); cur = null; }
  }
  if (cur) runs.push({ i: idx++, line: runLine, cp: cur });
  return runs;
}

function firstDiff(a, b) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return { at: i, expected: b[i], actual: a[i] };
  return { at: n, expected: b.length > n ? b[n] : null, actual: a.length > n ? a[n] : null };
}

// Actual runs (a) against expected runs (b), by exact code points.
function diffRuns(a, b) {
  const out = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (!a[i]) { out.push({ i, reason: "missing-run" }); continue; }
    if (!b[i]) { out.push({ i, reason: "extra-run" }); continue; }
    const x = a[i].cp, y = b[i].cp;
    if (x.length !== y.length || x.some((c, k) => c !== y[k])) out.push({ i, reason: "run-changed", expectedLen: y.length, actualLen: x.length, diff: firstDiff(x, y) });
  }
  return out;
}

function tracked() {
  let out;
  try { out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT }).toString("utf8"); }
  catch (e) { throw new Error("arabic-baseline: git is not available, so the committed files cannot be listed"); }
  return new Set(out.split("\0").filter(Boolean));
}

function readCommitted(rel, files) {
  if (!files.has(rel)) throw new Error("arabic-baseline: protected file is not committed: " + rel);
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) throw new Error("arabic-baseline: protected file is missing: " + rel);
  return fs.readFileSync(abs);
}

// Every leaf string or number of a JSON value, keyed by its path (e.g. [3].ayahs[0].segments[1].hl).
function leaves(value, prefix, out) {
  if (Array.isArray(value)) value.forEach((v, i) => leaves(v, prefix + "[" + i + "]", out));
  else if (value && typeof value === "object") Object.keys(value).sort().forEach((k) => leaves(value[k], prefix + "." + k, out));
  else out[prefix] = sha256(Buffer.from(JSON.stringify(value), "utf8"));
  return out;
}

function collect() {
  const files = tracked();
  const fields = {}, hashes = {};
  for (const rel of FIELD_FILES) fields[rel] = leaves(JSON.parse(readCommitted(rel, files).toString("utf8")), "", {});
  for (const rel of HASH_FILES) { const buf = readCommitted(rel, files); hashes[rel] = { sha256: sha256(buf), size: buf.length }; }
  return { fields, hashes };
}

function git(args) {
  try { return execFileSync("git", args, { cwd: ROOT }).toString("utf8").trim(); } catch (e) { return ""; }
}

function buildBaseline() {
  const c = collect();
  return {
    meta: {
      version: VERSION,
      generatedAtUtc: new Date().toISOString(),
      headCommit: git(["rev-parse", "HEAD"]),
      method: "sha256 of every JSON leaf (fields) or of the raw bytes (hashes); committed files only; no normalization",
    },
    fields: c.fields,
    hashes: c.hashes,
  };
}

function compareBaseline(baseline) {
  if (!baseline || !baseline.meta || baseline.meta.version !== VERSION) throw new Error("arabic-baseline: the fixture is missing or has an old format; regenerate it deliberately");
  const cur = collect();
  const result = { ok: true, fields: { changed: [], missing: [], added: [] }, hashes: { changed: [], missing: [] } };
  for (const rel of FIELD_FILES) {
    const a = cur.fields[rel], b = (baseline.fields || {})[rel] || {};
    for (const k of Object.keys(b)) { if (!(k in a)) result.fields.missing.push(rel + k); else if (a[k] !== b[k]) result.fields.changed.push(rel + k); }
    for (const k of Object.keys(a)) if (!(k in b)) result.fields.added.push(rel + k);
  }
  for (const rel of HASH_FILES) {
    const b = (baseline.hashes || {})[rel];
    if (!b) result.hashes.missing.push(rel);
    else if (b.sha256 !== cur.hashes[rel].sha256 || b.size !== cur.hashes[rel].size) result.hashes.changed.push(rel);
  }
  result.ok = !result.fields.changed.length && !result.fields.missing.length && !result.fields.added.length && !result.hashes.changed.length && !result.hashes.missing.length;
  return result;
}

module.exports = { ROOT, BASELINE_PATH, ARABIC_RANGES, FIELD_FILES, HASH_FILES, sha256, isArabic, extractRuns, diffRuns, leaves, collect, buildBaseline, compareBaseline };

if (require.main === module) {
  if (process.argv.includes("--diff")) {
    const r = compareBaseline(JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8")));
    console.log(JSON.stringify(r, null, 1));
    process.exitCode = r.ok ? 0 : 1;
  } else {
    const b = buildBaseline();
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(b, null, 1) + "\n");
    const n = Object.values(b.fields).reduce((s, f) => s + Object.keys(f).length, 0);
    console.log("arabic-baseline: wrote " + path.relative(ROOT, BASELINE_PATH).split(path.sep).join("/") + " (" + n + " fields, " + Object.keys(b.hashes).length + " files)");
  }
}
