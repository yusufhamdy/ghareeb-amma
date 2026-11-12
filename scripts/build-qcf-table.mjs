#!/usr/bin/env node
/*
 * build-qcf-table.mjs - builds public/qcf-v2.json, the one committed table of the Madinah Mushaf page fonts V2
 * (QCF V2, King Fahd Glorious Quran Printing Complex) for Juz Amma: surahs 78-114, Mushaf pages 582-604.
 *
 * Run by hand, offline, from saved raw responses (nothing here touches the network; the site, the build and the
 * publish never do either):
 *
 *   node scripts/build-qcf-table.mjs --src <dir> [--check]
 *
 * <dir> holds:
 *   c78.json ... c114.json  the raw Quran.com API v4 responses of
 *                           https://api.quran.com/api/v4/verses/by_chapter/{c}?words=true
 *                             &word_fields=code_v2,v2_page,text_qpc_hafs,page_number&per_page=50&page=1
 *   mushaf-v2.txt           https://raw.githubusercontent.com/nuqayah/qpc-fonts/master/mushaf-v2.txt
 *                           (line = global ayah number, "page,glyphs"), the cross-check of every glyph code
 *   fetched.txt             the UTC time of the download
 *
 * Every ayah is cross-checked before anything is written; any difference stops the build:
 *   - the ayah's glyph codes, in order, equal its mushaf-v2.txt glyphs (that file separates a word's glyphs with
 *     spaces too, so both are compared without spaces);
 *   - its words are type "word", then exactly one "end" (the ayah-end marker with its number), last;
 *   - every page font public/fonts/qcf-v2/QCF2{page}.ttf exists, every code of a word is in its page font's glyph
 *     table (cmap), and no code is used twice on one page (this is what confirms the page numbers).
 * The page of each word is the API's v2_page: the page column of mushaf-v2.txt follows another layout for some
 * ayat (it would put one glyph code on two pages), so it is not used.
 *
 * Word text (owner decision, 2026-11-12): the Complex's own Hafs text, data/quran/ (hafsData_v2-0.json, the source
 * of the site's stored text), split at Quran.com's word positions. Quran.com's text_qpc_hafs is the same text in
 * another encoding in a few places (a tatweel in one word in 18 ayat, other spaces at two marks), so it is used only
 * to find the word boundaries: each Quran.com word is matched to the next piece of the official ayah with the same
 * letters and marks (tatweel and white space ignored for this alignment only). The build stops unless the official
 * words, joined by single spaces, are the official ayah exactly, byte for byte.
 *
 * The table (see public/qcf.js for how it is read):
 *   { "about": ..., "source": ..., "first": 582, "last": 604,
 *     "ayat": { "78:1": [[page, code_v2, text], ...], ... } }
 * One entry per word, in order: the word's position is its index + 1. The last entry of each ayah is the ayah-end
 * marker; its text is the ayah number in Arabic-Indic digits, as Quran.com serves it (the official file draws the
 * number with a glyph that data/quran/ strips). Codes and pages are copied exactly as served.
 *
 * ASCII-ONLY (see test/arabic-guard.test.js).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const Q = createRequire(import.meta.url)("../data/quran/index.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "qcf-v2.json");
const FONTS = path.join(ROOT, "public", "fonts", "qcf-v2");
const FIRST_SURAH = 78, LAST_SURAH = 114, FIRST_PAGE = 582, LAST_PAGE = 604;

const args = process.argv.slice(2);
const src = args[args.indexOf("--src") + 1];
if (!src || args.indexOf("--src") < 0) { console.error("usage: node scripts/build-qcf-table.mjs --src <dir> [--check]"); process.exit(2); }

// Splits the official ayah text at the Quran.com words: returns one official piece per word, or null.
const SKIP = /[\s\u0640]/;
function split(ref, qwords) {
  const out = [];
  let i = 0;
  for (const qw of qwords) {
    const core = [...qw].filter((ch) => !SKIP.test(ch));
    while (i < ref.length && /\s/.test(ref[i])) i++;
    const start = i;
    for (const ch of core) {
      while (i < ref.length && SKIP.test(ref[i]) && ref[i] !== ch) i++;
      if (ref[i] !== ch) return null;
      i++;
    }
    out.push(ref.slice(start, i));
  }
  while (i < ref.length && /\s/.test(ref[i])) i++;
  if (i !== ref.length || out.join(" ") !== ref) return null;
  return out;
}

// The code points a TrueType font maps (cmap format 4, the Unicode BMP subtable).
function cmapCodes(buf) {
  const n = buf.readUInt16BE(4);
  let cmap = -1;
  for (let i = 0; i < n; i++) if (buf.toString("latin1", 12 + 16 * i, 16 + 16 * i) === "cmap") cmap = buf.readUInt32BE(12 + 16 * i + 8);
  const out = new Set();
  for (let i = 0, m = buf.readUInt16BE(cmap + 2); i < m; i++) {
    const off = cmap + buf.readUInt32BE(cmap + 4 + 8 * i + 4);
    if (buf.readUInt16BE(off) !== 4) continue;
    const seg = buf.readUInt16BE(off + 6) / 2, ends = off + 14, starts = ends + 2 * seg + 2, deltas = starts + 2 * seg, ranges = deltas + 2 * seg;
    for (let k = 0; k < seg; k++) {
      const e = buf.readUInt16BE(ends + 2 * k), st = buf.readUInt16BE(starts + 2 * k), d = buf.readUInt16BE(deltas + 2 * k), ro = buf.readUInt16BE(ranges + 2 * k);
      for (let c = st; c <= e && c !== 0xffff; c++) {
        const g = ro ? buf.readUInt16BE(ranges + 2 * k + ro + 2 * (c - st)) : 1;
        if (g && (ro ? (g + d) & 0xffff : (c + d) & 0xffff)) out.add(c);
      }
    }
  }
  return out;
}

const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const mv2Raw = fs.readFileSync(path.join(src, "mushaf-v2.txt"));
const mv2 = mv2Raw.toString("utf8").split(/\r?\n/);
const problems = [];
// mushaf-v2.txt has "None" for these ayat. Their codes are accepted only because each one is the next code after the
// previous ayah's last and before the next ayah's first on the same page, and every code of every page is in that page
// font's glyph table and used once (checked below).
const GAPS = ["85:18"];
const gaps = [];
const ayat = {};
const files = {};
let words = 0, count = 0;

for (let c = FIRST_SURAH; c <= LAST_SURAH; c++) {
  const raw = fs.readFileSync(path.join(src, "c" + c + ".json"));
  files["c" + c + ".json"] = sha(raw);
  const j = JSON.parse(raw.toString("utf8"));
  if (!j.pagination || j.pagination.total_pages !== 1) problems.push(c + ": more than one response page");
  for (const v of j.verses) {
    const key = v.verse_key, ws = v.words || [];
    if (key !== c + ":" + v.verse_number) problems.push(key + ": key");
    const line = mv2[v.id - 1] || "";
    const glyphs = line.slice(line.indexOf(",") + 1).replace(/ /g, "");
    const codes = ws.map((w) => w.code_v2).join("").replace(/ /g, "");
    if (glyphs === "None") gaps.push(key); // no glyphs in mushaf-v2.txt for this ayah: see GAPS below
    else if (codes !== glyphs) problems.push(key + ": glyphs differ from mushaf-v2.txt");
    ws.forEach((w, i) => {
      const end = i === ws.length - 1;
      if (w.char_type_name !== (end ? "end" : "word")) problems.push(key + ":" + (i + 1) + ": type " + w.char_type_name);
      if (w.position !== i + 1) problems.push(key + ":" + (i + 1) + ": position " + w.position);
      if (!Number.isInteger(w.v2_page) || w.v2_page < FIRST_PAGE || w.v2_page > LAST_PAGE) problems.push(key + ":" + (i + 1) + ": page " + w.v2_page);
      if (typeof w.code_v2 !== "string" || !w.code_v2 || typeof w.text_qpc_hafs !== "string" || !w.text_qpc_hafs) problems.push(key + ":" + (i + 1) + ": empty");
    });
    const official = split(Q.ayah(c, v.verse_number), ws.slice(0, -1).map((w) => w.text_qpc_hafs));
    if (!official) { problems.push(key + ": the official text does not split at the Quran.com words"); continue; }
    ayat[key] = ws.map((w, i) => [w.v2_page, w.code_v2, i < official.length ? official[i] : w.text_qpc_hafs]);
    words += ws.length;
    count++;
  }
}
if (gaps.join() !== GAPS.join()) problems.push("ayat without mushaf-v2.txt glyphs: " + gaps.join(" ") + " (expected " + GAPS.join(" ") + ")");
for (const key of GAPS) {
  const [s, a] = key.split(":").map(Number), prev = ayat[s + ":" + (a - 1)], cur = ayat[key], next = ayat[s + ":" + (a + 1)];
  const cps = [].concat(prev.slice(-1), cur, next.slice(0, 1)).map((w) => [w[0], w[1].codePointAt(0)]);
  for (let i = 1; i < cps.length; i++) if (cps[i][0] !== cps[0][0] || cps[i][1] !== cps[i - 1][1] + 1) problems.push(key + ": codes not contiguous with the neighbouring ayat");
}
const used = {};
for (const key in ayat) for (const [page, code] of ayat[key]) for (const ch of code) if (ch !== " ") (used[page] = used[page] || []).push(ch.codePointAt(0));
for (let p = FIRST_PAGE; p <= LAST_PAGE; p++) {
  const f = path.join(FONTS, "QCF2" + p + ".ttf");
  if (!fs.existsSync(f)) { problems.push("font QCF2" + p + ".ttf missing"); continue; }
  const cmap = cmapCodes(fs.readFileSync(f)), seen = new Set();
  for (const cp of used[p] || []) {
    if (!cmap.has(cp)) problems.push("page " + p + ": code U+" + cp.toString(16) + " is not in QCF2" + p + ".ttf");
    if (seen.has(cp)) problems.push("page " + p + ": code U+" + cp.toString(16) + " used twice");
    seen.add(cp);
  }
}
if (count !== 564) problems.push("expected 564 ayat, got " + count);

if (problems.length) { console.error("STOP: " + problems.length + " problem(s)\n" + problems.join("\n")); process.exit(1); }

const table = {
  about: "Madinah Mushaf page fonts V2 (QCF V2, King Fahd Glorious Quran Printing Complex) for Juz Amma. Per ayah, one [page, code_v2, text] per word in order (position = index + 1); text is the Complex's official Hafs text (data/quran/hafsData_v2-0.json) split at Quran.com's word positions; the last entry is the ayah-end marker. Built by scripts/build-qcf-table.mjs; read by public/qcf.js.",
  source: {
    text: "data/quran/hafsData_v2-0.json (King Fahd Glorious Quran Printing Complex, UthmanicHafs_v2-0.zip)",
    words: "https://api.quran.com/api/v4/verses/by_chapter/{78..114}?words=true&word_fields=code_v2,v2_page,text_qpc_hafs,page_number&per_page=50&page=1",
    crossCheck: "https://raw.githubusercontent.com/nuqayah/qpc-fonts/master/mushaf-v2.txt",
    fonts: "https://raw.githubusercontent.com/nuqayah/qpc-fonts/master/mushaf-v2/QCF2{page}.ttf",
    fetched: fs.readFileSync(path.join(src, "fetched.txt"), "utf8").trim(),
    noCrossCheck: GAPS,
    sha256: Object.assign({ "mushaf-v2.txt": sha(mv2Raw) }, files),
  },
  first: FIRST_PAGE,
  last: LAST_PAGE,
  ayat,
};
const out = JSON.stringify(table, null, 0).replace(/\],"(\d+:\d+)"/g, '],\n"$1"') + "\n";
if (args.includes("--check")) {
  const same = fs.existsSync(OUT) && fs.readFileSync(OUT, "utf8") === out;
  console.log(same ? "public/qcf-v2.json is up to date" : "public/qcf-v2.json differs");
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(OUT, out);
console.log("wrote public/qcf-v2.json: " + count + " ayat, " + words + " words (incl. " + count + " ayah-end markers), pages " + FIRST_PAGE + "-" + LAST_PAGE);
