"use strict";
/*
 * home-meta.test.js - the home page's title, description and structured data.
 *
 *  - <title>, og:title and twitter:title are the home title; description, og:description and twitter:description
 *    the home description; the app's own home title (pageTitle) is the same, so it doesn't change it back
 *  - two JSON-LD blocks: a WebSite (names, url, inLanguage, publisher -> the Organization) and an Organization (name,
 *    url, the 512 px brand icon as logo, sameAs = exactly the footer's profile links); valid JSON, Arabic as \u escapes
 *  - a Publish rebuild keeps them (the build's index.html is public/index.html with only the surah links refreshed)
 * ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const HTML = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
const HEAD = HTML.slice(0, HTML.indexOf("</head>"));
const SITE = "https://ghareebalquran.com/";
const NAME = "غريب القرآن";
const TITLE = NAME + " | Ghareeb Al Quran - معاني كلمات جزء عم";
const DESC = NAME + " (Ghareeb Al Quran): معاني الكلمات الغريبة في جزء عم بأسلوب مبسّط، مع الآية والمعنى ومصدره.";

const metas = (attr, key) => [...HEAD.matchAll(new RegExp("<meta " + attr + '="' + key + '" content="([^"]*)">', "g"))].map((m) => m[1]);
const ldBlocks = () => [...HEAD.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const footerLinks = () => {
  const soc = HTML.match(/const SOC=(\[\[[\s\S]*?\]\]);/);
  assert.ok(soc, "the footer's profile list");
  return [...soc[1].matchAll(/\['[a-z]+','(https:[^']+)'/g)].map((m) => m[1]);
};

test("home title and description in <title>, Open Graph and Twitter", () => {
  assert.deepStrictEqual([...HEAD.matchAll(/<title>([^<]*)<\/title>/g)].map((m) => m[1]), [TITLE]);
  assert.deepStrictEqual(metas("property", "og:title"), [TITLE]);
  assert.deepStrictEqual(metas("name", "twitter:title"), [TITLE]);
  assert.deepStrictEqual(metas("name", "description"), [DESC]);
  assert.deepStrictEqual(metas("property", "og:description"), [DESC]);
  assert.deepStrictEqual(metas("name", "twitter:description"), [DESC]);
});

test("JSON-LD: a WebSite and an Organization, valid, with the required fields", () => {
  const raw = ldBlocks();
  assert.strictEqual(raw.length, 2, "two JSON-LD blocks");
  for (const r of raw) assert.ok(/^[\x20-\x7e]*$/.test(r), "ASCII, Arabic as \\u escapes");
  const [web, org] = raw.map((r) => JSON.parse(r));
  assert.strictEqual(web["@context"], "https://schema.org");
  assert.strictEqual(web["@type"], "WebSite");
  assert.strictEqual(web.name, NAME);
  assert.deepStrictEqual(web.alternateName, ["Ghareeb Al Quran", "Gharib Al Quran", "Ghareeb Alquran", "غريب عم"]);
  assert.strictEqual(web.url, SITE);
  assert.strictEqual(web.inLanguage, "ar");
  assert.strictEqual(org["@context"], "https://schema.org");
  assert.strictEqual(org["@type"], "Organization");
  assert.ok(org["@id"] && web.publisher && web.publisher["@id"] === org["@id"], "the WebSite's publisher is the Organization");
  assert.strictEqual(org.name, NAME);
  assert.strictEqual(org.alternateName, "Ghareeb Al Quran");
  assert.strictEqual(org.url, SITE);
  assert.strictEqual(org.logo, SITE + "icon-512.png");
  const png = fs.readFileSync(path.join(PUBLIC, "icon-512.png"));
  assert.deepStrictEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [512, 512], "the logo is the 512 px icon");
  const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, "manifest.json"), "utf8"));
  assert.ok(manifest.icons.some((i) => i.sizes === "512x512" && i.purpose === "any" && i.src.split("?")[0] === "/icon-512.png"), "the brand icon of the manifest");
  const links = footerLinks();
  assert.strictEqual(links.length, 3);
  assert.deepStrictEqual(org.sameAs, links, "sameAs is exactly the footer's profile links");
});

test("a Publish rebuild keeps the home title, description and JSON-LD", async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, "scripts", "publish-build.mjs")).href);
  const words = JSON.parse(fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8"));
  const challenge = JSON.parse(fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8"));
  const out = mod.buildSite(words, challenge, { today: "2099-01-01" }).files["index.html"];
  assert.strictEqual(out.slice(0, out.indexOf("</head>")), HEAD);
});

test("the app keeps the home title after it renders", { timeout: 120000 }, async () => {
  const { chromium } = require("playwright");
  const srv = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(PUBLIC, p);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    const t = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css" }[path.extname(file)];
    res.writeHead(200, t ? { "content-type": t } : {});
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const br = await chromium.launch();
  try {
    const ctx = await br.newContext({ serviceWorkers: "block" });
    await ctx.addInitScript(() => { try { localStorage.setItem("gq-ld", "1"); } catch (e) {} });
    const p = await ctx.newPage();
    await p.goto("http://127.0.0.1:" + srv.address().port + "/#/surahs");
    await p.waitForSelector("#app .list.sl a.row");
    await p.evaluate(() => { location.hash = "#/"; });
    await p.waitForFunction(() => !document.querySelector("#app .list.sl"));
    assert.strictEqual(await p.title(), TITLE);
  } finally {
    await br.close(); srv.close();
  }
});
