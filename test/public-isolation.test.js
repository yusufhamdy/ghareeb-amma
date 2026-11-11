"use strict";
/*
 * public-isolation.test.js - no public visitor request may read, depend on, or display unpublished Firestore data.
 *
 * Static: no page or script outside /admin/ has Firebase code, loads the SDK or the config, or assigns the data
 * overrides; migrate.js is gone (its 404 is what protects an old cached page) and the worker no longer precaches it.
 * Browser: every route of the app, a static word page and a static surah page make no request to the Firebase SDK or
 * Firestore, and show the published counts. ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), "utf8");
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const rel = (f) => path.relative(PUBLIC, f).split(path.sep).join("/");
const PUBLIC_CODE = walk(PUBLIC).filter((f) => /\.(html|js)$/.test(f)).map(rel).filter((f) => !f.startsWith("admin/") && f !== "firebase-config.js");
const FORBIDDEN = /firebasejs|firestore\.googleapis|firebase-config|migrate\.js|initializeApp|getFirestore/i;

const WORD_COUNT = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "words.json"), "utf8")).reduce((n, s) => n + s.words.length, 0); // the published words: pages, images and sitemap entries must equal it exactly

test("static: no public page or script has Firebase code", () => {
  assert.ok(PUBLIC_CODE.length > 100, "the scan found the pages (" + PUBLIC_CODE.length + ")");
  assert.deepStrictEqual(PUBLIC_CODE.filter((f) => FORBIDDEN.test(read(f))), []);
});

test("static: migrate.js is gone, and firebase-config.js is kept for the admin", () => {
  assert.ok(!fs.existsSync(path.join(PUBLIC, "migrate.js")), "a 404 is what protects old cached pages");
  assert.ok(fs.existsSync(path.join(PUBLIC, "firebase-config.js")));
  assert.ok(read("admin/index.html").includes('src="/firebase-config.js"'), "the admin still loads it");
});

test("static: the worker neither precaches Firebase files nor keeps the old cache", () => {
  const sw = read("sw.js");
  assert.ok(sw.includes("'ghareeb-pwa-v46'"), "the cache is v46");
  assert.ok(!/migrate\.js|firebase-config\.js/.test(sw));
});

test("static: no public script assigns the data overrides, which remain for tests only", () => {
  const hits = PUBLIC_CODE.filter((f) => /(^|[^.\w])window\.__(WORDS|CH)__\s*=[^=]|globalThis\.__(WORDS|CH)__\s*=[^=]/.test(read(f)));
  assert.deepStrictEqual(hits, []);
});

test("browser: every route uses the published files only", { timeout: 180000 }, async (t) => {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let browser;
  try { browser = await chromium.launch(); } catch (e) { t.skip("chromium unavailable"); return; }
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf" };
  const server = http.createServer((q, s) => {
    let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const f = path.join(PUBLIC, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(s);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const ctx = await browser.newContext({ serviceWorkers: "block" }), page = await ctx.newPage(), asked = [], errors = [];
    page.on("request", (q) => { if (/gstatic\.com\/firebasejs|firestore\.googleapis|firebase-config\.js|migrate\.js/.test(q.url())) asked.push(new URL(q.url()).pathname); });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(base + "/", { waitUntil: "load" });
    await page.waitForFunction(() => typeof W !== "undefined" && W.length > 0);
    const s = await page.evaluate(() => ({ src: window.__DATA_SRC__, words: W.length, surahs: S.length, days: CH.length, overrides: window.__WORDS__ !== undefined || window.__CH__ !== undefined }));
    assert.deepStrictEqual(s, { src: "json", words: WORD_COUNT, surahs: JSON.parse(read("words.json")).length, days: JSON.parse(read("challenge.json")).days.length, overrides: false });
    for (const [hash, sel] of [["#/surahs", "#app .list.sl .row"], ["#/word/114-0", "#app .wd.q"], ["#/challenge", "#app .cg .dy"], ["#/day/1", "#dw .dcard"], ["#/quiz", "#app"], ["#/about", "#app h1"], ["#/", "#app .acts"]]) {
      await page.evaluate((h) => { location.hash = h; }, hash);
      await page.waitForSelector(sel, { timeout: 15000 });
    }
    for (const u of ["/word/an-naba-14.html", "/surah/" + fs.readdirSync(path.join(PUBLIC, "surah"))[0]]) await page.goto(base + u, { waitUntil: "load" });
    await page.waitForTimeout(800);
    assert.deepStrictEqual(asked, [], "no request for the Firebase SDK, Firestore, the config or migrate.js");
    assert.deepStrictEqual(errors, [], "no page or console errors");
    await ctx.close();
  } finally { await browser.close(); await new Promise((r) => server.close(r)); }
});
