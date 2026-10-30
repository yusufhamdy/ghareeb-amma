"use strict";
/*
 * phase-i.test.js - Phase I acceptance.
 *
 * Bug: clicking the day progress text (<b class="dcount"> x of y words </b>)
 * flipped the theme, because the counter carried a data-m attribute (the word
 * count) that collided with the settings handler's [data-m] mode selector.
 *
 * These tests:
 *   - a static check that the counter no longer carries a settings attribute
 *     and that the settings options are gated to the settings sheet;
 *   - a full sweep: on every route, in glass/shade, night/day, at 400 and 1440,
 *     clicking every clickable element and every text block leaves gq-set, the
 *     html/body classes and the inline CSS variables on <html> unchanged;
 *   - the day-progress text specifically (all 8 combinations);
 *   - keyboard activation on non-settings elements;
 *   - the real settings controls (mode, palette, style, glass strength) still
 *     change the theme with mouse and keyboard.
 *
 * File is ASCII only (Arabic only as \uXXXX escapes, and here none is needed).
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
    async page(width, set) {
      const page = await browser.newPage({ viewport: { width, height: 900 } });
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

async function loadRoute(page, base, hash, query) {
  await page.goto(base + "/index.html" + (hash ? "#" + hash : ""), { waitUntil: "load" });
  await page.waitForSelector("#nv a", { timeout: 20000 });
  if (query) { await page.fill("#q", query); await page.waitForTimeout(80); }
}

// Runs in the page: dispatches a bubbling click on every clickable element and
// every text block (the settings sheet, the roulette overlay and the gear are
// excluded), comparing the persisted settings and the applied theme each time.
function sweepInPage(skipArr) {
  const SKIP = new Set(skipArr || []);
  const SEL = 'a[href],button,input,[role="button"],[data-a],[data-m],[data-p],[data-g],[data-c]';
  function desc(el) {
    const parts = []; let n = el, d = 0;
    while (n && n.nodeType === 1 && d < 8) {
      let s = n.tagName.toLowerCase();
      const cls = (typeof n.className === "string" ? n.className : "").trim();
      if (cls) s += "." + cls.split(/\s+/).join(".");
      const da = Array.prototype.slice.call(n.attributes).filter((a) => a.name.indexOf("data-") === 0)
        .map((a) => a.name + "=" + a.value).sort().join("|");
      if (da) s += "[" + da + "]";
      parts.unshift(s); n = n.parentElement; d++;
    }
    return parts.join(">");
  }
  function skipEl(el) {
    if (!el || !el.isConnected) return true;
    try { if (el.closest("#sh") || el.closest("#rou") || el.id === "gear") return true; } catch (e) { return true; }
    return false;
  }
  function collect() {
    const out = new Set();
    document.querySelectorAll(SEL).forEach((el) => { if (!skipEl(el)) out.add(el); });
    document.querySelectorAll("#app *, #nv *, aside *").forEach((el) => {
      if (skipEl(el)) return;
      if (el.closest(SEL)) return;                 // inside an interactive element
      if (!(el.textContent || "").trim()) return;  // no text
      out.add(el);
    });
    return Array.from(out);
  }
  function sig() {
    return JSON.stringify({
      s: localStorage.getItem("gq-set"),
      hc: document.documentElement.className,
      bc: document.body.className,
      iv: document.documentElement.getAttribute("style") || "",
      tc: (document.querySelector('meta[name="theme-color"]') || {}).content || "",
    });
  }
  const blocker = (e) => { const a = e.target && e.target.closest && e.target.closest("a[href]"); if (a) e.preventDefault(); };
  document.addEventListener("click", blocker, true);
  const clicked = new Set(SKIP);
  const offenders = [];
  try {
    for (let i = 0; i < 900; i++) {
      const list = collect().filter((el) => !clicked.has(desc(el)));
      if (!list.length) return { offenders: offenders, done: true };
      const el = list[0];
      const k = desc(el);
      clicked.add(k);
      const before = sig();
      try { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window })); } catch (e) {}
      const sh = document.getElementById("sh"); if (sh) sh.classList.remove("open");
      const after = sig();
      if (after !== before) { offenders.push({ desc: k, before: before, after: after }); return { offenders: offenders, done: false }; }
    }
    return { offenders: offenders, done: false, cap: true };
  } finally {
    document.removeEventListener("click", blocker, true);
  }
}

async function sweepRoute(page, base, route) {
  const skip = [];
  const offenders = [];
  for (let attempt = 0; attempt < 30; attempt++) {
    await loadRoute(page, base, route.hash, route.query);
    const r = await page.evaluate(sweepInPage, skip);
    for (const o of r.offenders) offenders.push(o);
    if (r.done || !r.offenders.length) break;
    skip.push(r.offenders[0].desc);
  }
  return offenders;
}

const STYLES = ["glass", "shade"];
const MODES = ["dark", "light"];
const WIDTHS = [400, 1440];

// ---------------------------------------------------------------------------
// static: the cause was removed from the element and the handler hardened
// ---------------------------------------------------------------------------
test("I2: the day progress counter carries no settings attribute and options are gated to the sheet", () => {
  const html = read("public/index.html");
  const tag = html.match(/<b class="dcount"[^>]*>/);
  assert.ok(tag, "the day progress counter markup exists");
  assert.ok(!/\sdata-m=/.test(tag[0]), "the counter must not carry data-m: " + tag[0]);
  assert.ok(!/cnt\.dataset\.m\s*=/.test(html), "refreshDay must not write a data-m attribute");
  assert.ok(/if\(!t\.closest\('#sh'\)\)return;/.test(html), "settings options are gated to the settings sheet");
});

// ---------------------------------------------------------------------------
// full sweep: no non-settings click changes the theme, on any route
// ---------------------------------------------------------------------------
test("I2: no non-settings click changes the theme on any route (styles/modes/widths)", { timeout: 600000 }, async (t) => {
  const e = await env(t);
  if (!e) return;
  try {
    const probe = await e.page(400, { mode: "dark", pal: "def", gl: 3, style: "glass", gv: 2, snd: false });
    await loadRoute(probe, e.base, "", null);
    const info = await probe.evaluate(() => ({
      wid: (typeof W !== "undefined" && W[0] && W[0].id) || "114-0",
      q: (typeof W !== "undefined" && W[0] && W[0].word) || "",
    }));
    await probe.close();

    const routes = [
      { name: "home", hash: "" },
      { name: "search", hash: "", query: info.q },
      { name: "surahs", hash: "surahs" },
      { name: "surah", hash: "surah/114" },
      { name: "word", hash: "word/" + info.wid },
      { name: "day-1", hash: "day/1" },
      { name: "day-mid", hash: "day/15" },
      { name: "day-last", hash: "day/30" },
      { name: "challenge", hash: "challenge" },
      { name: "quiz", hash: "quiz" },
      { name: "about", hash: "about" },
      { name: "privacy", hash: "privacy" },
      { name: "terms", hash: "terms" },
      { name: "rights", hash: "rights" },
    ];
    const combos = [];
    for (const style of STYLES) for (const mode of MODES) for (const width of WIDTHS) combos.push({ style, mode, width });

    const all = [];
    for (const c of combos) {
      const page = await e.page(c.width, { mode: c.mode, pal: "def", gl: 3, style: c.style, gv: 2, snd: false });
      for (const r of routes) {
        const off = await sweepRoute(page, e.base, r);
        for (const o of off) all.push({ combo: c.style + "/" + c.mode + "@" + c.width, route: r.name, desc: o.desc, before: o.before, after: o.after });
      }
      await page.close();
    }
    assert.deepEqual(all.map((o) => ({ combo: o.combo, route: o.route, desc: o.desc })), [],
      "non-settings clicks changed the theme:\n" + JSON.stringify(all, null, 2));
  } finally { await e.close(); }
});

// ---------------------------------------------------------------------------
// the reported case: the day progress text
// ---------------------------------------------------------------------------
test("I2: the day progress text never changes the theme (glass/shade, night/day, 400/1440)", { timeout: 300000 }, async (t) => {
  const e = await env(t);
  if (!e) return;
  try {
    for (const style of STYLES) for (const mode of MODES) for (const width of WIDTHS) {
      const page = await e.page(width, { mode: mode, pal: "def", gl: 3, style: style, gv: 2, snd: false });
      await loadRoute(page, e.base, "day/1", null);
      const snap = () => page.evaluate(() => ({
        s: localStorage.getItem("gq-set"),
        hc: document.documentElement.className,
        bc: document.body.className,
        iv: document.documentElement.getAttribute("style") || "",
        tx: (document.documentElement.style.getPropertyValue("--tx") || "").trim().toUpperCase(),
      }));
      const before = await snap();
      assert.equal(before.tx, mode === "dark" ? "#ECEFFA" : "#1D2B25", "theme applied before the click (" + style + "/" + mode + "@" + width + ")");
      assert.equal(await page.getAttribute(".dcount", "data-m"), null, "the counter carries no data-m");
      const box = await page.locator(".dcount").boundingBox();
      assert.ok(box && box.width > 0, "the progress text is laid out");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const afterClick = await snap();
      assert.deepEqual({ s: afterClick.s, hc: afterClick.hc, bc: afterClick.bc, iv: afterClick.iv, tx: afterClick.tx },
        { s: before.s, hc: before.hc, bc: before.bc, iv: before.iv, tx: before.tx },
        "mouse click on the progress text changed the theme (" + style + "/" + mode + "@" + width + ")");
      const disp = await page.evaluate(() => {
        const el = document.querySelector(".dcount");
        const b = { s: localStorage.getItem("gq-set"), hc: document.documentElement.className, bc: document.body.className, iv: document.documentElement.getAttribute("style") || "" };
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        const a = { s: localStorage.getItem("gq-set"), hc: document.documentElement.className, bc: document.body.className, iv: document.documentElement.getAttribute("style") || "" };
        return { changed: JSON.stringify(a) !== JSON.stringify(b) };
      });
      assert.equal(disp.changed, false, "a click event on the progress text changed the theme (" + style + "/" + mode + "@" + width + ")");
      await page.close();
    }
  } finally { await e.close(); }
});

// ---------------------------------------------------------------------------
// keyboard activation on non-settings elements
// ---------------------------------------------------------------------------
test("I2: keyboard activation on non-settings elements never changes the theme", { timeout: 240000 }, async (t) => {
  const e = await env(t);
  if (!e) return;
  try {
    const page = await e.page(400, { mode: "dark", pal: "def", gl: 3, style: "glass", gv: 2, snd: false });
    const focusables = "#app a[href],#app button,#nv a";
    const snap = () => page.evaluate(() => JSON.stringify({
      s: localStorage.getItem("gq-set"), hc: document.documentElement.className,
      bc: document.body.className, iv: document.documentElement.getAttribute("style") || "",
    }));
    for (const hash of ["day/1", "challenge", "home", "surahs"]) {
      await loadRoute(page, e.base, hash, null);
      const n = await page.evaluate((sel) => Array.from(document.querySelectorAll(sel))
        .filter((el) => !el.closest("#sh") && el.id !== "gear" && !el.disabled).length, focusables);
      for (let i = 0; i < n; i++) {
        for (const key of ["Enter", " "]) {
          await loadRoute(page, e.base, hash, null);
          const before = await snap();
          const focused = await page.evaluate((a) => {
            const list = Array.from(document.querySelectorAll(a.sel))
              .filter((el) => !el.closest("#sh") && el.id !== "gear" && !el.disabled);
            const el = list[a.i]; if (!el) return false;
            el.focus(); return document.activeElement === el;
          }, { sel: focusables, i: i });
          if (!focused) continue;
          await page.keyboard.press(key);
          const after = await snap();
          assert.equal(after, before, "keyboard '" + key + "' on element #" + i + " of " + hash + " changed the theme");
        }
      }
    }
    await page.close();
  } finally { await e.close(); }
});

// ---------------------------------------------------------------------------
// the real settings controls still work (mouse and keyboard)
// ---------------------------------------------------------------------------
test("I2: the real settings controls still change the theme (mouse and keyboard)", { timeout: 180000 }, async (t) => {
  const e = await env(t);
  if (!e) return;
  try {
    const page = await e.page(400, { mode: "light", pal: "def", gl: 3, style: "glass", gv: 2, snd: false, cm: false });
    await loadRoute(page, e.base, "", null);
    await page.click("#gear");
    await page.waitForSelector("#sh.open", { timeout: 5000 });

    await page.click('#sh [data-m="dark"]');
    let s = await page.evaluate(() => JSON.parse(localStorage.getItem("gq-set")));
    assert.equal(s.mode, "dark", "the mode button sets night");
    assert.equal((await page.evaluate(() => document.documentElement.style.getPropertyValue("--tx"))).trim().toUpperCase(), "#ECEFFA", "night colours applied");

    await page.click('#sh [data-p="lav"]');
    s = await page.evaluate(() => JSON.parse(localStorage.getItem("gq-set")));
    assert.equal(s.pal, "lav", "the palette button works");

    await page.click('#sh [data-st="shade"]');
    s = await page.evaluate(() => JSON.parse(localStorage.getItem("gq-set")));
    assert.equal(s.style, "shade", "the style button works");
    assert.ok(await page.evaluate(() => document.body.classList.contains("shade")), "the shade class is applied");

    await page.click('#sh [data-st="glass"]');
    await page.waitForSelector("#gs", { timeout: 5000 });
    await page.evaluate(() => { const g = document.getElementById("gs"); g.value = "100"; g.dispatchEvent(new Event("input", { bubbles: true })); g.dispatchEvent(new Event("change", { bubbles: true })); });
    s = await page.evaluate(() => JSON.parse(localStorage.getItem("gq-set")));
    assert.equal(s.gl, 100, "the glass strength persists (saved on release)");

    await page.click("#sh [data-c]");
    s = await page.evaluate(() => JSON.parse(localStorage.getItem("gq-set")));
    assert.equal(s.cm, true, "the stop-motion toggle persists");

    await page.evaluate(() => document.querySelector('#sh [data-m="light"]').focus());
    await page.keyboard.press("Enter");
    s = await page.evaluate(() => JSON.parse(localStorage.getItem("gq-set")));
    assert.equal(s.mode, "light", "keyboard Enter on a settings control works");

    await page.close();
  } finally { await e.close(); }
});
