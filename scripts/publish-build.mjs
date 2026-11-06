#!/usr/bin/env node
/*
 * publish-build.mjs - free-plan publish generator (Phase 7A).
 *
 * Turns the Firestore source of truth (public/data, public/challenge) into the
 * static Hosting artefacts: words.json, challenge.json, sitemap.xml and the
 * /word/<slug>.html pages, plus rev.json (data rev + content hash).
 *
 * It runs on the free (Spark) plan from a scheduled GitHub Action: no Cloud
 * Functions, no Blaze, no billing. The static pages stay the SEO source.
 *
 * Input:
 *   (default)            Firestore, read-only, with the Firestore client (public/data and public/challenge only; it
 *                        works with the Workload Identity credential, unlike admin.initializeApp())
 *   --from-json PATH     read the surah list from a local JSON file
 *   --challenge-json P   read the challenge doc from a local JSON file
 *   --project ID         Firebase project id for the Firestore path
 *
 * Two modes:
 *   --out DIR            the old mode: write the generated files under DIR (never over public/)
 *     --current-url URL  fetch the live rev.json; skip (no-change) when the content hash matches
 *   --publish            Phase 5: update the site tree (default public/) and firebase.json in place, for a pull
 *                        request. Writes only what changed, deletes stale word and surah pages and share images,
 *                        adds a 301 redirect for each removed page (to its surah page, or the home page when the
 *                        surah is gone too), writes rev.json, and regenerates the share images whose word, surah or
 *                        ayah changed. Prints "publish-build: no-change" and writes nothing when the site is current.
 *     --site DIR         the site tree to update (default public/)
 *     --firebase-json P  the Hosting config whose redirects are updated (default firebase.json)
 *     --report FILE      write the review report (Markdown, scripts/publish-report.mjs) to FILE
 *     --summary FILE     write the change summary (file names and counts only) as JSON to FILE
 *     --no-images        skip the share images (tests)
 *   Both modes:
 *     --allow-removals N        how many words this publish may remove (default 0); it must be exact
 *     --allow-surah-removals L  comma-separated surah numbers this publish may remove (default none)
 *     --max-removals N          a further hard ceiling on removed words (the automatic publish passes 7)
 *     --owner-review            a publish the owner reviews in a pull request (Publish run by hand with an exact
 *                               allow_removals): the 10% ceiling does not apply; the exact count still must match
 *
 * Output (--out mode): words.json, challenge.json, sitemap.xml, word/<slug>.html, rev.json
 *   plus the static legal pages about/index.html, privacy/index.html,
 *   terms/index.html, rights/index.html (copy verbatim from shared/legal.js).
 *
 * Safety: the input is checked against a strict shape (no unknown keys), put in the committed shape and order, compared
 * with the committed public/words.json (the removal guard), and its challenge references are resolved. The whole site is
 * built in memory, validated, and only then written. Any failure exits non-zero with nothing written. Messages name
 * positions, surah numbers, day numbers, slugs and field names, never document content.
 *
 * ASCII-ONLY: every Arabic fragment is a \u escape (see
 * test/arabic-guard.test.js, which treats literal Arabic in new files as
 * protected content). The canonical slug scheme comes from shared/seo.js and
 * the public challenge payload from shared/challenge.js, so both stay single
 * sources of truth. The rendered HTML mirrors the committed static pages
 * byte-for-byte (the older committed format, which is the one Google indexed).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const seo = require("../shared/seo.js");
const challenge = require("../shared/challenge.js");
const { LEGAL } = require("../shared/legal.js");
// How Quran text is shown (shared with the app): the headword in the mushaf's spelling, the highlight on whole words.
const QText = require("../public/qtext.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SITE = "https://ghareebalquran.com";

// --- Arabic fragments (escaped so this module stays ASCII-only) ------------
const A = {
  LOGO: "\u063a\u0631\u064a\u0628 \u0627\u0644\u0642\u0631\u0622\u0646", // "Ghareeb Al-Quran"
  T_PRE: "\u0645\u0639\u0646\u0649 ", // "meaning of "
  T_SUF: " \u0641\u064a \u0627\u0644\u0642\u0631\u0622\u0646", // " in the Quran"
  DOT_AYAH: " \u00b7 \u0622\u064a\u0629 ", // " . ayah " (U+00B7 middle dot)
  AYAH: "\u0622\u064a\u0629 ", // "ayah "
  COMMA: "\u060c ", // U+060C ARABIC COMMA, then a space
  OTHER: "\u0643\u0644\u0645\u0627\u062a \u0623\u062e\u0631\u0649 \u0645\u0646 \u0633\u0648\u0631\u0629 ", // "other words from surah "
  APP: "\u062a\u0635\u0641\u0651\u062d \u0627\u0644\u0645\u0648\u0642\u0639", // "browse the site"
  PREV_WORD: "\u0627\u0644\u0643\u0644\u0645\u0629 \u0627\u0644\u0633\u0627\u0628\u0642\u0629", // "previous word"
  PREV_SURAH: "\u0627\u0644\u0633\u0648\u0631\u0629 \u0627\u0644\u0633\u0627\u0628\u0642\u0629", // "previous surah"
  NEXT_WORD: "\u0627\u0644\u0643\u0644\u0645\u0629 \u0627\u0644\u062a\u0627\u0644\u064a\u0629", // "next word"
  NEXT_SURAH: "\u0627\u0644\u0633\u0648\u0631\u0629 \u0627\u0644\u062a\u0627\u0644\u064a\u0629", // "next surah"
  FROM_SURAH: "\u060c \u0645\u0646 \u0633\u0648\u0631\u0629 ", // ", from surah " (accessible name of a cross-surah prev/next)
  COMMA: "\u060c ", // ", " (accessible name of the surah-page prev/next)
  ALL_SURAS: "\u0643\u0644 \u0627\u0644\u0633\u0648\u0631", // "all surahs"
  ONE_WORD: "\u0643\u0644\u0645\u0629 \u0648\u0627\u062d\u062f\u0629", // "one word"
  TWO_WORDS: "\u0643\u0644\u0645\u062a\u0627\u0646", // "two words"
  WORDS_PLURAL: " \u0643\u0644\u0645\u0627\u062a", // " words" (count >= 3, <= 10)
  WORD_SINGULAR: " \u0643\u0644\u0645\u0629", // " word" (count > 10)
  IN_THIS_SURAH: " \u0641\u064a \u0647\u0630\u0647 \u0627\u0644\u0633\u0648\u0631\u0629.", // " in this surah."
  HOME: "\u0627\u0644\u0631\u0626\u064a\u0633\u064a\u0629", // "home"
  MEANING: "\u0627\u0644\u0645\u0639\u0646\u0649", // "the meaning"
  OTHER_SAME: "\u0643\u0644\u0645\u0627\u062a \u0623\u062e\u0631\u0649 \u0645\u0646 \u0646\u0641\u0633 \u0627\u0644\u0633\u0648\u0631\u0629", // "other words from the same surah"
  NEXT: "\u0627\u0644\u062a\u0627\u0644\u064a", // "next"
  ALL_SURAH: "\u0639\u0631\u0636 \u0643\u0644 \u0643\u0644\u0645\u0627\u062a \u0627\u0644\u0633\u0648\u0631\u0629", // "show all words of the surah"
  COPY: "\u00a9", // copyright sign
  F_ABOUT: "\u0639\u0646 \u0627\u0644\u0645\u0648\u0642\u0639", // "about"
  F_PRIVACY: "\u0627\u0644\u062e\u0635\u0648\u0635\u064a\u0629", // "privacy"
  F_TERMS: "\u0627\u0644\u0634\u0631\u0648\u0637", // "terms"
  F_RIGHTS: "\u0627\u0644\u062d\u0642\u0648\u0642 \u0648\u0627\u0644\u0645\u0635\u0627\u062f\u0631", // "rights and sources"
  OL: "\ufd3f", // ornate left parenthesis
  OR: "\ufd3e", // ornate right parenthesis
  SURAH_T_PRE: "\u0645\u0639\u0627\u0646\u064a \u0643\u0644\u0645\u0627\u062a \u0633\u0648\u0631\u0629 ", // "meanings of the words of surah "
};

const SURAH_PREFIX_RE = /^\u0633\u0648\u0631\u0629\s*/; // leading "surah "
const EMAIL_RE = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g; // contact email inside a legal paragraph

