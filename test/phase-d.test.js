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

// ---------------------------------------------------------------------------
// D3: challenge day cards - stacked, collapsible, progress by opened cards
// ---------------------------------------------------------------------------
const cnt = (page) => page.locator("#dw .dcard").count();
const kOf = (page) => page.getAttribute(".dcount", "data-k");
const isOpen = (page, i) => page.locator("#dw .dcard").nth(i).evaluate((el) => el.classList.contains("open"));

test("D3: day cards - one-word open, three collapsed, tap opens, counter, completion, persistence", { timeout: 120000 }, async (t) => {
  const env = await setup(t, {});
  if (!env) return;
  try {
    const page = await env.page(390, 844);

    // 3-word day (day 1): three collapsed cards, no overlay, no next button.
    await nav(page, "#/day/1");
    await page.waitForSelector("#dw .dcard", { timeout: 20000 });
    assert.equal(await cnt(page), 3, "3-word day shows 3 cards");
    for (let i = 0; i < 3; i++) {
      assert.equal(await isOpen(page, i), false, "card " + i + " is collapsed by default");
      assert.equal(await page.locator("#dw .dcard").nth(i).getAttribute("aria-expanded"), "false", "card " + i + " aria-expanded false");
    }
    await page.waitForTimeout(700);
    assert.equal(await page.locator("#rou").count(), 0, "no roulette overlay on the day screen");
    assert.equal(await page.locator('[data-a="dnext"]').count(), 0, "no next button on the day screen");
    assert.equal(await kOf(page), "0", "counter starts at 0");

    // Tap opens the verse + meaning; two can be open together.
    await page.locator("#dw .dcard").nth(0).click();
    assert.equal(await isOpen(page, 0), true, "first tap opens the card");
    assert.equal(await page.locator("#dw .dcard").nth(0).getAttribute("aria-expanded"), "true", "aria-expanded true when open");
    assert.equal(await page.locator("#dw .dcard").nth(0).locator(".dbody").isVisible(), true, "the meaning body is visible when open");
    assert.ok((await page.locator("#dw .dcard").nth(0).locator(".dbody").innerText()).trim().length > 0, "the open card shows content");
    assert.equal(await kOf(page), "1", "counter counts the opened card");

    await page.locator("#dw .dcard").nth(1).click();
    assert.equal(await isOpen(page, 0), true, "card 0 still open");
    assert.equal(await isOpen(page, 1), true, "card 1 open too (two open together)");
    assert.equal(await kOf(page), "2", "counter counts distinct opened cards");

    // Closing keeps the count (a word counts once opened).
    await page.locator("#dw .dcard").nth(0).click();
    assert.equal(await isOpen(page, 0), false, "tapping again closes the card");
    assert.equal(await kOf(page), "2", "counter keeps the once-opened count after closing");

    // Completion only after all are opened.
    assert.equal(await page.locator('[data-a="done"]').isDisabled(), true, "day cannot be completed before all cards are opened");
    await page.locator("#dw .dcard").nth(2).click();
    assert.equal(await kOf(page), "3", "all three counted once opened");
    assert.equal(await page.locator('[data-a="done"]').isDisabled(), false, "day can be completed once all cards are opened");
    await page.locator('[data-a="done"]').click();
    const doneList = await page.evaluate(() => (JSON.parse(localStorage.getItem("gq-prog")) || {}).done || []);
    assert.ok(doneList.includes(1), "day 1 is recorded as done");

    // State survives a reload: progress persists, cards are collapsed again.
    await page.reload({ waitUntil: "load" });
    await nav(page, "#/day/1");
    await page.waitForSelector("#dw .dcard", { timeout: 20000 });
    assert.equal(await kOf(page), "3", "opened count survives reload");
    assert.equal(await isOpen(page, 0), false, "cards are collapsed again after reload");

    // One-word day (day 2): one card already open, no overlay, no next.
    await nav(page, "#/day/2");
    await page.waitForSelector("#dw .dcard", { timeout: 20000 });
    assert.equal(await cnt(page), 1, "one-word day shows a single card");
    assert.equal(await isOpen(page, 0), true, "the single card is already open");
    assert.equal(await kOf(page), "1", "a one-word day counts as opened on view");
    await page.waitForTimeout(400);
    assert.equal(await page.locator("#rou").count(), 0, "no roulette overlay on a one-word day");
    assert.equal(await page.locator('[data-a="dnext"]').count(), 0, "no next button on a one-word day");
  } finally { await env.close(); }
});

