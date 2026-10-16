"use strict";
/*
 * phase-b.test.js - Phase B visual-foundation acceptance.
 *
 * Loads the real public/index.html in Chromium and checks real behaviour with
 * computed styles / DOM, not just presence of CSS.
 *
 * Only ASCII is used here (no Arabic literals), so this file adds no Arabic
 * runs to the arabic-guard baseline. Each test skips cleanly when Chromium is
 * unavailable.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const WORD_ID = "78-0"; // first word in data order (surah 78, first word)

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
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const set = Object.assign({ mode: "light", pal: "def", gl: 3, style: "glass", gv: 2 }, opts.set || {});

  const api = {
    base,
    async page(width, height) {
      const page = await browser.newPage({ viewport: { width: width || 390, height: height || 844 } });
      await page.emulateMedia({ colorScheme: opts.colorScheme || "light", reducedMotion: opts.reducedMotion || "no-preference" });
      await page.addInitScript({
        content:
          "window.__WORDS__=" + words + ";window.__CH__=" + chRaw + ";" +
          "try{localStorage.setItem('gq-set',JSON.stringify(" + JSON.stringify(set) + "))}catch(e){}",
      });
      await page.goto(base + "/index.html", { waitUntil: "load" });
      await page.waitForSelector("#app .acts, #app .card, #app .list", { timeout: 20000 });
      return page;
    },
    async close() { await browser.close(); await new Promise((r) => server.close(r)); },
  };
  return api;
}

// ---------------------------------------------------------------------------
// B1: verse highlight (item 15)
// ---------------------------------------------------------------------------
test("B1: mark is a bounded inline-block box, no underline, no overlap", { timeout: 120000 }, async (t) => {
  const env = await setup(t);
  if (!env) return;
  try {
    const page = await env.page();
    await page.evaluate((h) => { location.hash = h; }, "#/word/" + WORD_ID);
    await page.waitForSelector("#app .ay mark", { timeout: 20000 });

    const m = await page.evaluate(() => {
      const mk = document.querySelector("#app .ay mark");
      const ay = mk.closest(".ay");
      const cm = getComputedStyle(mk), ca = getComputedStyle(ay);
      return {
        display: cm.display,
        borderBottom: cm.borderBottomWidth,
        deco: cm.textDecorationLine,
        radius: parseFloat(cm.borderTopLeftRadius),
        bg: cm.backgroundColor,
        color: cm.color,
        mH: mk.getBoundingClientRect().height,
        lineH: parseFloat(ca.lineHeight),
      };
    });

    assert.equal(m.display, "inline-block", "highlight is an inline-block box");
    assert.equal(m.borderBottom, "0px", "no border-bottom underline");
    assert.equal(m.deco, "none", "no text-decoration underline");
    assert.ok(m.radius >= 10, "rounded box (>=10px)");
    assert.notEqual(m.bg, "rgba(0, 0, 0, 0)", "translucent accent background present");
    assert.ok(m.mH < m.lineH, "highlight height (" + m.mH.toFixed(1) + ") stays under verse line-height (" + m.lineH.toFixed(1) + ")");
  } finally { await env.close(); }
});
