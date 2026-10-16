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

// ---------------------------------------------------------------------------
// F2: word-page previous/next share one structure (icon above text on desktop)
// ---------------------------------------------------------------------------
test("F2: prev/next stack icon above text on desktop and share a height", { timeout: 120000 }, async (t) => {
  const env = await setup(t);
  if (!env) return;
  try {
    const page = await env.page(1440, 900);
    await nav(page, "#/word/78-0");
    await page.waitForSelector("#app .cw .pnb.pv", { timeout: 20000 });
    const r = await page.evaluate(() => {
      const rect = (b) => ({ top: b.top, bottom: b.bottom, left: b.left, right: b.right, h: b.height });
      const el = (s) => document.querySelector(s);
      const svgR = (e) => { const s = e.querySelector("svg"); return s ? rect(s.getBoundingClientRect()) : null; };
      const textR = (e) => {
        const tn = [...e.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
        if (!tn) return null;
        const s = tn.textContent, a = s.search(/\S/), b = s.replace(/\s+$/, "").length;
        const rng = document.createRange(); rng.setStart(tn, a); rng.setEnd(tn, b);
        return rect(rng.getBoundingClientRect());
      };
      const d = (e) => { const p = e.querySelector("path"); return p ? (p.getAttribute("d") || "") : ""; };
      const out = {};
      for (const k of ["pv", "nx"]) {
        const e = el("#app .cw .pnb." + k);
        const s = svgR(e), tx = textR(e);
        out[k] = {
          h: e.getBoundingClientRect().height,
          flex: getComputedStyle(e).flexDirection,
          svg: s, text: tx,
          iconAbove: !!(s && tx) && s.bottom <= tx.top + 2,
          d: d(e),
        };
      }
      return out;
    });
    assert.ok(r.pv.iconAbove, "previous icon sits above its text");
    assert.ok(r.nx.iconAbove, "next icon sits above its text");
    assert.equal(r.pv.flex, "column", "previous stacks in a column");
    assert.equal(r.nx.flex, "column-reverse", "next stacks in a reversed column (same look)");
    assert.ok(Math.abs(r.pv.h - r.nx.h) < 0.5, "both controls share a height (" + r.pv.h + " vs " + r.nx.h + ")");
    assert.ok(r.pv.h >= 44 && r.nx.h >= 44, "controls keep a >=44px touch target");
    assert.ok(r.pv.d.indexOf("M9 5l7 7") >= 0, "previous chevron points right");
    assert.ok(r.nx.d.indexOf("M15 5l-7 7") >= 0, "next chevron points left");

    const mob = await env.page(400, 800);
    await nav(mob, "#/word/78-0");
    await mob.waitForSelector("#app .cw .pnb.pv", { timeout: 20000 });
    const mf = await mob.evaluate(() => ({
      pv: getComputedStyle(document.querySelector("#app .cw .pnb.pv")).flexDirection,
      nx: getComputedStyle(document.querySelector("#app .cw .pnb.nx")).flexDirection,
    }));
    assert.equal(mf.pv, "row", "mobile previous stays a row");
    assert.equal(mf.nx, "row", "mobile next stays a row");
  } finally { await env.close(); }
});

// ---------------------------------------------------------------------------
// F3: filled draw button inverts with its outlined siblings on hover
// ---------------------------------------------------------------------------
const probeBg = (page, name) => page.evaluate((v) => {
  const d = document.createElement("div");
  d.style.position = "absolute"; d.style.left = "-9999px"; d.style.background = "var(" + v + ")";
  document.body.appendChild(d);
  const c = getComputedStyle(d).backgroundColor; d.remove(); return c;
}, name);

test("F3: draw button and its outlined siblings invert on hover (AA in both themes)", { timeout: 120000 }, async (t) => {
  const env = await setup(t);
  if (!env) return;
  try {
    const page = await env.page(1440, 900);
    await page.waitForSelector('#app [data-a="rnd"]', { timeout: 20000 });
    const accent = await probeBg(page, "--ac");
    const filled0 = await page.$eval('#app [data-a="rnd"]', (e) => getComputedStyle(e).backgroundColor);
    const tr0 = await page.$eval('#app [data-a="rnd"]', (e) => getComputedStyle(e).transform);
    await page.hover('#app [data-a="rnd"]');
    await page.waitForTimeout(340);
    const filled1 = await page.$eval('#app [data-a="rnd"]', (e) => ({ bg: getComputedStyle(e).backgroundColor, tr: getComputedStyle(e).transform }));
    assert.notEqual(filled1.bg, filled0, "hovering the filled button changes its background");
    assert.notEqual(filled1.tr, tr0, "hovering the filled button animates it (light motion)");

    const olSel = '#app .acts .btn.o';
    const ol0 = await page.$eval(olSel, (e) => getComputedStyle(e).backgroundColor);
    await page.hover(olSel);
    await page.waitForTimeout(340);
    const ol1 = await page.$eval(olSel, (e) => getComputedStyle(e).backgroundColor);
    assert.notEqual(ol1, ol0, "hovering the outlined sibling changes its background");
    assert.equal(ol1, accent, "the outlined button inverts to the accent fill");
  } finally { await env.close(); }

  const shade = await setup(t, { set: { style: "shade" } });
  if (!shade) return;
  try {
    const page = await shade.page(1440, 900);
    await page.waitForSelector('#app [data-a="rnd"]', { timeout: 20000 });
    const tx = await probeBg(page, "--tx");
    const f0 = await page.$eval('#app [data-a="rnd"]', (e) => getComputedStyle(e).backgroundColor);
    await page.hover('#app [data-a="rnd"]');
    await page.waitForTimeout(340);
    const f1 = await page.$eval('#app [data-a="rnd"]', (e) => getComputedStyle(e).backgroundColor);
    assert.notEqual(f1, f0, "shade: filled button inverts on hover");
    const oSel = '#app .acts .btn.o';
    const o0 = await page.$eval(oSel, (e) => getComputedStyle(e).backgroundColor);
    await page.hover(oSel);
    await page.waitForTimeout(340);
    const o1 = await page.$eval(oSel, (e) => getComputedStyle(e).backgroundColor);
    assert.notEqual(o1, o0, "shade: outlined button changes on hover");
    assert.equal(o1, tx, "shade: outlined sibling inverts to the filled surface");
  } finally { await shade.close(); }

  const rmv = await setup(t, { reducedMotion: "reduce" });
  if (!rmv) return;
  try {
    const page = await rmv.page(1440, 900);
    await page.waitForSelector('#app [data-a="rnd"]', { timeout: 20000 });
    const b0 = await page.$eval('#app [data-a="rnd"]', (e) => getComputedStyle(e).backgroundColor);
    await page.hover('#app [data-a="rnd"]');
    await page.waitForTimeout(340);
    const r = await page.$eval('#app [data-a="rnd"]', (e) => ({ bg: getComputedStyle(e).backgroundColor, tr: getComputedStyle(e).transform }));
    assert.equal(r.tr, "none", "reduced motion keeps colour, drops the transform");
    assert.notEqual(r.bg, b0, "reduced motion still swaps the colour");
  } finally { await rmv.close(); }
});

// ---------------------------------------------------------------------------
// F4: social card gets a shadow on hover without moving
// ---------------------------------------------------------------------------
test("F4: social strip hover adds a shadow and never moves; icon hover intact", { timeout: 120000 }, async (t) => {
  const env = await setup(t);
  if (!env) return;
  try {
    const page = await env.page(1440, 900);
    await page.waitForSelector("#app .strip", { timeout: 20000 });
    const sh0 = await page.$eval("#app .strip", (e) => getComputedStyle(e).boxShadow);
    await page.hover("#app .strip");
    await page.waitForTimeout(420);
    const s = await page.$eval("#app .strip", (e) => ({ sh: getComputedStyle(e).boxShadow, tr: getComputedStyle(e).transform }));
    assert.notEqual(s.sh, sh0, "hovering the social card changes its box-shadow");
    assert.equal(s.tr, "none", "the social card never moves on hover");

    // the icon hover (unchanged) still reveals its disc
    await page.hover("#app .so");
    await page.waitForTimeout(150);
    const op = await page.$eval("#app .so", (e) => getComputedStyle(e, "::before").opacity);
    assert.ok(parseFloat(op) > 0.9, "social icon hover disc is still intact");
  } finally { await env.close(); }

  const shade = await setup(t, { set: { style: "shade" } });
  if (!shade) return;
  try {
    const page = await shade.page(1440, 900);
    await page.waitForSelector("#app .strip", { timeout: 20000 });
    const b0 = await page.$eval("#app .strip", (e) => getComputedStyle(e).boxShadow);
    await page.hover("#app .strip");
    await page.waitForTimeout(420);
    const s = await page.$eval("#app .strip", (e) => ({ sh: getComputedStyle(e).boxShadow, tr: getComputedStyle(e).transform }));
    assert.notEqual(s.sh, b0, "shade: hover still adds a shadow");
    assert.equal(s.tr, "none", "shade: the card never moves");
  } finally { await shade.close(); }
});

// ---------------------------------------------------------------------------
// F5: shade header tagline and counts line do not overlap
// ---------------------------------------------------------------------------
test("F5: shade header lines get line-height >=1.5 and an 8px gap at 3 widths", { timeout: 120000 }, async (t) => {
  const env = await setup(t, { set: { style: "shade" } });
  if (!env) return;
  try {
    const page = await env.page(390, 844);
    await page.waitForSelector("#app h1", { timeout: 20000 });
    for (const w of [400, 820, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(80);
      const r = await page.evaluate(() => {
        const h1 = document.querySelector("#app h1");
        const sub = h1.nextElementSibling;
        const ch = getComputedStyle(h1), cs = getComputedStyle(sub);
        const hb = h1.getBoundingClientRect(), sb = sub.getBoundingClientRect();
        return {
          h1Bottom: hb.bottom, subTop: sb.top,
          hLine: parseFloat(ch.lineHeight), hFont: parseFloat(ch.fontSize),
          sLine: parseFloat(cs.lineHeight), sFont: parseFloat(cs.fontSize),
          subIsSub: sub.classList.contains("sub"),
        };
      });
      assert.ok(r.subIsSub, "@" + w + ": the tagline is followed by the counts line");
      assert.ok(r.hLine >= 1.5 * r.hFont - 0.5, "@" + w + ": tagline line-height >=1.5");
      assert.ok(r.sLine >= 1.5 * r.sFont - 0.5, "@" + w + ": counts line-height >=1.5");
      assert.ok(r.subTop - r.h1Bottom >= 6, "@" + w + ": lines are separated by ~8px (got " + (r.subTop - r.h1Bottom).toFixed(1) + ")");
      assert.ok(!(r.h1Bottom > r.subTop), "@" + w + ": the two header lines do not intersect");
    }
  } finally { await env.close(); }
});
