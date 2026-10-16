"use strict";
/*
 * phase-d.test.js - Phase D acceptance (glass draw hover, no button jump,
 * collapsible day cards, navigation flash, admin dialog/icons, favicon, share).
 *
 * Loads the real public/ files in Chromium and checks real behaviour from the
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
    async page(width, height, extra) {
      const page = await browser.newPage({ viewport: { width: width || 390, height: height || 844 } });
      await page.emulateMedia({ colorScheme: opts.colorScheme || "light", reducedMotion: opts.reducedMotion || "no-preference" });
      let content =
        "window.__WORDS__=" + words + ";window.__CH__=" + JSON.stringify(chObj) + ";" +
        "try{localStorage.setItem('gq-set',JSON.stringify(" + JSON.stringify(set) + "))}catch(e){}";
      if (prog) content += "try{localStorage.setItem('gq-prog',JSON.stringify(" + JSON.stringify(prog) + "))}catch(e){}";
      if (opts.init) content += opts.init;
      await page.addInitScript({ content });
      if (opts.route) await opts.route(page);
      await page.goto(base + "/index.html", { waitUntil: "load" });
      return page;
    },
    async close() { await browser.close(); await new Promise((r) => server.close(r)); },
  };
  return api;
}

function nav(page, hash) { return page.evaluate((h) => { location.hash = h; }, hash); }

// Read the computed style of one element matched by a selector.
function cs(page, sel, props) {
  return page.evaluate(([s, ps]) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const c = getComputedStyle(el);
    const o = {}; ps.forEach((p) => { o[p] = c.getPropertyValue(p); }); return o;
  }, [sel, props]);
}

// ---------------------------------------------------------------------------
// D1: glass draw button keeps its fill and gains a rim/glow on hover
// ---------------------------------------------------------------------------
test("D1: glass filled draw button keeps its background and changes its shadow; shade still inverts", { timeout: 120000 }, async (t) => {
  const env = await setup(t, { set: { style: "glass", mode: "light" } });
  if (!env) return;
  try {
    const page = await env.page(390, 844);
    await nav(page, "#/");
    await page.waitForSelector('#app .acts [data-a="rnd"]', { timeout: 20000 });
    const sel = '#app .acts [data-a="rnd"]';
    const before = await cs(page, sel, ["background-color", "box-shadow"]);
    await page.hover(sel);
    await page.waitForTimeout(400);
    const after = await cs(page, sel, ["background-color", "box-shadow"]);
    assert.equal(after["background-color"], before["background-color"], "glass filled button keeps its background on hover");
    assert.notEqual(after["box-shadow"], before["box-shadow"], "glass filled button gains a hover box-shadow");
    assert.ok(/inset/.test(after["box-shadow"]), "the hover shadow is an inner rim + glow");
  } finally { await env.close(); }

  const envS = await setup(t, { set: { style: "shade", mode: "light" } });
  if (!envS) return;
  try {
    const page = await envS.page(390, 844);
    await nav(page, "#/");
    await page.waitForSelector('#app .acts [data-a="rnd"]', { timeout: 20000 });
    const sel = '#app .acts [data-a="rnd"]';
    const before = await cs(page, sel, ["background-color"]);
    await page.hover(sel);
    await page.waitForTimeout(400);
    const after = await cs(page, sel, ["background-color"]);
    assert.notEqual(after["background-color"], before["background-color"], "shade filled button still inverts (background changes) on hover");
  } finally { await envS.close(); }
});

// ---------------------------------------------------------------------------
// D2: buttons never move on hover; cards keep their very light lift
// ---------------------------------------------------------------------------
test("D2: buttons keep transform none on hover in both themes; a result card still lifts", { timeout: 120000 }, async (t) => {
  for (const style of ["glass", "shade"]) {
    const env = await setup(t, { set: { style, mode: "light" } });
    if (!env) return;
    try {
      const page = await env.page(390, 844);
      await nav(page, "#/");
      await page.waitForSelector('#app .acts .btn[data-a="rnd"]', { timeout: 20000 });
      await page.hover('.acts .btn[data-a="rnd"]');
      await page.waitForTimeout(400);
      const filled = await cs(page, '.acts .btn[data-a="rnd"]', ["transform"]);
      assert.equal(filled.transform, "none", style + ": filled .btn does not move on hover");
      await page.hover(".acts .btn.o");
      await page.waitForTimeout(400);
      const outlined = await cs(page, ".acts .btn.o", ["transform"]);
      assert.equal(outlined.transform, "none", style + ": .btn.o does not move on hover");

      await nav(page, "#/surah/78");
      await page.waitForSelector("#app .list.rs a.row", { timeout: 20000 });
      const c1 = await cs(page, "#app .list.rs a.row", ["transform"]);
      await page.hover("#app .list.rs a.row");
      await page.waitForTimeout(400);
      const c2 = await cs(page, "#app .list.rs a.row", ["transform"]);
      assert.notEqual(c2.transform, c1.transform, style + ": a result card still changes transform on hover");
    } finally { await env.close(); }
  }
});