// Surah name (without the leading "surah " word) -> mushaf number. Fixed set:
// Juz Amma surahs that currently carry words. Used only for the app deep link.
const SURAH_NO = {
  "\u0627\u0644\u0646\u0627\u0633": 114,
  "\u0627\u0644\u0641\u0644\u0642": 113,
  "\u0627\u0644\u0625\u062e\u0644\u0627\u0635": 112,
  "\u0627\u0644\u0643\u0648\u062b\u0631": 108,
  "\u0627\u0644\u0645\u0627\u0639\u0648\u0646": 107,
  "\u0642\u0631\u064a\u0634": 106,
  "\u0627\u0644\u0641\u064a\u0644": 105,
  "\u0627\u0644\u0647\u0645\u0632\u0629": 104,
  "\u0627\u0644\u0642\u0627\u0631\u0639\u0629": 101,
  "\u0627\u0644\u0639\u0627\u062f\u064a\u0627\u062a": 100,
  "\u0627\u0644\u0632\u0644\u0632\u0644\u0629": 99,
  "\u0627\u0644\u0628\u064a\u0646\u0629": 98,
  "\u0627\u0644\u0639\u0644\u0642": 96,
  "\u0627\u0644\u0634\u0631\u062d": 94,
  "\u0627\u0644\u0636\u062d\u0649": 93,
  "\u0627\u0644\u0644\u064a\u0644": 92,
  "\u0627\u0644\u0634\u0645\u0633": 91,
  "\u0627\u0644\u0628\u0644\u062f": 90,
  "\u0627\u0644\u0641\u062c\u0631": 89,
  "\u0627\u0644\u063a\u0627\u0634\u064a\u0629": 88,
  "\u0627\u0644\u0623\u0639\u0644\u0649": 87,
  "\u0627\u0644\u0637\u0627\u0631\u0642": 86,
  "\u0627\u0644\u0627\u0646\u0634\u0642\u0627\u0642": 84,
  "\u0627\u0644\u0645\u0637\u0641\u0641\u064a\u0646": 83,
  "\u0627\u0644\u062a\u0643\u0648\u064a\u0631": 81,
  "\u0639\u0628\u0633": 80,
  "\u0627\u0644\u0646\u0627\u0632\u0639\u0627\u062a": 79,
  "\u0627\u0644\u0646\u0628\u0623": 78,
};

// Legacy inline stylesheet (kept for the legal pages' older look). The shared
// stylesheet for every static page is the app's own <style> block, extracted
// from public/index.html at build time by appCss() below and committed as
// public/css/app.css.
const LEGACY_CSS =
  ":root{--bg:#EEF3F6;--tx:#1D2B25;--mu:#55645D;--ac:#0B6E8A;--ln:rgba(29,43,37,.14);--gb:rgba(255,255,255,.62)}\n" +
  "@media(prefers-color-scheme:dark){:root{--bg:#0A0E1F;--tx:#ECEFFA;--mu:#A3ABC9;--ac:#9FB4FF;--ln:rgba(255,255,255,.13);--gb:rgba(255,255,255,.07)}}\n" +
  "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font-family:'IBM Plex Sans Arabic',sans-serif;line-height:1.8}\n" +
  "main{max-width:680px;margin:0 auto;padding:22px 18px 60px}a{color:var(--ac);text-decoration:none}.q{font-family:'KFGQPC Uthmanic Hafs','Amiri Quran',serif}.aq{font-family:'Amiri Quran',serif}.sn{font-family:'Amiri',serif;font-weight:700}\n" +
  ".m{color:var(--mu);font-size:14px}header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}\n" +
  ".logo{font-size:27px}h1{font-size:44px;margin:8px 0;color:var(--ac);line-height:1.5}\n" +
  // room for Amiri Quran's descenders under the heading: (ascent 1.815em + descent 0.634em - line-height) / 2 (see index.html, N2)
  "h1.aq{padding-bottom:calc((1.815em + .634em - 1.5em) / 2)}\n" +
  ".card{background:var(--gb);border:1px solid var(--ln);border-radius:18px;padding:16px;margin:12px 0}\n" +
  ".pill{display:inline-flex;align-items:center;gap:8px;background:var(--gb);border:1px solid var(--ln);border-radius:999px;padding:9px 16px;font-size:15px}\n" +
  ".cols{display:grid;gap:12px}@media(min-width:800px){.cols{grid-template-columns:1fr 1fr;align-items:start}}\n" +
  ".wd{font-size:40px;line-height:1.7;color:var(--ac);text-align:center;margin:2px 0 6px;padding:0 4px}\n" +
  ".ay{font-size:24px;line-height:2.15;text-align:center;padding:0 4px}mark{background:none;color:var(--ac);border-bottom:2px solid var(--ac)}\n" +
  ".mn{font-size:19px;line-height:1.9}.acts{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:14px 0}\n" +
  ".btn{display:inline-flex;align-items:center;gap:8px;min-height:48px;padding:12px 22px;border-radius:24px;background:var(--ac);color:var(--bg);font-weight:600;font-size:16px}\n" +
  ".btn.o{background:transparent;color:var(--ac);border:1px solid var(--ac)}h2{font-size:20px;margin:6px 0 12px;text-align:center}\n" +
  ".chips{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}.chip{display:inline-block;background:var(--gb);border:1px solid var(--ln);border-radius:999px;padding:10px 16px;font-size:20px}\n" +
  "footer{margin-top:26px;text-align:center;border-top:1px solid var(--ln);padding-top:16px}.fl{display:flex;flex-wrap:wrap;gap:14px;justify-content:center;margin-bottom:8px;font-size:14px}";

// Extra rules the app renders with JS/markup the static pages also need (footer,
// legal paragraphs, the standalone legal <main>). ASCII only.
const STATIC_CSS_TAIL =
  // Q3: the static footer mirrors the app's footer (.ft) exactly; the link row
  // (.fl, 13px) comes from the extracted app stylesheet unchanged.
  "\nfooter{display:flex;flex-direction:column;align-items:center;gap:12px;margin-top:20px;padding-top:20px;border-top:1px solid var(--ln);text-align:center}\n" +
  ".para{font-size:17px;line-height:1.95;margin:0 0 14px}\n" +
  ".legal{max-width:680px;margin:0 auto;padding:22px 18px 60px}\n" +
  "h2{font-size:20px;margin:6px 0 12px;text-align:center}\n" +
  ".chips{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}\n" +
  ".chip{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 16px;border-radius:999px;font-size:20px;color:var(--ac);cursor:pointer}\n" +
  // M2: the app stacks a card's own children with its flex gap (its cards are
  // flex columns, e.g. .cols .card{...gap:8px} in the app's <style>). The
  // static "other words" card is a plain .card (not inside .cols), so it must
  // carry the same internal stacking; the app's own inter-block gap is 14px.
  // The more specific .cols .card rule above still wins for the word/meaning
  // cards, so the app's look is untouched.
  ".card{display:flex;flex-direction:column;gap:14px}\n" +
  // The chips' shadow (10px + 30px blur = 40px) ends before the translucent
  // "all words" button below them; the card's own gap is 14px.
  ".chips+.acts{margin-top:26px}\n" +
  // S8: in glass dark the chips sit on two glass layers; mixing the accent toward the text colour keeps them >= 4.5:1
  ":root.dk:not(.shade) .chip{color:color-mix(in srgb,var(--ac) 35%,var(--tx))}\n" +
  // P1 Tier 4: the legal pages' home link is a small text link, so it gets the
  // same subtle hover colour and light (opacity-only) press as the app's links.
  ":is(.legal>a.b,.para a){transition:color .2s,opacity .15s}\n" +
  "@media(hover:hover){:is(.legal>a.b,.para a):hover{color:color-mix(in srgb,var(--ac) 70%,var(--tx))}}\n" +
  ":is(.legal>a.b,.para a):active{opacity:.7}\n";

