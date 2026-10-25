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
 *   (default)            Firestore via firebase-admin (public/data,
 *                        public/challenge)
 *   --from-json PATH     read the surah list from a local JSON file
 *   --challenge-json P   read the challenge doc from a local JSON file
 *   --out DIR            output directory (required)
 *   --current-url URL    fetch the live rev.json; skip (no-change) when the
 *                        content hash matches
 *   --project ID         Firebase project id for the admin SDK path
 *
 * Output (written only under --out; never over the committed public/ tree):
 *   words.json, challenge.json, sitemap.xml, word/<slug>.html, rev.json
 *   plus the static legal pages about/index.html, privacy/index.html,
 *   terms/index.html, rights/index.html (copy verbatim from functions/legal.js).
 *
 * Safety: the whole site is built in memory, validated, and only then written.
 * It aborts with a non-zero exit and no output on empty data, fewer than 73
 * words, or any invalid word - a partial or empty site is never published.
 *
 * ASCII-ONLY: every Arabic fragment is a \u escape (see
 * test/arabic-guard.test.js, which treats literal Arabic in new files as
 * protected content). The canonical slug scheme comes from functions/seo.js and
 * the public challenge payload from functions/challenge.js, so both stay single
 * sources of truth. The rendered HTML mirrors the committed static pages
 * byte-for-byte (the older committed format, which is the one Google indexed).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const seo = require("../functions/seo.js");
