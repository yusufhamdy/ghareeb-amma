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
  APP: "\u0627\u0641\u062a\u062d \u0641\u064a \u0627\u0644\u062a\u0637\u0628\u064a\u0642", // "open in the app"
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
};

const SURAH_PREFIX_RE = /^\u0633\u0648\u0631\u0629\s*/; // leading "surah "

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

// Fixed inline stylesheet shared by every static word page (ASCII). Mirrors the
// design-spec-final `dlword` screen (cards, chips, RTL logical spacing).
const CSS =
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
        next: sorted[idx + 1] ? { word: sorted[idx + 1].word, slug: sorted[idx + 1].slug } : null,
      });
    });
  });
  return records;
}

export function renderWordPage(r) {
  const title = A.T_PRE + esc(r.word) + A.T_SUF + " | " + A.LOGO;
  const ogTitle = A.T_PRE + esc(r.word) + A.T_SUF;
  const descMeaning =
    String(r.rawMeaning).startsWith(String(r.word) + ":")
      ? r.rawMeaning
      : String(r.word) + ": " + r.rawMeaning;
  const desc = esc(descMeaning) + " (" + esc(r.surahFull) + A.COMMA + A.AYAH + esc(r.label) + ")";
  const ayah = renderAyah(r.ayah);
  const ext =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4 10 14M18 14v6H4V6h6"/></svg>';
  const book =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z"/></svg>';
  const chev =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';
  const chips = r.others
    .map((o) => '<a class="chip q" href="/word/' + o.slug + '.html">' + esc(o.word) + "</a>")
    .join("");
  const nextBtn = r.next ? '<a class="btn o" href="/word/' + r.next.slug + '.html">' + A.NEXT + "</a>" : "";
  const others =
    '<div class="card"><h2>' + A.OTHER_SAME + "</h2>" +
    (chips ? '<div class="chips">' + chips + "</div>" : "") +
    '<div class="acts">' + nextBtn +
    '<a class="btn o" href="/#/surah/' + r.no + '">' + book + A.ALL_SURAH + "</a>" +
    "</div></div>";
  const year = new Date().getFullYear();
  return (
    "<!doctype html>\n" +
    '<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    "<title>" + title + "</title>\n" +
    '<meta name="description" content="' + desc + '">\n' +
    '<link rel="canonical" href="' + SITE + "/word/" + r.slug + '.html">\n' +
    '<meta property="og:title" content="' + ogTitle + '"><meta property="og:description" content="' + desc + '"><meta property="og:image" content="' + SITE + '/og-image.png"><meta property="og:locale" content="ar_AR">\n' +
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">\n' +
    '<link rel="stylesheet" href="/fonts/fonts.css">\n' +
    "<style>" + CSS + "</style></head>\n" +
    '<body><main><header><a class="logo q" href="/">' + A.LOGO + "</a>" +
    '<a class="pill" href="/#/word/' + r.no + "-" + r.idx + '">' + ext + A.APP + "</a></header>\n" +
    '<a class="pill" href="/#/surah/' + r.no + '">' + esc(r.surahShort) + A.DOT_AYAH + esc(r.label) + chev + "</a>\n" +
    '<div class="cols">' +
    '<div class="card"><div class="wd q">' + esc(r.word) + '</div><div class="ay q">' + ayah + "</div></div>" +
    '<div class="card"><div class="m">' + A.MEANING + '</div><div class="mn">' + esc(r.meaning) + "</div></div>" +
    "</div>\n" +
    '<p class="m">' + esc(r.source) + "</p>\n" +
    others +
    '<footer><div class="fl"><a href="/about/">' + A.F_ABOUT + '</a><a href="/privacy/">' + A.F_PRIVACY + '</a><a href="/terms/">' + A.F_TERMS + '</a><a href="/rights/">' + A.F_RIGHTS + '</a></div><div class="m">' + A.COPY + " " + year + " " + A.LOGO + "</div></footer>\n" +
    "</main></body></html>"
  );
}

// Static legal pages: /about, /privacy, /terms, /rights. Text is verbatim from
// functions/legal.js (never retyped here). Same bare sheet as the word pages.
export function renderLegalPage(entry) {
  const title = esc(entry.title) + " | " + A.LOGO;
  const paras = entry.paras.map((p) => '<p class="para">' + esc(p) + "</p>").join("\n");
  return (
    "<!doctype html>\n" +
    '<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    "<title>" + title + "</title>\n" +
    '<meta name="description" content="' + esc(entry.title) + '">\n' +
    '<link rel="canonical" href="' + SITE + "/" + entry.slug + '/">\n' +
    '<meta property="og:title" content="' + esc(entry.title) + '"><meta property="og:locale" content="ar_AR">\n' +
    '<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png"><link rel="apple-touch-icon" href="/apple-touch-icon.png">\n' +
    '<link rel="stylesheet" href="/fonts/fonts.css">\n' +
    "<style>" + CSS + ".para{font-size:17px;line-height:1.95;margin:0 0 14px}</style></head>\n" +
    '<body><main><a href="/" class="q" style="font-size:28px;text-decoration:none">' + A.LOGO + "</a>\n" +
    '<h1 class="q" style="font-size:40px">' + esc(entry.title) + "</h1>\n" +
    paras + "\n" +
    '<a class="b" href="/">' + A.HOME + "</a>\n" +
    "</main></body></html>"
  );
}

function buildSitemap(records) {
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
  const files = {};
  files["words.json"] = JSON.stringify(surahs, null, 2);
  files["challenge.json"] = JSON.stringify(challenge.sanitizePublicChallenge(challengeState), null, 1);
  files["sitemap.xml"] = buildSitemap(records);
  for (const r of records) files["word/" + r.slug + ".html"] = renderWordPage(r);
  for (const entry of LEGAL) files[entry.slug + "/index.html"] = renderLegalPage(entry);
  return { files, hash: hashFiles(files), wordCount: records.length };
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