// The shared static-page stylesheet: the app's own <style> block (single source
// of truth) read at build time, plus the small tail above. Committed as
// public/css/app.css and linked from every static page.
export function appCss() {
  const html = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  const m = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!m) throw new Error("public/index.html has no <style> block");
  return m[1] + STATIC_CSS_TAIL;
}

const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const shortSurah = (s) => String(s == null ? "" : s).replace(SURAH_PREFIX_RE, "");

// Strip a leading "<word>: " prefix from a meaning for the page body. The
// committed static pages strip only when the raw meaning starts with the exact
// word followed by a colon; otherwise the full meaning is kept. (This is
// deliberately stricter than the admin page's diacritic-normalized check, so
// some live pages keep their prefix - matching them byte-for-byte is the goal.)
function strippedMeaning(word, raw) {
  const m = String(raw == null ? "" : raw);
  const prefix = String(word == null ? "" : word) + ":";
  return m.startsWith(prefix) ? m.slice(prefix.length).trim() : m;
}

function renderAyah(ayah) {
  const segs = ayah && Array.isArray(ayah.segments) ? ayah.segments : [];
  // the mark covers whole written words and the parentheses stay with their words, like the app (qtext.js)
  return QText.ayahHtml({ segments: segs }, esc);
}

// Flatten the raw surah list into one record per word, in canonical order.
export function buildRecords(surahs) {
  const slugs = seo.buildSlugs(surahs);
  const records = [];
  let si = 0;
  surahs.forEach((e, surahSeq) => {
    const words = Array.isArray(e.words) ? e.words : [];
    const meanings = Array.isArray(e.meanings) ? e.meanings : [];
    const ayahs = Array.isArray(e.ayahs) ? e.ayahs : [];
    const short = shortSurah(e.surah);
    const items = [];
    for (let i = 0; i < words.length; i++) {
      const a = ayahs[i] || ayahs[0] || {};
      const label = String(a.label == null ? "" : a.label) || String(i + 1);
      items.push({
        i,
        label,
        labelNum: Number(String(label).split("-")[0]) || i + 1,
        slug: slugs[si++], // slugs are assigned in data order (see shared/seo.js)
        word: words[i],
        dw: QText.displayWord(a) || words[i],
        raw: meanings[i] || "",
        ayah: a,
      });
    }
    // The live pages list a surah's words in ascending ayah order; the app deep
    // link index and the "other words" list both follow that order. Stable
    // tie-break on the original data index keeps same-ayah words in order.
    const sorted = items.slice().sort((x, y) => x.labelNum - y.labelNum || x.i - y.i);
    sorted.forEach((it, idx) => {
      records.push({
        surahSeq,
        surahFull: e.surah,
        surahShort: short,
        source: e.source,
        word: it.word,
        dw: it.dw,
        rawMeaning: it.raw,
        meaning: strippedMeaning(it.word, it.raw),
        label: it.label,
        labelNum: it.labelNum,
        slug: it.slug,
        no: SURAH_NO[short],
        idx,
        ayah: it.ayah,
        others: sorted
          .map((o, j) => ({ word: o.word, dw: o.dw, slug: o.slug, j }))
          .filter((o) => o.j !== idx)
          .map((o) => ({ word: o.word, dw: o.dw, slug: o.slug })),
        prev: idx > 0 ? { word: sorted[idx - 1].word, slug: sorted[idx - 1].slug } : null,
        next: sorted[idx + 1] ? { word: sorted[idx + 1].word, slug: sorted[idx + 1].slug } : null,
      });
    });
  });
  // Surah-level links for the static surah pages (prev/next surah + the surah
  // slug shared with the word pages). Prev/next follow the app's order: surah number.
  const seqOrder = [];
  records.forEach((r) => {
    if (!seqOrder.includes(r.surahSeq)) seqOrder.push(r.surahSeq);
  });
  const noOf = (seq) => records.find((x) => x.surahSeq === seq).no;
  const nameOf = (seq) => records.find((x) => x.surahSeq === seq).surahShort;
  seqOrder.sort((a, b) => noOf(a) - noOf(b));
  records.forEach((r) => {
    const i = seqOrder.indexOf(r.surahSeq);
    const slugOf = (seq) => {
      const first = records.find((x) => x.surahSeq === seq);
      return seo.SURAH_SLUG[first.surahShort] || "surah-" + first.no;
    };
    r.surahSlug = slugOf(r.surahSeq);
    r.surahPrev = i > 0 ? { no: noOf(seqOrder[i - 1]), slug: slugOf(seqOrder[i - 1]), name: nameOf(seqOrder[i - 1]) } : null;
    r.surahNext = i < seqOrder.length - 1 ? { no: noOf(seqOrder[i + 1]), slug: slugOf(seqOrder[i + 1]), name: nameOf(seqOrder[i + 1]) } : null;
  });
  // Word-page prev/next always lead to a word, in the app's order (surah number,
  // then the sorted order above); crossing into another surah carries its name.
  const flat = records.slice().sort((x, y) => x.no - y.no || x.idx - y.idx);
  flat.forEach((r, k) => {
    const p = flat[k - 1], n = flat[k + 1];
    r.wordPrev = p ? { slug: p.slug, surah: p.no !== r.no ? p.surahShort : "" } : null;
    r.wordNext = n ? { slug: n.slug, surah: n.no !== r.no ? n.surahShort : "" } : null;
  });
  return records;
}

// Shared head for every static page: fonts, the extracted app stylesheet and
// the synchronous theme bootstrap (applied before first paint). Every value is
// HTML-escaped here (they come from admin-written data); callers pass raw text.
function staticHead(o) {
  // a page with its own share image (a word) names it and its alt text; every other page has the general image
  const img = o.ogImage || SITE + "/og-2026-10.png";
  const alt = (k) => (o.ogImageAlt ? '<meta ' + k + ':image:alt" content="' + esc(o.ogImageAlt) + '">' : "");
  return (
    "<!doctype html>\n" +
    '<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
    '<meta name="theme-color" content="#EEF3F6">\n' +
    "<title>" + esc(o.title) + "</title>\n" +
    '<meta name="description" content="' + esc(o.desc) + '">\n' +
    '<link rel="canonical" href="' + esc(o.canonical) + '">\n' +
    '<meta property="og:type" content="' + esc(o.type || "website") + '"><meta property="og:title" content="' + esc(o.ogTitle) + '"><meta property="og:description" content="' + esc(o.ogDesc) + '"><meta property="og:image" content="' + img + '"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">' + alt('property="og') + '<meta property="og:locale" content="ar_AR">\n' +
    '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' + esc(o.ogTitle) + '"><meta name="twitter:description" content="' + esc(o.ogDesc) + '"><meta name="twitter:image" content="' + img + '">' + alt('name="twitter') + '\n' +
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">\n' +
    '<link rel="stylesheet" href="/fonts/fonts.css">\n<link rel="stylesheet" href="/css/app.css">\n' +
    // the Quran face (word and surah pages show Quran text): preloaded, and guarded by qfont.js
    '<link rel="preload" href="/fonts/kfgqpc-uthmanic-hafs-v22.ttf" as="font" type="font/ttf" crossorigin>\n' +
    '<script src="/theme-boot.js"></script>\n<script src="/qfont.js"></script>\n' +
    (o.jsonLd || []).map((j) => '<script type="application/ld+json">' + jsonLd(j) + "</script>\n").join("") +
    "</head>\n"
  );
}

const CHEV_R = '<svg class="i-cv i-cr" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
const CHEV_L = '<svg class="i-cv i-cl" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
// list rows keep a plain chevron: they are rows, not buttons, and do not nudge
const ROW_CHEV = CHEV_L.replace(' class="i-cv i-cl"', "");
const EXT =
  '<svg class="im i-ex" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4 10 14M18 14v6H4V6h6"/></svg>';
