/*
 * glass-slider.test.js - Phase A STEP 3 acceptance.
 *
 * Pure unit part: legacy 3-step value -> 5-step level migration.
 * DOM part: loads the real public/index.html in Chromium, moves the continuous
 * glass slider (0..100) across its range, and asserts (a) the page writes CSS
 * variables piecewise-linear through tools/glass-levels.js levels 1..5 (0, 25, 50, 75, 100 are the levels), (b)
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

// The settings migration (the GQ_THEME definitions block): records saved before the settings version (sv 2) had "def"
// as the default palette (blue at night), which became neo: a saved "def" becomes "neo" once; after that "def" is the
// green palette and stays. The removed palette "min" becomes the green palette, a missing palette the default (neo),
// and the glass strength moves to 0..100.
function themeBlock() {
  const vm = require("vm");
  // the definitions block (identical in index.html, theme-boot.js and theme.js: test/theme-copies.test.js)
  const src = fs.readFileSync(path.join(PUBLIC, "theme-boot.js"), "utf8");
  const ctx = {};
  vm.runInNewContext(src.slice(src.indexOf("/* GQ_THEME:begin"), src.indexOf("/* GQ_THEME:end */")) + ";this.T = GQ_THEME;", ctx);
  return ctx.T;
}
test("settings migration: palettes, the settings version and the continuous glass scale", () => {
  const T = themeBlock();
  assert.deepEqual(T.ORDER, ["neo", "gold", "def", "lav", "sun"]);
  assert.equal(T.DEFAULT, "neo");
  assert.equal(T.SV, 2);
  const m = (s) => T.migrate(Object.assign({}, s));
  // the old site (main d4405a7) saved its whole settings record, always with a palette, only when a setting changed
  assert.equal(m({ mode: "auto", pal: "def", gl: 3, cm: false, snd: true, style: "glass" }).pal, "neo", "old def (the old default) becomes neo");
  assert.equal(m({ pal: "neo", gl: 3, gv: 2 }).pal, "neo", "old neo stays neo");
  assert.equal(m({ pal: "min", gl: 3, gv: 2 }).pal, "def", "old min becomes the green palette, as before");
  assert.equal(m({ pal: "lav" }).pal, "lav");
  assert.equal(m({}).pal, "neo", "no saved settings: neo");
  assert.equal(m({ pal: "nope" }).pal, "neo", "unknown palette: neo");
  assert.equal(m({ pal: "def", sv: 2, gl: 50, gv: 3 }).pal, "def", "def saved after the release (sv 2) stays green");
  assert.equal(m({ pal: "def" }).sv, 2, "every migrated record carries the settings version");
  assert.equal(m({}).sv, 2, "a new record carries the settings version");
  const twice = m(m({ pal: "def" }));
  assert.equal(twice.pal, "neo", "migrating again changes nothing");
  // upgrade: what is saved back once, at load
  assert.equal(T.upgrade({}), null, "no record: nothing is written");
  assert.equal(T.upgrade(null), null);
  assert.equal(T.upgrade({ pal: "def", sv: 2 }), null, "a current record is left alone");
  assert.deepEqual(JSON.parse(JSON.stringify(T.upgrade({ mode: "dark", pal: "def", gl: 4, gv: 2, snd: false }))), { mode: "dark", pal: "neo", gl: 4, gv: 2, snd: false, sv: 2 }, "only pal and sv change");
  assert.deepEqual(JSON.parse(JSON.stringify(T.upgrade({ pal: "min", gl: 3 }))), { pal: "min", gl: 3, sv: 2 }, "min keeps its mapping (done in migrate)");
  // 1..5 (gv 2) -> 0..100; the older 0/1/2 scale goes through 1/3/5
  assert.deepEqual([1, 2, 3, 4, 5].map((g) => m({ gl: g, gv: 2 }).gl), [0, 25, 50, 75, 100]);
  assert.deepEqual([0, 1, 2].map((g) => m({ gl: g }).gl), [0, 50, 100]);
  assert.equal(m({ gl: 1, gv: 2 }).gv, 3);
  assert.equal(m({ gl: 37, gv: 3 }).gl, 37, "0..100 values pass through");
});

// The glass mapping goes through the old site's five levels (main d4405a7, GLLV): an old level n, migrated to
// (n - 1) * 25, gives exactly that level's blur, saturate, fill and rim, in light and dark; between two levels it is
// linear.
test("glass mapping: every old level gives the old site's values exactly", async () => {
  const T = themeBlock();
  const { LEVELS } = await import(pathToFileURL(path.join(ROOT, "tools", "glass-levels.js")).href);
  const OLD = [[4, 140, 0.88, 0.26, 0.55, 0.10], [12, 160, 0.80, 0.22, 0.63, 0.13], [22, 180, 0.72, 0.18, 0.71, 0.16], [34, 200, 0.64, 0.15, 0.79, 0.19], [48, 220, 0.56, 0.12, 0.87, 0.22]];
  OLD.forEach((o, i) => {
    const L = LEVELS[i];
    assert.deepEqual([L.bl, L.sat, L.bg.light, L.bg.dark, L.rim.light, L.rim.dark], o, "tools/glass-levels.js level " + (i + 1) + " is the old site's");
    const v = T.migrate({ gl: i + 1, gv: 2 }).gl;
    assert.equal(v, i * 25);
    for (const dark of [false, true]) {
      const g = T.glass(v, dark);
      assert.deepEqual([g.bl, g.sat, g.gb, g.gbr], [o[0] + "px", o[1] + "%", dark ? o[3] : o[2], dark ? o[5] : o[4]], "old level " + (i + 1) + (dark ? " dark" : " light"));
    }
  });
  // the default 50 is old level 3
  assert.deepEqual(T.glass(T.GLASS_DEFAULT, false), { bl: "22px", sat: "180%", gb: 0.72, gbr: 0.71 });
  assert.deepEqual(T.glass(T.GLASS_DEFAULT, true), { bl: "22px", sat: "180%", gb: 0.18, gbr: 0.16 });
  // linear between neighbouring levels: 60 is 40% of the way from level 3 to level 4
  assert.deepEqual(T.glass(60, false), { bl: "26.8px", sat: "188%", gb: 0.688, gbr: 0.742 });
  assert.deepEqual(T.glass(-5, true), T.glass(0, true));
  assert.deepEqual(T.glass(120, true), T.glass(100, true));
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
    // the stored level 3 (1..5 scale) migrates to 50: exactly the old level 3, blur 22px
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--bl")), "22px");

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

    // (b) 0, 25, 50, 75 and 100 write exactly the old levels 1..5
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
      const L = LEVELS[val / 25];
      assert.equal(v.bl, L.bl + "px", "blur at " + val);
      assert.equal(v.sat, L.sat + "%", "saturate at " + val);
      assert.equal(v.gb, "rgba(255,255,255," + L.bg.light + ")", "fill alpha at " + val);
      assert.equal(v.gbr, "rgba(255,255,255," + L.rim.light + ")", "rim alpha at " + val);
      bls.push(v.bl);
      sats.push(v.sat);
    }
    assert.equal(new Set(bls).size, 5, "each point writes a different blur");
    assert.equal(new Set(sats).size, 5, "each point writes a different saturate");
    assert.deepEqual(bls, ["4px", "12px", "22px", "34px", "48px"], "the blur goes through the old levels");

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
