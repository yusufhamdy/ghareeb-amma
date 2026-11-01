"use strict";
/*
 * word-merge.test.js - the three-way merge rules of the admin's word editor (public/admin/word-merge.js).
 * ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const WM = require(path.resolve(__dirname, "..", "public", "admin", "word-merge.js"));

const seg = (t) => [{ num: 3, before: "a ", hl: t, after: "" }];
const BASE = { surah: "S1", word: "w0", meaning: "m0", label: "3", segments: seg("t0") };
const word = (over) => Object.assign({}, JSON.parse(JSON.stringify(BASE)), over);

test("mine == base takes theirs, for every field", () => {
  const theirs = word({ surah: "S2", word: "w1", meaning: "m1", label: "4", segments: seg("t1") });
  const r = WM.merge(BASE, word(), theirs);
  assert.deepStrictEqual(r.conflicts, []);
  assert.deepStrictEqual(r.merged, theirs);
});

test("theirs == base takes mine, for every field", () => {
  const mine = word({ surah: "S2", word: "w1", meaning: "m1", label: "4", segments: seg("t1") });
  const r = WM.merge(BASE, mine, word());
  assert.deepStrictEqual(r.conflicts, []);
  assert.deepStrictEqual(r.merged, mine);
});

test("both changed to the same value takes it, with no conflict", () => {
  const both = { meaning: "m9", segments: seg("t9") };
  const r = WM.merge(BASE, word(both), word(both));
  assert.deepStrictEqual(r.conflicts, []);
  assert.strictEqual(r.merged.meaning, "m9");
  assert.deepStrictEqual(r.merged.segments, seg("t9"));
});

test("both changed differently is a real conflict, field by field; the others still merge", () => {
  const mine = word({ meaning: "mine", label: "4" });
  const theirs = word({ meaning: "theirs", segments: seg("newer") });
  const r = WM.merge(BASE, mine, theirs);
  assert.deepStrictEqual(r.conflicts, [{ field: "meaning", mine: "mine", theirs: "theirs" }]);
  assert.strictEqual(r.merged.label, "4", "my other edit is kept");
  assert.deepStrictEqual(r.merged.segments, seg("newer"), "the field I did not touch keeps the newer value");
  assert.ok(!("meaning" in r.merged));
});

test("today's case: only the meaning edited, the ayah text and everything else stay the newer version", () => {
  const theirs = word({ word: "w-new", label: "9", segments: seg("official bytes") });
  const r = WM.merge(BASE, word({ meaning: "edited" }), theirs);
  assert.deepStrictEqual(r.conflicts, []);
  assert.deepStrictEqual(r.merged, word({ word: "w-new", label: "9", segments: seg("official bytes"), meaning: "edited" }));
});

test("comparison is byte for byte: an encoding-only difference counts as a change", () => {
  const fa = "\u0650\u0651", af = "\u0651\u0650";
  const r = WM.merge(word({ word: fa }), word({ word: fa }), word({ word: af }));
  assert.strictEqual(r.merged.word, af);
  const c = WM.merge(word({ word: "x" }), word({ word: fa }), word({ word: af }));
  assert.strictEqual(c.conflicts.length, 1, "NFC-equal but different bytes is still a conflict");
});

test("a choice resolves a conflict only against the 'theirs' it was made for", () => {
  const mine = word({ meaning: "mine" }), theirs = word({ meaning: "theirs" });
  const pick = (v) => ({ meaning: { theirs: "theirs", value: v } });
  assert.strictEqual(WM.merge(BASE, mine, theirs, pick("mine")).merged.meaning, "mine");
  assert.strictEqual(WM.merge(BASE, mine, theirs, pick("theirs")).merged.meaning, "theirs");
  const again = WM.merge(BASE, mine, word({ meaning: "even newer" }), pick("mine"));
  assert.deepStrictEqual(again.conflicts, [{ field: "meaning", mine: "mine", theirs: "even newer" }]);
});

test("missing values compare equal (a word with no stored ayah)", () => {
  const b = word({ label: undefined, segments: undefined });
  const r = WM.merge(b, word({ label: undefined, segments: seg("t") }), word({ label: undefined, segments: null }));
  assert.deepStrictEqual(r.conflicts, []);
  assert.deepStrictEqual(r.merged.segments, seg("t"));
});

test("merge changes none of its arguments", () => {
  const b = word(), m = word({ meaning: "x" }), t = word({ segments: seg("y") });
  const snap = JSON.stringify([b, m, t]);
  WM.merge(b, m, t, {});
  assert.strictEqual(JSON.stringify([b, m, t]), snap);
});

const nameOf = (e) => e.surah;
const entry = (surah, words) => ({ surah, words: words.map((w) => w[0]), meanings: words.map((w) => w[1]), ayahs: words.map((w) => ({ label: "3", segments: seg(w[2]) })) });

test("locate: same text in its surah, moved to another surah, renamed", () => {
  const same = [entry("S0", [["z", "mz", "tz"]]), entry("S1", [["q", "mq", "tq"], ["w0", "changed", "changed"]])];
  assert.deepStrictEqual(WM.locate(same, BASE, nameOf), { si: 1, wi: 1 });
  const moved = [entry("S1", [["q", "mq", "tq"]]), entry("S2", [["w0", "m0", "changed"]])];
  assert.deepStrictEqual(WM.locate(moved, BASE, nameOf), { si: 1, wi: 0 });
  const renamed = [entry("S1", [["q", "mq", "tq"], ["w-new", "m0", "changed"]])];
  assert.deepStrictEqual(WM.locate(renamed, BASE, nameOf), { si: 0, wi: 1 });
  const renamedKeepsAyah = [entry("S1", [["w-new", "changed", "t0"]])];
  assert.deepStrictEqual(WM.locate(renamedKeepsAyah, BASE, nameOf), { si: 0, wi: 0 });
});

test("locate: null when deleted or ambiguous, never a guess", () => {
  assert.strictEqual(WM.locate([entry("S1", [["q", "mq", "tq"]])], BASE, nameOf), null, "deleted");
  const two = [entry("S1", [["a", "m0", "x"], ["b", "m0", "y"]])];
  assert.strictEqual(WM.locate(two, BASE, nameOf), null, "two entries could be it");
  const moved2 = [entry("S2", [["w0", "m0", "x"]]), entry("S3", [["w0", "m0", "y"]])];
  assert.strictEqual(WM.locate(moved2, BASE, nameOf), null, "moved to two surahs");
});

// ---- map key order: Firestore does not keep it, and on production it differs from one read to the next

const permute = (v, n) => {
  if (Array.isArray(v)) return v.map((x, i) => permute(x, n + i + 1));
  if (!v || typeof v !== "object") return v;
  const keys = Object.keys(v), r = n % keys.length, o = {};
  keys.slice(r).concat(keys.slice(0, r)).reverse().forEach((k, i) => { o[k] = permute(v[k], n + i + 1); });
  return o;
};
const nested = { a: 1, b: { c: 2, d: { e: 3, f: [{ g: 4, h: { i: 5, j: 6 } }, { k: 7, l: 8 }] } }, m: "x" };

test("same ignores key order at every nesting level", () => {
  assert.ok(WM.same({ a: 1, b: 2 }, { b: 2, a: 1 }), "top level");
  assert.ok(WM.same({ x: { a: 1, b: 2 } }, { x: { b: 2, a: 1 } }), "a map in a map");
  assert.ok(WM.same([{ a: 1, b: 2 }], [{ b: 2, a: 1 }]), "a map in an array");
  assert.ok(WM.same({ x: [{ y: { a: 1, b: 2 } }] }, { x: [{ y: { b: 2, a: 1 } }] }), "a map in an array in a map");
  for (let n = 0; n < 24; n++) assert.ok(WM.same(nested, permute(nested, n)), "permutation " + n);
});

test("same still compares every value exactly", () => {
  assert.ok(!WM.same({ a: 1, b: 2 }, { a: 2, b: 1 }), "values swapped between keys");
  assert.ok(!WM.same([1, 2], [2, 1]), "array order counts");
  assert.ok(!WM.same([{ a: 1 }, { b: 2 }], [{ b: 2 }, { a: 1 }]), "array order counts for maps too");
  assert.ok(!WM.same({ a: 1 }, { a: 1, b: 2 }), "an extra key");
  assert.ok(!WM.same({ a: 1 }, { b: 1 }), "another key");
  assert.ok(!WM.same({ a: 3 }, { a: "3" }), "a number is not its text");
  assert.ok(!WM.same({ a: null }, {}), "null is not a missing key");
  assert.ok(!WM.same("é", "é"), "text is never normalized");
  assert.ok(!WM.same({ a: "x " }, { a: "x" }), "text is never trimmed");
  assert.ok(WM.same(undefined, null), "a missing field is null, as before");
});

test("canon leaves its argument alone, and the key order it was given", () => {
  const v = { b: 1, a: { d: 2, c: 3 } }, before = JSON.stringify(v);
  assert.strictEqual(WM.canon(v), '{"a":{"c":3,"d":2},"b":1}');
  assert.strictEqual(JSON.stringify(v), before);
});

test("canon keeps a key named like Object's prototype", () => {
  const a = JSON.parse('{"__proto__":{"x":1}}'), b = JSON.parse('{"__proto__":{"x":2}}');
  assert.ok(!WM.same(a, b));
});

test("merge: permuted reads of the same word are not a change, for mine, base or theirs", () => {
  const s3 = [{ after: "", hl: "t0", before: "a ", num: 3 }];
  const r = WM.merge(BASE, word(), word({ segments: s3 }));
  assert.deepStrictEqual(r.conflicts, []);
  assert.ok(WM.same(r.merged.segments, BASE.segments));
  // a real edit of mine, against a permuted read of the unchanged field
  const r2 = WM.merge(BASE, word({ meaning: "m1" }), word({ segments: s3 }));
  assert.deepStrictEqual(r2.conflicts, []);
  assert.strictEqual(r2.merged.meaning, "m1");
  // a choice made against one read still applies to another read of the same value
  const mine = word({ segments: seg("mine") }), theirs = word({ segments: seg("theirs") });
  const shuffled = word({ segments: [{ after: "", hl: "theirs", before: "a ", num: 3 }] });
  assert.strictEqual(WM.merge(BASE, mine, theirs).conflicts.length, 1);
  const res = { segments: { theirs: theirs.segments, value: mine.segments } };
  const r3 = WM.merge(BASE, mine, shuffled, res);
  assert.deepStrictEqual(r3.conflicts, []);
  assert.deepStrictEqual(r3.merged.segments, mine.segments);
});

test("a real difference under permuted keys is still a change and still a conflict", () => {
  const s3 = [{ after: "", hl: "t1", before: "a ", num: 3 }];
  const r = WM.merge(BASE, word({ segments: seg("t2") }), word({ segments: s3 }));
  assert.deepStrictEqual(r.conflicts.map((c) => c.field), ["segments"]);
});

test("locate finds a moved word by a permuted read of its ayah", () => {
  const surahs = [{ surah: "S2", words: ["w0"], meanings: ["other"], ayahs: [{ segments: [{ after: "", hl: "t0", before: "a ", num: 3 }], label: "3" }] }];
  assert.deepStrictEqual(WM.locate(surahs, BASE, (e) => e.surah), { si: 0, wi: 0 });
});

test("the admin page compares through canon or same, never through a bare JSON.stringify", () => {
  const fs = require("fs");
  const dir = path.resolve(__dirname, "..", "public", "admin");
  for (const f of ["index.html", "history-logic.js", "challenge-logic.js", "ayah-check.js"]) {
    const src = fs.readFileSync(path.join(dir, f), "utf8");
    assert.ok(!/JSON\.stringify\([^\n]{0,120}?\)\)?\s*[!=]==|[!=]==\s*(String\()?JSON\.stringify/.test(src), f);
  }
});