// The open book, split into its halves so they open on hover/focus/press wherever it sits in a button (S12).
const BOOK =
  '<svg class="im i-bk" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path class="w" d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z"/><path class="pt bl" d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2z"/><path class="pt br" d="M22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z"/></svg>';

// The small book in a pill's second line stays still (only the pill's chevron moves).
const BOOK_P = BOOK.replace(' class="im i-bk"', "").replace(/<path class="pt[^>]*>/g, "").replace(' class="w"', "");

// The prev/next pill shared by the word and surah pages (same markup as the
// app's pnBtn): o = { label, href, surah, aria }; no href -> disabled. The
// surah line (open book + name) shows whenever o.surah is set.
function navBtn(o, dir) {
  const ps = o.surah ? '<span class="ps" aria-hidden="true">' + BOOK_P + esc(o.surah) + "</span>" : "";
  const lb = o.label.replace(/^(\S+) /, '<span class="pl">$1 </span>'); // first word hidden visually at <=340px
  const inner = dir === "pv" ? CHEV_R + " " + lb + ps : lb + " " + CHEV_L + ps;
  const al = o.aria ? ' aria-label="' + esc(o.aria) + '"' : "";
  return o.href
    ? '<a class="g pnb ' + dir + '" href="' + o.href + '"' + al + ">" + inner + "</a>"
    : '<span class="g pnb ' + dir + '" aria-disabled="true" style="opacity:.5;pointer-events:none">' + inner + "</span>";
}

// The app's existing count phrasing ("كلمة واحدة" / "كلمتان" / "n كلمات" /
// "n كلمة"), escaped for this ASCII-only module.
function countPhrase(n) {
  if (n === 1) return A.ONE_WORD;
  if (n === 2) return A.TWO_WORDS;
  if (n <= 10) return n + A.WORDS_PLURAL;
  return n + A.WORD_SINGULAR;
}

// One deterministic diacritics stripper for the title/description copies only
// (the body keeps the original). Removes the tashkeel marks, the dagger alif,
// the Quranic annotation marks and the tatweel.
const DIACRITICS = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g;
function stripDiacritics(s) {
  return String(s == null ? "" : s).replace(DIACRITICS, "");
}

// Cut a copy at a word boundary so it never exceeds max characters.
function cutAtWord(s, max) {
  const t = String(s == null ? "" : s).trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const head = t.slice(0, max);
  const i = head.lastIndexOf(" ");
  return (i > 0 ? head.slice(0, i) : head).trim();
}

// JSON-LD for the static pages, ASCII-escaped so the generator stays ASCII-only;
// "<" is escaped too (<), so no data value can close the <script> element.
function jsonLd(obj) {
  return JSON.stringify(obj).replace(/[<\u0080-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
}

// A BreadcrumbList from an ordered [{ name, item }] trail.
function breadcrumb(trail) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({ "@type": "ListItem", position: i + 1, name: t.name, item: t.item })),
  };
}

function staticFooter(year) {
  return (
    '<footer><div class="fl"><a href="/about/">' + A.F_ABOUT + '</a><a href="/privacy/">' + A.F_PRIVACY +
    '</a><a href="/terms/">' + A.F_TERMS + '</a><a href="/rights/">' + A.F_RIGHTS + '</a></div><div class="m">' +
    A.COPY + " " + year + " " + A.LOGO + "</div></footer>\n"
  );
}

// One surah group per surah, in data order, with its words in the same sorted
// order the word pages use (ascending ayah).
export function buildSurahs(records) {
  const out = [];
  records.forEach((r) => {
    let s = out[out.length - 1];
    if (!s || s.seq !== r.surahSeq) {
      s = { seq: r.surahSeq, no: r.no, slug: r.surahSlug, name: r.surahShort, prev: r.surahPrev, next: r.surahNext, words: [] };
      out.push(s);
    }
    s.words.push({ word: r.word, dw: r.dw, slug: r.slug, label: r.label });
  });
  return out;
}

export function renderWordPage(r) {
  // K2: title/description copies are diacritics-stripped copies of the page data;
  // the body keeps the original diacritics.
  const title = "\u0645\u0639\u0646\u0649 " + stripDiacritics(r.word) + " \u0641\u064a \u0633\u0648\u0631\u0629 " + stripDiacritics(r.surahShort || r.surahName || r.surahFull) + " - " + A.LOGO;
  const ogTitle = title;
  const desc = cutAtWord(stripDiacritics(r.rawMeaning), 155);
  const wordUrl = SITE + "/word/" + r.slug + ".html";
  const surahUrl = SITE + "/surah/" + r.surahSlug + ".html";
  const ld = [
    {
      "@context": "https://schema.org",
      "@type": "DefinedTerm",
      name: r.word,
      description: r.rawMeaning,
      inDefinedTermSet: { "@type": "DefinedTermSet", name: A.LOGO, url: SITE + "/" },
      url: wordUrl,
    },
    breadcrumb([
      { name: A.LOGO, item: SITE + "/" },
      { name: r.surahShort, item: surahUrl },
      { name: r.word, item: wordUrl },
    ]),
  ];
  const ayah = renderAyah(r.ayah);
  const surahHref = "/surah/" + r.surahSlug + ".html";
  const appHref = "/#/word/" + r.no + "-" + r.idx;
  const link = (w, label) =>
    w ? { label, href: "/word/" + w.slug + ".html", surah: w.surah, aria: w.surah ? label + A.FROM_SURAH + w.surah : "" } : { label, href: null };
  const pv = link(r.wordPrev, A.PREV_WORD);
  const nx = link(r.wordNext, A.NEXT_WORD);
  const chips = r.others
    .map((o) => '<a class="g chip q" href="/word/' + o.slug + '.html">' + esc(o.dw) + "</a>")
    .join("");
  const others =
    '<div class="g card"><h2>' + A.OTHER_SAME + "</h2>" +
    (chips ? '<div class="chips">' + chips + "</div>" : "") +
    '<div class="acts"><a class="btn o g" href="/surah/' + r.surahSlug + '.html">' + BOOK + A.ALL_SURAH + "</a></div></div>";
  const year = new Date().getFullYear();
  return (
    staticHead({ title, desc, canonical: SITE + "/word/" + r.slug + ".html", ogTitle, ogDesc: desc, type: "article", jsonLd: ld, ogImage: SITE + "/og/word/" + r.slug + ".png", ogImageAlt: ogTitle }) +
    '<body><div id="bg"><i></i><i></i></div><div class="wrap">' +
    '<header><a class="logo sn" href="/">' + A.LOGO + "</a>" +
    '<a class="pill" href="/#/word/' + r.no + "-" + r.idx + '">' + EXT + A.APP + "</a></header>\n" +
    "<main>" +
    '<a class="pill" href="/surah/' + r.surahSlug + '.html">' + esc(r.surahShort) + A.DOT_AYAH + esc(r.label) + CHEV_L + "</a>\n" +
    '<div class="cw">' + navBtn(pv, "pv") +
    '<div class="cols">' +
    '<div class="g card"><h1 class="wd q">' + esc(r.dw) + '</h1><div class="vr"><div class="ay q">' + ayah + "</div></div></div>" +
    '<div class="g card"><div class="m">' + A.MEANING + '</div><div class="mn">' + esc(r.meaning) + '</div><div class="m">' + esc(r.source || "") + "</div></div>" +
    "</div>" + navBtn(nx, "nx") + "</div>\n" +
    others +
    "</main>" +
    '<footer><div class="fl"><a href="/about/">' + A.F_ABOUT + '</a><a href="/privacy/">' + A.F_PRIVACY + '</a><a href="/terms/">' + A.F_TERMS + '</a><a href="/rights/">' + A.F_RIGHTS + '</a></div><div class="m">' + A.COPY + " " + year + " " + A.LOGO + "</div></footer>\n" +
    '<script src="/word-gap.js" defer></script>' +
    "</div></body></html>"
  );
}

