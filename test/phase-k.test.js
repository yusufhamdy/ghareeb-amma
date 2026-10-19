"use strict";
/*
 * phase-k.test.js - Phase K acceptance.
 *
 * K1 (this commit): the static pages are generated from the app's own stylesheet
 * and theme bootstrap. These tests are file-based: they prove the generator
 * extracts the app's <style> block into one committed stylesheet, every static
 * page links it plus the synchronous theme bootstrap and nothing else, the word
 * pages were rebuilt to match the app (no source line, "open on the site"
 * button, prev/next), the 28 static surah pages exist, and the sitemap lists
 * them. Arabic labels are written as \uXXXX escapes so this file stays
 * ASCII-only (test/arabic-guard.test.js).
 *
 * K2/K3 are added in their own steps.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const ROOT = path.join(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const loadPublish = () => import(pathToFileURL(path.join(ROOT, "scripts", "publish-build.mjs")).href);

// Arabic labels under test (escaped).
const OPEN_SITE = "\u0627\u0641\u062a\u062d \u0641\u064a \u0627\u0644\u0645\u0648\u0642\u0639"; // "open on the site"
const OPEN_APP = "\u0627\u0641\u062a\u062d \u0641\u064a \u0627\u0644\u062a\u0637\u0628\u064a\u0642"; // "open in the app" (removed)
const SOURCE = "\u0627\u0644\u0645\u0635\u062f\u0631"; // "the source" (removed line)
const OTHER_WORDS = "\u0643\u0644\u0645\u0627\u062a \u0623\u062e\u0631\u0649 \u0645\u0646 \u0646\u0641\u0633 \u0627\u0644\u0633\u0648\u0631\u0629"; // "other words from the same surah"

function wordFiles() {
  return fs.readdirSync(path.join(PUBLIC, "word")).filter((f) => f.endsWith(".html"));
}
function surahFiles() {
  const dir = path.join(PUBLIC, "surah");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".html")) : [];
}

test("K1: the shared stylesheet is the app's own style block, generated at build time", async () => {
  const mod = await loadPublish();
  const css = fs.readFileSync(path.join(PUBLIC, "css", "app.css"), "utf8");
  assert.strictEqual(css, mod.appCss(), "public/css/app.css must equal appCss()");
  // It is the app's block (not a hand-rolled copy): a few app-only rules must exist.
  for (const rule of [".shade #bg", "--tc", "color-mix(", ".cm ", "backdrop-filter"]) {
    assert.ok(css.includes(rule), "shared stylesheet is missing app rule: " + rule);
  }
  // The highlight is a bounded box, never an underline.
  const mark = css.match(/mark\{[^}]*\}/)[0];
  assert.ok(mark.includes("border-radius"), "highlight must be a bounded box");
  assert.ok(!mark.includes("border-bottom"), "highlight must not be an underline");
});

test("K1: public/index.html structure is untouched (still inline, no shared-css link)", () => {
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  assert.ok(html.includes("<style>"), "index.html keeps its inline style block");
  assert.ok(html.includes("gq-set"), "index.html keeps its synchronous inline theme bootstrap");
  assert.ok(!html.includes("/css/app.css"), "index.html must not link the extracted stylesheet");
  assert.ok(!html.includes("/theme-boot.js"), "index.html must not link the static-pages bootstrap");
});

test("K1: every static page links the shared stylesheet and the synchronous theme bootstrap only", () => {
  const pages = [
    ...wordFiles().map((f) => "word/" + f),
    ...surahFiles().map((f) => "surah/" + f),
    ...[ "about", "privacy", "terms", "rights" ].map((s) => s + "/index.html"),
  ];
  for (const p of pages) {
    const html = fs.readFileSync(path.join(PUBLIC, p), "utf8");
    assert.ok(html.includes('<link rel="stylesheet" href="/css/app.css">'), p + " must link the shared stylesheet");
    assert.ok(html.includes('<script src="/theme-boot.js"></script>'), p + " must include the theme bootstrap");
    // Synchronous (no defer/async) and in the head, so it runs before first paint.
    assert.ok(html.indexOf('<script src="/theme-boot.js"></script>') < html.indexOf("</head>"), p + " theme bootstrap must be in <head>");
    assert.ok(!/<script[^>]*\b(defer|async)\b/.test(html), p + " theme bootstrap must not be deferred");
    // No other app JS: the only <script> is the theme bootstrap (JSON-LD arrives in K2).
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    assert.strictEqual(scripts.length, 1, p + " must not load other app JS (found " + scripts.length + " scripts)");
  }
});

test("K1: the theme bootstrap applies the saved gq-set record before first paint", () => {
  const boot = fs.readFileSync(path.join(PUBLIC, "theme-boot.js"), "utf8");
  for (const key of ["gq-set", "--bg", "--ac", "--bl", "--sat", "set.cm", "shade", "prefers-color-scheme:dark"]) {
    assert.ok(boot.includes(key), "theme bootstrap must handle: " + key);
  }
  assert.ok(!/[\u0600-\u06ff]/.test(boot), "theme bootstrap stays ASCII-only");
});

test("K1: word pages are rebuilt like the app (no source line, open-on-site, prev/next, others card)", () => {
  const files = wordFiles();
  assert.strictEqual(files.length, 73, "exactly the 73 canonical word pages");
  for (const f of files) {
    const slug = f.replace(/\.html$/, "");
    const html = fs.readFileSync(path.join(PUBLIC, "word", f), "utf8");
    assert.ok(html.includes('<link rel="canonical" href="https://ghareebalquran.com/word/' + slug + '.html">'), f + " canonical");
    assert.ok(html.includes(OPEN_SITE), f + " must show the open-on-site button");
    assert.ok(!html.includes(OPEN_APP), f + " must not show the old open-in-app label");
    assert.ok(!html.includes(SOURCE), f + " must not show the source line");
    assert.ok(html.includes('class="g pnb pv"') && html.includes('class="g pnb nx"'), f + " app-style prev/next controls");
    assert.ok(html.includes(OTHER_WORDS), f + " others card heading");
    assert.ok(html.includes('href="/surah/'), f + " links to its static surah page");
    assert.ok(html.includes('href="/#/word/'), f + " open-on-site uses the app route");
  }
});

test("K1: the 28 static surah pages exist with the slug stems from functions/seo.js", async () => {
  const mod = await loadPublish();
  const seo = require("../functions/seo.js");
  const slugs = Object.values(seo.SURAH_SLUG);
  assert.strictEqual(slugs.length, 28);
  const files = surahFiles().map((f) => f.replace(/\.html$/, ""));
  assert.deepStrictEqual([...files].sort(), [...slugs].sort());
  for (const s of slugs) {
    const html = fs.readFileSync(path.join(PUBLIC, "surah", s + ".html"), "utf8");
    assert.ok(html.includes('<link rel="canonical" href="https://ghareebalquran.com/surah/' + s + '.html">'), s + " canonical");
    assert.ok(html.includes('<div class="shd">'), s + " surah heading block");
    assert.ok(html.includes('class="list g rs"'), s + " words as app rows");
    assert.ok(html.includes('href="/#/surah/'), s + " open-on-site uses the app route");
    assert.ok(html.includes('class="g pnb pv"') && html.includes('class="g pnb nx"'), s + " prev/next surah controls");
  }
});

test("K1: the sitemap lists the home, 73 word pages, 28 surah pages and the legal pages", async () => {
  const seo = require("../functions/seo.js");
  const legal = require("../functions/legal.js");
  const xml = fs.readFileSync(path.join(PUBLIC, "sitemap.xml"), "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.strictEqual(locs.length, 1 + 73 + Object.keys(seo.SURAH_SLUG).length + legal.LEGAL.length);
  assert.strictEqual(locs[0], "https://ghareebalquran.com/");
  for (const s of Object.values(seo.SURAH_SLUG)) {
    assert.ok(locs.includes("https://ghareebalquran.com/surah/" + s + ".html"), "sitemap missing surah " + s);
  }
});