const challenge = require("../functions/challenge.js");
const { LEGAL } = require("../functions/legal.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SITE = "https://ghareebalquran.com";
const MIN_WORDS = 73;

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
  ":root{--bg:#F2F0E8;--tx:#1D2B25;--mu:#55645D;--ac:#1E6B50;--ln:rgba(29,43,37,.14);--gb:rgba(255,255,255,.62)}\n" +
  "@media(prefers-color-scheme:dark){:root{--bg:#0A0E1F;--tx:#ECEFFA;--mu:#A3ABC9;--ac:#9FB4FF;--ln:rgba(255,255,255,.13);--gb:rgba(255,255,255,.07)}}\n" +
  "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font-family:'IBM Plex Sans Arabic',sans-serif;line-height:1.8}\n" +
  "main{max-width:680px;margin:0 auto;padding:22px 18px 60px}a{color:var(--ac);text-decoration:none}.q{font-family:'Amiri Quran',serif}\n" +
  ".m{color:var(--mu);font-size:14px}header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}\n" +
  ".logo{font-size:27px}h1{font-size:44px;margin:8px 0;color:var(--ac);line-height:1.5}\n" +
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
  return segs
    .map((sg) => A.OL + esc(sg.before) + "<mark>" + esc(sg.hl) + "</mark>" + esc(sg.after) + A.OR)
    .join(" ");
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
        slug: slugs[si++], // slugs are assigned in data order (see functions/seo.js)
        word: words[i],
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
        rawMeaning: it.raw,
        meaning: strippedMeaning(it.word, it.raw),
        label: it.label,
        labelNum: it.labelNum,
        slug: it.slug,
        no: SURAH_NO[short],
        idx,
        ayah: it.ayah,
        others: sorted
          .map((o, j) => ({ word: o.word, slug: o.slug, j }))
          .filter((o) => o.j !== idx)
          .map((o) => ({ word: o.word, slug: o.slug })),
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
// the synchronous theme bootstrap (applied before first paint).
function staticHead(o) {
  return (
    "<!doctype html>\n" +
    '<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
    '<meta name="theme-color" content="#F2F0E8">\n' +
    "<title>" + o.title + "</title>\n" +
    '<meta name="description" content="' + o.desc + '">\n' +
    '<link rel="canonical" href="' + o.canonical + '">\n' +
    '<meta property="og:type" content="' + (o.type || "website") + '"><meta property="og:title" content="' + o.ogTitle + '"><meta property="og:description" content="' + o.ogDesc + '"><meta property="og:image" content="' + SITE + '/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:locale" content="ar_AR">\n' +
    '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' + o.ogTitle + '"><meta name="twitter:description" content="' + o.ogDesc + '"><meta name="twitter:image" content="' + SITE + '/og.png">\n' +
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">\n' +
    '<link rel="stylesheet" href="/fonts/fonts.css">\n<link rel="stylesheet" href="/css/app.css">\n' +
    '<script src="/theme-boot.js"></script>\n' +
    (o.jsonLd || []).map((j) => '<script type="application/ld+json">' + jsonLd(j) + "</script>\n").join("") +
    "</head>\n"
  );
}

const CHEV_R = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>';
const CHEV_L = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
const EXT =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4 10 14M18 14v6H4V6h6"/></svg>';
const BOOK =
  '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z"/></svg>';

// The prev/next pill shared by the word and surah pages (same markup as the
// app's pnBtn): o = { label, href, surah, aria }; no href -> disabled. The
// surah line (open book + name) shows whenever o.surah is set.
function navBtn(o, dir) {
  const ps = o.surah ? '<span class="ps" aria-hidden="true">' + BOOK + esc(o.surah) + "</span>" : "";
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

// JSON-LD for the static pages, ASCII-escaped so the generator stays ASCII-only.
function jsonLd(obj) {
  return JSON.stringify(obj).replace(/[\u0080-\uffff]/g, (c) => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0"));
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
    s.words.push({ word: r.word, slug: r.slug, label: r.label });
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
    .map((o) => '<a class="g chip q" href="/word/' + o.slug + '.html">' + esc(o.word) + "</a>")
    .join("");
  const others =
    '<div class="g card"><h2>' + A.OTHER_SAME + "</h2>" +
    (chips ? '<div class="chips">' + chips + "</div>" : "") +
    '<div class="acts"><a class="btn o g" href="/surah/' + r.surahSlug + '.html">' + BOOK + A.ALL_SURAH + "</a></div></div>";
  const year = new Date().getFullYear();
  return (
    staticHead({ title, desc, canonical: SITE + "/word/" + r.slug + ".html", ogTitle, ogDesc: desc, type: "article", jsonLd: ld }) +
    '<body><div id="bg"><i></i><i></i></div><div class="wrap">' +
    '<header><a class="logo q" href="/">' + A.LOGO + "</a>" +
    '<a class="pill" href="/#/word/' + r.no + "-" + r.idx + '">' + EXT + A.APP + "</a></header>\n" +
    "<main>" +
    '<a class="pill" href="/surah/' + r.surahSlug + '.html">' + esc(r.surahShort) + A.DOT_AYAH + esc(r.label) + CHEV_L + "</a>\n" +
    '<div class="cw">' + navBtn(pv, "pv") +
    '<div class="cols">' +
    '<div class="g card"><h1 class="wd q">' + esc(r.word) + '</h1><div class="vr"><div class="ay q">' + ayah + "</div></div></div>" +
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
        '<span class="q w" style="flex:1;font-size:25px">' + esc(w.word) + "</span>" +
        '<span class="m">' + A.AYAH + esc(w.label) + "</span>" + CHEV_L + "</a>"
    )
    .join("");
  const year = new Date().getFullYear();
  return (
    staticHead({ title, desc, canonical: SITE + "/surah/" + s.slug + ".html", ogTitle: title, ogDesc: desc, type: "website", jsonLd: ld }) +
    '<body><div id="bg"><i></i><i></i></div><div class="wrap">' +
    '<header><a class="logo q" href="/">' + A.LOGO + "</a>" +
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
// functions/legal.js (never retyped here). Same bare sheet as the word pages.
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
    '<meta property="og:type" content="website"><meta property="og:title" content="' + esc(entry.title) + '"><meta property="og:description" content="' + esc(entry.title) + '"><meta property="og:image" content="' + SITE + '/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:locale" content="ar_AR">\n' +
    '<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="' + esc(entry.title) + '"><meta name="twitter:description" content="' + esc(entry.title) + '"><meta name="twitter:image" content="' + SITE + '/og.png">\n' +
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">\n' +
    '<link rel="stylesheet" href="/fonts/fonts.css">\n<link rel="stylesheet" href="/css/app.css">\n' +
    "<style>" + LEGACY_CSS + ".para{font-size:17px;line-height:1.95;margin:0 0 14px}</style>\n" +
    '<script src="/theme-boot.js"></script></head>\n' +
    '<body><main class="legal"><a href="/" class="q" style="font-size:28px;text-decoration:none">' + A.LOGO + "</a>\n" +
    '<h1 class="q" style="font-size:40px">' + esc(entry.title) + "</h1>\n" +
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

export function validateInput(surahs) {
  if (!Array.isArray(surahs) || !surahs.length) {
    throw new Error("no surah data (empty input)");
  }
  const total = surahs.reduce((n, e) => n + (Array.isArray(e.words) ? e.words.length : 0), 0);
  if (total < MIN_WORDS) {
    throw new Error("refusing to publish: only " + total + " words (< " + MIN_WORDS + ")");
  }
}

function validateRecords(records) {
  const problems = [];
  records.forEach((r, i) => {
    if (!r.word) problems.push("word#" + i + ": empty word");
    if (!r.meaning) problems.push("word#" + i + ": empty meaning");
    if (!r.slug) problems.push("word#" + i + ": empty slug");
    if (!r.label) problems.push("word#" + i + ": empty label");
    if (!r.no) problems.push("word#" + i + ": unknown surah number");
    const segs = r.ayah && Array.isArray(r.ayah.segments) ? r.ayah.segments : [];
    if (!segs.length) problems.push("word#" + i + ": no ayah segments");
  });
  if (problems.length) {
    throw new Error("refusing to publish; invalid words:\n" + problems.join("\n"));
  }
}

// Build the whole site in memory. Returns { files, hash, wordCount }.
export function buildSite(surahs, challengeState) {
  validateInput(surahs);
  const records = buildRecords(surahs);
  validateRecords(records);
  const surahList = buildSurahs(records);
  const files = {};
  files["words.json"] = JSON.stringify(surahs, null, 2);
  files["challenge.json"] = JSON.stringify(challenge.sanitizePublicChallenge(challengeState), null, 1);
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
    const p = path.join(out, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content, "utf8");
  }
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
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from-json") args.fromJson = argv[++i];
    else if (a === "--challenge-json") args.challengeJson = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--current-url") args.currentUrl = argv[++i];
    else if (a === "--project") args.project = argv[++i];
    else throw new Error("unknown argument: " + a);
  }
  return args;
}

async function loadFromFirestore(projectId) {
  const admin = require("firebase-admin");
  if (!admin.apps.length) admin.initializeApp(projectId ? { projectId } : undefined);
  const db = admin.firestore();
  const [dataSnap, chSnap] = await Promise.all([db.doc("public/data").get(), db.doc("public/challenge").get()]);
  const d = dataSnap.exists ? dataSnap.data() : {};
  const c = chSnap.exists ? chSnap.data() : {};
  const surahs = Array.isArray(d.surahs) ? d.surahs : Array.isArray(d) ? d : [];
  return { surahs, rev: d.rev == null ? null : d.rev, challenge: c };
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
  if (!args.out) throw new Error("--out DIR is required");

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

  const { files, hash, wordCount } = buildSite(surahs, challengeState);

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
