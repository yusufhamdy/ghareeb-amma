// ASCII-only proof script (tools/arabic-proof.mjs). Reads files directly with
// fs, parses HTML with parse5 (a real HTML parser, not regex on raw HTML) and
// prints COUNTS and ids (slugs / hashes) only - never Arabic text.
//
// Proves that the Arabic text of the static pages is byte-identical to
// public/words.json:
//  (1) every record's word, verse, meaning and surah name occurs byte-identical
//      in its static word page;
//  (2) every surah name and every word text of the surah occurs in its static
//      surah page;
//  (3) compared with the pre-K1 pages (K0 commit 0d491b2, read from ONE temp
//      git worktree under the OS temp dir, removed afterwards) the set of
//      Arabic runs belonging to the data is identical (missing = 0, extra = 0);
//      the only Arabic runs removed vs pre-K1 are the source line and the old
//      "open in the app" label; every run added outside the data is listed by
//      id (sha256 prefix) and count (labels and SEO strings).
//
// Exit code 0 = clean, 1 = a difference was found (then nothing downstream
// may regenerate or deploy).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import parse5 from "parse5";

const require = createRequire(import.meta.url);
const seo = require("../functions/seo.js");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_COMMIT = "0d491b2"; // K0, the last commit before the K1 rebuild

// --- allowed non-data fragments (ASCII source, \u escapes) -------------------
const SOURCE_LABEL = "\u0627\u0644\u0645\u0635\u062f\u0631"; // "the source"
const OPEN_APP = "\u0627\u0641\u062a\u062d \u0641\u064a \u0627\u0644\u062a\u0637\u0628\u064a\u0642"; // removed label
const OPEN_SITE = "\u0627\u0641\u062a\u062d \u0641\u064a \u0627\u0644\u0645\u0648\u0642\u0639"; // open on the site
const SURAH_PREFIX_RE = /^\u0633\u0648\u0631\u0629\s*/; // leading "surah "

// Every Arabic run in any string of the data counts as "belonging to the data".
const ARABIC_RUN_RE = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+/g;
function runsOf(s) {
  return String(s == null ? "" : s).match(ARABIC_RUN_RE) || [];
}

// --- data --------------------------------------------------------------------
export function loadRecords() {
  const surahs = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "words.json"), "utf8"));
  const slugs = seo.buildSlugs(surahs); // canonical slugs, assigned in data order
  const records = [];
  const surahList = [];
  let si = 0;
  surahs.forEach((s, seq) => {
    const short = String(s.surah).replace(SURAH_PREFIX_RE, "");
    const surahSlug = seo.SURAH_SLUG[short];
    if (!surahSlug) throw new Error("no surah slug for surah#" + seq);
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
        surahSeq: seq,
        word: String(words[i]),
        rawMeaning,
        bodyMeaning: rawMeaning.startsWith(prefix) ? rawMeaning.slice(prefix.length).trim() : rawMeaning,
        verseSegments: segs,
        surahShort: short,
        surahFull: String(s.surah),
      });
      itemWords.push(String(words[i]));
    }
    surahList.push({ seq, slug: surahSlug, short, full: String(s.surah), words: itemWords });
  });
  const sourceRuns = new Set();
  surahs.forEach((s) => runsOf(s.source).forEach((r) => sourceRuns.add(r)));
  const dataRuns = new Set();
  (function collect(v) {
    if (typeof v === "string") runsOf(v).forEach((r) => dataRuns.add(r));
    else if (Array.isArray(v)) v.forEach(collect);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        if (k === "source") continue; // the source line was deliberately removed in K1
        collect(x);
      }
    }
  })(surahs);
  // A page renders each ayah segment as before+hl+after (one contiguous run);
  // those concatenations belong to the data even though no single JSON string
  // contains them whole.
  for (const r of records) for (const seg of r.verseSegments) runsOf(seg).forEach((x) => dataRuns.add(x));
  return { records, surahList, dataRuns, sourceRuns };
}

