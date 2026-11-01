"use strict";
/*
 * history-logic.test.js - the version history's pure logic (public/admin/history-logic.js): what changed between two
 * versions, a save's one-line summary, and the Arabic time labels. No browser and no emulator. ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const H = require("../public/admin/history-logic.js");
const WM = require("../public/admin/word-merge.js");

const SURA = "سورة ";
const NAME = (e) => e.surah.replace(/^سورة\s*/, "");
const seg = (t) => [{ num: 1, before: "", hl: t, after: "" }];
const surah = (name, no, words) => ({
  surah: SURA + name, no, source: "s",
  words: words.map((w) => w[0]), meanings: words.map((w) => w[1]),
  ayahs: words.map((w) => ({ label: w[2] || "1", segments: seg(w[3] || w[0]) })),
});
const A = "ألف", B = "باء", C = "جيم", D = "دال", E = "هاء";
const NAMES = { x: "النبأ", y: "الناس" };
const base = () => [surah(NAMES.x, 78, [[A, "a"], [B, "b"], [C, "c"]]), surah(NAMES.y, 114, [[D, "d"]])];
const clone = (x) => JSON.parse(JSON.stringify(x));
const q = (w) => "«" + w + "»";
const EDIT_MEANING = "تعديل معنى ", ADD = "إضافة ", DEL = "حذف ", SEP = " · ";

test("the fields and the identity are the merge's", () => {
  assert.deepStrictEqual(WM.FIELDS, ["surah", "word", "meaning", "label", "segments"]);
  const next = clone(base());
  next[0].words[1] = E; // renamed: its meaning and its ayah are unchanged, so it is the same word
  const d = H.diff(base(), next, NAME);
  assert.strictEqual(d.words.length, 1);
  assert.strictEqual(d.words[0].type, "edit");
  assert.deepStrictEqual(d.words[0].fields, [{ field: "word", before: B, after: E }]);
});

test("no change: nothing to report", () => {
  assert.deepStrictEqual(H.diff(base(), base(), NAME), { surahs: [], words: [] });
});

test("an edited meaning, a label and the ayah text are each reported by field, byte for byte", () => {
  const next = clone(base());
  next[0].meanings[0] = "new";
  next[0].ayahs[1].label = "2";
  next[0].ayahs[2].segments = seg(C + "ْ"); // one added mark is a change: Quran text is never normalized
  const d = H.diff(base(), next, NAME);
  assert.deepStrictEqual(d.words.map((w) => [w.word, w.fields.map((f) => f.field)]), [[A, ["meaning"]], [B, ["label"]], [C, ["segments"]]]);
  assert.deepStrictEqual(d.words[0].fields[0], { field: "meaning", before: "a", after: "new" });
});

test("added and deleted words show their meaning and ayah, on their one side only", () => {
  const next = clone(base());
  next[1].words.push(E); next[1].meanings.push("e"); next[1].ayahs.push({ label: "4", segments: seg(E) });
  next[0].words.splice(2, 1); next[0].meanings.splice(2, 1); next[0].ayahs.splice(2, 1);
  const d = H.diff(base(), next, NAME);
  const add = d.words.find((w) => w.type === "add"), del = d.words.find((w) => w.type === "del");
  assert.strictEqual(add.word, E); assert.strictEqual(add.surah, NAMES.y); assert.strictEqual(add.label, "4");
  assert.ok(add.fields.every((f) => "after" in f && !("before" in f)));
  assert.strictEqual(del.word, C);
  assert.ok(del.fields.every((f) => "before" in f && !("after" in f)));
});

test("a word moved to another surah is one change, of its surah", () => {
  const next = clone(base());
  const [w, m, a] = [next[0].words.splice(0, 1)[0], next[0].meanings.splice(0, 1)[0], next[0].ayahs.splice(0, 1)[0]];
  next[1].words.push(w); next[1].meanings.push(m); next[1].ayahs.push(a);
  const d = H.diff(base(), next, NAME);
  assert.strictEqual(d.words.length, 1);
  assert.deepStrictEqual(d.words[0].fields, [{ field: "surah", before: NAMES.x, after: NAMES.y }]);
});

test("a surah's name, number and source are reported on the surah, not on each of its words", () => {
  const next = clone(base());
  next[0].surah = SURA + "جديد"; next[0].source = "other";
  const d = H.diff(base(), next, NAME);
  assert.deepStrictEqual(d.words, [], "a renamed surah's words have not changed");
  assert.deepStrictEqual(d.surahs[0].fields.map((f) => f.field), ["name", "source"]);
  const renum = clone(base()); renum[1].no = 113;
  assert.deepStrictEqual(H.diff(base(), renum, NAME).surahs[0].fields, [{ field: "no", before: 114, after: 113 }]);
});