export function renderSurahPage(s) {
  const title = A.SURAH_T_PRE + stripDiacritics(s.name) + " - " + A.LOGO;
  const count = countPhrase(s.words.length) + A.IN_THIS_SURAH;
  const desc = cutAtWord(stripDiacritics(s.name) + " - " + count, 155);
  const surahUrl = SITE + "/surah/" + s.slug + ".html";
  const ld = [
    breadcrumb([
      { name: A.LOGO, item: SITE + "/" },
      { name: s.name, item: surahUrl },
    ]),
  ];
  const sbtn = (o, dir) => {
    const label = dir === "pv" ? A.PREV_SURAH : A.NEXT_SURAH;
    return navBtn(o ? { label, href: "/surah/" + o.slug + ".html", surah: o.name, aria: label + A.COMMA + o.name } : { label, href: null }, dir);
  };
  const rows = s.words
    .map(
      (w) =>
        '<a class="row" href="/word/' + w.slug + '.html">' +
        '<span class="q w" style="flex:1;font-size:25px">' + esc(w.dw) + "</span>" +
        '<span class="m">' + A.AYAH + esc(w.label) + "</span>" + ROW_CHEV + "</a>"
    )
    .join("");
  const year = new Date().getFullYear();
  return (
    staticHead({ title, desc, canonical: SITE + "/surah/" + s.slug + ".html", ogTitle: title, ogDesc: desc, type: "website", jsonLd: ld }) +
    '<body><div id="bg"><i></i><i></i></div><div class="wrap">' +
    '<header><a class="logo sn" href="/">' + A.LOGO + "</a>" +
    '<a class="pill" href="/#/surah/' + s.no + '">' + EXT + A.APP + "</a></header>\n" +
    "<main>" +
    '<div class="shd"><h1 class="q">' + esc(s.name) + '</h1><div class="sub">' + count + "</div>" +
    '<div class="cw snav">' +
    '<div class="list g rs">' + rows + "</div>" +
    sbtn(s.prev, "pv") + sbtn(s.next, "nx") + "</div></div>\n" +
    '<div class="acts"><a class="btn o g mib" href="/#/surah/' + s.no + '">' + BOOK + A.ALL_SURAS + "</a></div>\n" +
    "</main>" +
    '<footer><div class="fl"><a href="/about/">' + A.F_ABOUT + '</a><a href="/privacy/">' + A.F_PRIVACY + '</a><a href="/terms/">' + A.F_TERMS + '</a><a href="/rights/">' + A.F_RIGHTS + '</a></div><div class="m">' + A.COPY + " " + year + " " + A.LOGO + "</div></footer>\n" +
    "</div></body></html>"
  );
}

// Static legal pages: /about, /privacy, /terms, /rights. Text is verbatim from
// shared/legal.js (never retyped here). Same bare sheet as the word pages.
export function renderLegalPage(entry) {
  const title = esc(entry.title) + " | " + A.LOGO;
  // The contact email becomes a mailto link; the paragraph text itself is unchanged.
  const paras = entry.paras.map((p) => '<p class="para">' + esc(p).replace(EMAIL_RE, '<a href="mailto:$&">$&</a>') + "</p>").join("\n");
  return (
    "<!doctype html>\n" +
    '<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    "<title>" + title + "</title>\n" +
    '<meta name="description" content="' + esc(entry.title) + '">\n' +
    '<link rel="canonical" href="' + SITE + "/" + entry.slug + '/">\n' +
    '<meta property="og:type" content="website"><meta property="og:title" content="' + esc(entry.title) + '"><meta property="og:description" content="' + esc(entry.title) + '"><meta property="og:image" content="' + SITE + '/og-2026-10.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:locale" content="ar_AR">\n' +
    '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' + esc(entry.title) + '"><meta name="twitter:description" content="' + esc(entry.title) + '"><meta name="twitter:image" content="' + SITE + '/og-2026-10.png">\n' +
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">\n' +
    '<link rel="stylesheet" href="/fonts/fonts.css">\n<link rel="stylesheet" href="/css/app.css">\n' +
    "<style>" + LEGACY_CSS + ".para{font-size:17px;line-height:1.95;margin:0 0 14px}</style>\n" +
    '<script src="/theme-boot.js"></script></head>\n' +
    '<body><main class="legal"><a href="/" class="sn" style="font-size:28px;text-decoration:none">' + A.LOGO + "</a>\n" +
    '<h1 class="aq" style="font-size:40px">' + esc(entry.title) + "</h1>\n" +
    paras + "\n" +
    '<a class="b" href="/">' + A.HOME + "</a>\n" +
    "</main></body></html>"
  );
}

function buildSitemap(records, surahList) {
  // The committed sitemap lists each surah's words in ascending ayah order
  // (the static pages keep the raw data order). Stable tie-break on data index.
  const ordered = records
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.surahSeq - b.r.surahSeq || a.r.labelNum - b.r.labelNum || a.i - b.i)
    .map((x) => x.r);
  let xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    "<url><loc>" + SITE + "/</loc><priority>1.0</priority></url>\n";
  for (const r of ordered) {
    xml += "<url><loc>" + SITE + "/word/" + r.slug + ".html</loc><priority>0.6</priority></url>\n";
  }
  for (const s of surahList || []) {
    xml += "<url><loc>" + SITE + "/surah/" + s.slug + ".html</loc><priority>0.5</priority></url>\n";
  }
  for (const entry of LEGAL) {
    xml += "<url><loc>" + SITE + "/" + entry.slug + "/</loc><priority>0.4</priority></url>\n";
  }
  return xml + "</urlset>\n";
}

export function hashFiles(files) {
  const h = crypto.createHash("sha256");
  for (const name of Object.keys(files).sort()) {
    h.update(name);
    h.update("\u0000");
    h.update(files[name]);
    h.update("\u0000");
  }
  return h.digest("hex");
}

// Empty data is always refused. How far the data may shrink is decided against the committed site (guardRemovals),
// not by a fixed minimum, so a deliberate, counted deletion is possible.
export function validateInput(surahs) {
  if (!Array.isArray(surahs) || !surahs.length) {
    throw new Error("no surah data (empty input)");
  }
  const total = surahs.reduce((n, e) => n + (Array.isArray(e.words) ? e.words.length : 0), 0);
  if (!total) throw new Error("refusing to publish: no words");
}

// The ayah label format: an ayah number or a range. Also enforced in the admin (wordErrors and the JSON import).
export const AYAH_LABEL_RE = /^[0-9]+(-[0-9]+)?$/;

function validateRecords(records) {
  const problems = [];
  records.forEach((r, i) => {
    if (!r.word) problems.push("word#" + i + ": empty word");
    if (!r.meaning) problems.push("word#" + i + ": empty meaning");
    if (!r.slug) problems.push("word#" + i + ": empty slug");
    if (!r.label) problems.push("word#" + i + ": empty label");
    // an ayah label is the ayah number or a range ("3" or "3-4"): it becomes part of the word page's file name and URL
    else if (!AYAH_LABEL_RE.test(r.label)) problems.push("word#" + i + ": ayah label is not a number or a range (" + JSON.stringify(r.label) + ")");
    if (!r.no) problems.push("word#" + i + ": unknown surah number");
    const segs = r.ayah && Array.isArray(r.ayah.segments) ? r.ayah.segments : [];
    if (!segs.length) problems.push("word#" + i + ": no ayah segments");
  });
  if (problems.length) {
    throw new Error("refusing to publish; invalid words:\n" + problems.join("\n"));
  }
}

