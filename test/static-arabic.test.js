// Phase L: the static word/surah pages must carry the data Arabic byte-identical
// (public/words.json is the untouchable source of truth). ASCII-only file: every
// Arabic literal is a \u escape. Runs inside npm test and never skips.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const seo = require("../shared/seo.js");
// The visible headword is the mushaf's spelling taken from the ayah (qtext.js displayWord); the stored word stays in
// the page's data (JSON-LD), titles and URLs.
const QText = require("../public/qtext.js");
const asJsonLd = (s) => s.replace(/[\u0080-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));

const ROOT = path.join(__dirname, "..");
const OPEN_SITE = "\u062a\u0635\u0641\u0651\u062d \u0627\u0644\u0645\u0648\u0642\u0639"; // "browse the site"
const OPEN_APP = "\u0627\u0641\u062a\u062d \u0641\u064a \u0627\u0644\u062a\u0637\u0628\u064a\u0642"; // removed label
const SOURCE_LABEL = "\u0627\u0644\u0645\u0635\u062f\u0631"; // the source line's label (word pages only)
const SURAH_PREFIX_RE = /^\u0633\u0648\u0631\u0629\s*/; // leading "surah "

// Minimal text-node scanner (skips comments, script/style and all tags; the
// pages are generator-written, so tag/attribute quoting is well-formed).
function textNodes(html) {
  const out = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt < 0) { out.push(html.slice(i)); break; }
    if (lt > i) out.push(html.slice(i, lt));
    if (html.startsWith("<!--", lt)) { const e = html.indexOf("-->", lt); i = e < 0 ? html.length : e + 3; continue; }
    const m = /^<(script|style)\b/i.exec(html.slice(lt, lt + 12));
    if (m) {
      const close = html.toLowerCase().indexOf("</" + m[1].toLowerCase(), lt);
      i = close < 0 ? html.length : html.indexOf(">", close) + 1;
      continue;
    }
    const gt = html.indexOf(">", lt);
    i = gt < 0 ? html.length : gt + 1;
  }
  return out.join("");
}

function loadRecords() {
  const surahs = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "words.json"), "utf8"));
  const slugs = seo.buildSlugs(surahs);
  const records = [];
  const surahList = [];
  let si = 0;
  surahs.forEach((s, seq) => {
    const short = String(s.surah).replace(SURAH_PREFIX_RE, "");
    const surahSlug = seo.SURAH_SLUG[short];
    assert.ok(surahSlug, "surah#" + seq + " has a canonical slug");
    const words = Array.isArray(s.words) ? s.words : [];
    const meanings = Array.isArray(s.meanings) ? s.meanings : [];
    const ayahs = Array.isArray(s.ayahs) ? s.ayahs : [];
    const itemWords = [];
    for (let i = 0; i < words.length; i++) {
      const segs = (ayahs[i] && Array.isArray(ayahs[i].segments) ? ayahs[i].segments : []).map((sg) =>
        String(sg.before == null ? "" : sg.before) + String(sg.hl == null ? "" : sg.hl) + String(sg.after == null ? "" : sg.after)
      );
      const rawMeaning = String(meanings[i] == null ? "" : meanings[i]);
      const prefix = String(words[i]) + ":";
      records.push({
        slug: slugs[si++],
        surahSlug,
        word: String(words[i]),
        dw: QText.displayWord(ayahs[i]) || String(words[i]),
        rawMeaning,
        bodyMeaning: rawMeaning.startsWith(prefix) ? rawMeaning.slice(prefix.length).trim() : rawMeaning,
        verseSegments: segs,
        surahShort: short,
        surahFull: String(s.surah),
      });
      itemWords.push(QText.displayWord(ayahs[i]) || String(words[i]));
    }
    surahList.push({ slug: surahSlug, short, full: String(s.surah), words: itemWords });
  });
  return { records, surahList };
}

function pageChecks(file, html) {
  assert.ok(!html.includes(OPEN_APP), file + ": old open-in-app label is gone");
  const text = textNodes(html);
  // word pages show the same source line as the app; surah pages have none
  if (file.startsWith("word/")) assert.ok(text.includes(SOURCE_LABEL), file + ": source line label is shown");
  else assert.ok(!text.includes(SOURCE_LABEL), file + ": source line label is gone");
  const pill = html.match(/<a class="pill"[^>]*>([\s\S]*?)<\/a>/);
  assert.ok(pill, file + ": has the open-on-site pill");
  const pillText = pill[1].replace(/<svg[\s\S]*?<\/svg>/g, "").trim();
  assert.equal(pillText, OPEN_SITE, file + ": open button text equals the site string");
  return text;
}

test("static word pages carry every record's word/verse/meaning/surah byte-identical", () => {
  const { records } = loadRecords();
  assert.equal(records.length, 73);
  const files = fs.readdirSync(path.join(ROOT, "public", "word")).filter((f) => f.endsWith(".html"));
  assert.equal(files.length, 73);
  assert.deepEqual([...files].sort(), records.map((r) => r.slug + ".html").sort(), "one page per record slug");
  for (const r of records) {
    const file = "word/" + r.slug + ".html";
    const html = fs.readFileSync(path.join(ROOT, "public", "word", r.slug + ".html"), "utf8");
    const text = pageChecks(file, html);
    assert.ok(text.includes(r.dw), file + ": headword shown in the mushaf spelling");
    assert.ok(html.includes(asJsonLd(r.word)), file + ": the stored word is kept in the page data");
    for (const seg of r.verseSegments) assert.ok(text.includes(seg), file + ": verse segment");
    assert.ok(text.includes(r.bodyMeaning) || text.includes(r.rawMeaning), file + ": meaning text");
    assert.ok(text.includes(r.surahShort) || text.includes(r.surahFull), file + ": surah name");
  }
});

test("static surah pages carry the surah name and every word of the surah", () => {
  const { records, surahList } = loadRecords();
  assert.equal(surahList.length, 28);
  const files = fs.readdirSync(path.join(ROOT, "public", "surah")).filter((f) => f.endsWith(".html"));
  assert.equal(files.length, 28);
  assert.deepEqual([...files].sort(), surahList.map((s) => s.slug + ".html").sort(), "one page per surah slug");
  for (const s of surahList) {
    const file = "surah/" + s.slug + ".html";
    const html = fs.readFileSync(path.join(ROOT, "public", "surah", s.slug + ".html"), "utf8");
    const text = pageChecks(file, html);
    assert.ok(text.includes(s.short) || text.includes(s.full), file + ": surah name");
    for (const w of s.words) assert.ok(text.includes(w), file + ": word " + records.indexOf(records.find((r) => r.word === w && r.surahSlug === s.slug)));
  }
});