// ---------------------------------------------------------------------------
// D4: no washed-out flash on navigation (page entrance must not fade)
// ---------------------------------------------------------------------------
async function sampleNav(page, hash, sel) {
  await page.evaluate(({ hash, sel }) => {
    const eff = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { o *= parseFloat(getComputedStyle(n).opacity) || 0; } return o; };
    window.__s = []; const t0 = performance.now();
    const raf = () => {
      const el = document.querySelector(sel); const c = el ? getComputedStyle(el) : null;
      const ac = getComputedStyle(document.querySelector("#app")); const bc = getComputedStyle(document.body);
      window.__s.push({ t: performance.now() - t0, eo: el ? eff(el) : null, ao: +ac.opacity, bo: +bc.opacity, cb: c ? c.backgroundColor : null, cbd: c ? c.backdropFilter : null });
      if (performance.now() - t0 < 520) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf); location.hash = hash;
  }, { hash, sel });
  await page.waitForTimeout(570);
  return page.evaluate(() => window.__s);
}
function near(samples, tt) { return samples.reduce((a, b) => (Math.abs(b.t - tt) < Math.abs(a.t - tt) ? b : a), samples[0]); }

test("D4: navigating between routes never fades the new page (all themes)", { timeout: 180000 }, async (t) => {
  const combos = [["glass", "light", 390], ["glass", "dark", 390], ["shade", "light", 1440], ["shade", "dark", 1440]];
  for (const [style, mode, w] of combos) {
    const env = await setup(t, { set: { style, mode } });
    if (!env) return;
    try {
      const page = await env.page(w, 900);
      const routes = [
        { hash: "#/surah/78", sel: "#app .list.rs a.row" },
        { hash: "#/word/78-0", sel: "#app .acts.v3" },
        { hash: "#/challenge", sel: "#app .cg .dy" },
      ];
      // First load on home: the first card must already be at final look.
      const load = await cs(page, "#app .sb", ["opacity"]);
      assert.ok(load && parseFloat(load.opacity) >= 0.98, style + "/" + mode + ": first load is not faded");

      for (const r of routes) {
        const samples = await sampleNav(page, r.hash, r.sel);
        const last = samples[samples.length - 1];
        const seen = samples.filter((s) => s.eo != null);
        assert.ok(seen.length > 0, style + "/" + mode + " " + r.hash + ": the new view was measured");
        for (const s of samples) {
          assert.ok(s.ao >= 0.98, style + "/" + mode + " " + r.hash + " t=" + Math.round(s.t) + ": #app opacity " + s.ao);
          assert.ok(s.bo >= 0.98, style + "/" + mode + " " + r.hash + " t=" + Math.round(s.t) + ": body opacity " + s.bo);
        }
        for (const s of seen) {
          assert.ok(s.eo >= 0.98, style + "/" + mode + " " + r.hash + " t=" + Math.round(s.t) + ": effective card opacity " + s.eo);
          assert.equal(s.cb, last.cb, style + "/" + mode + " " + r.hash + " t=" + Math.round(s.t) + ": card background is final");
          assert.equal(s.cbd, last.cbd, style + "/" + mode + " " + r.hash + " t=" + Math.round(s.t) + ": card backdrop-filter is final");
        }
        // spot-check the requested offsets
        for (const tt of [0, 50, 100, 200, 400]) {
          const s = near(seen, tt);
          assert.ok(s.eo >= 0.98, style + "/" + mode + " " + r.hash + " t~" + tt + ": effective card opacity " + s.eo);
        }
      }
    } finally { await env.close(); }
  }
});
