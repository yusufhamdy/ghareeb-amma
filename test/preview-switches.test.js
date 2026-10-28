"use strict";
/*
 * preview-switches.test.js - PREVIEW-ONLY switches (delete this test together with them, before release):
 *   ?gs=a|b|c|d  the glass slider's drag variants: a (default) the sheet panel follows, b the slider's pill only, c the
 *                sheet panel's fill and rim only (--gb/--gbr), d nothing during the drag; every variant ends the same
 *                way on release (the whole page's variables, no scoped values, the same saved setting);
 *   ?nd=<ms>     the nav drag's delay override (read only by the drag code; no visible state to check here);
 *   ?perf=1      the on-device readout (live FPS, last drag's median and worst frame); absent without the parameter.
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

const STATE = () => {
  const v = (el) => (el ? ["--bl", "--sat", "--gb", "--gbr"].map((k) => el.style.getPropertyValue(k)) : null);
  return { root: v(document.documentElement).join("|"), sheet: v(document.querySelector("#sh .p")), pill: v(document.querySelector("#sh .gs.g")), value: +document.getElementById("gs").value, saved: JSON.parse(localStorage.getItem("gq-set") || "{}") };
};

test("preview switches: slider variants end the same; the perf readout is opt-in", { timeout: 240000 }, async (t) => {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let br;
  try { br = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return; }
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const ends = {};
  try {
    for (const gs of ["a", "b", "c", "d"]) {
      const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
      await ctx.addInitScript(() => { try { if (!sessionStorage.getItem("s")) { sessionStorage.setItem("s", "1"); localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-set", JSON.stringify({ mode: "dark", pal: "neo", gl: 50, gv: 3, sv: 2, style: "glass", cm: true, snd: false })); } } catch (e) {} });
      const p = await ctx.newPage();
      await p.goto(base + "/?gs=" + gs + "#/", { waitUntil: "load" });
      await p.waitForSelector("#app .acts");
      await p.click('[data-a="set"]'); await p.waitForSelector("#gs", { state: "visible" }); await p.waitForTimeout(400);
      const before = await p.evaluate(STATE);
      const box = await p.$eval("#gs", (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width }; });
      await p.mouse.move(box.x + box.w / 2, box.y); await p.mouse.down();
      await p.mouse.move(box.x + 2, box.y, { steps: 8 }); await p.waitForTimeout(100);
      const mid = await p.evaluate(STATE);
      assert.strictEqual(mid.root, before.root, "gs=" + gs + ": the page is unchanged during the drag");
      const has = (a) => a.map((x) => (x ? 1 : 0)).join("");
      const want = { a: ["1111", "0000"], b: ["0000", "1111"], c: ["0011", "0000"], d: ["0000", "0000"] }[gs];
      assert.deepStrictEqual([has(mid.sheet), has(mid.pill)], want, "gs=" + gs + ": scoped values during the drag (sheet, pill) as --bl --sat --gb --gbr");
      await p.mouse.up(); await p.waitForTimeout(150);
      const end = await p.evaluate(STATE);
      assert.strictEqual(has(end.sheet) + has(end.pill), "00000000", "gs=" + gs + ": no scoped values after the release");
      ends[gs] = { root: end.root, value: end.value, gl: end.saved.gl, gv: end.saved.gv };
      await ctx.close();
    }
    for (const gs of ["b", "c", "d"]) assert.deepStrictEqual(ends[gs], ends.a, "gs=" + gs + " ends exactly as the default");
    assert.notStrictEqual(ends.a.root, "", "the release wrote the page's variables");
    // the perf readout
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("gq-ld", "1"); } catch (e) {} });
    const p = await ctx.newPage();
    const probe = () => ({ readout: [...document.body.children].some((e) => /^FPS /.test(e.textContent || "")) });
    await p.goto(base + "/#/", { waitUntil: "load" }); await p.waitForSelector("#app .acts"); await p.waitForTimeout(300);
    assert.deepStrictEqual(await p.evaluate(probe), { readout: false }, "no switch: no readout");
    await p.goto(base + "/?perf=1&nd=17#/", { waitUntil: "load" }); await p.waitForSelector("#app .acts"); await p.waitForTimeout(300);
    assert.deepStrictEqual(await p.evaluate(probe), { readout: true }, "?perf=1: the readout");
    await ctx.close();
  } finally {
    await br.close();
    await new Promise((r) => server.close(r));
  }
});
