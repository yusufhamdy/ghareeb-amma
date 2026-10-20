"use strict";
/*
 * phase-k.test.js - Phase K acceptance.
 *
 * K1: the static pages are generated from the app's own stylesheet and theme
 * bootstrap. These tests prove the generator extracts the app's <style> block
 * into one committed stylesheet, every static page links it plus the synchronous
 * theme bootstrap and nothing else, the word pages were rebuilt to match the app
 * (no source line, "open on the site" button, prev/next), the 28 static surah
 * pages exist, and the sitemap lists them.
 *
 * K2: SEO titles/descriptions per the spec, diacritics stripped only in the
 * title/description copies by one deterministic function, ASCII-escaped JSON-LD
 * (WebSite / BreadcrumbList / DefinedTerm) and one canonical per page.
 *
 * K3 is added in its own step. Arabic labels are written as \uXXXX escapes so
 * this file stays ASCII-only (test/arabic-guard.test.js).
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
const LOGO = "\u063a\u0631\u064a\u0628 \u0627\u0644\u0642\u0631\u0622\u0646"; // "Ghareeb Al-Quran"
const WORD_T_PRE = "\u0645\u0639\u0646\u0649 "; // "meaning of "
const WORD_T_IN_SURAH = " \u0641\u064a \u0633\u0648\u0631\u0629 "; // " in surah "
const HOME_TITLE =
  "\u063a\u0631\u064a\u0628 \u0627\u0644\u0642\u0631\u0622\u0646 - \u0645\u0639\u0627\u0646\u064a \u0643\u0644\u0645\u0627\u062a \u062c\u0632\u0621 \u0639\u0645";
const HOME_DESC =
  "\u063a\u0631\u064a\u0628 \u0627\u0644\u0642\u0631\u0622\u0646: \u0645\u0639\u0627\u0646\u064a \u0643\u0644\u0645\u0627\u062a \u062c\u0632\u0621 \u0639\u0645 (\u063a\u0631\u064a\u0628 \u0639\u0645) \u062d\u0633\u0628 \u0627\u0644\u0633\u0648\u0631\u0629\u060c \u0645\u0639 \u0627\u0644\u0622\u064a\u0629 \u0648\u0627\u0644\u0645\u0639\u0646\u0649.";
const SURAH_T_PRE = "\u0645\u0639\u0627\u0646\u064a \u0643\u0644\u0645\u0627\u062a \u0633\u0648\u0631\u0629 "; // "meanings of the words of surah "

// The exact diacritics the title/description stripper removes (U+064B-U+065F,
// U+0670, U+06D6-U+06ED, U+0640).
const DIACRITIC_RE = /[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/;

function wordFiles() {
  return fs.readdirSync(path.join(PUBLIC, "word")).filter((f) => f.endsWith(".html"));
}
function surahFiles() {
  const dir = path.join(PUBLIC, "surah");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".html")) : [];
}
function read(rel) {
  return fs.readFileSync(path.join(PUBLIC, rel), "utf8");
}
function isAscii(s) {
  for (const ch of s) if (ch.codePointAt(0) > 127) return false;
  return true;
}
function titleOf(html) {
  return html.match(/<title>([\s\S]*?)<\/title>/)[1];
}
function metaName(html, name) {
  const m = html.match(new RegExp('<meta name="' + name + '" content="([^"]*)">'));
  return m ? m[1] : null;
}
function metaProp(html, prop) {
  const m = html.match(new RegExp('<meta property="' + prop + '" content="([^"]*)">'));
  return m ? m[1] : null;
}
function ldBlocks(html) {
  return [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------- K1 --------

test("K1: the shared stylesheet is the app's own style block, generated at build time", async () => {
  const mod = await loadPublish();
  const css = read("css/app.css");
  assert.strictEqual(css, mod.appCss(), "public/css/app.css must equal appCss()");
  for (const rule of [".shade #bg", "--tc", "color-mix(", ".cm ", "backdrop-filter"]) {
    assert.ok(css.includes(rule), "shared stylesheet is missing app rule: " + rule);
  }
  const mark = css.match(/mark\{[^}]*\}/)[0];
  assert.ok(mark.includes("border-radius"), "highlight must be a bounded box");
  assert.ok(!mark.includes("border-bottom"), "highlight must not be an underline");
});

test("K1: public/index.html structure is untouched (still inline, no shared-css link)", () => {
  const html = read("index.html");
  assert.ok(html.includes("<style>"), "index.html keeps its inline style block");
  assert.ok(html.includes("gq-set"), "index.html keeps its synchronous inline theme bootstrap");
  assert.ok(!html.includes("/css/app.css"), "index.html must not link the extracted stylesheet");
  assert.ok(!html.includes("/theme-boot.js"), "index.html must not link the static-pages bootstrap");
});

test("K1: every static page links the shared stylesheet and the synchronous theme bootstrap only", () => {
  const pages = [
    ...wordFiles().map((f) => "word/" + f),
    ...surahFiles().map((f) => "surah/" + f),
    ...["about", "privacy", "terms", "rights"].map((s) => s + "/index.html"),
  ];
  for (const p of pages) {
    const html = read(p);
    assert.ok(html.includes('<link rel="stylesheet" href="/css/app.css">'), p + " must link the shared stylesheet");
    assert.ok(html.includes('<script src="/theme-boot.js"></script>'), p + " must include the theme bootstrap");
    assert.ok(html.indexOf('<script src="/theme-boot.js"></script>') < html.indexOf("</head>"), p + " theme bootstrap must be in <head>");
    assert.ok(!/<script[^>]*\b(defer|async)\b/.test(html), p + " theme bootstrap must not be deferred");
    // No other app JS: the only app <script> is the theme bootstrap; JSON-LD
    // blocks (K2) are data, not app code.
    const appJs = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]).filter((s) => !/type="application\/ld\+json"/.test(s));
    assert.strictEqual(appJs.length, 1, p + " must load exactly one app script");
    assert.ok(/src="\/theme-boot\.js"/.test(appJs[0]), p + " the only app JS is the theme bootstrap");
  }
});

test("K1: the theme bootstrap applies the saved gq-set record before first paint", () => {
  const boot = read("theme-boot.js");
  for (const key of ["gq-set", "--bg", "--ac", "--bl", "--sat", "set.cm", "shade", "prefers-color-scheme:dark"]) {
    assert.ok(boot.includes(key), "theme bootstrap must handle: " + key);
  }
  assert.ok(isAscii(boot), "theme bootstrap stays ASCII-only");
});

test("K1: word pages are rebuilt like the app (no source line, open-on-site, prev/next, others card)", () => {
  const files = wordFiles();
  assert.strictEqual(files.length, 73, "exactly the 73 canonical word pages");
  for (const f of files) {
    const slug = f.replace(/\.html$/, "");
    const html = read("word/" + f);
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

test("K1: the 28 static surah pages exist with the slug stems from functions/seo.js", () => {
  const seo = require("../functions/seo.js");
  const slugs = Object.values(seo.SURAH_SLUG);
  assert.strictEqual(slugs.length, 28);
  const files = surahFiles().map((f) => f.replace(/\.html$/, ""));
  assert.deepStrictEqual([...files].sort(), [...slugs].sort());
  for (const s of slugs) {
    const html = read("surah/" + s + ".html");
    assert.ok(html.includes('<link rel="canonical" href="https://ghareebalquran.com/surah/' + s + '.html">'), s + " canonical");
    assert.ok(html.includes('<div class="shd">'), s + " surah heading block");
    assert.ok(html.includes('class="list g rs"'), s + " words as app rows");
    assert.ok(html.includes('href="/#/surah/'), s + " open-on-site uses the app route");
    assert.ok(html.includes('class="g pnb pv"') && html.includes('class="g pnb nx"'), s + " prev/next surah controls");
  }
});

test("K1: the sitemap lists the home, 73 word pages, 28 surah pages and the legal pages", () => {
  const seo = require("../functions/seo.js");
  const legal = require("../functions/legal.js");
  const xml = read("sitemap.xml");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.strictEqual(locs.length, 1 + 73 + Object.keys(seo.SURAH_SLUG).length + legal.LEGAL.length);
  assert.strictEqual(locs[0], "https://ghareebalquran.com/");
  for (const s of Object.values(seo.SURAH_SLUG)) {
    assert.ok(locs.includes("https://ghareebalquran.com/surah/" + s + ".html"), "sitemap missing surah " + s);
  }
});

// ---------------------------------------------------------------- K2 --------

test("K2: home head carries the exact home title/description, equal og/twitter copies and one canonical", () => {
  const html = read("index.html");
  assert.ok(html.includes("<title>" + HOME_TITLE + "</title>"), "home title");
  assert.ok(html.includes('<meta name="description" content="' + HOME_DESC + '">'), "home description");
  assert.strictEqual(metaProp(html, "og:title"), HOME_TITLE, "home og:title equals title");
  assert.strictEqual(metaProp(html, "og:description"), HOME_DESC, "home og:description equals description");
  assert.strictEqual(metaName(html, "twitter:title"), HOME_TITLE, "home twitter:title equals title");
  assert.strictEqual(metaName(html, "twitter:description"), HOME_DESC, "home twitter:description equals description");
  assert.strictEqual((html.match(/rel="canonical"/g) || []).length, 1, "home has exactly one canonical");
  assert.ok(html.includes('<link rel="canonical" href="https://ghareebalquran.com/">'));
});

test("K2: home carries one ASCII-only WebSite JSON-LD block", () => {
  const blocks = ldBlocks(read("index.html"));
  assert.strictEqual(blocks.length, 1, "home has exactly one JSON-LD block");
  assert.ok(blocks[0].includes('"@type":"WebSite"'));
  assert.ok(blocks[0].includes('"url":"https://ghareebalquran.com/"'));
  assert.ok(isAscii(blocks[0]), "home JSON-LD is ASCII-escaped");
  assert.doesNotThrow(() => JSON.parse(blocks[0]));
});

test("K2: word pages use the stripped title/description patterns with equal og/twitter copies", async () => {
  const { loadRecords } = await import(pathToFileURL(path.join(ROOT, "tools", "arabic-proof.mjs")).href);
  const { records } = loadRecords();
  const strip = (s) => String(s == null ? "" : s).replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "");
  const seen = new Set();
  for (const f of wordFiles()) {
    const html = read("word/" + f);
    const title = titleOf(html);
    const r = records.find((x) => x.slug === f.replace(/\.html$/, ""));
    assert.ok(r, f + " has a data record");
    // The new pattern: "meaning of {word} in surah {surah} - brand", all
    // diacritics stripped; the brand stays the suffix.
    const expected = WORD_T_PRE + strip(r.word) + WORD_T_IN_SURAH + strip(r.surahShort) + " - " + LOGO;
    assert.strictEqual(title, expected, f + " title follows the word-first pattern");
    assert.ok(!DIACRITIC_RE.test(title), f + " title is diacritics-stripped");
    seen.add(title);
    const desc = metaName(html, "description");
    assert.ok(desc && desc.length > 0 && desc.length <= 155, f + " description is 1..155 chars");
    assert.ok(!DIACRITIC_RE.test(desc), f + " description is diacritics-stripped");
    assert.strictEqual(metaProp(html, "og:title"), title, f + " og:title equals title");
    assert.strictEqual(metaProp(html, "og:description"), desc, f + " og:description equals description");
    assert.strictEqual(metaName(html, "twitter:title"), title, f + " twitter:title equals title");
    assert.strictEqual(metaName(html, "twitter:description"), desc, f + " twitter:description equals description");
    // The body keeps the original diacritics.
    assert.ok(DIACRITIC_RE.test(html.slice(html.indexOf("<body"))), f + " body keeps the original Arabic");
  }
  assert.strictEqual(seen.size, wordFiles().length, "every word page has a unique title");
});

test("K2: surah pages use the surah title/description patterns", () => {
  for (const f of surahFiles()) {
    const html = read("surah/" + f);
    const title = titleOf(html);
    assert.ok(title.startsWith(SURAH_T_PRE), f + " surah title starts with the count phrase");
    assert.ok(title.endsWith(" - " + LOGO), f + " surah title ends with the brand");
    assert.ok(!DIACRITIC_RE.test(title), f + " surah title is diacritics-stripped");
    const desc = metaName(html, "description");
    assert.ok(desc && desc.length > 0 && desc.length <= 155, f + " surah description is 1..155 chars");
    assert.ok(!DIACRITIC_RE.test(desc), f + " surah description is diacritics-stripped");
  }
});

test("K2: every static page has one canonical and ASCII-only JSON-LD with the right types", () => {
  const pages = [
    ...wordFiles().map((f) => ["word/" + f, ["DefinedTerm", "BreadcrumbList"]]),
    ...surahFiles().map((f) => ["surah/" + f, ["BreadcrumbList"]]),
  ];
  for (const [p, types] of pages) {
    const html = read(p);
    assert.strictEqual((html.match(/rel="canonical"/g) || []).length, 1, p + " has exactly one canonical");
    const blocks = ldBlocks(html);
    assert.strictEqual(blocks.length, types.length, p + " JSON-LD block count");
    for (const b of blocks) {
      assert.ok(isAscii(b), p + " JSON-LD must be ASCII-escaped");
      assert.doesNotThrow(() => JSON.parse(b), p + " JSON-LD must be valid JSON");
    }
    for (const t of types) assert.ok(blocks.some((b) => b.includes('"@type":"' + t + '"')), p + " must include " + t);
  }
});

// ---------------------------------------------------------------- K3 --------

test("K3: all motion is gated by exactly one .cm class block and one reduced-motion media query", () => {
  const css = read("css/app.css");
  const mq = [...css.matchAll(/@media\(prefers-reduced-motion:reduce\)\{([\s\S]*?)\n\}/g)];
  assert.strictEqual(mq.length, 1, "exactly one prefers-reduced-motion media query");
  const body = mq[0][1];
  for (const decl of [
    "animation:none;transition:none",
    "#gear:hover,#gear:active,#gear:focus-visible,.dcard.open .chev,nav.g .t:active{transform:none}",
    "transform:none!important",
    ".reelstrip{transition:opacity .3s}",
  ]) {
    assert.ok(body.includes(decl), "media query is missing: " + decl);
  }
  // The .cm class mirrors the same gates (entrance, hover lift, gear, cards, reel).
  assert.ok(/\.cm #gear:hover,\.cm #gear:active,\.cm #gear:focus-visible/.test(css), ".cm disables the gear rotation");
  assert.ok(css.includes(".cm .dcard.open .chev"), ".cm stills the open chevron");
  assert.ok(css.includes(".cm .reelstrip{transition:opacity .3s}"), ".cm makes the roulette a quick fade");
  assert.ok(/\.cm [^{]*\{animation:none;transition:none\}/.test(css), "the .cm block mirrors the media query");
  assert.ok(css.includes(".cm #bg i"), "the glow blobs are gated by .cm (and stay visible)");
});

test("K3: first visit follows the device; a saved choice always wins (app + shared bootstrap)", () => {
  const html = read("index.html");
  assert.ok(
    html.includes("if(LS.get().cm===undefined)set.cm=matchMedia('(prefers-reduced-motion:reduce)').matches;"),
    "the app defaults stop-motion from the device only when nothing is saved"
  );
  assert.ok(html.includes("const rm=set.cm||matchMedia('(prefers-reduced-motion:reduce)').matches;"), "the roulette honours the saved toggle");
  const boot = read("theme-boot.js");
  assert.ok(boot.includes("if (!hasCm) set.cm = matchMedia(\"(prefers-reduced-motion:reduce)\").matches;"), "the static bootstrap mirrors the same default");
});

function staticServer(root) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
  };
  return require("node:http").createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

// Loads the real app in Chromium with a chosen saved gq-set record (or none, for
// a first visit) and an emulated device motion preference. Skips cleanly when
// Chromium is unavailable.
async function k3env(t, opts) {
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch (e) {
    t.skip("playwright not installed");
    return null;
  }
  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    t.skip("chromium unavailable: " + e.message);
    return null;
  }
  const words = read("words.json");
  const ch = read("challenge.json");
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const init =
    "window.__WORDS__=" + words + ";window.__CH__=" + ch + ";" +
    (opts.set === null ? "" : "try{localStorage.setItem('gq-set',JSON.stringify(" + JSON.stringify(opts.set) + "))}catch(e){}");
  return {
    async open() {
      const page = await browser.newPage({ viewport: { width: 400, height: 844 } });
      await page.emulateMedia({ reducedMotion: opts.reducedMotion || "no-preference", colorScheme: "light" });
      await page.addInitScript({ content: init });
      await page.goto(base + "/index.html", { waitUntil: "load" });
      await page.waitForSelector("#app .acts, #app .card, #app header", { timeout: 20000 });
      return page;
    },
    async close() {
      await browser.close();
      await new Promise((r) => server.close(r));
    },
  };
}

const K3SET = { mode: "light", pal: "def", gl: 3, style: "glass", gv: 2, snd: false };

test("K3: the saved stop-motion choice turns every motion off in the app", { timeout: 120000 }, async (t) => {
  const env = await k3env(t, { set: Object.assign({}, K3SET, { cm: true }) });
  if (!env) return;
  try {
    const page = await env.open();
    assert.ok(await page.evaluate(() => document.body.classList.contains("cm")), "the cm class is applied from the saved choice");
    assert.strictEqual(await page.$eval("#gear", (e) => getComputedStyle(e).transitionDuration), "0s", "the gear rotation transition is removed");
    const entrance = await page.$eval("#app.pg>*:not(header)", (e) => getComputedStyle(e).transitionDuration);
    assert.ok(/^(0s|0\.001s)$/.test(entrance), "the page entrance transition is removed (got " + entrance + ")");
    const btn = await page.$("#app .acts .btn");
    if (btn) {
      const d = await btn.evaluate((e) => getComputedStyle(e).transitionDuration);
      assert.ok(/^(0s|0\.001s)$/.test(d), "the hover-lift transition is removed (got " + d + ")");
    }
    await page.evaluate(() => { location.hash = "#/day/1"; });
    await page.waitForSelector("#dw .dcard", { timeout: 20000 });
    const names = await page.evaluate(() => [...document.querySelectorAll("#dw .dcard")].map((c) => getComputedStyle(c).animationName));
    assert.ok(names.every((n) => n === "none"), "there is no challenge stagger under cm");
  } finally {
    await env.close();
  }
});

test("K3: a saved stop-motion choice is used as-is instead of the device default", { timeout: 120000 }, async (t) => {
  const off = await k3env(t, { set: Object.assign({}, K3SET, { cm: false }) });
  if (!off) return;
  try {
    const page = await off.open();
    assert.ok(!(await page.evaluate(() => document.body.classList.contains("cm"))), "no cm class when motion is on");
    const gear = await page.$eval("#gear", (e) => getComputedStyle(e).transitionDuration);
    assert.ok(gear.includes("0.5s"), "the gear rotation transition is present when motion is on (got " + gear + ")");
  } finally {
    await off.close();
  }

  const saved = await k3env(t, { set: Object.assign({}, K3SET, { cm: false }), reducedMotion: "reduce" });
  if (!saved) return;
  try {
    const page = await saved.open();
    assert.ok(!(await page.evaluate(() => document.body.classList.contains("cm"))), "a saved choice is not overwritten by the device");
  } finally {
    await saved.close();
  }
});

test("K3: a first visit with no saved choice follows the device", { timeout: 120000 }, async (t) => {
  const first = await k3env(t, { set: null, reducedMotion: "reduce" });
  if (!first) return;
  try {
    const page = await first.open();
    assert.ok(await page.evaluate(() => document.body.classList.contains("cm")), "first visit + reduced motion => stop-motion on");
  } finally {
    await first.close();
  }
});