// Per-platform video links: reelIg / reelTt / reelYt, each https on its platform's host. The public challenge carries
// a link only when it is set and valid; every other field of a day (private notes included) stays out, exactly as
// sanitizePublicChallenge decides. The old single "reel" link is kept as it is until release.
export const REEL_LINKS = [
  ["reelIg", ["instagram.com", "www.instagram.com"]],
  ["reelTt", ["tiktok.com", "www.tiktok.com", "vm.tiktok.com"]],
  ["reelYt", ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]],
];
export function reelLinkOk(url, hosts) {
  try {
    const u = new URL(String(url));
    return u.protocol === "https:" && hosts.includes(u.hostname.toLowerCase());
  } catch (e) {
    return false;
  }
}
export function publicChallenge(state) {
  const out = challenge.sanitizePublicChallenge(state);
  const src = state && Array.isArray(state.days) ? state.days : [];
  out.days.forEach((day, i) => {
    const s = src[i] || {};
    // a word reference keeps only its surah number and word, as the [no, word] pair of the committed file (Firestore,
    // which can't hold a list inside a list, stores it as {no, word}): no other field can reach the file
    day.w = day.w.map((r) => (Array.isArray(r) ? [r[0], r[1]] : [r && r.no, r && r.word]));
    for (const [key, hosts] of REEL_LINKS) {
      if (typeof s[key] !== "string" || !s[key]) continue;
      if (!reelLinkOk(s[key], hosts)) throw new Error("refusing to publish; day " + day.d + " has an invalid " + key + ": " + s[key]);
      day[key] = s[key];
    }
  });
  return out;
}

// --- Phase 5: the committed shape, strict checks, and the guards against the committed site --------------------------

// The committed public/words.json: surahs from 114 down, each with exactly these keys in this order.
export const SURAH_KEYS = ["surah", "words", "meanings", "ayahs", "source"];
export const AYAH_KEYS = ["label", "segments"];
export const SEGMENT_KEYS = ["num", "before", "hl", "after"];
// Hard ceiling on the words one publish may remove, whatever --allow-removals says: 10% of the committed words.
export const MAX_REMOVAL_SHARE = 0.1;

export const surahNumber = (name) => SURAH_NO[shortSurah(name)];
const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);

// The strict shape of public/data's surah list (Firestore's, which may also carry "no", or the committed file's).
// Messages name positions and field names only.
export function validateShape(surahs) {
  if (!Array.isArray(surahs) || !surahs.length) throw new Error("no surah data (empty input)");
  const p = [];
  if (surahs.length > 114) p.push("more than 114 surahs");
  const seen = new Set();
  surahs.forEach((s, i) => {
    const at = "surah#" + i;
    if (!isObj(s)) return p.push(at + ": not an object");
    for (const k of Object.keys(s)) if (!SURAH_KEYS.includes(k) && k !== "no") p.push(at + ": unknown key " + JSON.stringify(k));
    const no = typeof s.surah === "string" ? surahNumber(s.surah) : undefined;
    if (!no) p.push(at + ": the surah name is not one of the known surahs");
    else {
      if (seen.has(no)) p.push(at + ": surah " + no + " appears twice");
      seen.add(no);
    }
    if ("no" in s && (!Number.isInteger(s.no) || s.no < 1 || s.no > 114)) p.push(at + ": no is not a whole number from 1 to 114");
    else if ("no" in s && no && s.no !== no) p.push(at + ": no (" + s.no + ") does not match the surah name (" + no + ")");
    if (typeof s.source !== "string") p.push(at + ": source is not a string");
    const lists = ["words", "meanings", "ayahs"];
    for (const k of lists) if (!Array.isArray(s[k])) p.push(at + ": " + k + " is not a list");
    if (!lists.every((k) => Array.isArray(s[k]))) return;
    if (!s.words.length) p.push(at + ": no words");
    if (s.words.length !== s.meanings.length || s.words.length !== s.ayahs.length) p.push(at + ": words, meanings and ayahs differ in length");
    s.words.forEach((w, j) => { if (typeof w !== "string" || !w.trim()) p.push(at + " word#" + j + ": the word is not a non-empty string"); });
    s.meanings.forEach((m, j) => { if (typeof m !== "string" || !m.trim()) p.push(at + " word#" + j + ": the meaning is not a non-empty string"); });
    s.ayahs.forEach((a, j) => {
      const aw = at + " ayah#" + j;
      if (!isObj(a)) return p.push(aw + ": not an object");
      for (const k of Object.keys(a)) if (!AYAH_KEYS.includes(k)) p.push(aw + ": unknown key " + JSON.stringify(k));
      if (typeof a.label !== "string" || !AYAH_LABEL_RE.test(a.label)) p.push(aw + ": the label is not a number or a range");
      if (!Array.isArray(a.segments) || !a.segments.length) return p.push(aw + ": segments is not a non-empty list");
      a.segments.forEach((g, n) => {
        const gw = aw + " segment#" + n;
        if (!isObj(g)) return p.push(gw + ": not an object");
        for (const k of Object.keys(g)) if (!SEGMENT_KEYS.includes(k)) p.push(gw + ": unknown key " + JSON.stringify(k));
        if (!Number.isInteger(g.num)) p.push(gw + ": num is not a whole number");
        for (const k of ["before", "after"]) if (typeof g[k] !== "string") p.push(gw + ": " + k + " is not a string");
        if (typeof g.hl !== "string" || !g.hl) p.push(gw + ": hl is not a non-empty string");
      });
    });
  });
  if (p.length) throw new Error("refusing to publish; the data does not have the expected shape:\n" + p.join("\n"));
}

// Put the surah list in the committed shape: surahs from 114 down, keys in the committed order, no "no" field.
// Every text value is copied exactly as it is; nothing is trimmed or normalised.
export function normaliseSurahs(surahs) {
  validateShape(surahs);
  return surahs
    .map((s) => ({ s, no: surahNumber(s.surah) }))
    .sort((a, b) => b.no - a.no)
    .map(({ s }) => ({
      surah: s.surah,
      words: s.words.slice(),
      meanings: s.meanings.slice(),
      ayahs: s.ayahs.map((a) => ({ label: a.label, segments: a.segments.map((g) => ({ num: g.num, before: g.before, hl: g.hl, after: g.after })) })),
      source: s.source,
    }));
}

// One entry per word, keyed by its page slug: the identity of a word on the site.
export function wordIndex(surahs) {
  const slugs = seo.buildSlugs(surahs.map((s) => ({ ...s, no: surahNumber(s.surah) })));
  const out = new Map();
  let k = 0;
  surahs.forEach((s) => {
    const no = surahNumber(s.surah);
    s.words.forEach((w, i) => {
      const slug = slugs[k++];
      out.set(slug, { slug, no, i, id: no + "-" + i, surah: s.surah, word: w, meaning: s.meanings[i], ayah: s.ayahs[i], source: s.source });
    });
  });
  return out;
}

// The large-removal guard. Removed words are counted against the committed site: the count must equal
// allowRemovals exactly, it may never exceed 10% of the committed words (unless ownerReview: a pull request the owner
// reviews, opened by a Publish run started by hand with that exact count), never exceed maxRemovals when given (the
// automatic publish passes 7), and a surah may disappear only when its number is listed in allowSurahRemovals.
export function guardRemovals(committed, next, opt = {}) {
  const allow = opt.allowRemovals == null ? 0 : Number(opt.allowRemovals);
  const allowSurahs = (opt.allowSurahRemovals || []).map(Number);
  if (!Number.isInteger(allow) || allow < 0) throw new Error("refusing to publish: allow-removals must be a whole number, 0 or more");
  const before = wordIndex(committed), after = wordIndex(next);
  const removed = [...before.keys()].filter((s) => !after.has(s));
  const added = [...after.keys()].filter((s) => !before.has(s));
  const nosBefore = new Set(committed.map((s) => surahNumber(s.surah)));
  const nosAfter = new Set(next.map((s) => surahNumber(s.surah)));
  const removedSurahs = [...nosBefore].filter((n) => !nosAfter.has(n)).sort((a, b) => a - b);
  const ceiling = Math.floor(before.size * MAX_REMOVAL_SHARE);
  const max = opt.maxRemovals == null ? null : Number(opt.maxRemovals);
  if (max != null && !(Number.isInteger(max) && max >= 0)) throw new Error("refusing to publish: max-removals must be a whole number, 0 or more");
  const p = [];
  if (!after.size) p.push("the new data has no words");
  if (max != null && removed.length > max) p.push(removed.length + " words would be removed, more than the ceiling of " + max + " for this publish, whatever allow-removals says");
  else if (!opt.ownerReview && removed.length > ceiling) p.push(removed.length + " words would be removed, more than the ceiling of " + ceiling + " (10% of " + before.size + "), whatever allow-removals says; run Publish by hand with allow_removals " + removed.length + " to open a pull request for the owner");
  else if (removed.length !== allow) p.push(removed.length + " words would be removed (" + removed.join(", ") + ") but allow-removals is " + allow + "; it must match exactly");
  const unlisted = removedSurahs.filter((n) => !allowSurahs.includes(n));
  if (unlisted.length) p.push("surahs " + unlisted.join(", ") + " would be removed; list them in allow-surah-removals to allow it");
  if (p.length) throw new Error("refusing to publish; removal guard:\n" + p.join("\n"));
  return { removed, added, removedSurahs, before, after };
}

