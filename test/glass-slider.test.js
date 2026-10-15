/*
 * glass-slider.test.js - Phase A STEP 3 acceptance.
 *
 * Pure unit part: legacy 3-step value -> 5-step level migration.
 * DOM part: loads the real public/index.html in Chromium, moves the glass
 * slider through every level, and asserts (a) the page writes the exact CSS
 * variables from tools/glass-levels.js, (b) each level writes a different
 * blur, (c) the slider exposes the required a11y attributes, (d) the setting
 * persists across a reload, and (e) the control is shown only for the glass
 * style. The DOM test skips cleanly when Chromium is unavailable.
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

test("glass slider: levels, a11y, persistence, glass-only", { timeout: 90000 }, async (t) => {
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
    // default level is 3 (blur 22px, the previous "medium")
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--bl")), "22px");

    await page.click('[data-a="set"]');
    await page.waitForSelector("#gs");

    // (a) attributes / a11y
    const gs = await page.$eval("#gs", (el) => ({
      tag: el.tagName, type: el.type, min: el.min, max: el.max, step: el.step,
      value: el.value, aria: el.getAttribute("aria-label"),
    }));
    assert.equal(gs.tag, "INPUT");
    assert.equal(gs.type, "range");
    assert.equal(gs.min, "1");
    assert.equal(gs.max, "5");
    assert.equal(gs.step, "1");
    assert.equal(gs.aria, "شدة الزجاج");

    // (b) every level writes the exact expected CSS variables
    const bls = [];
    const sats = [];
    for (let lvl = 1; lvl <= 5; lvl++) {
      await page.$eval(
        "#gs",
        (el, v) => { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); },
        lvl
      );
      const v = await page.evaluate(() => {
        const r = document.documentElement.style;
        return { bl: r.getPropertyValue("--bl"), sat: r.getPropertyValue("--sat"), gb: r.getPropertyValue("--gb"), gbr: r.getPropertyValue("--gbr") };
      });
      assert.equal(v.bl, LEVELS[lvl - 1].bl + "px", "blur at level " + lvl);
      assert.equal(v.sat, LEVELS[lvl - 1].sat + "%", "saturate at level " + lvl);
      assert.equal(v.gb, "rgba(255,255,255," + LEVELS[lvl - 1].bg.light + ")", "fill alpha at level " + lvl);
      assert.equal(v.gbr, "rgba(255,255,255," + LEVELS[lvl - 1].rim.light + ")", "rim alpha at level " + lvl);
      bls.push(v.bl);
      sats.push(v.sat);
    }
    assert.equal(new Set(bls).size, 5, "each level writes a different blur");
    assert.equal(new Set(sats).size, 5, "each level writes a different saturate");
    assert.deepEqual(bls, ["4px", "12px", "22px", "34px", "48px"]);

    // (c) theme order: auto first
    const modes = await page.$$eval("#sh [data-m]", (els) => els.map((e) => e.getAttribute("data-m")));
    assert.deepEqual(modes, ["auto", "light", "dark"]);

    // (d) persistence: level 5 survives a reload, slider reopens on 5
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("gq-set")));
    assert.equal(stored.gl, 5);
    assert.equal(stored.gv, 2);
    await page.reload({ waitUntil: "load" });
    await page.waitForSelector("#app .acts", { timeout: 20000 });
    assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue("--bl")), "48px");
    await page.click('[data-a="set"]');
    await page.waitForSelector("#gs");
    assert.equal(await page.$eval("#gs", (el) => el.value), "5");

    // (e) shown only for the glass style
    await page.click('[data-st="shade"]');
    await page.waitForTimeout(60);
    assert.equal(await page.$("#gs"), null, "slider hidden for shade");
    await page.click('[data-st="glass"]');
    await page.waitForTimeout(60);
    assert.ok(await page.$("#gs"), "slider shown for glass");
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
