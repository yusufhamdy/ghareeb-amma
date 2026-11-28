"use strict";
/*
 * cf-analytics.test.js - Cloudflare Web Analytics (cookieless visit counts).
 *
 *  - every public page (home, word pages, surah pages, legal pages) has the beacon snippet exactly once, just before
 *    </body>; the admin page has none; a Publish rebuild keeps it (the build writes it)
 *  - the CSP allows the beacon script and its endpoint, in script-src and connect-src only
 *  - the service worker never handles (so never caches) a cross-origin request such as the beacon
 *  - the privacy text says the site uses Cloudflare Web Analytics, in the static privacy page, the app's privacy view
 *    and the shared legal copy; the old sentence is gone
 * ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), "utf8");
const SNIP = "<script defer src=\"https://static.cloudflareinsights.com/beacon.min.js\" data-cf-beacon='{\"token\": \"e4ae8446ec884d63b0308848a90d22ea\"}'></script>";
const NEW_PRIV = "يستخدم الموقع أداة Cloudflare Web Analytics لمعرفة عدد الزيارات فقط، دون ملفات تعريف الارتباط ودون جمع أي بيانات شخصية، ولا يعرض الموقع أي إعلانات.";
const OLD_PRIV = "لا يستخدم الموقع أدوات تحليل ولا إعلانات.";
const LEGAL_SLUGS = ["about", "privacy", "terms", "rights"];
const publicPages = () => ["index.html"]
  .concat(fs.readdirSync(path.join(PUBLIC, "word")).filter((f) => f.endsWith(".html")).map((f) => "word/" + f))
  .concat(fs.readdirSync(path.join(PUBLIC, "surah")).filter((f) => f.endsWith(".html")).map((f) => "surah/" + f))
  .concat(LEGAL_SLUGS.map((s) => s + "/index.html"));
const count = (s, x) => s.split(x).length - 1;

test("every public page has the beacon exactly once, before </body>; the admin page has none", () => {
  const pages = publicPages();
  assert.strictEqual(pages.length, 1 + 73 + 28 + 4);
  const bad = pages.filter((f) => { const h = read(f); return count(h, SNIP) !== 1 || count(h, "cloudflareinsights") !== 1 || !h.includes(SNIP + "</body>"); });
  assert.deepStrictEqual(bad, [], "pages without exactly one snippet before </body>");
  assert.strictEqual(count(read("admin/index.html"), "cloudflareinsights"), 0, "no beacon on the admin page");
});

test("a Publish rebuild writes the beacon on every generated page", async () => {
  const mod = await import(pathToFileURL(path.join(ROOT, "scripts", "publish-build.mjs")).href);
  assert.strictEqual(mod.CF_BEACON, SNIP);
  const { files } = mod.buildSite(JSON.parse(read("words.json")), JSON.parse(read("challenge.json")), { today: "2099-01-01" });
  const html = Object.keys(files).filter((f) => f.endsWith(".html"));
  assert.deepStrictEqual(html.slice().sort(), publicPages().sort(), "the build generates exactly the public pages");
  assert.deepStrictEqual(html.filter((f) => count(files[f], SNIP) !== 1 || !files[f].includes(SNIP + "</body>")), []);
});

test("the CSP allows the beacon script and endpoint, in script-src and connect-src only", () => {
  const fb = JSON.parse(fs.readFileSync(path.join(ROOT, "firebase.json"), "utf8"));
  const csps = fb.hosting.headers.flatMap((h) => h.headers).filter((x) => /content-security-policy/i.test(x.key)).map((x) => x.value);
  assert.ok(csps.length >= 1);
  for (const csp of csps) {
    const dir = Object.fromEntries(csp.split(";").map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map((d) => [d[0], d.slice(1)]));
    assert.ok(dir["script-src"].includes("https://static.cloudflareinsights.com"), "script-src");
    assert.ok(dir["connect-src"].includes("https://cloudflareinsights.com"), "connect-src");
    const others = Object.keys(dir).filter((k) => k !== "script-src" && k !== "connect-src");
    assert.deepStrictEqual(others.filter((k) => dir[k].some((v) => /cloudflareinsights/.test(v))), [], "no other directive");
    assert.strictEqual(count(csp, "cloudflareinsights"), 2, "exactly the two hosts");
  }
});

test("the service worker leaves cross-origin requests (the beacon) to the network, uncached", () => {
  const sw = read("sw.js");
  const handler = sw.slice(sw.indexOf("addEventListener('fetch'"));
  const skip = handler.indexOf("if (url.origin !== self.location.origin) return;");
  assert.ok(skip > 0, "cross-origin requests are not handled");
  assert.ok(skip < handler.indexOf("event.respondWith"), "before any respondWith");
  assert.ok(!/cloudflareinsights/.test(sw));
});

test("automated runs answer the beacon locally: npm test and the CI shards load scripts/ci/no-analytics.cjs", { timeout: 120000 }, async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.ok(/^node --require \.\/scripts\/ci\/no-analytics\.cjs --test /.test(pkg.scripts.test), "npm test");
  assert.ok(/spawn\(process\.execPath, \["--require", path\.join\(REPO, "scripts", "ci", "no-analytics\.cjs"\), "--test"/.test(fs.readFileSync(path.join(ROOT, "scripts", "ci", "shard-tests.mjs"), "utf8")), "the CI shard runner");
  assert.ok(fs.readFileSync(path.join(ROOT, "scripts", "verify-client-firestore.mjs"), "utf8").includes("createRequire(import.meta.url)('./ci/no-analytics.cjs');"), "npm run client:verify (CI)");
  require(path.join(ROOT, "scripts", "ci", "no-analytics.cjs"));
  assert.ok(/no-analytics\.cjs/.test(process.env.NODE_OPTIONS || ""), "passed on to child processes");
  const { chromium } = require("playwright");
  const br = await chromium.launch();
  try {
    const p = await br.newPage();
    const seen = [];
    p.on("response", async (r) => { if (/cloudflareinsights\.com/.test(r.url())) seen.push([r.status(), (await r.body()).length]); });
    await p.setContent("<!doctype html><html><body>" + SNIP + "</body></html>", { waitUntil: "load" });
    await p.waitForTimeout(300);
    assert.deepStrictEqual(seen, [[200, 0]], "the beacon script is answered locally with an empty script");
  } finally { await br.close(); }
});

test("the privacy text names Cloudflare Web Analytics in the static page, the app view and the shared copy", () => {
  const { LEGAL } = require(path.join(ROOT, "shared", "legal.js"));
  const priv = LEGAL.find((e) => e.slug === "privacy");
  assert.strictEqual(priv.paras.filter((p) => p === NEW_PRIV).length, 1, "shared/legal.js");
  assert.strictEqual(count(read("privacy/index.html"), NEW_PRIV), 1, "the static privacy page");
  assert.strictEqual(count(read("index.html"), "'" + NEW_PRIV + "'"), 1, "the app's privacy view");
  const pages = ["index.html", "privacy/index.html"];
  assert.deepStrictEqual(pages.filter((f) => read(f).includes(OLD_PRIV)), [], "the old sentence is gone");
  assert.ok(!priv.paras.includes(OLD_PRIV));
});