// The site's own word key (public/index.html, `k:norm(word)`): a challenge reference [no, key] names the word of surah
// no whose key is exactly that. test/publish-build.test.js keeps this copy identical to the site's.
export const siteWordKey = (s) =>
  String(s)
    .replace(/[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0624/g, "\u0648")
    .replace(/\u0626/g, "\u064A")
    .replace(/\s+/g, " ")
    .trim();

// Challenge integrity: the days are numbered 1..N with N as committed, every word reference resolves to a word of the
// new data, and the dates are null or valid. Messages name days and positions, never the words.
export function checkChallenge(pub, surahs, committedChallenge) {
  const p = [];
  const bySurah = new Map(surahs.map((s) => [surahNumber(s.surah), new Set(s.words.map(siteWordKey))]));
  const days = Array.isArray(pub && pub.days) ? pub.days : [];
  const want = committedChallenge && Array.isArray(committedChallenge.days) ? committedChallenge.days.length : days.length;
  if (days.length !== want) p.push("the challenge has " + days.length + " days, the site has " + want);
  days.forEach((day, i) => {
    if (day.d !== i + 1) p.push("day #" + (i + 1) + " is numbered " + JSON.stringify(day.d));
    (day.w || []).forEach((r, k) => {
      const set = bySurah.get(r[0]);
      if (!set || !set.has(r[1])) p.push("day " + day.d + ": word reference " + (k + 1) + " (surah " + r[0] + ") is not a word of the new data");
    });
  });
  if (pub.startDate != null && !(/^\d{4}-\d{2}-\d{2}$/.test(pub.startDate) && !isNaN(Date.parse(pub.startDate)))) p.push("startDate is not a date");
  if (pub.releasedUpTo != null && !(Number.isInteger(pub.releasedUpTo) && pub.releasedUpTo >= 0 && pub.releasedUpTo <= days.length)) p.push("releasedUpTo is not a day number");
  if (p.length) throw new Error("refusing to publish; challenge:\n" + p.join("\n"));
}

// The generated site must hang together: one page per word, and the sitemap lists exactly the generated pages.
export function checkSiteFiles(files, wordCount) {
  const p = [];
  const pages = Object.keys(files).filter((f) => /^word\/[^/]+\.html$/.test(f));
  if (pages.length !== wordCount) p.push(pages.length + " word pages for " + wordCount + " words");
  const locs = [...String(files["sitemap.xml"] || "").matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1].replace(SITE, ""));
  const fileOf = (u) => (u === "/" ? null : u.endsWith("/") ? u.slice(1) + "index.html" : u.slice(1));
  for (const u of locs) { const f = fileOf(u); if (f && !(f in files)) p.push("the sitemap lists " + u + ", which is not generated"); }
  const listed = new Set(locs.map(fileOf));
  for (const f of Object.keys(files)) if (/^(word|surah)\/[^/]+\.html$/.test(f) && !listed.has(f)) p.push(f + " is not in the sitemap");
  if (p.length) throw new Error("refusing to publish; generated site:\n" + p.join("\n"));
}

// The redirects for removed pages (owner decision D-4): a removed word page goes to its surah page, or to the home page
// when the surah is gone too; a removed surah page goes to the home page. A redirect whose source is a live page again
// is dropped, and one that pointed at a page removed now is pointed at that page's new destination.
export function updateRedirects(redirects, { removedPages, livePages }) {
  const out = [];
  for (const r of redirects || []) {
    if (livePages.has(r.source)) continue;
    out.push(removedPages.has(r.destination) ? { ...r, destination: removedPages.get(r.destination) } : r);
  }
  const sources = new Set(out.map((r) => r.source));
  for (const [source, destination] of removedPages) if (!sources.has(source)) out.push({ source, destination, type: 301 });
  return out;
}

// Which share images to make again: new words, and words whose image inputs (the word, its surah, its ayah) changed.
// The meaning is not on the image, so a meaning-only edit keeps the image as it is.
export function imagesToMake(before, after) {
  const key = (w) => JSON.stringify([w.surah, w.word, w.ayah]);
  return [...after.values()].filter((w) => !before.has(w.slug) || key(before.get(w.slug)) !== key(w));
}

const GENERATED_DIRS = [["word", ".html"], ["surah", ".html"], ["og/word", ".png"]];

// Phase 5 publish: update the site tree and the Hosting config in place. Returns a summary of file names and counts.
export function publishToTree(input, opt) {
  const site = path.resolve(opt.site);
  const committed = JSON.parse(fs.readFileSync(path.join(site, "words.json"), "utf8"));
  const committedChallenge = JSON.parse(fs.readFileSync(path.join(site, "challenge.json"), "utf8"));
  const surahs = normaliseSurahs(input.surahs);
  const g = guardRemovals(committed, surahs, opt);
  const pub = publicChallenge(input.challenge);
  checkChallenge(pub, surahs, committedChallenge);
  const built = buildSite(surahs, input.challenge);
  checkSiteFiles(built.files, built.wordCount);

  // what changes in the tree
  const write = Object.keys(built.files).filter((f) => {
    const p = path.join(site, f);
    return !fs.existsSync(p) || fs.readFileSync(p, "utf8") !== built.files[f];
  });
  const slugs = new Set(g.after.keys());
  const remove = [];
  for (const [dir, ext] of GENERATED_DIRS) {
    const d = path.join(site, dir);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!f.endsWith(ext)) continue;
      const rel = dir + "/" + f;
      const keep = dir === "og/word" ? slugs.has(f.slice(0, -ext.length)) : rel in built.files;
      if (!keep) remove.push(rel);
    }
  }
  remove.sort();
  const surahSlugOf = new Map(built.surahs.map((s) => [s.no, s.slug]));
  const removedPages = new Map();
  for (const f of remove) {
    if (f.startsWith("word/")) {
      const was = g.before.get(f.slice(5, -5));
      const to = was && surahSlugOf.get(was.no);
      removedPages.set("/" + f, to ? "/surah/" + to + ".html" : "/");
    } else if (f.startsWith("surah/")) removedPages.set("/" + f, "/");
  }
  const livePages = new Set(Object.keys(built.files).filter((f) => /^(word|surah)\//.test(f)).map((f) => "/" + f));
  const fbPath = path.resolve(opt.firebaseJson);
  const fbText = fs.readFileSync(fbPath, "utf8");
  const fb = JSON.parse(fbText);
  const redirects = updateRedirects(fb.hosting.redirects, { removedPages, livePages });
  const redirectsChanged = JSON.stringify(redirects) !== JSON.stringify(fb.hosting.redirects || []);
  const images = imagesToMake(g.before, g.after).map((w) => ({ slug: w.slug, id: w.id }));

  const summary = {
    changed: !!(write.length || remove.length || redirectsChanged || images.length),
    rev: input.rev == null ? null : input.rev,
    words: { before: g.before.size, after: g.after.size, added: g.added, removed: g.removed },
    surahs: { before: committed.length, after: surahs.length, removed: g.removedSurahs },
    write, remove, images: images.map((x) => x.slug),
    redirects: { added: [...removedPages.keys()].filter((s) => !(fb.hosting.redirects || []).some((r) => r.source === s)), changed: redirectsChanged },
  };
  if (!summary.changed) return { summary, surahs, committed, pub, committedChallenge };

  for (const f of remove) fs.rmSync(path.join(site, f));
  writeSite(site, Object.fromEntries(write.map((f) => [f, built.files[f]])), null);
  fs.writeFileSync(path.join(site, "rev.json"), JSON.stringify({ rev: summary.rev, hash: built.hash, words: built.wordCount }, null, 1) + "\n", "utf8");
  summary.write.push("rev.json");
  if (redirectsChanged) {
    fb.hosting.redirects = redirects;
    fs.writeFileSync(fbPath, JSON.stringify(fb, null, 2) + "\n", "utf8");
  }
  if (images.length && !opt.noImages) makeShareImages(site, images.map((x) => x.id));
  return { summary, surahs, committed, pub, committedChallenge };
}

// The share images, made by scripts/gen-share-images.js in Chromium from the updated tree.
export function makeShareImages(site, ids) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "gen-share-images.js"), "--root", site, "--only", ids.join(",")], { encoding: "utf8", timeout: 600000 });
  if (r.status !== 0) throw new Error("share images failed (exit " + r.status + ")\n" + String(r.stdout || "").slice(-2000) + String(r.stderr || "").slice(-2000));
}

