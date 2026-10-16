"use strict";
/*
 * phase-c.test.js - Phase C acceptance (fixes + roulette + multi-word day + sounds).
 *
 * Loads the real public/index.html in Chromium and checks real behaviour from the
 * DOM / computed styles. ASCII only (no Arabic literals), so no new Arabic runs
 * reach the arabic-guard baseline. Each test skips cleanly when Chromium is
 * unavailable.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

function staticServer(root) {
  const types = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  };
  return http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

async function setup(t, opts = {}) {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return null; }
  let browser;
  try { browser = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return null; }

  const words = fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8");
  const chRaw = fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8");
  const chObj = opts.ch || Object.assign(JSON.parse(chRaw), { releasedUpTo: 30 });
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const set = Object.assign({ mode: "light", pal: "def", gl: 3, style: "glass", gv: 2, snd: false }, opts.set || {});
  const prog = opts.prog || null;

  const api = {
    base,
    async page(width, height) {
      const page = await browser.newPage({ viewport: { width: width || 390, height: height || 844 } });
      await page.emulateMedia({ colorScheme: opts.colorScheme || "light", reducedMotion: opts.reducedMotion || "no-preference" });
      let content =
        "window.__WORDS__=" + words + ";window.__CH__=" + JSON.stringify(chObj) + ";" +
        "try{localStorage.setItem('gq-set',JSON.stringify(" + JSON.stringify(set) + "))}catch(e){}";
      if (prog) content += "try{localStorage.setItem('gq-prog',JSON.stringify(" + JSON.stringify(prog) + "))}catch(e){}";
      if (opts.init) content += opts.init;
      await page.addInitScript({ content });
      await page.goto(base + "/index.html", { waitUntil: "load" });
      await page.waitForSelector("#app .acts, #app .card, #app .list, #app header", { timeout: 20000 });
      return page;
    },
    async close() { await browser.close(); await new Promise((r) => server.close(r)); },
  };
  return api;
}

function nav(page, hash) { return page.evaluate((h) => { location.hash = h; }, hash); }

// ---------------------------------------------------------------------------
// F1: settings gear sits just outside the content column on desktop only
// ---------------------------------------------------------------------------
test("F1: desktop gear is inset outside the content column and unchanged on mobile", { timeout: 120000 }, async (t) => {
  const env = await setup(t);
  if (!env) return;
  try {
    const page = await env.page(1440, 900);
    await page.waitForSelector('#app .ib[data-a="set"]', { timeout: 20000 });
    const desk = await page.evaluate(() => {
      const g = document.querySelector('#app .ib[data-a="set"]');
      const wrap = document.querySelector('#app');
      const gb = g.getBoundingClientRect(), wb = wrap.getBoundingClientRect();
      const overlap = !(gb.right <= wb.left || gb.left >= wb.right || gb.bottom <= wb.top || gb.top >= wb.bottom);
      return {
        pos: getComputedStyle(g).position,
        gapEnd: wb.left - gb.left,           // RTL: inline-end side is the left
        overlap,
        visTop: gb.top, visBottom: gb.bottom,
      };
    });
    assert.equal(desk.pos, "fixed", "gear stays position:fixed");
    assert.ok(!desk.overlap, "gear does not intersect the content column");
    assert.ok(desk.gapEnd >= 0 && desk.gapEnd <= 72, "inline-end gap to the column is 0..72px (got " + desk.gapEnd.toFixed(1) + ")");

    const mob = await env.page(400, 800);
    await mob.waitForSelector('#app .ib[data-a="set"]', { timeout: 20000 });
    const m = await mob.evaluate(() => {
      const g = document.querySelector('#app .ib[data-a="set"]');
      const r = g.getBoundingClientRect();
      return { left: r.left, pos: getComputedStyle(g).position };
    });
    assert.equal(m.pos, "fixed", "mobile gear stays fixed");
    assert.ok(Math.abs(m.left - 16) < 1.5, "mobile gear keeps its 16px edge offset (got " + m.left.toFixed(1) + ")");
  } finally { await env.close(); }
});
