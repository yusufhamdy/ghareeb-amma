"use strict";
/*
 * phase-e.test.js - Phase E acceptance:
 *   E1 day word cards: badge + word + chevron circle, even vertical gaps (pixel test).
 *   E2 quiz screen: answering an option moves nothing (no entrance replay, no reflow,
 *      no press scale), scroll preserved, no layout shift.
 *   E3 settings gear: one persistent fixed element outside #app, never moved by renders.
 *
 * Loads the real public/ files in Chromium and checks real behaviour from the DOM,
 * computed styles and real pixels. ASCII only (no Arabic literals).
 * Each test skips cleanly when Chromium is unavailable.
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

  const api = {
    base,
    async page(width, height) {
      const page = await browser.newPage({ viewport: { width: width || 390, height: height || 844 } });
      await page.emulateMedia({ colorScheme: opts.colorScheme || "light", reducedMotion: opts.reducedMotion || "no-preference" });
      const content = "window.__WORDS__=" + words + ";window.__CH__=" + JSON.stringify(chObj) + ";" +
        "try{localStorage.setItem('gq-set',JSON.stringify(" + JSON.stringify(set) + "))}catch(e){}";
      await page.addInitScript({ content });
      await page.goto(base + "/index.html", { waitUntil: "load" });
      return page;
    },
    async close() { await browser.close(); await new Promise((r) => server.close(r)); },
  };
  return api;
}

function nav(page, hash) { return page.evaluate((h) => { location.hash = h; }, hash); }

// Decode a base64 PNG inside the page and measure the ink box of a cropped card.
// Returns { topGap, botGap, startGap } in pixels (card edges are 0 and W-1 / H-1).
const SCAN = async (dataUrl, band) => {
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = dataUrl; });
  const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
  const x = c.getContext("2d"); x.drawImage(img, 0, 0);
  const W = c.width, H = c.height;
  const d = x.getImageData(0, 0, W, H).data;
  // background = modal colour of the interior (skip a 3px frame for the border + corners)
  const hist = new Map();
  for (let y = 3; y < H - 3; y++) for (let xx = 3; xx < W - 3; xx++) {
    const i = (y * W + xx) * 4; const k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
    hist.set(k, (hist.get(k) || 0) + 1);
  }
  let best = 0, bk = 0; for (const [k, v] of hist) if (v > best) { best = v; bk = k; }
  const bg = { r: (bk >> 10 & 31) << 3, g: (bk >> 5 & 31) << 3, b: (bk & 31) << 3 };
  const ink = (i) => d[i + 3] > 8 && (Math.abs(d[i] - bg.r) + Math.abs(d[i + 1] - bg.g) + Math.abs(d[i + 2] - bg.b) > 96);
  const y0 = 5, y1 = H - 6;                       // skip the 1px card border (+ its AA) top and bottom
  const x0 = band, x1 = W - 1 - band;             // exclude the rounded-corner border columns
  let first = -1, last = -1;
  for (let y = y0; y <= y1; y++) {
    let any = false;
    for (let xx = x0; xx <= x1; xx++) if (ink((y * W + xx) * 4)) { any = true; break; }
    if (any) { if (first < 0) first = y; last = y; }
  }
  // inline-end side (RTL start is the right edge) over the flat central rows
  const cy0 = Math.max(y0, (H >> 1) - 6), cy1 = Math.min(y1, (H >> 1) + 6);
  let right = -1, left = W;
  for (let y = cy0; y <= cy1; y++) {
    for (let xx = W - 6; xx >= 6; xx--) if (ink((y * W + xx) * 4)) { if (xx > right) right = xx; break; }
    for (let xx = 6; xx <= W - 6; xx++) if (ink((y * W + xx) * 4)) { if (xx < left) left = xx; break; }
  }
  // word-only ink extent (columns inside the word box)
  return { W, H, bg, first, last, topGap: first, botGap: (H - 1) - last, rightGap: (W - 1) - right, leftGap: left };
};
const SCAN_SRC = "(" + SCAN.toString() + ")";

// ---------------------------------------------------------------------------
// E1: day word cards - balanced row (badge, word, chevron circle), even gaps
// ---------------------------------------------------------------------------
test("E1: day card badge/word/chevron layout and even vertical gaps (pixel test)", { timeout: 300000 }, async (t) => {
  const combos = [["glass", "light"], ["glass", "dark"], ["shade", "light"], ["shade", "dark"]];
  for (const [style, mode] of combos) {
    const env = await setup(t, { set: { style, mode } });
    if (!env) return;
    try {
      for (const w of [400, 1440]) {
        const page = await env.page(w, 900);
        await nav(page, "#/day/1");
        await page.waitForSelector("#dw .dcard", { timeout: 20000 });
        try { await page.evaluate(() => document.fonts.ready); } catch (e) {}
        await page.waitForTimeout(1100); // let the staggered rise finish

        const info = await page.evaluate(() => {
          const card = document.querySelector("#dw .dcard");
          const c = getComputedStyle(card);
          const b = card.querySelector(".bdg"), ch = card.querySelector(".chev"), wd = card.querySelector(".dword");
          const r = (el) => { const q = el.getBoundingClientRect(); return { w: q.width, h: q.height }; };
          const ws = getComputedStyle(wd);
          return {
            layout: { minH: parseFloat(c.minHeight), pt: parseFloat(c.paddingTop), pb: parseFloat(c.paddingBottom), ps: parseFloat(c.paddingInlineStart) },
            badge: r(b), chev: r(ch),
            word: { fs: parseFloat(ws.fontSize), lh: parseFloat(ws.lineHeight), ff: ws.fontFamily, align: getComputedStyle(wd).textAlign },
            dir: c.direction,
            badgeText: (b.textContent || "").trim(),
            cardW: card.getBoundingClientRect().width,
          };
        });
        const tag = style + "/" + mode + "/" + w;
        assert.ok(info.layout.minH >= 64, tag + ": card min-height >= 64 (" + info.layout.minH + ")");
        assert.equal(info.layout.pt, 14, tag + ": padding-block-start 14");
        assert.equal(info.layout.pb, 14, tag + ": padding-block-end 14");
        assert.equal(info.layout.ps, 16, tag + ": padding-inline-start 16");
        assert.equal(Math.round(info.badge.w), 36, tag + ": badge is 36px wide");
        assert.equal(Math.round(info.badge.h), 36, tag + ": badge is 36px tall");
        assert.equal(Math.round(info.chev.w), 36, tag + ": chevron circle is 36px wide");
        assert.equal(Math.round(info.chev.h), 36, tag + ": chevron circle is 36px tall");
        assert.ok(info.word.fs >= 24 && info.word.fs <= 26, tag + ": word font-size 24-26 (" + info.word.fs + ")");
        assert.ok(info.word.lh / info.word.fs >= 1.9, tag + ": word line-height >= 1.9 (" + (info.word.lh / info.word.fs) + ")");
        assert.ok(/Amiri Quran/i.test(info.word.ff), tag + ": word uses Amiri Quran (" + info.word.ff + ")");
        assert.equal(info.dir, "rtl", tag + ": card is RTL");

        const buf = await page.locator("#dw .dcard").first().screenshot();
        const band = Math.min(30, Math.floor(info.cardW / 4));
        const s = await page.evaluate(async (arg) => (new Function("return " + arg.src)())(arg.dataUrl, arg.band),
          { src: SCAN_SRC, dataUrl: "data:image/png;base64," + buf.toString("base64"), band });
        assert.ok(s.topGap >= 12, tag + ": top gap >= 12 (" + s.topGap + ")");
        assert.ok(s.botGap >= 12, tag + ": bottom gap >= 12 (" + s.botGap + ")");
        assert.ok(Math.abs(s.topGap - s.botGap) <= 3, tag + ": top/bottom gaps differ <= 3 (" + s.topGap + " vs " + s.botGap + ")");
        assert.ok(s.rightGap >= 15, tag + ": word inline-start gap to the card edge >= 16 (got " + s.rightGap + ", 1px AA tolerance)");
        await page.close();
      }
    } finally { await env.close(); }
  }

  // behaviour: badge shows the day index (Western digits) then a check once opened
  const env = await setup(t, {});
  if (!env) return;
  try {
    const page = await env.page(400, 900);
    await nav(page, "#/day/1");
    await page.waitForSelector("#dw .dcard", { timeout: 20000 });
    await page.waitForTimeout(700);
    const before = await page.$$eval("#dw .dcard .bdg", (bs) => bs.map((b) => ({ t: (b.textContent || "").trim(), svg: !!b.querySelector("svg") })));
    assert.deepEqual(before.map((b) => b.t), ["1", "2", "3"], "badges show the 1-based day index");
    assert.ok(before.every((b) => !b.svg), "badges start without a check");
    await page.locator("#dw .dcard").nth(0).click();
    await page.waitForTimeout(200);
    const after = await page.$$eval("#dw .dcard .bdg", (bs) => bs.map((b) => !!b.querySelector("svg")));
    assert.ok(after[0] === true, "the opened card's badge becomes a check");
    assert.ok(after[1] === false && after[2] === false, "unopened badges keep their number");
    assert.equal(await page.locator("#dw .dcard").count(), 3, "#dw .dcard still renders three cards");
  } finally { await env.close(); }
});

// ---------------------------------------------------------------------------
// E2: answering a quiz option must not move the screen
// ---------------------------------------------------------------------------
test("E2: answering a quiz option never moves the screen or replays the entrance", { timeout: 300000 }, async (t) => {
  const combos = [["glass", "light"], ["glass", "dark"], ["shade", "light"], ["shade", "dark"]];
  for (const [style, mode] of combos) {
    const env = await setup(t, { set: { style, mode } });
    if (!env) return;
    try {
      const page = await env.page(390, 844);
      await nav(page, "#/quiz");
      await page.waitForSelector("#app .opts .opt", { timeout: 20000 });
      await page.waitForTimeout(700);
      const first = await page.$eval("#app .opts .opt", (e) => e.dataset.o);

      await page.evaluate(() => {
        window.__ls = 0;
        try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ls += e.value; }).observe({ type: "layout-shift", buffered: false }); } catch (e) {}
        const rects = () => {
          const a = document.querySelector("#app");
          return [...a.children].map((el) => {
            const r = el.getBoundingClientRect();
            return { tag: el.tagName + (el.className ? "." + String(el.className).split(" ")[0] : ""), x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
          });
        };
        const anims = () => {
          const a = document.querySelector("#app");
          return [...a.getAnimations({ subtree: true })].map((an) => an.animationName || "").filter(Boolean);
        };
        const snap = () => ({ scroll: window.scrollY, kids: rects(), an: anims() });
        window.__before = snap();
        document.addEventListener("click", function once(ev) {
          if (!ev.target.closest || !ev.target.closest(".opt")) return;
          document.removeEventListener("click", once, true);
          const out = [];
          [0, 16, 50, 100, 200, 300, 400].forEach((ms) => setTimeout(() => out.push(snap()), ms));
          setTimeout(() => { window.__samp = out; }, 470);
        }, true);
      });
      await page.click('#app .opt[data-o="' + first + '"]');
      await page.waitForFunction(() => Array.isArray(window.__samp), null, { timeout: 6000 });
      const res = await page.evaluate(() => ({ before: window.__before, samples: window.__samp, ls: window.__ls }));
      const tag = style + "/" + mode;
      assert.ok(res.samples.length === 7, tag + ": collected seven samples");
      assert.equal(res.before.scroll, 0, tag + ": the quiz starts at the top");
      assert.ok(res.before.kids.some((k) => /FOOTER/.test(k.tag)), tag + ": the footer is one of the sampled #app children");
      for (const [i, s] of res.samples.entries()) {
        assert.equal(s.scroll, res.before.scroll, tag + ": sample " + i + " keeps scrollY");
        assert.equal(s.kids.length, res.before.kids.length, tag + ": sample " + i + " keeps the same #app children (no row is inserted)");
        for (let k = 0; k < Math.min(res.before.kids.length, s.kids.length); k++) {
          const a = res.before.kids[k], b = s.kids[k];
          assert.ok(Math.abs(a.x - b.x) <= 0.5 && Math.abs(a.y - b.y) <= 0.5 && Math.abs(a.w - b.w) <= 0.5 && Math.abs(a.h - b.h) <= 0.5,
            tag + ": sample " + i + " box of #app child " + a.tag + " is unchanged (was " + JSON.stringify(a) + " now " + JSON.stringify(b) + ")");
        }
        assert.equal(s.an.filter((x) => /pgin|pgs|rise/.test(x)).length, 0, tag + ": sample " + i + " runs no entrance animation (" + s.an.join(",") + ")");
      }
      assert.ok(res.ls <= 0.001, tag + ": layout-shift total is 0 (got " + res.ls + ")");
      assert.ok(await page.$("#app .opt.ok"), tag + ": the correct option is marked ok");
      assert.ok(await page.$("#app .opt.ok svg"), tag + ": the ok glyph is present");
      await page.close();
    } finally { await env.close(); }
  }
});

// ---------------------------------------------------------------------------
// E3: the settings gear is one persistent fixed element outside #app
// ---------------------------------------------------------------------------
test("E3: settings gear is persistent, outside #app, and never moves", { timeout: 300000 }, async (t) => {
  for (const [w, h] of [[400, 900], [1440, 900]]) {
    const env = await setup(t, {});
    if (!env) return;
    try {
      const page = await env.page(w, h);
      await page.waitForSelector("#gear", { timeout: 20000 });
      const tag = w + "px";

      const start = await page.evaluate(() => {
        window.__g0 = document.querySelector("#gear");
        const g = window.__g0;
        const r = g.getBoundingClientRect();
        const cs = getComputedStyle(g);
        const anc = []; let n = g.parentElement;
        while (n) { const s = getComputedStyle(n); anc.push({ tag: n.tagName, tf: s.transform, an: s.animationName }); n = n.parentElement; }
        return {
          parentIsBody: g.parentElement === document.body,
          count: document.querySelectorAll('[data-a="set"]').length,
          inHeader: !!document.querySelector("#app header [data-a='set']"),
          rect: { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) },
          pos: cs.position, top: cs.top, ie: cs.insetInlineEnd, z: cs.zIndex,
          ancestors: anc,
        };
      });
      assert.ok(start.parentIsBody, tag + ": the gear is a direct child of body");
      assert.equal(start.count, 1, tag + ": exactly one settings control in the document");
      assert.ok(!start.inHeader, tag + ": the gear is gone from the per-view header");
      assert.equal(start.pos, "fixed", tag + ": the gear is position fixed");
      assert.ok(start.ancestors.every((a) => a.tf === "none"), tag + ": no ancestor is transformed (" + JSON.stringify(start.ancestors) + ")");
      assert.ok(start.ancestors.every((a) => !a.an || a.an === "none"), tag + ": no ancestor is animated");
      const wantIE = w >= 1025 ? Math.max(16, (w - 1080) / 2 - 56) : 16;
      assert.ok(Math.abs(parseFloat(start.ie) - wantIE) <= 1, tag + ": inline-end inset matches the release rule (" + start.ie + " vs " + wantIE + ")");
      assert.ok(Math.abs(parseFloat(start.top) - 14) <= 1, tag + ": top inset 14 (" + start.top + ")");

      const samples = [];
      const routes = ["#/surahs", "#/surah/78", "#/word/78-0", "#/challenge", "#/day/1", "#/quiz", "#/about", "#/rights", "#/privacy", "#/"];
      for (const r of routes) {
        await nav(page, r);
        for (const ms of [0, 16, 50, 100, 200, 400]) {
          const s = await page.evaluate(() => { const q = document.querySelector("#gear").getBoundingClientRect(); return { x: +q.x.toFixed(2), y: +q.y.toFixed(2), w: +q.width.toFixed(2), h: +q.height.toFixed(2) }; });
          samples.push({ r, ms, s });
          await page.waitForTimeout(ms === 0 ? 0 : 16);
        }
      }
      for (const { r, ms, s } of samples) {
        assert.ok(Math.abs(s.x - start.rect.x) <= 0.5 && Math.abs(s.y - start.rect.y) <= 0.5 && Math.abs(s.w - start.rect.w) <= 0.5 && Math.abs(s.h - start.rect.h) <= 0.5,
          tag + ": gear unchanged after " + r + " at " + ms + "ms (was " + JSON.stringify(start.rect) + " now " + JSON.stringify(s) + ")");
      }
      const identity = await page.evaluate(() => window.__g0 === document.querySelector("#gear"));
      assert.ok(identity, tag + ": the gear element is never recreated");

      await nav(page, "#/quiz");
      await page.waitForSelector("#app .opts .opt", { timeout: 20000 });
      const o = await page.$eval("#app .opts .opt", (e) => e.dataset.o);
      await page.click('#app .opt[data-o="' + o + '"]');
      await page.waitForTimeout(60);
      const afterAns = await page.evaluate(() => { const q = document.querySelector("#gear").getBoundingClientRect(); return { x: +q.x.toFixed(2), y: +q.y.toFixed(2), w: +q.width.toFixed(2), h: +q.height.toFixed(2) }; });
      assert.ok(Math.abs(afterAns.x - start.rect.x) <= 0.5 && Math.abs(afterAns.y - start.rect.y) <= 0.5, tag + ": gear unchanged after answering a quiz option");

      await page.click("#gear");
      await page.waitForSelector("#sh.open", { timeout: 6000 });
      assert.ok(await page.$("#sh.open"), tag + ": clicking the gear opens the settings sheet");
      await page.close();
    } finally { await env.close(); }
  }
});
