"use strict";
/*
 * settings-migration.test.js - the saved settings record ("gq-set") in a real browser, in the app and on a static
 * page (theme-boot.js, before first paint).
 *
 * The old site (main d4405a7) saved its whole settings record, palette included, only when the visitor changed a
 * setting; its default palette "def" was blue at night and is now neo, and "def" is the green palette. On load, a
 * record saved before the settings version (sv 2) is moved to it once and saved back: "def" becomes "neo". Cases:
 *   - old def -> neo (painted in neo, saved back with sv 2);
 *   - old neo -> neo; old min -> the green palette ("def"), as before;
 *   - no saved settings -> neo, and nothing is written;
 *   - def saved after the release (sv 2) -> stays green, also after a reload.
 *
 * ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PUBLIC = path.resolve(__dirname, "..", "public");
const NEO_DARK = "#0A0E1F", GREEN_DARK = "#07140F";

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

const CASES = [
  { name: "old def", saved: { mode: "dark", pal: "def", gl: 3, cm: false, snd: true, style: "glass" }, pal: "neo", bg: NEO_DARK, written: true },
  { name: "old neo", saved: { mode: "dark", pal: "neo", gl: 3, gv: 2, cm: false, snd: true, style: "glass" }, pal: "neo", bg: NEO_DARK, written: true },
  { name: "old min", saved: { mode: "dark", pal: "min", gl: 3, cm: false, snd: true, style: "glass" }, pal: "def", bg: GREEN_DARK, written: true },
  { name: "no saved settings", saved: null, pal: "neo", bg: NEO_DARK, written: false },
  { name: "def saved after the release", saved: { mode: "dark", pal: "def", gl: 50, gv: 3, sv: 2, cm: false, snd: true, style: "glass" }, pal: "def", bg: GREEN_DARK, written: false },
];

test("saved settings: the old default becomes neo once; a later green choice stays", { timeout: 180000 }, async (t) => {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let br;
  try { br = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return; }
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    for (const c of CASES) for (const where of ["/#/", "/word/an-nas-4.html"]) {
      const ctx = await br.newContext({ viewport: { width: 400, height: 800 }, colorScheme: "dark" });
      // the record is put in place once, before the first load (not on reloads)
      await ctx.addInitScript((s) => { try { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.clear(); if (s) localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); } } catch (e) {} }, c.saved);
      const p = await ctx.newPage();
      const tag = c.name + " on " + where;
      for (const pass of ["first load", "reload"]) {
        if (pass === "first load") await p.goto(base + where, { waitUntil: "load" }); else await p.reload({ waitUntil: "load" });
        await p.waitForTimeout(300);
        const st = await p.evaluate(() => ({ bg: document.documentElement.style.getPropertyValue("--bg"), meta: (document.querySelector('meta[name="theme-color"]') || {}).content, raw: localStorage.getItem("gq-set") }));
        assert.strictEqual(st.bg.toUpperCase(), c.bg, tag + " (" + pass + "): painted in " + c.pal);
        assert.strictEqual(String(st.meta).toUpperCase(), c.bg, tag + " (" + pass + "): theme-color");
        if (c.written) {
          const rec = JSON.parse(st.raw);
          assert.strictEqual(rec.sv, 2, tag + ": saved back with the settings version");
          assert.strictEqual(rec.pal, c.saved.pal === "def" ? "neo" : c.saved.pal, tag + ": the saved palette");
          for (const k of Object.keys(c.saved)) if (k !== "pal") assert.deepStrictEqual(rec[k], c.saved[k], tag + ": " + k + " kept as saved");
        } else {
          assert.strictEqual(st.raw, c.saved ? JSON.stringify(c.saved) : null, tag + ": nothing written");
        }
      }
      await ctx.close();
    }
    // a visitor upgraded from the old default then picks the green palette in the settings: it stays green
    const ctx = await br.newContext({ viewport: { width: 400, height: 800 }, colorScheme: "dark" });
    await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.clear(); localStorage.setItem("gq-set", JSON.stringify({ mode: "dark", pal: "def", gl: 3, style: "glass" })); localStorage.setItem("gq-ld", "1"); } } catch (e) {} });
    const p = await ctx.newPage();
    await p.goto(base + "/#/", { waitUntil: "load" });
    await p.click('[data-a="set"]');
    await p.click('#sh [data-p="def"]');
    await p.waitForTimeout(200);
    assert.strictEqual(JSON.parse(await p.evaluate(() => localStorage.getItem("gq-set"))).pal, "def");
    await p.reload({ waitUntil: "load" });
    await p.waitForTimeout(300);
    assert.strictEqual((await p.evaluate(() => document.documentElement.style.getPropertyValue("--bg"))).toUpperCase(), GREEN_DARK, "a green choice after the upgrade stays green");
    await p.goto(base + "/word/an-nas-4.html", { waitUntil: "load" });
    assert.strictEqual((await p.evaluate(() => document.documentElement.style.getPropertyValue("--bg"))).toUpperCase(), GREEN_DARK, "also on a static page");
    await ctx.close();
  } finally {
    await br.close();
    await new Promise((r) => server.close(r));
  }
});