test("an empty surah added or deleted is reported; a deleted surah with words is reported by its words", () => {
  const added = clone(base()); added.push(surah(E, 100, []));
  assert.deepStrictEqual(H.diff(base(), added, NAME).surahs, [{ type: "add", name: E, fields: [] }]);
  assert.deepStrictEqual(H.diff(added, base(), NAME).surahs, [{ type: "del", name: E, fields: [] }]);
  const d = H.diff(base(), base().slice(0, 1), NAME);
  assert.deepStrictEqual(d.surahs, []);
  assert.deepStrictEqual(d.words.map((w) => [w.type, w.word]), [["del", D]]);
});

test("two words with the same text in one surah pair up one to one", () => {
  const two = [surah(NAMES.x, 78, [[A, "a"], [A, "a2"]])];
  assert.deepStrictEqual(H.diff(two, clone(two), NAME), { surahs: [], words: [] });
});

test("a version with missing lists is read without throwing", () => {
  const odd = [{ surah: SURA + NAMES.x, no: 78 }];
  assert.deepStrictEqual(H.diff(odd, odd, NAME), { surahs: [], words: [] });
  assert.strictEqual(H.diff(odd, base(), NAME).words.length, 4);
});

test("diff and summary never change their arguments", () => {
  const a = base(), b = clone(a); b[0].meanings[0] = "new";
  const a0 = JSON.stringify(a), b0 = JSON.stringify(b);
  H.diff(a, b, NAME); H.summary("edit", a, b, { nameOf: NAME });
  assert.strictEqual(JSON.stringify(a), a0); assert.strictEqual(JSON.stringify(b), b0);
});

test("summary: the formats", () => {
  const edited = clone(base()); edited[0].meanings[0] = "new";
  assert.strictEqual(H.summary("edit", base(), edited, { nameOf: NAME }), EDIT_MEANING + q(A));
  const added = clone(base()); added[1].words.push(E); added[1].meanings.push("e"); added[1].ayahs.push({ label: "1", segments: seg(E) });
  assert.strictEqual(H.summary("edit", base(), added, { nameOf: NAME }), ADD + q(E));
  const deleted = clone(base()); deleted[1].words = []; deleted[1].meanings = []; deleted[1].ayahs = [];
  assert.strictEqual(H.summary("edit", base(), deleted, { nameOf: NAME }), DEL + q(D));
  assert.strictEqual(H.summary("import", base(), base()), "استيراد من ملف" + SEP + "2 سورة، 4 كلمة");
  assert.strictEqual(H.summary("restore", base(), base(), { restoredFrom: 41 }), "استرجاع النسخة 41");
});

test("summary: at most two items, then the count of the others, in the app's number agreement", () => {
  const many = (n) => {
    const words = Array.from({ length: n }, (_, i) => [A + i, "m" + i]), a = [surah(NAMES.x, 78, words)], b = clone(a);
    b[0].meanings = b[0].meanings.map((m) => m + "!");
    return H.summary("edit", a, b, { nameOf: NAME });
  };
  const two = EDIT_MEANING + q(A + 0) + SEP + EDIT_MEANING + q(A + 1);
  assert.strictEqual(many(2), two);
  assert.strictEqual(many(3), two + SEP + "وتعديل آخر");
  assert.strictEqual(many(4), two + SEP + "وتعديلان آخران");
  assert.strictEqual(many(7), two + SEP + "و 5 تعديلات أخرى");
  assert.strictEqual(many(20), two + SEP + "و 18 تعديلًا آخر");
});

test("summary: never over 300 characters and never cuts a word", () => {
  const long = "ب".repeat(200), a = [surah(NAMES.x, 78, [[long, "a"], [long + "2", "b"]])], b = clone(a);
  b[0].meanings = ["x", "y"];
  const one = H.summary("edit", a, b, { nameOf: NAME });
  assert.ok(one.length <= H.MAX_SUMMARY);
  assert.ok(one.includes(long), "one word still fits");
  const huge = "ب".repeat(400), c = [surah(NAMES.x, 78, [[huge, "a"]])], e = clone(c);
  e[0].meanings = ["x"];
  const s = H.summary("edit", c, e, { nameOf: NAME });
  assert.ok(s.length <= H.MAX_SUMMARY);
  assert.ok(!s.includes("بب"), "no part of the word");
});

test("summary: a save with no change still has a row's text", () => {
  const s = H.summary("edit", base(), base(), { nameOf: NAME });
  assert.ok(s.length > 0 && s.length <= H.MAX_SUMMARY);
});

