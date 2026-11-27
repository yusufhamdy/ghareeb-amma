"use strict";
/*
 * seo-crawlable.test.js - every surah and word page is reachable by a crawlable link, and the sitemap dates each page.
 *
 *  - the app's surah and word links carry the static page as href (it exists) and the app route in data-r; a plain
 *    left click routes in the app (hash route, no page load), a Ctrl click opens the static page
 *  - the initial home HTML has a link to every surah page, inside the container the app replaces, hidden when scripts
 *    run and shown without them
 *  - every sitemap URL has a valid <lastmod> that only moves when that page's content changes
 * ASCII only; asserts counts and paths, never document content.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), "utf8");
const WORDS = JSON.parse(read("words.json"));
const CHALLENGE = JSON.parse(read("challenge.json"));
const SURAH_FILES = fs.readdirSync(path.join(PUBLIC, "surah")).filter((f) => f.endsWith(".html")).map((f) => "/surah/" + f).sort();
const exists = (u) => fs.existsSync(path.join(PUBLIC, u.replace(/^\//, "")));
const loadPublish = () => import(pathToFileURL(path.join(ROOT, "scripts", "publish-build.mjs")).href);

function server() {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2", ".png": "image/png" };
  return http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(PUBLIC, p);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

test("the initial home HTML links every surah page inside the app's container", () => {
  const html = read("index.html");
  const app = html.match(/<main class="wrap" id="app">([\s\S]*?)<\/main>/);
  assert.ok(app, "the app container is in the initial HTML");
  const links = [...app[1].matchAll(/<a href="([^"]+)">[^<]+<\/a>/g)].map((m) => m[1]).sort();
  assert.strictEqual(links.length, WORDS.length, "one link per surah");
  assert.deepStrictEqual(links, SURAH_FILES, "the links are exactly the static surah pages");
  assert.ok(/<nav class="sfb"/.test(app[1]) && /\.sfb\{display:none\}/.test(html) && /<noscript><style>\.sfb\{display:flex/.test(html), "hidden when scripts run, shown without them");
});

test("the build reproduces the committed home HTML, sitemap and dates", async () => {
  const mod = await loadPublish();
  const { files } = mod.buildSite(WORDS, CHALLENGE, { today: "2099-01-01" });
  assert.strictEqual(files["index.html"], read("index.html"), "index.html surah links are up to date");
  assert.strictEqual(files["sitemap.xml"], read("sitemap.xml"), "the sitemap (and its dates) are stable on a rebuild");
  assert.strictEqual(files[mod.DATES_FILE], read(mod.DATES_FILE), "the dates file is stable on a rebuild");
});

test("every sitemap URL has a valid <lastmod>, the dates file covers exactly the sitemap", async () => {
  const mod = await loadPublish();
  const xml = read("sitemap.xml"), dates = JSON.parse(read(mod.DATES_FILE));
  const urls = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  assert.strictEqual(urls.length, 106, "106 URLs");
  const today = new Date().toISOString().slice(0, 10);
  for (const u of urls) {
    const loc = (u.match(/<loc>https:\/\/ghareebalquran\.com([^<]*)<\/loc>/) || [])[1];
    const lm = (u.match(/<lastmod>([^<]*)<\/lastmod>/) || [])[1];
    assert.ok(loc && lm, "loc and lastmod: " + loc);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(lm) && !isNaN(Date.parse(lm + "T00:00:00Z")) && lm >= "2026-01-01" && lm <= today, "a valid past date for " + loc);
    assert.strictEqual(dates[loc] && dates[loc].lastmod, lm, "the dates file agrees for " + loc);
  }
  assert.strictEqual(Object.keys(dates).length, urls.length);
});

test("a changed page gets a new date; every other page keeps its date", async () => {
  const mod = await loadPublish();
  const words = JSON.parse(JSON.stringify(WORDS));
  words[0].meanings[0] = String(words[0].meanings[0]) + " .";
  const { files } = mod.buildSite(words, CHALLENGE, { today: "2099-01-01" });
  const before = JSON.parse(read(mod.DATES_FILE)), after = JSON.parse(files[mod.DATES_FILE]);
  const moved = Object.keys(after).filter((u) => after[u].lastmod !== before[u].lastmod).sort();
  const changed = Object.keys(after).filter((u) => mod.pageOfUrl(u).some((f) => files[f] !== read(f))).sort();
  assert.ok(moved.includes("/"), "the home page (its words changed)");
  assert.strictEqual(moved.filter((u) => u.startsWith("/word/")).length, 1, "one word page");
  assert.deepStrictEqual(moved, changed, "exactly the pages whose content changed");
  assert.ok(moved.length <= 3, "nothing else");
  assert.ok(moved.every((u) => after[u].lastmod === "2099-01-01"));
});

test("app links: static hrefs that exist, in-app routing on a plain click, the static page on Ctrl+click", { timeout: 240000 }, async () => {
  const { chromium } = require("playwright");
  const srv = server(); await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + srv.address().port;
  const br = await chromium.launch();
  try {
    const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
    await ctx.addInitScript(() => { try { localStorage.setItem("gq-ld", "1"); } catch (e) {} });
    const p = await ctx.newPage();
    const collect = () => p.evaluate(() => ({
      links: [...document.querySelectorAll("#app a[href]")].map((a) => ({ href: a.getAttribute("href"), r: a.getAttribute("data-r") })).filter((x) => /^\/(surah|word)\//.test(x.href) || /^#\/(surah|word)\//.test(x.href)),
    }));
    const seen = new Map();
    const visit = async (h, prep) => {
      await p.goto(base + "/?v=" + Math.random() + h); await p.waitForSelector("#app > *:not(.sfb)", { timeout: 15000 });
      if (prep) await prep();
      for (const l of (await collect()).links) seen.set(l.href, l.r);
    };
    await visit("#/surahs");
    for (const s of WORDS.keys()) await visit("#/surah/" + (await p.evaluate((i) => S[i].num, s)));
    await visit("#/word/78-0");
    await visit("#/", async () => { await p.fill("#q", "ا"); await p.waitForSelector("#res .row", { timeout: 5000 }); });
    const hrefs = [...seen.keys()];
    assert.ok(hrefs.length > 100, "links collected: " + hrefs.length);
    assert.deepStrictEqual(hrefs.filter((h) => h.startsWith("#")), [], "no hash-only surah or word links");
    assert.deepStrictEqual(hrefs.filter((h) => !exists(h)), [], "every href is an existing static page");
    assert.deepStrictEqual(hrefs.filter((h) => !/^#\/(surah|word)\/[0-9-]+$/.test(seen.get(h) || "")), [], "every link has its app route");
    assert.deepStrictEqual(SURAH_FILES.filter((f) => !seen.has(f)), [], "every surah page is linked from the app");

    // a plain left click routes in the app: same document, hash route
    await p.goto(base + "/?click#/surahs"); await p.waitForSelector("#app .list.sl a.row");
    await p.evaluate(() => { window.__doc = 1; });
    const first = await p.$eval("#app .list.sl a.row", (a) => a.getAttribute("data-r"));
    await p.click("#app .list.sl a.row");
    await p.waitForFunction((r) => location.hash === r, first);
    assert.strictEqual(await p.evaluate(() => [window.__doc, location.pathname].join(" ")), "1 /", "no page load");
    await p.waitForSelector("#app .snav a.row");
    const word = await p.$eval("#app .snav a.row", (a) => a.getAttribute("data-r"));
    await p.click("#app .snav a.row");
    await p.waitForFunction((r) => location.hash === r, word);
    assert.strictEqual(await p.evaluate(() => window.__doc), 1, "still no page load");

    // Ctrl+click: the browser opens the static page; the app doesn't route
    await p.waitForSelector("#app a.pill");
    const before = await p.evaluate(() => location.hash);
    const pill = await p.$eval("#app a.pill", (a) => a.getAttribute("href"));
    const [tab] = await Promise.all([ctx.waitForEvent("page"), p.click("#app a.pill", { modifiers: ["Control"] })]);
    await tab.waitForLoadState("domcontentloaded");
    assert.strictEqual(new URL(tab.url()).pathname, pill, "the new tab is the static surah page");
    assert.strictEqual(await p.evaluate(() => location.hash), before, "the app stayed on its page");

    // without scripts the home page shows the surah links
    const noJs = await br.newContext({ javaScriptEnabled: false });
    const q = await noJs.newPage(); await q.goto(base + "/");
    const vis = await q.$$eval("#app nav.sfb a", (a) => a.filter((x) => x.getBoundingClientRect().width > 0).length);
    assert.strictEqual(vis, WORDS.length, "every surah link is visible without scripts");
    await noJs.close();
  } finally {
    await br.close(); srv.close();
  }
});
