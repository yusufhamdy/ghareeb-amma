/*
 * glass-slider.test.js - Phase A STEP 3 acceptance.
 *
 * Pure unit part: legacy 3-step value -> 5-step level migration.
 * DOM part: loads the real public/index.html in Chromium, moves the continuous
 * glass slider (0..100) across its range, and asserts (a) the page writes CSS
 * variables mapped evenly between tools/glass-levels.js levels 1 and 5, (b)
 * every point writes a different blur, (c) the slider exposes the required
 * a11y attributes, (d) the setting persists across a reload, and (e) the
 * control is shown only for the glass style. The DOM test skips cleanly when
 * Chromium is unavailable.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

test("glass levels: legacy 0/1/2 migrate to 1/3/5; 1..5 pass through", async () => {
  const { normalizeLevel, LEVELS, DEFAULT_LEVEL } = await import(
    pathToFileURL(path.join(ROOT, "tools", "glass-levels.js")).href
  );
  assert.equal(LEVELS.length, 5);
  assert.equal(DEFAULT_LEVEL, 3);
  assert.equal(normalizeLevel(0, false), 1);
  assert.equal(normalizeLevel(1, false), 3);
  assert.equal(normalizeLevel(2, false), 5);
  assert.equal(normalizeLevel(undefined, false), 3);
  // once the new-scheme flag is set, stored 1..5 are taken verbatim
  assert.equal(normalizeLevel(1, true), 1);
  assert.equal(normalizeLevel(5, true), 5);
  assert.equal(normalizeLevel(4, true), 4);
  assert.equal(normalizeLevel(9, true), 3);
});

// The settings migration (the GQ_THEME definitions block): the removed palette "min"
// becomes the green palette, a missing palette the default (gold), and the glass strength moves to 0..100.
test("settings migration: palettes and the continuous glass scale", () => {
  const vm = require("vm");
  // the definitions block (identical in index.html, theme-boot.js and theme.js: test/theme-copies.test.js)
  const src = fs.readFileSync(path.join(PUBLIC, "theme-boot.js"), "utf8");
  const ctx = {};
  vm.runInNewContext(src.slice(src.indexOf("/* GQ_THEME:begin"), src.indexOf("/* GQ_THEME:end */")) + ";this.T = GQ_THEME;", ctx);
  const T = ctx.T;
  assert.deepEqual(T.ORDER, ["gold", "def", "lav", "sun", "neo"]);
  assert.equal(T.DEFAULT, "gold");
  const m = (s) => T.migrate(Object.assign({}, s));
  assert.equal(m({ pal: "min", gl: 3, gv: 2 }).pal, "def", "min becomes the green palette");
  assert.equal(m({ pal: "def", gl: 3, gv: 2 }).pal, "def", "a saved def stays green");
  assert.equal(m({}).pal, "gold", "no saved palette: gold");
  assert.equal(m({ pal: "nope" }).pal, "gold", "unknown palette: gold");
  // 1..5 (gv 2) -> 0..100; the older 0/1/2 scale goes through 1/3/5
  assert.deepEqual([1, 2, 3, 4, 5].map((g) => m({ gl: g, gv: 2 }).gl), [0, 25, 50, 75, 100]);
  assert.deepEqual([0, 1, 2].map((g) => m({ gl: g }).gl), [0, 50, 100]);
  assert.equal(m({ gl: 1, gv: 2 }).gv, 3);
  assert.equal(m({ gl: 37, gv: 3 }).gl, 37, "0..100 values pass through");
});

function staticServer(root) {
  const types = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
  };
  return http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

