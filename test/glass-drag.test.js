"use strict";
/*
 * glass-drag.test.js - the glass-strength slider while it is dragged (the iPhone lag fix).
 *
 * While a pointer drags the slider, the four glass variables (--bl --sat --gb --gbr) are written only on the sheet
 * panel, scoped on that element (the slider's pill inside it follows). The former preview switch ?gd is gone: a ?gd=pill
 * URL behaves the same.
 * The page itself (the <html> variables and every other glass surface) keeps its values until the release; then they
 * are written once on the whole page, the scoped values are removed and the setting is saved, exactly as a change
 * always did. Closing the sheet during a drag does the same. Keyboard steps apply to the whole page at each step.
 *
 * ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PUBLIC = path.resolve(__dirname, "..", "public");

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

// the state that matters: root variables, inline (scoped) variables on the sheet's glass, a page glass surface's
// backdrop, the slider value and the saved record
const STATE = () => {
  const r = document.documentElement.style, inl = (el) => (el ? ["--bl", "--sat", "--gb", "--gbr"].map((k) => el.style.getPropertyValue(k)).join("|") : null);
  const pageGlass = [...document.querySelectorAll("#app .g")].find((e) => getComputedStyle(e).backdropFilter !== "none");
  return {
    root: ["--bl", "--sat", "--gb", "--gbr"].map((k) => r.getPropertyValue(k)).join("|"),
    sheet: inl(document.querySelector("#sh .p")), pill: inl(document.querySelector("#sh .gs.g")),
    sheetBlur: getComputedStyle(document.querySelector("#sh .p")).backdropFilter,
    pillBlur: getComputedStyle(document.querySelector("#sh .gs.g")).backdropFilter,
    pageBlur: pageGlass ? getComputedStyle(pageGlass).backdropFilter : null,
    value: +document.getElementById("gs").value,
    saved: JSON.parse(localStorage.getItem("gq-set") || "{}"),
  };
};

test("glass slider drag: only the sheet's glass follows; the page updates once on release", { timeout: 180000 }, async (t) => {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let br;
  try { br = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return; }
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    for (const gd of ["", "pill"]) {
      const mode = "sheet", tag = "gd=" + (gd || "(none)");
      const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
      await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("s")) { sessionStorage.setItem("s", "1"); localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-set", JSON.stringify({ mode: "dark", pal: "neo", gl: 50, gv: 3, sv: 2, style: "glass", cm: true, snd: false })); } } catch (e) {} });
      const p = await ctx.newPage();
      await p.goto(base + "/" + (gd ? "?gd=" + gd : "") + "#/", { waitUntil: "load" });
      await p.waitForSelector("#app .acts");
      // GQ_THEME's mapping, from the page itself
      const W = async (v) => p.evaluate((v) => { const g = GQT.glass(v, true), a = (x) => "rgba(255,255,255," + x + ")"; return [g.bl, g.sat, a(g.gb), a(g.gbr)].join("|"); }, v);
      const w50 = await W(50);
      const openSheet = async () => { await p.click('[data-a="set"]'); await p.waitForSelector("#gs", { state: "visible" }); await p.waitForTimeout(400); };
      await openSheet();
      let s = await p.evaluate(STATE);
      assert.strictEqual(s.root, w50, tag + ": before the drag the page has 50");
      // a pointer drag from the thumb to one end of the track
      const box = await p.$eval("#gs", (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
      await p.mouse.move(box.x + box.w / 2, box.y);
      await p.mouse.down();
      await p.mouse.move(box.x + box.w * 0.3, box.y, { steps: 5 });
      await p.mouse.move(box.x + 2, box.y, { steps: 5 });
      await p.waitForTimeout(100);
      s = await p.evaluate(STATE);
      assert.ok(s.value === 0 || s.value === 100, tag + ": the drag reached the end (" + s.value + ")");
      const wEnd = await W(s.value);
      assert.strictEqual(s.root, w50, tag + ": during the drag the page's variables are unchanged");
      assert.ok(s.pageBlur && s.pageBlur.includes("blur(22px)"), tag + ": during the drag a page glass surface keeps blur 22px (" + s.pageBlur + ")");
      assert.strictEqual(s.saved.gl, 50, tag + ": nothing is saved during the drag");
      if (mode === "sheet") {
        assert.strictEqual(s.sheet, wEnd, tag + ": the sheet panel carries the dragged values");
        assert.ok(!s.pill.replace(/\|/g, ""), tag + ": the pill inherits them (no values of its own)");
        assert.ok(s.sheetBlur.includes("blur(" + wEnd.split("|")[0] + ")") && s.pillBlur.includes("blur(" + wEnd.split("|")[0] + ")"), tag + ": panel and pill show the dragged blur");
      } else {
        assert.strictEqual(s.pill, wEnd, tag + ": the pill carries the dragged values");
        assert.ok(!s.sheet.replace(/\|/g, ""), tag + ": the sheet panel keeps the page's values");
        assert.ok(s.pillBlur.includes("blur(" + wEnd.split("|")[0] + ")") && s.sheetBlur.includes("blur(22px)"), tag + ": only the pill shows the dragged blur");
      }
      // release: the whole page once, scoped values gone, saved
      await p.mouse.up();
      await p.waitForTimeout(150);
      s = await p.evaluate(STATE);
      assert.strictEqual(s.root, wEnd, tag + ": after the release the page has the dragged values");
      assert.ok(!s.sheet.replace(/\|/g, "") && !s.pill.replace(/\|/g, ""), tag + ": no scoped values remain");
      assert.ok(s.pageBlur.includes("blur(" + wEnd.split("|")[0] + ")"), tag + ": the page's glass shows the new blur");
      assert.deepStrictEqual([s.saved.gl, s.saved.gv], [s.value, 3], tag + ": saved as before");
      // keyboard: each step is the whole page at once
      await p.focus("#gs");
      await p.keyboard.press(s.value === 0 ? "ArrowUp" : "ArrowDown");
      await p.waitForTimeout(100);
      const k = await p.evaluate(STATE);
      assert.notStrictEqual(k.value, s.value, tag + ": the key moved the slider");
      assert.strictEqual(k.root, await W(k.value), tag + ": a keyboard step applies to the whole page");
      assert.ok(!k.sheet.replace(/\|/g, "") && !k.pill.replace(/\|/g, ""), tag + ": no scoped values for a keyboard step");
      // the sheet closes during a drag: the page gets the values once and they are saved
      await p.mouse.move(box.x + box.w / 2, box.y);
      await p.mouse.down();
      await p.mouse.move(box.x + box.w * 0.7, box.y, { steps: 4 });
      await p.waitForTimeout(80);
      const mid = await p.evaluate(STATE);
      await p.evaluate(() => closeSh());
      await p.waitForTimeout(100);
      const c = await p.evaluate(() => ({ root: ["--bl", "--sat", "--gb", "--gbr"].map((k) => document.documentElement.style.getPropertyValue(k)).join("|"), saved: JSON.parse(localStorage.getItem("gq-set")), v: +document.getElementById("gs").value, scoped: [...document.querySelectorAll("#sh .p,#sh .gs.g")].some((e) => e.style.getPropertyValue("--bl")) }));
      await p.mouse.up();
      assert.strictEqual(c.root, await W(mid.value), tag + ": closing the sheet mid-drag applies the value to the page");
      assert.strictEqual(c.saved.gl, mid.value, tag + ": and saves it");
      assert.ok(!c.scoped, tag + ": and removes the scoped values");
      await ctx.close();
    }
  } finally {
    await br.close();
    await new Promise((r) => server.close(r));
  }
});
