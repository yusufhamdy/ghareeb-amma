"use strict";
/*
 * phase-j.test.js - Phase J acceptance.
 *
 * K4: iOS glass performance counts, cleanup, shadow clipping and typing latency;
 * K5: the save-as-image preview and the saved file use one renderer and save inside the tap.
 *
 * ASCII-only; Arabic only as \uXXXX escapes if needed.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

function staticServer(dir) {
  const types = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  };
  return http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(dir, p);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

async function env(t) {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return null; }
  let browser;
  try { browser = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return null; }

  const words = fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8");
  const chObj = Object.assign(JSON.parse(fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8")), { releasedUpTo: 30 });
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;

  return {
    base,
    async page(width, height, set) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      page.on("dialog", (d) => d.dismiss().catch(() => {}));
      const content = "window.__WORDS__=" + words + ";window.__CH__=" + JSON.stringify(chObj) + ";" +
        "try{localStorage.setItem('gq-set',JSON.stringify(" + JSON.stringify(set) + "))}catch(e){}";
      await page.addInitScript({ content });
      return page;
    },
    async close() { await browser.close(); await new Promise((r) => server.close(r)); },
  };
}

// ---------------------------------------------------------------------------
// K4: iOS glass performance - measured on the real app in Chromium.
// ---------------------------------------------------------------------------

// Records the timers/loops/oscillators a route starts, so we can prove none
// outlive a route change.
const TIMER_PROBE = `
window.__K4 = { iv: new Set(), osc: { c: 0, s: 0 }, raf: 0 };
const _si=window.setInterval,_ci=window.clearInterval,_raf=window.requestAnimationFrame;
window.setInterval=function(f,m){const i=_si.call(window,f,m);window.__K4.iv.add(i);return i};
window.clearInterval=function(i){window.__K4.iv.delete(i);return _ci.call(window,i)};
window.requestAnimationFrame=function(cb){window.__K4.raf++;return _raf.call(window,cb)};
const _AC=window.AudioContext||window.webkitAudioContext;
if(_AC){const co=_AC.prototype.createOscillator;_AC.prototype.createOscillator=function(){window.__K4.osc.c++;const o=co.call(this);const s=o.stop;o.stop=function(){window.__K4.osc.s++;return s.apply(this,arguments)};return o}};
window.__LT=[];try{new PerformanceObserver(function(l){for(const e of l.getEntries())window.__LT.push(e.duration)}).observe({entryTypes:['longtask']})}catch(e){}
`;

const ROUTES = [
  ["home", "#/", "#app"],
  ["surahs", "#/surahs", "#app .list"],
  ["surah", "#/surah/78", "#app .shd"],
  ["word", "#/word/78-0", "#app .acts"],
  ["day", "#/day/1", "#dw .dcard"],
  ["challenge", "#/challenge", "#app .card"],
  ["quiz", "#/quiz", "#app .card"],
];

async function envOrSkip(t) {
  try { require("playwright"); } catch (e) { t.skip("playwright not installed"); return null; }
  return env(t);
}

async function open(env, set) {
  const page = await env.page(400, 844, set);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
  await page.addInitScript({ content: TIMER_PROBE });
  await page.goto(env.base + "/index.html", { waitUntil: "load" });
  await page.waitForSelector("#app", { timeout: 20000 });
  return page;
}

async function goHash(page, hash, sel) {
  await page.evaluate((h) => { location.hash = h; }, hash);
  if (sel) await page.waitForSelector(sel, { timeout: 20000 });
  await page.waitForTimeout(200);
}

test("K4: every route blurs at most six surfaces, and the large cards still blur", { timeout: 180000 }, async (t) => {
  const e = await envOrSkip(t);
  if (!e) return;
  try {
    const page = await open(e, { mode: "light", pal: "def", gl: 3, style: "glass", gv: 2, snd: false, cm: false });
    for (const [name, hash, sel] of ROUTES) {
      await goHash(page, hash, sel);
      const r = await page.evaluate(() => {
        let total = 0, visible = 0;
        for (const el of document.querySelectorAll("*")) {
          const bf = getComputedStyle(el).backdropFilter;
          if (!bf || bf === "none") continue;
          total++;
          if (el.getClientRects().length > 0 && !el.closest("#ld")) visible++;
        }
        return { total, visible };
      });
      assert.ok(r.total <= 6, name + " has " + r.total + " blurred surfaces (max 6)");
      assert.ok(r.visible <= 6, name + " has " + r.visible + " visible blurred surfaces (max 6)");
    }
    await goHash(page, "#/word/78-0", "#app .acts");
    const card = await page.$eval("#app .card", (el) => getComputedStyle(el).backdropFilter);
    assert.ok(card && card !== "none", "the word card still blurs");
    const nav = await page.$eval("nav.g", (el) => getComputedStyle(el).backdropFilter);
    assert.ok(nav && nav !== "none", "the nav still blurs");
    await page.close();
  } finally { await e.close(); }
});

test("K4: leaving a route leaves no interval, oscillator or rAF loop alive", { timeout: 180000 }, async (t) => {
  const e = await envOrSkip(t);
  if (!e) return;
  try {
    const page = await open(e, { mode: "light", pal: "def", gl: 3, style: "glass", gv: 2, snd: false, cm: false });
    await goHash(page, "#/word/78-0", "#app .acts");
    await page.click('#app [data-a="rnd"]');
    await page.waitForSelector("#rou", { timeout: 5000 });
    const live = await page.evaluate(() => window.__K4.iv.size);
    assert.ok(live >= 1, "the roulette really starts an interval (got " + live + ")");
    await page.evaluate(() => { location.hash = "#/"; });
    await page.waitForSelector("#app", { timeout: 20000 });
    await page.waitForTimeout(120);
    const after = await page.evaluate(() => ({ iv: window.__K4.iv.size, osc: window.__K4.osc, rou: !!document.getElementById("rou") }));
    assert.strictEqual(after.iv, 0, "no interval survives the route change");
    assert.strictEqual(after.osc.c - after.osc.s, 0, "no oscillator is left running");
    assert.strictEqual(after.rou, false, "the roulette element is removed");
    for (const [name, hash, sel] of [["day", "#/day/1", "#dw .dcard"], ["challenge", "#/challenge", "#app .card"]]) {
      await goHash(page, hash, sel);
      const a = await page.evaluate(() => window.__K4.raf);
      await page.waitForTimeout(300);
      const b = await page.evaluate(() => window.__K4.raf);
      assert.ok(b - a < 10, name + " runs a rAF loop (" + (b - a) + " frames in 300ms)");
    }
    await page.close();
  } finally { await e.close(); }
});

test("K4: at 4x CPU no navigation over 200ms, TBT under 300ms, and a clean exit from the challenge", { timeout: 180000 }, async (t) => {
  const e = await envOrSkip(t);
  if (!e) return;
  try {
    const page = await open(e, { mode: "light", pal: "def", gl: 3, style: "glass", gv: 2, snd: false, cm: false });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    for (const [name, hash, sel] of [["challenge", "#/challenge", "#app .card"], ["day", "#/day/1", "#dw .dcard"], ["home", "#/", "#app"]]) {
      await page.evaluate(() => { window.__LT.length = 0; });
      await goHash(page, hash, sel);
      await page.waitForTimeout(600);
      const lt = await page.evaluate(() => window.__LT.slice());
      const tbt = lt.reduce((s, d) => s + Math.max(0, d - 50), 0);
      assert.ok(tbt < 300, name + " TBT is " + tbt + "ms (max 300)");
      assert.ok(Math.max(0, ...lt) <= 200, name + " has a " + Math.max(0, ...lt) + "ms long task (max 200)");
    }
    await goHash(page, "#/challenge", "#app .card");
    await page.evaluate(() => { window.__LT.length = 0; });
    await page.evaluate(() => { location.hash = "#/"; });
    await page.waitForSelector("#app", { timeout: 20000 });
    await page.waitForTimeout(800);
    const after = await page.evaluate(() => window.__LT.slice());
    assert.ok(Math.max(0, ...after) <= 200, "leaving the challenge left a " + Math.max(0, ...after) + "ms long task (max 200)");
    await page.close();
  } finally { await e.close(); }
});

test("K4b: the action rows only clip while the search collapses, so button shadows are not cut", { timeout: 120000 }, async (t) => {
  const e = await envOrSkip(t);
  if (!e) return;
  try {
    const page = await open(e, { mode: "light", pal: "def", gl: 3, style: "glass", gv: 2, snd: false, cm: false });
    const rest = await page.evaluate(() => {
      const a = document.querySelector("#app .acts");
      const s = document.querySelector(".strip");
      return { acts: getComputedStyle(a).overflow, clip: getComputedStyle(a).overflowClipMargin, strip: s ? getComputedStyle(s).overflow : "n/a" };
    });
    assert.strictEqual(rest.acts, "visible", "the action row does not clip at rest (got " + rest.acts + ")");
    assert.ok(rest.strip === "visible" || rest.strip === "n/a", "the strip does not clip at rest (got " + rest.strip + ")");
    await page.hover('#app .acts [data-a="rnd"]');
    await page.waitForTimeout(300);
    const shadow = await page.$eval('#app .acts [data-a="rnd"]', (el) => getComputedStyle(el).boxShadow);
    assert.ok(shadow && shadow !== "none", "the hover shadow is painted");
    await page.fill("#q", "\u0627");
    await page.waitForTimeout(80);
    const searching = await page.evaluate(() => getComputedStyle(document.querySelector("#app .acts")).overflow);
    assert.strictEqual(searching, "hidden", "the action row clips while collapsing (got " + searching + ")");
    await page.fill("#q", "");
    await page.waitForTimeout(80);
    const back = await page.evaluate(() => getComputedStyle(document.querySelector("#app .acts")).overflow);
    assert.strictEqual(back, "visible", "the action row stops clipping once the search clears (got " + back + ")");
    await page.close();
  } finally { await e.close(); }
});

test("K4c: a burst of typing is coalesced into one result rebuild instead of one per key", { timeout: 180000 }, async (t) => {
  const e = await envOrSkip(t);
  if (!e) return;
  try {
    const page = await open(e, { mode: "light", pal: "def", gl: 3, style: "glass", gv: 2, snd: false, cm: false });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    // Count every write to the results container.
    await page.evaluate(() => {
      window.__RESW = 0;
      const res = document.getElementById("res");
      const proto = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
      Object.defineProperty(res, "innerHTML", {
        configurable: true,
        get() { return proto.get.call(this); },
        set(v) { window.__RESW++; return proto.set.call(this, v); },
      });
    });
    await page.click("#q");
    // Six keys in a burst (shorter than the debounce window).
    for (const ch of ["\u0627", "\u0644", "\u0644", "\u0647", "\u0645", "\u0627"]) {
      await page.type("#q", ch, { delay: 0 });
      await page.waitForTimeout(25);
    }
    // Feedback stays instant even though the list render is deferred.
    assert.ok(await page.evaluate(() => document.body.classList.contains("searching")), "the collapse reacts on the first key");
    // Only the trailing keystroke should have rebuilt the list.
    const writes = await page.evaluate(() => window.__RESW);
    assert.ok(writes <= 2, "six keys caused " + writes + " result rebuilds (max 2)");
    // And the results do arrive once typing pauses.
    await page.fill("#q", "");
    await page.fill("#q", "\u0627");
    await page.waitForSelector("#res .list.rs .row", { timeout: 5000 });
    const rows = await page.evaluate(() => document.querySelectorAll("#res .row").length);
    assert.ok(rows > 0, "the results still render after a pause (got " + rows + " rows)");
    await page.close();
  } finally { await e.close(); }
});

test("K5: the sheet preview and the saved file share one canvas renderer; desktop saves directly", { timeout: 180000 }, async (t) => {
  const e = await envOrSkip(t);
  if (!e) return;
  try {
    const page = await open(e, { mode: "light", pal: "def", gl: 3, style: "glass", gv: 2, snd: false, cm: false });
    // Chromium has no functional file share, so record the Web Share calls.
    await page.evaluate(() => {
      window.__shared = 0;
      Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
      Object.defineProperty(navigator, "share", { configurable: true, value: () => { window.__shared++; return Promise.resolve(); } });
    });
    await goHash(page, "#/word/78-0", '[data-a="card"]');
    await page.click('[data-a="card"]');
    await page.waitForSelector("#sh .arts", { timeout: 20000 });
    await page.waitForTimeout(300);
    const prev = await page.evaluate(() => {
      const art = document.querySelector("#sh .art");
      const img = art && art.querySelector("img");
      return {
        hasImg: !!img,
        src: img ? String(img.getAttribute("src") || "") : "",
        legacyText: !!document.querySelector("#sh .art .aw"),
        rgAspect: getComputedStyle(document.querySelector("#sh .art.rg")).aspectRatio,
        stAspect: getComputedStyle(document.querySelector("#sh .art.st")).aspectRatio,
      };
    });
    assert.ok(prev.hasImg, "the preview is produced by the canvas renderer (an <img>)");
    assert.ok(/^(blob:|data:image\/png)/.test(prev.src), "the preview is the rendered PNG (src " + prev.src.slice(0, 12) + ")");
    assert.ok(!prev.legacyText, "the container-query text preview is gone (it does not render on older iOS)");
    assert.ok(prev.rgAspect.replace(/\s+/g, "") === "4/5", "the regular preview keeps 4/5 (got " + prev.rgAspect + ")");
    assert.ok(prev.stAspect.replace(/\s+/g, "") === "9/16", "the story preview keeps 9/16 (got " + prev.stAspect + ")");
    // Desktop (no coarse pointer): even though canShare() reports true, the tap must
    // save the PNG directly and must never open the share sheet.
    await page.evaluate(() => { window.__shared = 0; });
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      page.click('#sh [data-a="savepng"]'),
    ]);
    const shared = await page.evaluate(() => window.__shared);
    assert.strictEqual(shared, 0, "a desktop tap does not call navigator.share (got " + shared + ")");
    assert.ok(/\.png$/.test(dl.suggestedFilename()), "a desktop tap saves a PNG directly (got " + dl.suggestedFilename() + ")");
    await page.close();
  } finally { await e.close(); }
});
