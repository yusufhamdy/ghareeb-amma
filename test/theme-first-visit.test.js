"use strict";
/*
 * theme-first-visit.test.js - the theme of a FIRST visit (no saved choice: a new browser, cleared storage), in a real
 * browser, in the app and on a static word page (theme-boot.js, before first paint).
 *
 * Since 2026-11-11 a first visit gets style "glass", mode "light" and palette "def" (the green palette), whatever the
 * device's colour scheme; it was glass + auto + neo. A saved choice always wins, as before:
 *   - first visit, prefers-color-scheme dark AND light: glass + light + def, painted in def's light colours, the
 *     theme-color meta too, and nothing is written;
 *   - with JavaScript off (the first-paint fallbacks): the page background is def's light background in both schemes;
 *   - first visit with prefers-reduced-motion: stop-motion is on (it still follows the device);
 *   - a saved {mode: "dark", pal: "lav"} stays dark + lav in both schemes;
 *   - a saved {mode: "auto"} still follows the device.
 *
 * ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PUBLIC = path.resolve(__dirname, "..", "public");
// def (green): light [background, accent]; lav and neo at night
const DEF_LIGHT = ["#F2F0E8", "#1E6B50"], LAV_DARK = "#0B0D22", NEO_DARK = "#0A0E1F", NEO_LIGHT = "#EEF3F6";
const PAGES = ["/#/", "/word/an-nas-4.html"];

function staticServer(root) {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".png": "image/png", ".webp": "image/webp" };
  return http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/firebase-config.js") { res.writeHead(200, { "content-type": types[".js"] }); res.end("window.FIREBASE_CONFIG={};"); return; }
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

const hex = (rgb) => "#" + (rgb.match(/\d+/g) || []).slice(0, 3).map((n) => (+n).toString(16).padStart(2, "0")).join("").toUpperCase();

async function withBrowser(t, fn) {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let br;
  try { br = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return; }
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try { await fn(br, base); } finally { await br.close(); await new Promise((r) => server.close(r)); }
}

// one page load with the given saved record (null: none; the loading screen flag only, as a returning visitor has)
async function load(br, base, where, opt) {
  const ctx = await br.newContext({ viewport: { width: 400, height: 800 }, colorScheme: opt.scheme, reducedMotion: opt.motion || "no-preference", javaScriptEnabled: opt.js !== false });
  await ctx.addInitScript((s) => { try { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.clear(); if (s) localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); } } catch (e) {} }, opt.saved || null);
  const p = await ctx.newPage();
  await p.goto(base + where, { waitUntil: "load" });
  await p.waitForTimeout(300);
  const st = await p.evaluate(() => {
    const r = document.documentElement, cs = getComputedStyle(r);
    // the app's settings object (a top-level let in index.html); static pages have none
    let app = null;
    try { app = typeof set === "object" && set ? { mode: set.mode, pal: set.pal, style: set.style, cm: !!set.cm } : null; } catch (e) {}
    return {
      bg: cs.getPropertyValue("--bg").trim(), ac: cs.getPropertyValue("--ac").trim(),
      body: getComputedStyle(document.body).backgroundColor,
      meta: (document.querySelector('meta[name="theme-color"]') || {}).content,
      dk: r.classList.contains("dk"), shade: r.classList.contains("shade") || document.body.classList.contains("shade"), cm: r.classList.contains("cm") || document.body.classList.contains("cm"),
      app, raw: (() => { try { return localStorage.getItem("gq-set"); } catch (e) { return "unavailable"; } })(),
    };
  });
  await ctx.close();
  return st;
}

test("first visit: glass + light + the green palette (def), whatever the device's colour scheme", { timeout: 180000 }, async (t) => {
  await withBrowser(t, async (br, base) => {
    for (const scheme of ["dark", "light"]) for (const where of PAGES) {
      const tag = where + " (" + scheme + " device)";
      const st = await load(br, base, where, { scheme });
      assert.strictEqual(st.bg.toUpperCase(), DEF_LIGHT[0], tag + ": painted in def's light background");
      assert.strictEqual(st.ac.toUpperCase(), DEF_LIGHT[1], tag + ": def's light accent");
      assert.strictEqual(String(st.meta).toUpperCase(), DEF_LIGHT[0], tag + ": theme-color");
      assert.strictEqual(st.shade, false, tag + ": the glass style, not shade");
      if (where !== "/#/") assert.strictEqual(st.dk, false, tag + ": day (light) mode, not night (the static pages mark night with .dk)");
      assert.strictEqual(st.cm, false, tag + ": stop-motion off on a device without reduced motion");
      if (where === "/#/") assert.deepStrictEqual(st.app, { mode: "light", pal: "def", style: "glass", cm: false }, tag + ": the app's settings");
      assert.strictEqual(st.raw, null, tag + ": a first visit writes no settings record");
    }
  });
});

test("first paint without JavaScript: def's light background in both colour schemes", { timeout: 180000 }, async (t) => {
  await withBrowser(t, async (br, base) => {
    for (const scheme of ["dark", "light"]) for (const where of PAGES.concat(["/about/", "/404.html"])) {
      const st = await load(br, base, where, { scheme, js: false });
      assert.strictEqual(hex(st.body), DEF_LIGHT[0], where + " (" + scheme + " device, no JS): background");
      // the legal pages carry no theme-color meta
      if (where !== "/about/") assert.strictEqual(String(st.meta).toUpperCase(), DEF_LIGHT[0], where + " (" + scheme + " device, no JS): theme-color");
    }
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, "manifest.json"), "utf8"));
  assert.strictEqual(manifest.theme_color.toUpperCase(), DEF_LIGHT[0], "manifest theme_color");
  assert.strictEqual(manifest.background_color.toUpperCase(), DEF_LIGHT[0], "manifest background_color");
  const sw = fs.readFileSync(path.join(PUBLIC, "sw.js"), "utf8");
  const offline = sw.slice(sw.indexOf("const OFFLINE_HTML"), sw.indexOf("\n", sw.indexOf("const OFFLINE_HTML")));
  assert.ok(offline.includes('content="#F2F0E8"') && offline.includes("background:#F2F0E8"), "the service worker's offline page uses def's light background");
});

test("first visit with reduced motion: stop-motion still follows the device", { timeout: 180000 }, async (t) => {
  await withBrowser(t, async (br, base) => {
    for (const where of PAGES) {
      const st = await load(br, base, where, { scheme: "dark", motion: "reduce" });
      assert.strictEqual(st.cm, true, where + ": stop-motion on");
      assert.strictEqual(st.bg.toUpperCase(), DEF_LIGHT[0], where + ": still glass + light + def");
      if (where === "/#/") assert.deepStrictEqual(st.app, { mode: "light", pal: "def", style: "glass", cm: true }, where + ": the app's settings");
    }
  });
});

test("a saved choice wins: dark + lav stays dark + lav; a saved auto still follows the device", { timeout: 180000 }, async (t) => {
  await withBrowser(t, async (br, base) => {
    for (const scheme of ["dark", "light"]) for (const where of PAGES) {
      const tag = where + " (" + scheme + " device)";
      const st = await load(br, base, where, { scheme, saved: { mode: "dark", pal: "lav" } });
      assert.strictEqual(st.bg.toUpperCase(), LAV_DARK, tag + ": painted in lav's night background");
      assert.strictEqual(String(st.meta).toUpperCase(), LAV_DARK, tag + ": theme-color");
      if (where !== "/#/") assert.strictEqual(st.dk, true, tag + ": night (.dk on the static pages)");
      if (where === "/#/") assert.deepStrictEqual([st.app.mode, st.app.pal], ["dark", "lav"], tag + ": the app's settings");
      const rec = JSON.parse(st.raw);
      assert.deepStrictEqual([rec.mode, rec.pal], ["dark", "lav"], tag + ": the saved record keeps its choice");
      const auto = await load(br, base, where, { scheme, saved: { mode: "auto", pal: "neo", sv: 2 } });
      assert.strictEqual(auto.bg.toUpperCase(), scheme === "dark" ? NEO_DARK : NEO_LIGHT, tag + ": a saved auto follows the device");
    }
  });
});
