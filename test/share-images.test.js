"use strict";
/*
 * share-images.test.js - every word page shares its own image, and the favicon is the green hizb star.
 *   - each public/word/<slug>.html points og:image and twitter:image at /og/word/<slug>.png, with width 1200, height 630
 *     and alt; that file exists and is a 1200x630 PNG; there is no image without a page;
 *   - the generator writes the same tags, so a publish keeps them;
 *   - favicon.svg has the letter as a path (no web font, no text), the green palette and the night palette under
 *     prefers-color-scheme: dark; favicon-32.png is 32x32;
 *   - the general image stays 1200x630.
 * ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const SITE = "https://ghareebalquran.com";
const pngSize = (f) => { const b = fs.readFileSync(f); assert.strictEqual(b.toString("latin1", 1, 4), "PNG", f + " is a PNG"); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const meta = (html, attr, key) => { const m = html.match(new RegExp("<meta " + attr + '="' + key + '" content="([^"]*)">')); return m ? m[1] : null; };

const pages = fs.readdirSync(path.join(PUBLIC, "word")).filter((f) => f.endsWith(".html"));

function checkTags(html, slug, where) {
  const img = SITE + "/og/word/" + slug + ".png";
  assert.strictEqual(meta(html, "property", "og:image"), img, where + " og:image");
  assert.strictEqual(meta(html, "name", "twitter:image"), img, where + " twitter:image");
  assert.strictEqual(meta(html, "property", "og:image:width"), "1200", where + " width");
  assert.strictEqual(meta(html, "property", "og:image:height"), "630", where + " height");
  assert.ok(meta(html, "property", "og:image:alt"), where + " og:image:alt");
  assert.ok(meta(html, "name", "twitter:image:alt"), where + " twitter:image:alt");
}

test("every word page has its own 1200x630 share image", () => {
  assert.strictEqual(pages.length, 73);
  for (const f of pages) {
    const slug = f.replace(/\.html$/, ""), png = path.join(PUBLIC, "og", "word", slug + ".png");
    checkTags(fs.readFileSync(path.join(PUBLIC, "word", f), "utf8"), slug, f);
    assert.ok(fs.existsSync(png), slug + ".png exists");
    assert.deepStrictEqual(pngSize(png), [1200, 630], slug + ".png is 1200x630");
  }
  const images = fs.readdirSync(path.join(PUBLIC, "og", "word"));
  assert.strictEqual(images.length, 73, "one image per word, and no others");
});

test("the generator writes the same word-page tags, and the general image for other pages", async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, "scripts/publish-build.mjs")).href);
  const { files } = mod.buildSite(JSON.parse(fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8")), JSON.parse(fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8")));
  const keys = Object.keys(files).filter((k) => /^word\/.+\.html$/.test(k));
  assert.strictEqual(keys.length, 73);
  for (const k of keys) {
    checkTags(files[k], k.slice(5, -5), k);
    assert.strictEqual(files[k], fs.readFileSync(path.join(PUBLIC, k), "utf8"), k + " is what the generator writes");
  }
  const surah = Object.keys(files).find((k) => k.startsWith("surah/") && k.endsWith(".html"));
  assert.strictEqual(meta(files[surah], "property", "og:image"), SITE + "/og-2026-10.png", "a surah page keeps the general image");
  assert.strictEqual(meta(files[surah], "property", "og:image:alt"), null);
});

test("the favicon: green by default, night when dark, the letter as a path", () => {
  const svg = fs.readFileSync(path.join(PUBLIC, "favicon.svg"), "utf8");
  assert.ok(!/<text|<image|font-family|@font-face|url\(http/.test(svg), "no text, image or web font");
  assert.ok(/<path class="f" d="M/.test(svg), "the letter is a path");
  const dark = svg.indexOf("prefers-color-scheme:dark");
  assert.ok(dark > 0, "has a dark variant");
  for (const c of ["#F2F0E8", "#1E6B50", "#8FCBAE", "#EBC98A"]) assert.ok(svg.indexOf(c) >= 0 && svg.indexOf(c) < dark, c + " in the default");
  for (const c of ["#0A0E1F", "#9FB4FF", "#4B5BDB", "#2FB5A8"]) assert.ok(svg.indexOf(c) > dark, c + " under dark");
  assert.strictEqual((svg.match(/<rect width="100" height="100" rx="22\.83"/g) || []).length, 3, "the background has the general icon's corner radius (21/92)");
  assert.deepStrictEqual(pngSize(path.join(PUBLIC, "favicon-32.png")), [32, 32]);
  assert.strictEqual(fs.readFileSync(path.join(PUBLIC, "favicon-32.png"))[25], 6, "favicon-32.png has alpha, for its rounded corners");
});

test("the service worker precaches no share image", () => {
  const sw = fs.readFileSync(path.join(PUBLIC, "sw.js"), "utf8");
  const list = sw.match(/assetsToCache = \[([\s\S]*?)\]/)[1];
  assert.ok(!/\/og/.test(list), "no og image in the precache list");
});

test("the general image has its new name everywhere, and the old file is gone", () => {
  assert.ok(!fs.existsSync(path.join(PUBLIC, "og.png")), "og.png is deleted");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const old = walk(PUBLIC).filter((f) => /\.(html|js|json|xml|css)$/.test(f) && /\/og\.png/.test(fs.readFileSync(f, "utf8")));
  assert.deepStrictEqual(old, [], "nothing in public/ points at /og.png");
  const home = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  assert.strictEqual(meta(home, "property", "og:image"), SITE + "/og-2026-10.png");
  assert.strictEqual(meta(home, "name", "twitter:image"), SITE + "/og-2026-10.png");
});

test("the general image is 1200x630", () => {
  assert.deepStrictEqual(pngSize(path.join(PUBLIC, "og-2026-10.png")), [1200, 630]);
});
