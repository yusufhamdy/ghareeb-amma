"use strict";
/*
 * preview-switches.test.js - PREVIEW-ONLY switches (delete this test together with them, before release):
 *   ?gs=a|b|c|d  the glass slider's drag variants: a (default) the sheet panel follows, b the slider's pill only, c the
 *                sheet panel's fill and rim only (--gb/--gbr), d nothing during the drag; every variant ends the same
 *                way on release (the whole page's variables, no scoped values, the same saved setting);
 *   ?nd=<ms>     the nav drag's delay; ?nd=0 the drawing before 322b2c0 (at the newest touch);
 *   ?nb=0 ?nl=0 ?ns=0  during the nav drag only: no backdrop blur on the nav, no label transition, no stretch;
 *   ?perf=1      the on-device readout (perf.js): after a drag, frames, moves, clocks, indicator, script and options
 *                lines; absent (and perf.js not loaded) without the parameter.
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

test("preview switches: slider variants end the same; nav isolation switches; the perf readout is opt-in", { timeout: 240000 }, async (t) => {
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
    // the nav switches and the perf readout: a touch drag (CDP, real input) from the home tab to the 3rd, held, then
    // the state mid-drag, then the release
    const drag = async (query) => {
      const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "no-preference" });
      await ctx.addInitScript(() => { try { localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-set", JSON.stringify({ mode: "dark", pal: "neo", gl: 50, gv: 3, sv: 2, style: "glass", cm: false, snd: false })); } catch (e) {} });
      const p = await ctx.newPage();
      await p.goto(base + "/" + query + "#/", { waitUntil: "load" }); await p.waitForSelector("#nv a.t"); await p.waitForTimeout(500);
      const tabs = await p.$$eval("#nv a.t", (as) => as.map((a) => { const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
      const cdp = await ctx.newCDPSession(p), y = tabs[0].y, from = tabs[0].x, to = tabs[2].x;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y, id: 1 }] });
      for (let i = 1; i <= 20; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from + ((to - from) * i) / 20, y, id: 1 }] }); await p.waitForTimeout(16); }
      await p.waitForTimeout(150);
      const mid = await p.evaluate(() => { const nv = document.getElementById("nv"), t = nv.querySelector(".t"), cs = getComputedStyle(nv); return { drag: nv.classList.contains("drag"), blur: cs.backdropFilter || cs.webkitBackdropFilter, tr: getComputedStyle(t).transitionDuration, ind: nv.querySelector(".ind").style.transform }; });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await p.waitForTimeout(300);
      const after = await p.evaluate(() => { const nv = document.getElementById("nv"), cs = getComputedStyle(nv); return { hash: location.hash, blur: cs.backdropFilter || cs.webkitBackdropFilter, tr: getComputedStyle(nv.querySelector(".t")).transitionDuration, perfJs: !!document.querySelector('script[src="/perf.js"]'), readout: [...document.body.children].map((e) => e.textContent || "").find((x) => /^(current|3e15a9c) /.test(x)) || null }; });
      await ctx.close();
      return { mid, after };
    };
    const def = await drag("");
    assert.ok(def.mid.drag && /blur/.test(def.mid.blur) && def.mid.tr !== "0s" && /scale\(/.test(def.mid.ind), "default: blur, label transition and stretch during the drag");
    assert.strictEqual(def.after.hash, "#/challenge", "default: the release opens the tab under the finger");
    assert.deepStrictEqual([def.after.perfJs, def.after.readout], [false, null], "no ?perf=1: perf.js not loaded, no readout");
    const off = await drag("?nb=0&nl=0&ns=0&perf=1");
    assert.ok(off.mid.drag, "switches: the drag runs");
    assert.ok(!/blur/.test(off.mid.blur), "?nb=0: no backdrop blur during the drag (" + off.mid.blur + ")");
    assert.strictEqual(off.mid.tr, "0s", "?nl=0: no label transition during the drag");
    assert.ok(/^translateX\([-\d.]+px\)$/.test(off.mid.ind), "?ns=0: translate only (" + off.mid.ind + ")");
    assert.strictEqual(off.after.hash, "#/challenge", "switches: the release opens the same tab");
    assert.strictEqual(off.after.blur, def.after.blur, "?nb=0: the blur is back after the drag");
    assert.strictEqual(off.after.tr, def.after.tr, "?nl=0: the transition is back after the drag");
    const lines = (off.after.readout || "").split(String.fromCharCode(10));
    assert.ok(/^current nd=24 nb=0 nl=0 ns=0 gs=a  FPS \d+$/.test(lines[0]), "readout: options line (" + lines[0] + ")");
    for (const [i, re] of [[1, /^nav drag  /], [2, /^frames \d+  med [\d.]+  worst [\d.]+  >20ms \d+  >34ms \d+$/], [3, /^moves \d+\/s  gap [\d.]+ms  coalesced ([\d.]+\/move|n\/a)$/], [4, /^clocks ts-now -?[\d.]+  rAF-now -?[\d.]+  age@frame -?[\d.]+ms$/], [5, /^indicator still \d+%  CV [\d.]+  \(\d+ frames\)$/], [6, /^script max [\d.]+ms\/frame  med [\d.]+$/]])
      assert.ok(re.test(lines[i] || ""), "readout line " + i + ": " + lines[i]);
    const old = await drag("?nd=0");
    assert.ok(old.mid.drag && /scale\(/.test(old.mid.ind), "?nd=0: the earlier drawing runs");
    assert.strictEqual(old.after.hash, "#/challenge", "?nd=0: the release opens the same tab");
  } finally {
    await br.close();
    await new Promise((r) => server.close(r));
  }
});
