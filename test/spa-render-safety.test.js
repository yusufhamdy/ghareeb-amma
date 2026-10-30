"use strict";
/*
 * spa-render-safety.test.js - stored data cannot inject markup into the public site (public/index.html).
 *   - an ayah label with a quote and markup stays inside the share button's data-u attribute (esc(w.slug));
 *   - a challenge day number that is a string of markup is read as a number, and the start date in the lock message
 *     is escaped.
 * Serves public/ with crafted words.json / challenge.json and no Firebase config (no live read). ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PUBLIC = path.resolve(__dirname, "..", "public");

function staticServer(root, over) {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".png": "image/png" };
  return http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/firebase-config.js") { res.writeHead(200, { "content-type": types[".js"] }); res.end("window.FIREBASE_CONFIG=null;"); return; }
    if (over[p]) { res.writeHead(200, { "content-type": types[".json"] }); res.end(over[p]()); return; }
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

test("public site: a crafted label or day number cannot inject markup", { timeout: 120000 }, async (t) => {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let br;
  try { br = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return; }
  const words = JSON.parse(fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8"));
  // the first word of the first surah gets a label that would close the data-u attribute
  words[0].ayahs[0] = Object.assign({}, words[0].ayahs[0], { label: '4"><i id="inj"></i><b x="' });
  const ch = JSON.parse(fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8"));
  const days = Array.isArray(ch) ? ch : ch.days;
  days[0] = Object.assign({}, days[0], { d: '1"><i id="inj2"></i><b x="' });
  if (!Array.isArray(ch)) { ch.startDate = '2099-01-01<i id="inj3"></i>'; ch.releasedUpTo = null; }
  const server = staticServer(PUBLIC, { "/words.json": () => JSON.stringify(words), "/challenge.json": () => JSON.stringify(ch) });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("gq-ld", "1"); } catch (e) {} });
    const page = await ctx.newPage();
    const probe = () => page.evaluate(() => ({ inj: !!document.getElementById("inj"), inj2: !!document.getElementById("inj2"), inj3: !!document.getElementById("inj3"), du: [...document.querySelectorAll("[data-u]")].map((e) => e.getAttribute("data-u")) }));
    await page.goto(base + "/#/word/114-0", { waitUntil: "load" });
    await page.waitForSelector("#app .wd", { timeout: 20000 });
    let r = await probe();
    assert.strictEqual(r.inj, false, "no element injected through the label");
    assert.ok(r.du.some((u) => u.includes('"><i id="inj">')), "the label stays inside data-u: " + JSON.stringify(r.du));
    await page.goto(base + "/#/challenge", { waitUntil: "load" });
    await page.waitForSelector("#app h1", { timeout: 20000 });
    await page.waitForTimeout(300);
    r = await probe();
    assert.strictEqual(r.inj2, false, "no element injected through a day number");
    assert.strictEqual(r.inj3, false, "no element injected through the start date");
    await ctx.close();
  } finally {
    await br.close();
    await new Promise((r) => server.close(r));
  }
});
