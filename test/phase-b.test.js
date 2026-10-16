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

// ---------------------------------------------------------------------------
// B2: search results / surah word rows as cards (item 16)
// ---------------------------------------------------------------------------
function firstWord() {
  const entries = JSON.parse(fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8"));
  return entries[0].words[0];
}

test("B2: results are one centered card column and the whole row is the hover target", { timeout: 120000 }, async (t) => {
  const env = await setup(t);
  if (!env) return;
  try {
    const page = await env.page(1440, 900);
    await page.fill("#q", firstWord());
    await page.waitForSelector("#res .list.rs .row", { timeout: 20000 });

    const info = await page.evaluate(() => {
      const box = document.querySelector("#res .list.rs");
      const row = box.querySelector(".row");
      const cb = getComputedStyle(box), cr = getComputedStyle(row);
      const rb = row.getBoundingClientRect(), bb = box.getBoundingClientRect();
      return {
        cols: cb.gridTemplateColumns.trim().split(/\s+/).length,
        maxW: parseFloat(cb.maxWidth),
        boxW: bb.width,
        centered: Math.abs((bb.left + bb.width / 2) - (window.innerWidth / 2)) < 2,
        border: cr.borderTopWidth,
        radius: parseFloat(cr.borderTopLeftRadius),
        bg: cr.backgroundImage,
        // the row is both the hover target and the painted card: one element
        rowIsCard: cr.borderTopWidth === "1px" && parseFloat(cr.borderTopLeftRadius) >= 22 && rb.height >= 76,
      };
    });
    assert.equal(info.cols, 1, "search results use one column at 1440px");
    assert.ok(info.maxW <= 720, "results column is capped at 720px");
    assert.ok(info.centered, "results column is centered");
    assert.equal(info.border, "1px", "each result is its own bordered card");
    assert.ok(info.radius >= 22, "result card has the card radius");
    assert.ok(info.bg.includes("gradient"), "result card paints a card surface, not a shared list");
    assert.ok(info.rowIsCard, "the hover target is the whole card (bounding box == card)");

    // hovering applies to the whole card row
    const before = await page.$eval("#res .list.rs .row", (e) => getComputedStyle(e).transform);
    await page.hover("#res .list.rs .row");
    const after = await page.$eval("#res .list.rs .row", (e) => getComputedStyle(e).transform);
    assert.notEqual(before, after, "hovering the row transforms the whole card");
  } finally { await env.close(); }
});

// ---------------------------------------------------------------------------
// B3: shade surah picker rectangles + 44px day tiles (items 17, 18)
// ---------------------------------------------------------------------------
test("B3: shade surah cards are rectangles and day tiles are 44px with even gaps", { timeout: 120000 }, async (t) => {
  const env = await setup(t, { set: { style: "shade" } });
  if (!env) return;
  try {
    const page = await env.page(390, 844);
    await page.evaluate(() => { location.hash = "#/surahs"; });
    await page.waitForSelector("#app .list.sl .row", { timeout: 20000 });
    const card = await page.evaluate(() => {
      const r = document.querySelector("#app .list.sl .row");
      const rb = r.getBoundingClientRect(), cr = getComputedStyle(r);
      return {
        w: rb.width, h: rb.height,
        shade: document.body.classList.contains("shade"),
        disp: cr.display,
        bg: cr.backgroundImage,
      };
    });
    assert.ok(card.shade, "shade style applied");
    assert.equal(card.disp, "grid", "surah card is a grid rectangle, not a square tile");
    assert.ok(card.w > card.h, "surah card width (" + card.w.toFixed(0) + ") > height (" + card.h.toFixed(0) + ")");
    assert.ok(card.bg.includes("gradient"), "surah card uses the light --tc gradient");

    await page.evaluate(() => { location.hash = "#/challenge"; });
    await page.waitForSelector("#app .cg .dy", { timeout: 20000 });
    const tiles = await page.evaluate(() => {
      const cg = document.querySelector("#app .cg");
      const dy = cg.querySelector(".dy");
      const db = dy.getBoundingClientRect(), cs = getComputedStyle(cg);
      return { w: db.width, h: db.height, col: cs.columnGap, row: cs.rowGap };
    });
    assert.ok(Math.abs(tiles.w - 44) < 0.5 && Math.abs(tiles.h - 44) < 0.5, "day tile is 44x44 (got " + tiles.w + "x" + tiles.h + ")");
    assert.equal(tiles.col, tiles.row, "horizontal gap equals vertical gap (" + tiles.col + " vs " + tiles.row + ")");
  } finally { await env.close(); }
});

// ---------------------------------------------------------------------------
// B4: per-theme hover / press / focus + centered social tile (items 12, 13)
// ---------------------------------------------------------------------------
test("B4: hovering a card transforms it, social tile is centered, reduced-motion keeps transform none", { timeout: 120000 }, async (t) => {
  const env = await setup(t);
  if (!env) return;
  try {
    const page = await env.page(900, 900);
    await page.waitForSelector("#app a.g.card", { timeout: 20000 });
    const cardSel = "#app a.g.card";

    const t0 = await page.$eval(cardSel, (e) => getComputedStyle(e).transform);
    await page.hover(cardSel);
    const t1 = await page.$eval(cardSel, (e) => ({ tr: getComputedStyle(e).transform, sh: getComputedStyle(e).boxShadow }));
    assert.notEqual(t1.tr, t0, "hovering a card changes its transform");
    assert.ok(t1.sh !== "none", "hovering a card applies a soft shadow/glow");

    // social icon: the ::before disc shares the icon box centre
    await page.waitForSelector("#app .so", { timeout: 20000 });
    const so = await page.evaluate(() => {
      const el = document.querySelector("#app .so");
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el, "::before");
      const px = (v) => parseFloat(v) || 0;
      const l = px(cs.left), rt = px(cs.right), tp = px(cs.top), bt = px(cs.bottom);
      // pseudo centre = element centre shifted by the asymmetric insets
      const dx = (rt - l) / 2, dy = (bt - tp) / 2;
      return { dx, dy, w: px(cs.width), h: px(cs.height), ew: r.width, eh: r.height };
    });
    assert.ok(Math.abs(so.dx) < 1 && Math.abs(so.dy) < 1, "social ::before is centred on the icon box");
  } finally { await env.close(); }

  const rmv = await setup(t, { reducedMotion: "reduce" });
  if (!rmv) return;
  try {
    const page = await rmv.page(900, 900);
    await page.waitForSelector("#app a.g.card", { timeout: 20000 });
    const cardSel = "#app a.g.card";
    await page.hover(cardSel);
    const tr = await page.$eval(cardSel, (e) => getComputedStyle(e).transform);
    assert.equal(tr, "none", "prefers-reduced-motion disables hover transform (colour only)");
  } finally { await rmv.close(); }
});