test("glass slider: continuous range, a11y, persistence, glass-only", { timeout: 90000 }, async (t) => {
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch (e) {
    t.skip("playwright not installed");
    return;
  }
  let browser;
  try {
    browser = await chromium.launch();
  } catch (e) {
    t.skip("chromium unavailable: " + e.message);
    return;
  }

  const { LEVELS } = await import(pathToFileURL(path.join(ROOT, "tools", "glass-levels.js")).href);
  const words = fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8");

  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;

  try {
    const page = await browser.newPage();
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript({
      content:
        "window.__WORDS__=" + words + ";window.__CH__=[];" +
        "try{if(!localStorage.getItem('gq-set'))localStorage.setItem('gq-set',JSON.stringify({mode:'light',pal:'def',gl:3,style:'glass',gv:2}))}catch(e){}",
    });

    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForSelector("#app .acts", { timeout: 20000 });
    // the stored level 3 (1..5 scale) migrates to 50: blur 26px, halfway between levels 1 and 5
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--bl")), "26px");

    await page.click('[data-a="set"]');
    await page.waitForSelector("#gs");

    // (a) attributes / a11y
    const gs = await page.$eval("#gs", (el) => ({
      tag: el.tagName, type: el.type, min: el.min, max: el.max, step: el.step,
      value: el.value, aria: el.getAttribute("aria-label"), text: el.getAttribute("aria-valuetext"),
    }));
    assert.equal(gs.tag, "INPUT");
    assert.equal(gs.type, "range");
    assert.equal(gs.min, "0");
    assert.equal(gs.max, "100");
    assert.equal(gs.step, "1");
    assert.equal(gs.value, "50");
    assert.equal(gs.aria, "شدة الزجاج");
    assert.equal(gs.text, "متوسط", "value text names the range");

    // (b) every point writes the CSS variables mapped evenly between level 1 (0) and level 5 (100)
    const lo = LEVELS[0], hi = LEVELS[4], at = (a, b, t) => a + (b - a) * t;
    const bls = [];
    const sats = [];
    for (const val of [0, 25, 50, 75, 100]) {
      await page.$eval(
        "#gs",
        (el, v) => { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); },
        val
      );
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const v = await page.evaluate(() => {
        const r = document.documentElement.style;
        return { bl: r.getPropertyValue("--bl"), sat: r.getPropertyValue("--sat"), gb: r.getPropertyValue("--gb"), gbr: r.getPropertyValue("--gbr") };
      });
      const t = val / 100;
      assert.equal(v.bl, +at(lo.bl, hi.bl, t).toFixed(2) + "px", "blur at " + val);
      assert.equal(v.sat, +at(lo.sat, hi.sat, t).toFixed(1) + "%", "saturate at " + val);
      assert.equal(v.gb, "rgba(255,255,255," + +at(lo.bg.light, hi.bg.light, t).toFixed(3) + ")", "fill alpha at " + val);
      assert.equal(v.gbr, "rgba(255,255,255," + +at(lo.rim.light, hi.rim.light, t).toFixed(3) + ")", "rim alpha at " + val);
      bls.push(v.bl);
      sats.push(v.sat);
    }
    assert.equal(new Set(bls).size, 5, "each point writes a different blur");
    assert.equal(new Set(sats).size, 5, "each point writes a different saturate");
    assert.deepEqual(bls, ["4px", "15px", "26px", "37px", "48px"], "the blur moves evenly");

    // (c) theme order: auto first
    const modes = await page.$$eval("#sh [data-m]", (els) => els.map((e) => e.getAttribute("data-m")));
    assert.deepEqual(modes, ["auto", "light", "dark"]);

    // (d) persistence: 100 is saved on release and survives a reload, slider reopens on 100
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("gq-set")));
    assert.equal(stored.gl, 100);
    assert.equal(stored.gv, 3);
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#app .acts", { timeout: 20000 });
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--bl")), "48px");
    await page.click('[data-a="set"]');
    await page.waitForSelector("#gs");
    assert.equal(await page.$eval("#gs", (el) => el.value), "100");

    // (e) shown only for the glass style
    // the glass strength collapses (hidden, inert) in shade and expands again in glass (~200ms)
    await page.click('[data-st="shade"]');
    await page.waitForSelector("#gs", { state: "hidden", timeout: 2000 });
    assert.equal(await page.isVisible("#gs"), false, "slider hidden for shade");
    assert.equal(await page.$eval("#sh .gsx", (e) => e.inert), true, "the collapsed slider is inert");
    await page.click('[data-st="glass"]');
    await page.waitForSelector("#gs", { state: "visible", timeout: 2000 });
    assert.ok(await page.isVisible("#gs"), "slider shown for glass");
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
