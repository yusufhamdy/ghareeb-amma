"use strict";
/*
 * quran-text.test.js - the site's ayah text against the official Hafs text (data/quran, the King Fahd Complex's
 * file, committed unmodified).
 *
 *   - the official file is the downloaded one (hash) and holds 114 surahs and 6236 ayat;
 *   - in public/words.json and in the static word pages built from it, every segment's before + hl + after is one
 *     contiguous piece of its official ayah and the segment's num is that ayah's number (public/admin/ayah-check.js,
 *     the rule the admin applies before a save), byte for byte, with no Unicode normalization;
 *   - the 2026-10-28 rewrite to the official bytes changed only segment fields, each to a canonically equivalent
 *     value (test/fixtures/ayat-bytes-2026-10-28.json), and putting the old values back gives that file byte for byte;
 *   - the 2026-10-27 corrections changed only the listed fields: putting the old values back (after the 2026-10-28
 *     ones) gives the old file byte for byte (test/fixtures/ayat-fix-2026-10-27.json), and each corrected field is what
 *     data/quran/fix.js rebuilds from the official text;
 *   - the admin's copy (public/admin/quran-hafs.json) is exactly what scripts/build-quran-ref.mjs writes, and only
 *     the admin refers to it.
 *
 * ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const quran = require("../data/quran/index.js");
const AyahCheck = require("../public/admin/ayah-check.js");
const { fixSegment } = require("../data/quran/fix.js");
const QText = require("../public/qtext.js");

const OFFICIAL_SHA256 = "d2960b3217962e7e4252abdcece67bea3d6b48271e4cd3af45bbbb2dd5c872ca";
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
const WORDS_RAW = fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8");
const WORDS = JSON.parse(WORDS_RAW);

test("the official text: unmodified file, 114 surahs, 6236 ayat", () => {
  assert.strictEqual(sha(fs.readFileSync(quran.FILE)), OFFICIAL_SHA256, "data/quran/hafsData_v2-0.json is the downloaded file");
  let n = 0;
  for (let s = 1; s <= 114; s++) { assert.ok(quran.ayahCount(s) > 0, "surah " + s); n += quran.ayahCount(s); }
  assert.strictEqual(n, 6236);
  assert.strictEqual(quran.ayahCount(115), 0);
  assert.strictEqual(quran.ayahCount(1), 7);
  assert.strictEqual(quran.ayahCount(2), 286);
  assert.strictEqual(quran.ayahCount(114), 6);
  for (let s = 1; s <= 114; s++) for (let a = 1; a <= quran.ayahCount(s); a++) {
    const t = quran.ayah(s, a);
    assert.ok(!/[\ufb50-\ufdff\ufe70-\ufeff]/.test(t) && t === t.trim(), "ayah " + s + ":" + a + " has no ayah-number glyph");
    // the only no-break spaces kept are the file's own, after the hizb mark
    assert.ok(!/[^\u06de]\u00a0|^\u00a0/.test(t), "ayah " + s + ":" + a + ": a no-break space only after U+06DE");
  }
  // byte for byte the file's aya_text, less the trailing space and ayah-number glyph
  const rows = JSON.parse(fs.readFileSync(quran.FILE, "utf8"));
  for (const r of rows) assert.ok(r.aya_text.trim().startsWith(quran.ayah(r.sura_no, r.aya_no)) && /^[ \u00a0]*[\ufb50-\ufdff\ufe70-\ufeff]$/.test(r.aya_text.trim().slice(quran.ayah(r.sura_no, r.aya_no).length)), r.sura_no + ":" + r.aya_no + " is the official bytes");
});

test("every segment in words.json is a contiguous piece of its official ayah", () => {
  let n = 0;
  const bad = [];
  WORDS.forEach((e) => {
    const no = quran.surahNumber(e.surah);
    assert.ok(no >= 78 && no <= 114, "surah resolves: " + JSON.stringify(e.surah));
    (e.ayahs || []).forEach((a, ai) => (a.segments || []).forEach((g, gi) => {
      n++;
      AyahCheck.check([g], no, quran.ayah).forEach((p) => bad.push(no + ":" + g.num + " (" + p.why + ", word " + ai + ", segment " + gi + ")"));
    }));
  });
  assert.deepStrictEqual(bad, [], "segments that fail");
  assert.strictEqual(n, 74, "all 74 segments checked");
});

test("the rule: byte for byte; NFC or NFD text, a wrong number or an extra mark fails", () => {
  const ref = quran.ayah(114, 4);
  const words = ref.split(" ");
  const ok = { num: 4, before: words.slice(0, 2).join(" ") + " ", hl: words.slice(2).join(" "), after: "" };
  assert.deepStrictEqual(AyahCheck.check([ok], 114, quran.ayah), []);
  // canonically equivalent but other bytes is an error: Safari draws them differently
  assert.notStrictEqual(ok.hl.normalize("NFD"), ok.hl, "the test piece has marks NFD reorders");
  assert.deepStrictEqual(AyahCheck.check([Object.assign({}, ok, { hl: ok.hl.normalize("NFD") })], 114, quran.ayah).map((p) => p.why), ["text"]);
  // 81:15 with alef + maddah composed into U+0622 (what NFC stored)
  const f = quran.ayah(81, 15), w0 = f.split(" ")[0];
  assert.ok(w0.includes("\u0627\u0653") && w0.normalize("NFC").includes("\u0622"), "81:15 starts with alef + maddah");
  assert.deepStrictEqual(AyahCheck.check([{ num: 15, before: "", hl: w0, after: "" }], 81, quran.ayah), []);
  assert.deepStrictEqual(AyahCheck.check([{ num: 15, before: "", hl: w0.normalize("NFC"), after: "" }], 81, quran.ayah).map((p) => p.why), ["text"]);
  assert.deepStrictEqual(AyahCheck.check([Object.assign({}, ok, { num: 5 })], 114, quran.ayah).map((p) => p.why), ["text"]);
  assert.deepStrictEqual(AyahCheck.check([Object.assign({}, ok, { num: 7 })], 114, quran.ayah).map((p) => p.why), ["num"]);
  assert.deepStrictEqual(AyahCheck.check([Object.assign({}, ok, { hl: ok.hl + "\u0640" })], 114, quran.ayah).map((p) => p.why), ["text"]);
  // the admin's table form gives the same answers
  const table = JSON.parse(fs.readFileSync(path.join(PUBLIC, "admin", "quran-hafs.json"), "utf8"));
  assert.deepStrictEqual(AyahCheck.check([ok, Object.assign({}, ok, { num: 5 })], 114, AyahCheck.fromTable(table)).map((p) => p.i), [1]);
});

test("the static word pages show the same segments, and they pass", async () => {
  const { buildRecords } = await import("../scripts/publish-build.mjs");
  const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  let pages = 0;
  for (const r of buildRecords(WORDS)) {
    const html = fs.readFileSync(path.join(PUBLIC, "word", r.slug + ".html"), "utf8");
    const ay = ((html.match(/<div class="ay q">([\s\S]*?)<\/div>/) || [])[1] || "").replace(/<span class="nb">|<\/span>/g, ""); // no-break wrappers (K) are layout only
    assert.ok(ay != null, r.slug + ": has the ayah block");
    const shown = [...ay.matchAll(/\ufd3f([\s\S]*?)<mark>([\s\S]*?)<\/mark>([\s\S]*?)\ufd3e/g)].map((m) => ({ before: unesc(m[1]), hl: unesc(m[2]), after: unesc(m[3]) }));
    const segs = r.ayah.segments;
    assert.strictEqual(shown.length, segs.length, r.slug + ": segment count");
    shown.forEach((g, i) => {
      // the page shows the mark widened to whole written words (qtext.js markParts); the text is the data
      const k = QText.markParts(segs[i]);
      assert.deepStrictEqual(g, { before: k.pre, hl: k.mark, after: k.post }, r.slug + ": segment " + i + " is the data");
      assert.deepStrictEqual(AyahCheck.check([Object.assign({ num: segs[i].num }, g)], r.no, quran.ayah), [], r.slug + ": segment " + i + " passes");
    });
    pages++;
  }
  assert.strictEqual(pages, 73);
});

const BYTES = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "ayat-bytes-2026-10-28.json"), "utf8"));
// words.json as it was before the 2026-10-28 rewrite to the official bytes
function beforeBytes() {
  const old = JSON.parse(WORDS_RAW);
  for (const f of BYTES.fields) old[f.si].ayahs[f.ai].segments[f.gi][f.field] = f.from;
  return old;
}

test("the rewrite to the official bytes changed only segment fields, each to the same text in other bytes", () => {
  assert.ok(BYTES.fields.length > 0);
  for (const f of BYTES.fields) {
    const e = WORDS[f.si], g = e.ayahs[f.ai].segments[f.gi];
    assert.strictEqual(quran.surahNumber(e.surah), f.surah);
    assert.strictEqual(g.num, f.num);
    assert.ok(["before", "hl", "after"].includes(f.field));
    assert.notStrictEqual(g[f.field], f.from, f.surah + ":" + f.num + " " + f.field + " changed");
    assert.strictEqual(g[f.field].normalize("NFC"), f.from.normalize("NFC"), f.surah + ":" + f.num + " " + f.field + " is the same text");
  }
  assert.strictEqual(sha(JSON.stringify(beforeBytes(), null, 2)), BYTES.beforeSha256, "with the old values back, words.json is byte-identical to the file before the rewrite");
  // no composed alef + maddah left anywhere in the ayah text
  const all = WORDS.map((e) => e.ayahs.map((a) => a.segments.map((g) => g.before + g.hl + g.after).join("")).join("")).join("");
  assert.ok(!all.includes("\u0622"), "no U+0622 in the ayah text");
});

test("the ayah corrections changed only the listed fields, to the official text", () => {
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "ayat-fix-2026-10-27.json"), "utf8"));
  const old = beforeBytes();
  for (const f of fx.fields) {
    const e = WORDS[f.si], g = e.ayahs[f.ai].segments[f.gi];
    assert.strictEqual(quran.surahNumber(e.surah), f.surah, "fixture entry points at surah " + f.surah);
    assert.strictEqual(g.num, f.num);
    assert.notStrictEqual(g[f.field], f.from, f.surah + ":" + f.num + " " + f.field + " was corrected");
    // the corrected value is what fix.js rebuilds from the official text for the old segment
    const oldSeg = Object.assign({}, g);
    fx.fields.filter((h) => h.si === f.si && h.ai === f.ai && h.gi === f.gi).forEach((h) => { oldSeg[h.field] = h.from; });
    const r = fixSegment(oldSeg, f.surah);
    assert.ok(!r.error, r.error);
    assert.strictEqual(g[f.field], r.seg[f.field], f.surah + ":" + f.num + " " + f.field + " is the official text");
    old[f.si].ayahs[f.ai].segments[f.gi][f.field] = f.from;
  }
  assert.strictEqual(sha(JSON.stringify(old, null, 2)), fx.originalSha256, "with the old values back, words.json is byte-identical to the file before the fix");
});

test("the admin's reference copy is current, and the public site never loads it", async () => {
  const { buildRef } = await import("../scripts/build-quran-ref.mjs");
  const file = fs.readFileSync(path.join(PUBLIC, "admin", "quran-hafs.json"), "utf8");
  assert.ok(file === buildRef(), "public/admin/quran-hafs.json is what scripts/build-quran-ref.mjs writes (run it)");
  const refs = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((x) => {
    const p = path.join(d, x.name);
    if (x.isDirectory()) return walk(p);
    if (/\.(html|js|json|css|webmanifest)$/.test(x.name) && !p.endsWith("quran-hafs.json") && fs.readFileSync(p, "utf8").includes("quran-hafs.json")) refs.push(path.relative(PUBLIC, p).split(path.sep).join("/"));
  });
  walk(PUBLIC);
  assert.deepStrictEqual(refs.sort(), ["admin/ayah-check.js", "admin/index.html"], "only the admin refers to the reference text");
});
