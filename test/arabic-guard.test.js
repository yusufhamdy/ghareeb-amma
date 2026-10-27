/*
 * arabic-guard.test.js - the Arabic/Quranic content preservation guard (scripts/arabic-baseline.js).
 *
 * Compares the committed data, field by field, with the committed baseline fixture. It never skips: a missing
 * fixture, a missing protected file or a missing git fails the test. The synthetic cases prove the guard notices a
 * removed diacritic, a canonical-equivalence-only change and an added run, and that reading the data changes
 * nothing on disk.
 *
 * ASCII only (the synthetic strings are built from code points).
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const B = require("../scripts/arabic-baseline.js");

const cpStr = (cps) => cps.map((c) => String.fromCodePoint(c)).join("");

test("protected Arabic content matches the baseline (never skipped)", () => {
  assert.ok(fs.existsSync(B.BASELINE_PATH), "the baseline fixture is missing: " + B.BASELINE_PATH);
  const res = B.compareBaseline(JSON.parse(fs.readFileSync(B.BASELINE_PATH, "utf8")));
  assert.ok(res.ok, "Arabic preservation baseline mismatch:\n" + JSON.stringify(res, null, 1));
});

test("the guard covers every field of words.json and challenge.json", () => {
  const c = B.collect();
  const words = Object.keys(c.fields["public/words.json"]);
  for (const k of ["surah", "words", "meanings", "source", "label", "num", "before", "hl", "after"]) {
    assert.ok(words.some((p) => p.includes("." + k)), "words.json fields include " + k);
  }
  assert.ok(Object.keys(c.fields["public/challenge.json"]).length > 30, "challenge.json is covered");
});

test("a changed field is reported by its path", () => {
  const W = JSON.parse(fs.readFileSync(path.join(B.ROOT, "public", "words.json"), "utf8"));
  const a = B.leaves(W, "", {});
  W[0].ayahs[0].segments[0].hl = W[0].ayahs[0].segments[0].hl.normalize("NFD") + "ـ";
  const b = B.leaves(W, "", {});
  const changed = Object.keys(a).filter((k) => a[k] !== b[k]);
  assert.deepStrictEqual(changed, ["[0].ayahs[0].segments[0].hl"]);
});

test("guard detects a removed diacritic mark", () => {
  const diffs = B.diffRuns(B.extractRuns(cpStr([0x0628, 0x0650, 0x0633, 0x0652, 0x0645])), B.extractRuns(cpStr([0x0628, 0x0650, 0x0633, 0x0652, 0x0645, 0x0650])));
  assert.ok(diffs.length > 0);
});

test("guard detects a canonical-equivalence-only change (no normalization)", () => {
  assert.ok(B.diffRuns(B.extractRuns(cpStr([0x0627, 0x0654])), B.extractRuns(cpStr([0x0623]))).length > 0);
  assert.notStrictEqual(B.sha256(Buffer.from(cpStr([0x0627, 0x0654]))), B.sha256(Buffer.from(cpStr([0x0623]))));
});

test("guard detects an added Arabic run", () => {
  const base = cpStr([0x0633, 0x0648, 0x0631, 0x0629]);
  assert.ok(B.diffRuns(B.extractRuns(base + " " + cpStr([0x0627, 0x0644, 0x0646, 0x0627, 0x0633])), B.extractRuns(base)).length > 0);
});

test("identical Arabic content yields no differences", () => {
  const text = cpStr([0x0633, 0x0648, 0x0631, 0x0629, 0x0020, 0x0627, 0x0644, 0x0646, 0x0627, 0x0633]);
  assert.strictEqual(B.diffRuns(B.extractRuns(text), B.extractRuns(text)).length, 0);
});

test("guard run leaves inspected repository files byte-identical", () => {
  const files = B.FIELD_FILES.concat(B.HASH_FILES);
  const snap = () => files.map((rel) => { const abs = path.join(B.ROOT, rel), st = fs.statSync(abs); return [rel, st.size, st.mtimeMs, B.sha256(fs.readFileSync(abs))].join("|"); });
  const before = snap();
  B.compareBaseline(JSON.parse(fs.readFileSync(B.BASELINE_PATH, "utf8")));
  assert.deepStrictEqual(snap(), before);
});
