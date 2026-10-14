/*
 * seo.test.js - canonical SEO verification for the `seo` Cloud Function.
 *
 * The 73 static word pages, public/sitemap.xml and data/redirects.json are the
 * source of truth for the canonical English URL scheme:
 *
 *     /word/<surah-slug>-<ayah>[-<n>].html
 *
 * These tests prove that functions/seo.js (used by the deployed `seo` function)
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
const seo = require("../functions/seo");

const wordsData = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "words.json"), "utf8"));
const redirects = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "redirects.json"), "utf8"));
const SITE = "https://ghareebalquran.com";

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

test("public/sitemap.xml lists the home URL and exactly the canonical word slugs", () => {
  const xml = fs.readFileSync(path.join(ROOT, "public", "sitemap.xml"), "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.strictEqual(locs[0], SITE + "/");
  assert.strictEqual(locs.length, 1 + slugs.length);
  for (const s of slugs) assert.ok(locs.includes(SITE + "/word/" + s + ".html"), "sitemap missing " + s);
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
