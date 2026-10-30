/*
 * seo.test.js - canonical SEO verification for the static site.
 *
 * The 73 static word pages, public/sitemap.xml and data/redirects.json are the
 * source of truth for the canonical English URL scheme:
 *
 *     /word/<surah-slug>-<ayah>[-<n>].html
 *
 * These tests prove that shared/seo.js (used by scripts/publish-build.mjs)
 * reproduces exactly that scheme, and check the static sitemap, canonical tags,
 * internal word links and 404 lookup. All Arabic/Qur'anic data is read-only and
 * this file is intentionally ASCII-only (see test/arabic-guard.test.js).
 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const seo = require("../shared/seo");
const legal = require("../shared/legal");

const wordsData = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "words.json"), "utf8"));
const redirects = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "redirects.json"), "utf8"));
const SITE = "https://ghareebalquran.com";

// HTML-escape, matching scripts/publish-build.mjs (see its `esc`).
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const slugs = seo.buildSlugs(wordsData);
const wordDir = path.join(ROOT, "public", "word");
const fileSlugs = fs
  .readdirSync(wordDir)
  .filter((f) => f.endsWith(".html"))
  .map((f) => f.slice(0, -5));

test("buildSlugs reproduces the 73 canonical static filenames exactly", () => {
  assert.strictEqual(slugs.length, 73);
  assert.strictEqual(fileSlugs.length, 73);
  assert.deepStrictEqual([...slugs].sort(), [...fileSlugs].sort());
  assert.strictEqual(new Set(slugs).size, slugs.length, "slugs must be unique");
});

test("slugs are canonical ASCII form (surah-slug-ayah[-n])", () => {
  for (const s of slugs) assert.match(s, /^[a-z0-9]+(-[a-z0-9]+)*$/, "not canonical ASCII: " + s);
});

test("ayah suffixes match the files: second word in one ayah gets -2; a range label uses its first number", () => {
  const has = (s) => assert.ok(slugs.includes(s), "missing " + s);
  has("al-kawthar-3");
  has("al-kawthar-3-2"); // second word of Al-Kawthar ayah 3
  has("al-fajr-19");
  has("al-fajr-19-2"); // second word of Al-Fajr ayah 19
  has("at-takwir-15"); // ayah label "15-16" -> first number
  assert.ok(!slugs.includes("at-takwir-15-16"));
  assert.ok(!slugs.includes("at-takwir-16"));
});

test("every redirect destination resolves to a canonical word slug", () => {
  const set = new Set(slugs);
  assert.strictEqual(Object.keys(redirects).length, 71);
  for (const [source, target] of Object.entries(redirects)) {
    assert.ok(set.has(target), "redirect " + source + " -> " + target + " has no word");
  }
});

test("public/sitemap.xml lists the home URL, the canonical word slugs and the legal pages", () => {
  const xml = fs.readFileSync(path.join(ROOT, "public", "sitemap.xml"), "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.strictEqual(locs[0], SITE + "/");
  // Phase K: the sitemap now also lists the 28 static surah pages.
  const surahSlugs = Object.values(seo.SURAH_SLUG);
  assert.strictEqual(locs.length, 1 + slugs.length + surahSlugs.length + legal.LEGAL.length);
  for (const s of slugs) assert.ok(locs.includes(SITE + "/word/" + s + ".html"), "sitemap missing " + s);
  for (const s of surahSlugs) assert.ok(locs.includes(SITE + "/surah/" + s + ".html"), "sitemap missing surah " + s);
  for (const entry of legal.LEGAL) assert.ok(locs.includes(SITE + "/" + entry.slug + "/"), "sitemap missing legal " + entry.slug);
});

test("each static word page declares its own canonical URL", () => {
  for (const f of fileSlugs) {
    const html = fs.readFileSync(path.join(wordDir, f + ".html"), "utf8");
    const m = html.match(/<link rel="canonical" href="([^"]+)"/);
    assert.ok(m, "missing canonical tag in " + f);
    assert.strictEqual(m[1], SITE + "/word/" + f + ".html", "wrong canonical in " + f);
  }
});

test("internal /word/ links inside the static pages all point at canonical slugs", () => {
  const set = new Set(slugs);
  for (const f of fileSlugs) {
    const html = fs.readFileSync(path.join(wordDir, f + ".html"), "utf8");
    for (const m of html.matchAll(/href="\/word\/([^"]+)\.html"/g)) {
      assert.ok(set.has(m[1]), f + " links to non-canonical slug: " + m[1]);
    }
  }
});

test("lookup: a canonical slug resolves; unknown and legacy Arabic slugs 404", () => {
  const words = slugs.map((s) => ({ slug: s }));
  assert.ok(seo.findBySlug(words, "an-nas-4"), "an-nas-4 must resolve");
  assert.strictEqual(seo.findBySlug(words, "nope-1"), undefined);
  // Legacy Arabic URL (U+0627 U+0644 U+062E U+0646 U+0627 U+0633) must not resolve.
  assert.strictEqual(seo.findBySlug(words, "\u0627\u0644\u062e\u0646\u0627\u0633"), undefined);
});

test("SURAH_SLUG maps all 28 surahs to ASCII transliteration slugs", () => {
  const values = Object.values(seo.SURAH_SLUG);
  assert.strictEqual(values.length, 28);
  for (const v of values) assert.match(v, /^[a-z0-9-]+$/, "non-ASCII surah slug: " + v);
});

// --- Phase 7A: free-plan publish generator (scripts/publish-build.mjs) ------
// The generator turns the Firestore source of truth into the committed static
// site. These tests prove it reproduces the committed artefacts byte-for-byte,
// is deterministic, never leaks private challenge notes, and refuses to publish
// an empty/shrunken site.
const { pathToFileURL } = require("node:url");
const os = require("node:os");
const publishPath = path.join(ROOT, "scripts", "publish-build.mjs");
const challengeData = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "challenge.json"), "utf8"));
const loadPublish = () => import(pathToFileURL(publishPath).href);

test("publish generator reproduces the committed static site byte-for-byte", async () => {
  const mod = await loadPublish();
  const { files, wordCount } = mod.buildSite(wordsData, challengeData);
  assert.strictEqual(wordCount, 73);
  assert.strictEqual(files["words.json"], fs.readFileSync(path.join(ROOT, "public", "words.json"), "utf8"));
  assert.strictEqual(files["challenge.json"], fs.readFileSync(path.join(ROOT, "public", "challenge.json"), "utf8"));
  assert.strictEqual(files["sitemap.xml"], fs.readFileSync(path.join(ROOT, "public", "sitemap.xml"), "utf8"));
  for (const f of fileSlugs) {
    assert.strictEqual(
      files["word/" + f + ".html"],
      fs.readFileSync(path.join(wordDir, f + ".html"), "utf8"),
      "page mismatch: " + f
    );
  }
  const surahKeys = Object.values(seo.SURAH_SLUG).map((s) => "surah/" + s + ".html");
  const expected = ["words.json", "challenge.json", "sitemap.xml", "css/app.css"]
    .concat(fileSlugs.map((f) => "word/" + f + ".html"))
    .concat(surahKeys)
    .concat(legal.LEGAL.map((e) => e.slug + "/index.html"))
    .sort();
  assert.deepStrictEqual(Object.keys(files).sort(), expected);
  for (const entry of legal.LEGAL) {
    assert.strictEqual(
      files[entry.slug + "/index.html"],
      fs.readFileSync(path.join(ROOT, "public", entry.slug, "index.html"), "utf8"),
      "legal page mismatch: " + entry.slug
    );
  }
});

test("legal pages contain their paragraphs verbatim", () => {
  const nodec = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
  for (const entry of legal.LEGAL) {
    const html = fs.readFileSync(path.join(ROOT, "public", entry.slug, "index.html"), "utf8");
    assert.match(html, /<link rel="canonical" href="https:\/\/ghareebalquran\.com\/[a-z]+\/">/);
    for (const p of entry.paras) {
      const escaped = esc(p);
      assert.ok(html.replace(/<a href="mailto:[^"]*">([^<]*)<\/a>/g, "$1").includes(escaped), "missing paragraph in " + entry.slug);
      assert.ok(nodec(escaped).includes(p), "paragraph not verbatim in " + entry.slug);
    }
  }
});

test("publish generator is deterministic and its hash tracks content", async () => {
  const mod = await loadPublish();
  const a = mod.buildSite(wordsData, challengeData);
  const b = mod.buildSite(wordsData, challengeData);
  assert.strictEqual(a.hash, b.hash);
  const changed = mod.buildSite(wordsData, Object.assign({}, challengeData, { releasedUpTo: 7 }));
  assert.notStrictEqual(a.hash, changed.hash);
});

test("publish generator never emits private challenge notes", async () => {
  const mod = await loadPublish();
  const withNotes = Object.assign({}, challengeData, { notes: { "1": "LEAK_SENTINEL_9F2A" } });
  const { files } = mod.buildSite(wordsData, withNotes);
  for (const [name, content] of Object.entries(files)) {
    assert.ok(!content.includes("LEAK_SENTINEL_9F2A"), "note leaked into " + name);
    assert.ok(!content.includes('"notes"'), "notes key leaked into " + name);
  }
});

test("publish generator refuses to publish an empty or shrunken site", async () => {
  const mod = await loadPublish();
  assert.throws(() => mod.buildSite([], challengeData), /empty input/);
  const tiny = [
    {
      surah: wordsData[0].surah,
      words: ["x"],
      meanings: ["y"],
      ayahs: [{ label: "4", segments: [{ before: "a", hl: "x", after: "" }] }],
      source: wordsData[0].source,
    },
  ];
  assert.throws(() => mod.buildSite(tiny, challengeData), /refusing to publish/);
});

test("publish generator writes into an output directory (never over public/)", async () => {
  const mod = await loadPublish();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "ghareeb-publish-"));
  try {
    const { files, hash, wordCount } = mod.buildSite(wordsData, challengeData);
    mod.writeSite(out, files, { rev: 5, hash, wordCount });
    assert.ok(fs.existsSync(path.join(out, "rev.json")), "rev.json missing");
    assert.ok(fs.existsSync(path.join(out, "word", "an-nas-4.html")), "word page missing");
    const rev = JSON.parse(fs.readFileSync(path.join(out, "rev.json"), "utf8"));
    assert.strictEqual(rev.hash, hash);
    assert.strictEqual(rev.rev, 5);
    assert.strictEqual(rev.words, 73);
    assert.strictEqual(
      fs.readFileSync(path.join(out, "words.json"), "utf8"),
      fs.readFileSync(path.join(ROOT, "public", "words.json"), "utf8")
    );
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