// ---------------------------------------------------------------------------
// B5: floating settings gear (item 4)
// ---------------------------------------------------------------------------
test("B5: the settings gear is fixed and stays in view while scrolling", { timeout: 120000 }, async (t) => {
  const env = await setup(t);
  if (!env) return;
  try {
    const page = await env.page(390, 700);
    await page.waitForSelector('#app .ib[data-a="set"]', { timeout: 20000 });
    const g = '#app .ib[data-a="set"]';
    const a = await page.$eval(g, (e) => {
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      return { top: r.top, w: r.width, h: r.height, pos: cs.position, z: cs.zIndex, hasGearPath: e.querySelectorAll("svg path").length > 0 };
    });
    assert.equal(a.pos, "fixed", "gear is position:fixed");
    assert.ok(Math.abs(a.w - 44) < 0.5 && Math.abs(a.h - 44) < 0.5, "gear is a 44px touch target");
    assert.ok(a.hasGearPath, "gear button renders the gear glyph");

    await page.evaluate(() => scrollTo(0, 800));
    const b = await page.$eval(g, (e) => {
      const r = e.getBoundingClientRect();
      return { top: r.top, inView: r.top >= 0 && r.bottom <= window.innerHeight };
    });
    assert.equal(Math.round(b.top), Math.round(a.top), "gear top is unchanged after scrolling 800px");
    assert.ok(b.inView, "gear remains inside the viewport while scrolling");
  } finally { await env.close(); }
});