// Build the whole site in memory. Returns { files, hash, wordCount }.
export function buildSite(surahs, challengeState) {
  validateInput(surahs);
  const records = buildRecords(surahs);
  validateRecords(records);
  const surahList = buildSurahs(records);
  const files = {};
  files["words.json"] = JSON.stringify(surahs, null, 2);
  files["challenge.json"] = JSON.stringify(publicChallenge(challengeState), null, 1);
  files["sitemap.xml"] = buildSitemap(records, surahList);
  files["css/app.css"] = appCss();
  for (const r of records) files["word/" + r.slug + ".html"] = renderWordPage(r);
  for (const s of surahList) files["surah/" + s.slug + ".html"] = renderSurahPage(s);
  for (const entry of LEGAL) files[entry.slug + "/index.html"] = renderLegalPage(entry);
  return { files, hash: hashFiles(files), wordCount: records.length, surahs: surahList };
}

export function writeSite(outDir, files, meta) {
  const out = path.resolve(outDir);
  for (const [name, content] of Object.entries(files)) {
    const p = path.resolve(out, name);
    // every generated file stays inside the output folder (a name with ".." or an absolute path is refused)
    if (!p.startsWith(out + path.sep)) throw new Error("refusing to write outside " + out + ": " + JSON.stringify(name));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, "utf8");
  }
  if (!meta) return; // the publish mode writes its own rev.json
  const revJson = {
    rev: meta.rev == null ? null : meta.rev,
    hash: meta.hash,
    words: meta.wordCount,
    generatedAtUtc: new Date().toISOString(),
  };
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "rev.json"), JSON.stringify(revJson, null, 1), "utf8");
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(path.resolve(p), "utf8"));
}

function parseArgs(argv) {
  const args = { allowRemovals: 0, allowSurahRemovals: [] };
  const num = (v, name) => {
    if (!/^[0-9]+$/.test(String(v))) throw new Error(name + " must be a whole number, 0 or more");
    return Number(v);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from-json") args.fromJson = argv[++i];
    else if (a === "--challenge-json") args.challengeJson = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--current-url") args.currentUrl = argv[++i];
    else if (a === "--project") args.project = argv[++i];
    else if (a === "--publish") args.publish = true;
    else if (a === "--site") args.site = argv[++i];
    else if (a === "--firebase-json") args.firebaseJson = argv[++i];
    else if (a === "--report") args.report = argv[++i];
    else if (a === "--summary") args.summary = argv[++i];
    else if (a === "--no-images") args.noImages = true;
    else if (a === "--allow-removals") args.allowRemovals = num(argv[++i], "--allow-removals");
    else if (a === "--max-removals") args.maxRemovals = num(argv[++i], "--max-removals");
    else if (a === "--owner-review") args.ownerReview = true;
    else if (a === "--allow-surah-removals") args.allowSurahRemovals = String(argv[++i] || "").split(",").filter(Boolean).map((v) => num(v.trim(), "--allow-surah-removals"));
    else throw new Error("unknown argument: " + a);
  }
  return args;
}

// Read-only: the two public documents and nothing else (never admin/challengeNotes). The Firestore client itself, not
// admin.initializeApp(): firebase-admin 12 refuses the short-lived Workload Identity credential file, while the client
// accepts it (see scripts/firestore-export.mjs). It also follows FIRESTORE_EMULATOR_HOST, which the tests use.
export const READ_DOCS = ["public/data", "public/challenge"];
export async function loadFromFirestore(projectId) {
  const { Firestore } = require("firebase-admin").firestore;
  const db = new Firestore(projectId ? { projectId } : {});
  try {
    const [dataSnap, chSnap] = await Promise.all(READ_DOCS.map((d) => db.doc(d).get()));
    const d = dataSnap.exists ? dataSnap.data() : {};
    const c = chSnap.exists ? chSnap.data() : {};
    const surahs = Array.isArray(d.surahs) ? d.surahs : [];
    return { surahs, rev: d.rev == null ? null : d.rev, challenge: c };
  } finally {
    await db.terminate();
  }
}

async function fetchRev(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (!args.out && !args.publish) throw new Error("--out DIR or --publish is required");

  let surahs = null;
  let challengeState = null;
  let rev = null;

  if (args.fromJson) {
    const j = readJson(args.fromJson);
    surahs = Array.isArray(j) ? j : j && j.surahs;
    if (j && !Array.isArray(j) && j.rev != null) rev = j.rev;
  }
  if (args.challengeJson) challengeState = readJson(args.challengeJson);

  if (!surahs || !challengeState) {
    const loaded = await loadFromFirestore(args.project);
    if (!surahs) {
      surahs = loaded.surahs;
      rev = loaded.rev;
    }
    if (!challengeState) challengeState = loaded.challenge;
  }

  if (args.publish) {
    const site = args.site || path.join(ROOT, "public");
    const res = publishToTree({ surahs, challenge: challengeState, rev }, {
      site, firebaseJson: args.firebaseJson || path.join(ROOT, "firebase.json"), noImages: !!args.noImages,
      allowRemovals: args.allowRemovals, allowSurahRemovals: args.allowSurahRemovals,
      maxRemovals: args.maxRemovals, ownerReview: !!args.ownerReview,
    });
    // file names and counts only: this goes to the (public) Actions log
    if (args.summary) fs.writeFileSync(path.resolve(args.summary), JSON.stringify(res.summary, null, 1) + "\n", "utf8");
    if (!res.summary.changed) {
      console.log("publish-build: no-change");
      return 0;
    }
    if (args.report) {
      const { buildReport } = await import("./publish-report.mjs");
      fs.writeFileSync(path.resolve(args.report), buildReport({ before: res.committed, after: res.surahs, beforeChallenge: res.committedChallenge, afterChallenge: res.pub, summary: res.summary }), "utf8");
    }
    const sm = res.summary;
    console.log("publish-build: changed (rev " + sm.rev + "; words " + sm.words.before + " -> " + sm.words.after + "; " + sm.write.length + " written, " + sm.remove.length + " removed, " + sm.images.length + " share images)");
    return 0;
  }

  // the --out mode puts the data in the committed shape and applies the same guards before building
  const committedDir = path.join(ROOT, "public");
  const committed = JSON.parse(fs.readFileSync(path.join(committedDir, "words.json"), "utf8"));
  surahs = normaliseSurahs(surahs);
  guardRemovals(committed, surahs, args);
  checkChallenge(publicChallenge(challengeState), surahs, JSON.parse(fs.readFileSync(path.join(committedDir, "challenge.json"), "utf8")));
  const { files, hash, wordCount } = buildSite(surahs, challengeState);
  checkSiteFiles(files, wordCount);

  if (args.currentUrl) {
    const live = await fetchRev(args.currentUrl);
    if (live && live.hash && live.hash === hash) {
      console.log("publish-build: no-change");
      return 0;
    }
  }

  writeSite(args.out, files, { rev, hash, wordCount });
  console.log("publish-build: changed");
  return 0;
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main(process.argv.slice(2)).catch((e) => {
    console.error("publish-build: " + e.message);
    process.exit(1);
  });
}