test("time: the date with Western digits, in twelve hours", () => {
  // 31 October 2026 is a Saturday
  assert.strictEqual(H.absTime(new Date(2026, 9, 31, 21, 12)), "السبت 31 أكتوبر، 9:12 م");
  assert.strictEqual(H.absTime(new Date(2026, 9, 30, 9, 4)), "الجمعة 30 أكتوبر، 9:04 ص");
  assert.ok(H.absTime(new Date(2026, 0, 1, 0, 0)).includes("12:00 ص"), "midnight");
  assert.ok(H.absTime(new Date(2026, 0, 1, 12, 0)).includes("12:00 م"), "noon");
  assert.ok(!/[٠-٩۰-۹]/.test(H.absTime(new Date(2026, 9, 31, 21, 12))));
});

test("time: relative under 24 hours, then the date alone", () => {
  const now = new Date(2026, 9, 31, 21, 17), at = (min) => new Date(now.getTime() - min * 60000), abs = (d) => H.absTime(d);
  const ago = (min) => H.rowTime(at(min), now).split(SEP)[0];
  assert.strictEqual(H.rowTime(at(5), now), "منذ 5 دقائق" + SEP + abs(at(5)));
  assert.strictEqual(ago(0), "منذ لحظات");
  assert.strictEqual(ago(1), "منذ دقيقة");
  assert.strictEqual(ago(2), "منذ دقيقتين");
  assert.strictEqual(ago(30), "منذ 30 دقيقة");
  assert.strictEqual(ago(60), "منذ ساعة");
  assert.strictEqual(ago(120), "منذ ساعتين");
  assert.strictEqual(ago(300), "منذ 5 ساعات");
  assert.strictEqual(ago(23 * 60), "منذ 23 ساعة");
  assert.strictEqual(H.rowTime(at(24 * 60), now), abs(at(24 * 60)));
  const later = new Date(now.getTime() + 60000); // a clock behind the server's: the date, never a negative time
  assert.strictEqual(H.rowTime(later, now), abs(later));
});

// ---- map key order: every read of the same version may return its map keys in another order

const fsx = require("fs"), pathx = require("path");
const REAL = JSON.parse(fsx.readFileSync(pathx.resolve(__dirname, "..", "public", "words.json"), "utf8"));
function reorder(v, n) {
  if (Array.isArray(v)) return v.map((x, i) => reorder(x, n + i + 1));
  if (!v || typeof v !== "object") return v;
  const keys = Object.keys(v), r = n % keys.length, o = {};
  keys.slice(r).concat(keys.slice(0, r)).reverse().forEach((k, i) => { o[k] = reorder(v[k], n + i + 1); });
  return o;
}
const NO_CHANGE = H.summary("edit", [], []);

test("key order: the real words against their own permuted reads have no changes", () => {
  for (let n = 0; n < 12; n++) {
    const d = H.diff(reorder(REAL, n), reorder(REAL, n + 5));
    assert.strictEqual(d.words.length + d.surahs.length, 0, "permutation " + n);
    assert.strictEqual(H.summary("edit", reorder(REAL, n), reorder(REAL, n + 5)), NO_CHANGE);
  }
});

test("key order: one real change among permuted reads is listed, and only that", () => {
  const si = REAL.findIndex((s) => s.words.length), next = JSON.parse(JSON.stringify(REAL));
  next[si].meanings[0] += " x";
  const d = H.diff(reorder(REAL, 1), reorder(next, 4));
  assert.strictEqual(d.surahs.length, 0);
  assert.strictEqual(d.words.length, 1);
  assert.deepStrictEqual(d.words[0].fields.map((f) => f.field), ["meaning"]);
  const seg = JSON.parse(JSON.stringify(REAL));
  seg[si].ayahs[0].segments[0].before += " x";
  const e = H.diff(reorder(REAL, 2), reorder(seg, 7));
  assert.strictEqual(e.words.length, 1);
  assert.deepStrictEqual(e.words[0].fields.map((f) => f.field), ["segments"]);
});

test("key order: a moved word is found by a permuted read of its meaning or ayah, and a deleted word stays deleted", () => {
  const si = REAL.findIndex((s) => s.words.length >= 2), next = JSON.parse(JSON.stringify(REAL));
  next[si].words[0] += " x";
  const d = H.diff(reorder(REAL, 3), reorder(next, 6));
  assert.strictEqual(d.words.length, 1);
  assert.strictEqual(d.words[0].type, "edit");
  assert.deepStrictEqual(d.words[0].fields.map((f) => f.field), ["word"]);
  const del = JSON.parse(JSON.stringify(REAL));
  del[si].words.splice(1, 1); del[si].meanings.splice(1, 1); del[si].ayahs.splice(1, 1);
  const e = H.diff(reorder(REAL, 4), reorder(del, 9));
  assert.deepStrictEqual(e.words.map((w) => w.type), ["del"]);
});
