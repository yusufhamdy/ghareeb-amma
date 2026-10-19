"use strict";
/*
 * home-search.test.js - the home search state must not leak across routes.
 *
 * The home page shows an action row (the "random word" button and the
 * "browse by surah" link) and a tagline. While the search box has text a
 * `searching` class is set on <body>, which hides both. This test drives the
 * real app in Chromium and proves that every way back home restores them:
 *
 *   - clearing the box, pressing Escape;
 *   - the bottom home tab, the site logo link, the browser Back button;
 *   - after searching with results, with no results, after opening a word,
 *     and over several search -> home rounds in a row;
 *   - entering home via "#/" and via a full reload;
 *   - the same element on the word page (its action row shares the cause),
 *     the header and the bottom nav must not get stuck either;
 *   - in the glass and shade themes, day and night, on desktop and on a
 *     mobile (touch) viewport.
 *
 * ASCII only (no Arabic literals) so this file adds no Arabic runs to the
 * arabic-guard baseline: the search text comes from the loaded data and from
 * code points. Skips cleanly when Chromium is unavailable.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const WORDS_JSON = fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8");
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const GLASS = { mode: "light", pal: "def", gl: 3, style: "glass", gv: 2, snd: false, cm: false };
const SHADE = Object.assign({}, GLASS, { mode: "dark", style: "shade" });

const DESKTOP = { width: 1280, height: 900 };
const PHONE = { width: 390, height: 844 };

// The visibility contract: an element counts as shown only when it is really
// painted (not just present in the DOM) - this is what the bug broke.
const SHOWN_FN = function (sel) {
  const e = document.querySelector(sel);
  if (!e) return false;
  const c = getComputedStyle(e);
  const r = e.getBoundingClientRect();
  return c.visibility === "visible" && +c.opacity > 0.5 && r.height > 1;
};

const PROBE = "(() => {" +
  "const q=(s)=>{const e=document.querySelector(s);if(!e)return null;const c=getComputedStyle(e),r=e.getBoundingClientRect();return {vis:c.visibility,op:+c.opacity,h:Math.round(r.height)};};" +
  "return {hash:location.hash,searching:document.body.classList.contains('searching'),box:(document.getElementById('q')||{}).value||''," +
  "acts:q('#app .acts'),strip:q('#app .strip'),h1:q('#app h1'),logo:q('#app header .logo'),nav:q('#nv')};" +
  "})()";

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

async function launchBrowser(t) {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return null; }
  try { return await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return null; }
}

async function serve(root) {
  const server = staticServer(root);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: "http://127.0.0.1:" + server.address().port, close: () => new Promise((r) => server.close(r)) };
}

async function boot(browser, base, opts) {
  const context = opts.mobile
    ? await browser.newContext({ viewport: opts.viewport, hasTouch: true, isMobile: true, userAgent: IPHONE_UA })
    : await browser.newContext({ viewport: opts.viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.emulateMedia({ colorScheme: opts.colorScheme || "light" });
  await page.addInitScript({
    content: "window.__WORDS__=" + WORDS_JSON + ";window.__CH__=[];" +
      "try{if(!localStorage.getItem('gq-set'))localStorage.setItem('gq-set',JSON.stringify(" + JSON.stringify(opts.set) + "))}catch(e){}",
  });
  await page.goto(base + "/index.html", { waitUntil: "load" });
  await page.waitForSelector("#app .acts", { timeout: 20000 });
  return { context, page, errors };
}

const probe = (page) => page.evaluate(PROBE);
const shown = (v) => !!v && v.vis === "visible" && v.op > 0.5 && v.h > 1;

async function waitShown(page, sel, label) {
  try {
    await page.waitForFunction(SHOWN_FN, sel, { timeout: 10000 });
  } catch (e) {
    throw new Error("expected " + sel + " to be visible (" + label + ")");
  }
}
async function waitHidden(page, sel, label) {
  try {
    await page.waitForFunction(
      (s) => { const e = document.querySelector(s); if (!e) return false; const c = getComputedStyle(e); return c.visibility === "hidden" || e.getBoundingClientRect().height <= 1; },
      sel, { timeout: 10000 });
  } catch (e) {
    throw new Error("expected " + sel + " to be hidden while searching (" + label + ")");
  }
}

const onHome = (page) => page.waitForFunction(() => location.hash === "" || location.hash === "#/", null, { timeout: 10000 });

// The home page must be back to its resting state: action row, tagline, title,
// header logo and bottom nav all painted, search state cleared, box empty.
async function assertHome(page, label) {
  await onHome(page);
  await waitShown(page, "#app .acts", label);
  await waitShown(page, "#app .strip", label);
  await waitShown(page, "#app h1", label);
  await waitShown(page, "#app header .logo", label);
  await waitShown(page, "#nv", label);
  const s = await probe(page);
  assert.equal(s.searching, false, label + ": the searching state is cleared after returning home");
  assert.equal(s.box, "", label + ": the search box is empty on home");
  assert.ok(shown(s.acts), label + ": the two action buttons are visible again");
  assert.ok(shown(s.strip), label + ": the tagline is visible again");
}

// Type a real word (from the loaded data) so the search returns results.
async function typeWord(page) {
  await page.evaluate(() => {
    const q = document.getElementById("q");
    q.value = W[0].word;
    q.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForSelector("#res .row", { timeout: 10000 });
  await page.waitForFunction(() => document.body.classList.contains("searching"), null, { timeout: 10000 });
}
// A query that cannot match anything (pure ASCII) -> the "no results" card.
async function typeNone(page) {
  await page.evaluate(() => {
    const q = document.getElementById("q");
    q.value = "qqqqzzzz";
    q.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForSelector("#res .card", { timeout: 10000 });
}

async function openWordFromResults(page, tap) {
  await page.waitForSelector("#res .row", { timeout: 10000 });
  if (tap) await page.tap("#res .row"); else await page.click("#res .row");
  await page.waitForFunction(() => location.hash.indexOf("#/word/") === 0, null, { timeout: 10000 });
  await page.waitForSelector('#app [data-a="card"]', { state: "attached", timeout: 10000 });
}

// ---------------------------------------------------------------------------
// Desktop, glass/light: every documented return path.
// ---------------------------------------------------------------------------
test("home search: the action row and tagline come back on every return path (desktop, glass)", { timeout: 180000 }, async (t) => {
  const browser = await launchBrowser(t);
  if (!browser) return;
  const srv = await serve(PUBLIC);
  try {
    const { context, page, errors } = await boot(browser, srv.base, { viewport: DESKTOP, set: GLASS, colorScheme: "light" });

    // 0) resting home is intact
    await assertHome(page, "initial home");

    // the search genuinely hides the row while it is active (unchanged intent)
    await typeWord(page);
    await waitHidden(page, "#app .acts", "search with results");
    await waitHidden(page, "#app .strip", "search with results");
    const busy = await probe(page);
    assert.equal(busy.searching, true, "searching is on while the box has a query");

    // 1) clearing the search box
    await page.evaluate(() => {
      const q = document.getElementById("q");
      q.value = "";
      q.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await assertHome(page, "clearing the search box");

    // 2) pressing Escape
    await typeWord(page);
    await page.focus("#q");
    await page.keyboard.press("Escape");
    await assertHome(page, "pressing Escape");

    // 3) a result -> word page -> bottom home tab
    await typeWord(page);
    await openWordFromResults(page, false);
    await page.click('#nv a[href="#/"]');
    await assertHome(page, "the bottom home tab");

    // 4) the word page opened from a search must not be left with a hidden
    //    action row (same cause), and the site logo link returns home
    await typeWord(page);
    await openWordFromResults(page, false);
    await waitShown(page, "#app .acts", "word page opened from search");
    await waitShown(page, "#nv", "word page opened from search");
    await page.click("#app header .logo");
    await assertHome(page, "the site logo link");

    // 5) searching -> bottom nav to the surah list -> browser Back
    await typeWord(page);
    await page.click('#nv a[href="#/surahs"]');
    await page.waitForFunction(() => location.hash === "#/surahs", null, { timeout: 10000 });
    await page.goBack();
    await assertHome(page, "the browser Back button");

    // 6) a result -> word page -> browser Back
    await typeWord(page);
    await openWordFromResults(page, false);
    await page.goBack();
    await assertHome(page, "Back from a word page");

    // 7) a search with no results, then away and back
    await typeNone(page);
    await waitHidden(page, "#app .acts", "search with no results");
    await page.click('#nv a[href="#/surahs"]');
    await page.waitForFunction(() => location.hash === "#/surahs", null, { timeout: 10000 });
    await page.click('#nv a[href="#/"]');
    await assertHome(page, "after a search with no results");

    // 8) three search -> home rounds in a row
    for (let i = 1; i <= 3; i++) {
      await typeWord(page);
      await openWordFromResults(page, false);
      await page.click('#nv a[href="#/"]');
      await assertHome(page, "round " + i);
    }

    // 9) entering home directly and after a full reload
    await page.goto(srv.base + "/index.html#/", { waitUntil: "load" });
    await page.waitForSelector("#app .acts", { timeout: 20000 });
    await assertHome(page, "home entered via #/");
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#app .acts", { timeout: 20000 });
    await assertHome(page, "home after a refresh");

    assert.deepEqual(errors, [], "no page errors during the flow");
    await context.close();
  } finally { await browser.close(); await srv.close(); }
});

// ---------------------------------------------------------------------------
// Themes (glass/shade, day/night) and mobile touch.
// ---------------------------------------------------------------------------
test("home search: restored in both themes and on mobile", { timeout: 180000 }, async (t) => {
  const browser = await launchBrowser(t);
  if (!browser) return;
  const srv = await serve(PUBLIC);
  try {
    const combos = [
      { label: "glass day", set: GLASS, colorScheme: "light", mobile: false, viewport: DESKTOP },
      { label: "glass night", set: Object.assign({}, GLASS, { mode: "dark" }), colorScheme: "dark", mobile: false, viewport: DESKTOP },
      { label: "shade night", set: SHADE, colorScheme: "dark", mobile: false, viewport: DESKTOP },
    ];
    for (const c of combos) {
      const { context, page, errors } = await boot(browser, srv.base, c);
      if (c.set.style === "shade") {
        assert.equal(await page.evaluate(() => document.body.classList.contains("shade")), true, c.label + ": the shade theme is applied");
      }
      await assertHome(page, c.label + " initial");
      await typeWord(page);
      await waitHidden(page, "#app .acts", c.label);
      await openWordFromResults(page, false);
      await page.click('#nv a[href="#/"]');
      await assertHome(page, c.label + " after search");
      await typeWord(page);
      await openWordFromResults(page, false);
      await waitShown(page, "#app .acts", c.label + " word page");
      await page.click('#nv a[href="#/"]');
      await assertHome(page, c.label + " word page -> home");
      assert.deepEqual(errors, [], c.label + ": no page errors");
      await context.close();
    }

    // mobile (touch): the same two routes with taps
    const { context, page, errors } = await boot(browser, srv.base, { mobile: true, viewport: PHONE, set: GLASS, colorScheme: "light" });
    assert.equal(await page.evaluate(() => matchMedia("(hover: none) and (pointer: coarse)").matches), true, "the mobile harness is a touch device");
    await assertHome(page, "mobile initial");
    await typeWord(page);
    await waitHidden(page, "#app .acts", "mobile search");
    await openWordFromResults(page, true);
    await page.tap('#nv a[href="#/"]');
    await assertHome(page, "mobile bottom home tab");
    await typeWord(page);
    await openWordFromResults(page, true);
    await waitShown(page, "#app .acts", "mobile word page");
    await page.tap('#nv a[href="#/"]');
    await assertHome(page, "mobile word page -> home");

    await typeWord(page);
    await page.tap('#nv a[href="#/surahs"]');
    await page.waitForFunction(() => location.hash === "#/surahs", null, { timeout: 10000 });
    await page.goBack();
    await assertHome(page, "mobile Back button");

    assert.deepEqual(errors, [], "mobile: no page errors");
    await context.close();
  } finally { await browser.close(); await srv.close(); }
});
