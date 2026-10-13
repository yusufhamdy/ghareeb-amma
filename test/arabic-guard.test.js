/*
 * arabic-guard.test.js - Stage A: permanent read-only Arabic-content guard.
 *
 * Runs under `node --test`. It verifies that protected Arabic/Quranic content
 * on disk still matches the committed baseline fixture, and proves the guard
 * itself detects diacritic changes, canonical-equivalence-only changes, and
 * added Arabic runs.
 *
 * The guard only reads repository files. Synthetic cases use in-memory strings
 * (constructed from code points so this file stays ASCII-only) and a temp file.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const baselineMod = require("../scripts/arabic-baseline.js");

const { BASELINE_PATH, sha256, extractRuns, diffRuns, compareBaseline } = baselineMod;

// The guard protects the LOCAL working tree during Phase 5B. A fresh CI checkout
// contains neither the untracked handoff bundle nor the (untracked) baseline
// fixture, so the tree-dependent tests skip there instead of failing. They never
// skip in the full local environment.
const HANDOFF_WORDS = path.join(baselineMod.ROOT, "ghareeb-handoff", "data", "words.json");
const PARTIAL_TREE = !(fs.existsSync(BASELINE_PATH) && fs.existsSync(HANDOFF_WORDS));
const PARTIAL_REASON = PARTIAL_TREE
  ? "partial checkout: baseline fixture or untracked handoff data absent"
  : false;

function loadBaseline() {
  assert.ok(fs.existsSync(BASELINE_PATH), "baseline fixture missing: " + BASELINE_PATH);
  return JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"));
}

// Build a string from an array of code points (keeps this file ASCII-only).
function cpStr(cps) {
  return cps.map((c) => String.fromCodePoint(c)).join("");
}

test("protected Arabic content matches the baseline", { skip: PARTIAL_REASON }, () => {
  const baseline = loadBaseline();
  const res = compareBaseline(baseline);
  const detail = JSON.stringify(
    {
      class1: res.class1,
      class2Changed: res.class2.changed.map((c) => ({ path: c.path, diffs: c.diffs.length })),
      class2Missing: res.class2.missing,
      class2Added: res.class2.added,
    },
    null,
    2
  );
  assert.ok(res.ok, "Arabic preservation baseline mismatch:\n" + detail);
});

test("guard detects a removed diacritic mark", () => {
  const base = cpStr([0x0628, 0x0650, 0x0633, 0x0652, 0x0645, 0x0650]);
  const mutated = cpStr([0x0628, 0x0650, 0x0633, 0x0652, 0x0645]);
  const diffs = diffRuns(extractRuns(mutated), extractRuns(base));
  assert.ok(diffs.length > 0, "expected a diacritic change to be detected");
});

test("guard detects a canonical-equivalence-only change (no normalization)", () => {
  const base = cpStr([0x0623]);
  const canonicalOnly = cpStr([0x0627, 0x0654]);
  const diffs = diffRuns(extractRuns(canonicalOnly), extractRuns(base));
  assert.ok(diffs.length > 0, "expected canonical-equivalence change to be detected");
});

test("guard detects an added Arabic run", () => {
  const base = cpStr([0x0633, 0x0648, 0x0631, 0x0629]);
  const withExtra = cpStr([
    0x0633, 0x0648, 0x0631, 0x0629,
    0x0020,
    0x0627, 0x0644, 0x0646, 0x0627, 0x0633,
  ]);
  const diffs = diffRuns(extractRuns(withExtra), extractRuns(base));
  assert.ok(diffs.length > 0, "expected an added run to be detected");
});

test("identical Arabic content yields no differences", () => {
  const text = cpStr([0x0633, 0x0648, 0x0631, 0x0629, 0x0020, 0x0627, 0x0644, 0x0646, 0x0627, 0x0633]);
  const diffs = diffRuns(extractRuns(text), extractRuns(text));
  assert.strictEqual(diffs.length, 0);
});

test("guard run leaves inspected repository files byte-identical", { skip: PARTIAL_REASON }, () => {
  const samples = ["public/words.json", "public/index.html", "functions/index.js"];
  const before = samples.map((rel) => {
    const abs = path.join(baselineMod.ROOT, rel);
    const st = fs.statSync(abs);
    return { rel, size: st.size, mtimeMs: st.mtimeMs, sha256: sha256(fs.readFileSync(abs)) };
  });

  const baseline = loadBaseline();
  compareBaseline(baseline);

  const after = samples.map((rel) => {
    const abs = path.join(baselineMod.ROOT, rel);
    const st = fs.statSync(abs);
    return { rel, size: st.size, mtimeMs: st.mtimeMs, sha256: sha256(fs.readFileSync(abs)) };
  });

  for (let i = 0; i < before.length; i++) {
    assert.strictEqual(after[i].sha256, before[i].sha256, "content changed: " + before[i].rel);
    assert.strictEqual(after[i].size, before[i].size, "size changed: " + before[i].rel);
    assert.strictEqual(after[i].mtimeMs, before[i].mtimeMs, "mtime changed: " + before[i].rel);
  }
});