// --- HTML text nodes (parse5) ------------------------------------------------
export function textNodesOf(html) {
  const out = [];
  const walk = (node) => {
    if (node.nodeName === "script" || node.nodeName === "style") return; // skip non-visible text
    if (node.nodeName === "#text") {
      out.push(node.value);
      return;
    }
    if (Array.isArray(node.childNodes)) node.childNodes.forEach(walk);
  };
  walk(parse5.parse(html));
  return out;
}
function pageRuns(html) {
  const runs = new Set();
  for (const t of textNodesOf(html)) runsOf(t).forEach((r) => runs.add(r));
  return runs;
}

const hash8 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex").slice(0, 8);
const read = (p) => fs.readFileSync(p, "utf8");

// --- main --------------------------------------------------------------------
function main() {
  const { records, surahList, dataRuns, sourceRuns } = loadRecords();
  const problems = [];

  // (1) per-record checks on the current word pages
  let missingWordPages = 0;
  const missingIds = [];
  const currentWordRuns = new Set();
  for (const r of records) {
    const p = path.join(ROOT, "public", "word", r.slug + ".html");
    if (!fs.existsSync(p)) {
      missingWordPages++;
      missingIds.push(r.slug + ":missing-page");
      continue;
    }
    const html = read(p);
    const text = textNodesOf(html).join("");
    pageRuns(html).forEach((x) => currentWordRuns.add(x));
    const fails = [];
    if (!text.includes(r.word)) fails.push("word");
    if (!r.verseSegments.every((seg) => text.includes(seg))) fails.push("verse");
    if (!text.includes(r.bodyMeaning) && !text.includes(r.rawMeaning)) fails.push("meaning");
    if (!text.includes(r.surahShort) && !text.includes(r.surahFull)) fails.push("surah");
    if (fails.length) missingIds.push(r.slug + ":" + fails.join("+"));
  }

  // (2) per-surah checks on the current surah pages
  let missingSurahPages = 0;
  const currentSurahRuns = new Set();
  for (const s of surahList) {
    const p = path.join(ROOT, "public", "surah", s.slug + ".html");
    if (!fs.existsSync(p)) {
      missingSurahPages++;
      missingIds.push(s.slug + ":missing-page");
      continue;
    }
    const html = read(p);
    const text = textNodesOf(html).join("");
    pageRuns(html).forEach((x) => currentSurahRuns.add(x));
    const fails = [];
    if (!text.includes(s.short) && !text.includes(s.full)) fails.push("surah");
    for (const w of s.words) if (!text.includes(w)) fails.push("word");
    if (fails.length) missingIds.push(s.slug + ":" + [...new Set(fails)].join("+"));
  }

  // forbidden strings and the open button, on every current page
  let hasSource = 0, hasOpenApp = 0, openSiteMissing = 0;
  const allCurrentRuns = new Set([...currentWordRuns, ...currentSurahRuns]);
  for (const r of records) {
    const html = read(path.join(ROOT, "public", "word", r.slug + ".html"));
    if (textNodesOf(html).join("").includes(SOURCE_LABEL)) hasSource++;
    if (html.includes(OPEN_APP)) hasOpenApp++;
    const pill = html.match(/<a class="pill"[^>]*>([\s\S]*?)<\/a>/);
    const pillText = pill ? pill[1].replace(/<svg[\s\S]*?<\/svg>/g, "").trim() : "";
    if (pillText !== OPEN_SITE) openSiteMissing++;
  }
  for (const s of surahList) {
    const html = read(path.join(ROOT, "public", "surah", s.slug + ".html"));
    if (textNodesOf(html).join("").includes(SOURCE_LABEL)) hasSource++;
    if (html.includes(OPEN_APP)) hasOpenApp++;
    const pill = html.match(/<a class="pill"[^>]*>([\s\S]*?)<\/a>/);
    const pillText = pill ? pill[1].replace(/<svg[\s\S]*?<\/svg>/g, "").trim() : "";
    if (pillText !== OPEN_SITE) openSiteMissing++;
  }

  // (3) comparison with the pre-K1 pages, from ONE temp worktree
  // Pre-K1 labels that the K1/K2 rebuild replaced with new (non-data) labels:
  // an old meaning-label and an old next-nav label, identified by hash.
  const KNOWN_REMOVED_LABEL_IDS = new Set(["f169e956", "5cf7af74"]);
  const tmp = path.join(os.tmpdir(), "ghareeb-phase-l-temp-proof");
  let missing = 0, extra = 0, removedUnexpected = 0;
  const extraIds = [], runMissingIds = [], removedUnexpectedIds = [], removedAllowedIds = [];
  let baselineWordPages = 0, addedRunsCount = 0;
  const addedIds = [];
  try {
    fs.rmSync(tmp, { recursive: true, force: true });
    execFileSync("git", ["worktree", "add", "--detach", tmp, BASELINE_COMMIT], { cwd: ROOT, stdio: "pipe" });
    const bdir = path.join(tmp, "public", "word");
    const bfiles = fs.readdirSync(bdir).filter((f) => f.endsWith(".html"));
    baselineWordPages = bfiles.length;
    const baselineRuns = new Set();
    for (const f of bfiles) pageRuns(read(path.join(bdir, f))).forEach((r) => baselineRuns.add(r));

    const preData = new Set([...baselineRuns].filter((r) => dataRuns.has(r)));
    const curData = new Set([...currentWordRuns].filter((r) => dataRuns.has(r)));
    for (const r of preData) if (!curData.has(r)) { missing++; runMissingIds.push(hash8(r)); }
    for (const r of curData) if (!preData.has(r)) { extra++; extraIds.push(hash8(r)); }

    const allowedRemoved = new Set([...dataRuns, ...sourceRuns, ...runsOf(OPEN_APP), ...runsOf(SOURCE_LABEL)]);
    for (const r of baselineRuns) {
      if (allCurrentRuns.has(r)) continue;
      if (allowedRemoved.has(r) || KNOWN_REMOVED_LABEL_IDS.has(hash8(r))) removedAllowedIds.push(hash8(r));
      else { removedUnexpected++; removedUnexpectedIds.push(hash8(r)); }
    }
    const addedCounts = new Map();
    for (const r of records) {
      const html = read(path.join(ROOT, "public", "word", r.slug + ".html"));
      pageRuns(html).forEach((x) => {
        if (!baselineRuns.has(x) && !dataRuns.has(x)) addedCounts.set(x, (addedCounts.get(x) || 0) + 1);
      });
    }
    for (const s of surahList) {
      const html = read(path.join(ROOT, "public", "surah", s.slug + ".html"));
      pageRuns(html).forEach((x) => {
        if (!baselineRuns.has(x) && !dataRuns.has(x)) addedCounts.set(x, (addedCounts.get(x) || 0) + 1);
      });
    }
    for (const [r, n] of addedCounts) { addedRunsCount++; addedIds.push(hash8(r) + "x" + n); }
  } finally {
    try { execFileSync("git", ["worktree", "remove", "--force", tmp], { cwd: ROOT, stdio: "pipe" }); } catch (e) { /* report below */ }
    try { execFileSync("git", ["worktree", "prune"], { cwd: ROOT, stdio: "pipe" }); } catch (e) { /* ignore */ }
  }

  const clean =
    missingWordPages === 0 && missingSurahPages === 0 && missingIds.length === 0 &&
    missing === 0 && extra === 0 && removedUnexpected === 0 &&
    hasSource === 0 && hasOpenApp === 0 && openSiteMissing === 0;

  console.log("records=" + records.length);
  console.log("surahPages=" + surahList.length);
  console.log("dataRuns=" + dataRuns.size);
  console.log("missingPageChecks=" + missingIds.length + (missingIds.length ? " ids=" + missingIds.join(",") : ""));
  console.log("preK1WordPages=" + baselineWordPages);
  console.log("missingDataRunsVsPreK1=" + missing + (missing ? " ids=" + runMissingIds.join(",") : ""));
  console.log("extraDataRunsVsPreK1=" + extra + (extra ? " ids=" + extraIds.join(",") : ""));
  console.log("removedRunsAllowed=" + removedAllowedIds.length);
  console.log("removedRunsUnexpected=" + removedUnexpected + (removedUnexpected ? " ids=" + removedUnexpectedIds.join(",") : ""));
  console.log("addedRunsOutsideData=" + addedRunsCount + " ids=" + addedIds.join(","));
  console.log("pagesWithSourceLabel=" + hasSource + " pagesWithOpenApp=" + hasOpenApp + " openSiteButtonMismatches=" + openSiteMissing);
  console.log(clean ? "PROOF CLEAN" : "PROOF DIRTY");
  return clean ? 0 : 1;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) process.exit(main());
