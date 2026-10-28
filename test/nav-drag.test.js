"use strict";
/*
 * nav-drag.test.js - the bottom nav's drag-to-switch follows the finger smoothly whatever the touch cadence.
 *
 * Drives the drag in Chromium with pointer events whose timeStamp is the time the finger was there (as a phone gives
 * them), the finger moving at constant speed, and samples the indicator every frame:
 *   - touches every 2nd frame and in irregular bunches: no frame without movement, step-size CV <= 0.1;
 *   - the finger stops: the indicator ends exactly under it (it does not stay ahead);
 *   - the release opens the tab under the real last finger position, even though the indicator is drawn a little
 *     behind it;
 *   - reduced motion: no stretch (scale stays 1).
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

// in the page: a drag from the home tab towards the last tab at `speed` px/ms with the given per-frame pattern of
// touch events; `stopAt` (0..1 of the way) stops the finger and holds it for 20 frames; `release` lifts it at the end
const DRAG = async ([pattern, speed, stopAt, release]) => {
  const nv = document.getElementById("nv"), ind = nv.querySelector(".ind"), ts = [...nv.querySelectorAll(".t")].map((t) => t.getBoundingClientRect());
  const y = ts[0].top + ts[0].height / 2, x0 = ts[0].left + ts[0].width / 2, x1 = ts[ts.length - 1].left + ts[ts.length - 1].width / 2, dir = Math.sign(x1 - x0);
  const mk = (type, x, t) => { const e = new PointerEvent(type, { pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }); Object.defineProperty(e, "timeStamp", { value: t }); return e; };
  const raf = () => new Promise((r) => requestAnimationFrame(r));
  const end = stopAt ? x0 + (x1 - x0) * stopAt : x1;
  let t = await raf();
  nv.dispatchEvent(mk("pointerdown", x0, t));
  const t0 = t, fx = (tt) => { const x = x0 + dir * speed * (tt - t0); return dir * (x - end) > 0 ? end : x; };
  let last = t0, prevT = t, i = 0, x = x0;
  const out = [];
  while (true) {
    t = await raf();
    const b = ind.getBoundingClientRect(), m = new DOMMatrix(getComputedStyle(ind).transform);
    out.push({ cx: b.left + b.width / 2, sx: m.a, finger: fx(prevT), drag: nv.classList.contains("drag") });
    const n = pattern[i++ % pattern.length];
    for (let k = 0; k < n; k++) { const tk = last + ((k + 1) * (t - last)) / n; x = fx(tk); nv.dispatchEvent(mk("pointermove", x, tk)); }
    if (n) last = t;
    prevT = t;
    if (fx(t) === end) break;
  }
  const hold = [];
  if (stopAt) for (let k = 0; k < 20; k++) { await raf(); const b = ind.getBoundingClientRect(); hold.push(b.left + b.width / 2 - x); } // x: the newest position the page received
  const st = out.filter((o) => o.drag && dir * (o.finger - x0) > 40 && dir * (end - o.finger) > 40);
  const steps = []; for (let k = 1; k < st.length; k++) steps.push(Math.abs(st[k].cx - st[k - 1].cx));
  const mean = (a) => a.reduce((s, v) => s + v, 0) / (a.length || 1), mu = mean(steps), sd = Math.sqrt(mean(steps.map((v) => (v - mu) ** 2)));
  const before = location.hash;
  if (release) nv.dispatchEvent(mk("pointerup", end, performance.now()));
  await raf(); await raf();
  return { stalled: steps.filter((v) => v < 0.05).length, steps: steps.length, cv: sd / (mu || 1), maxScale: Math.max(...out.map((o) => o.sx)), holdEnd: hold.length ? hold[hold.length - 1] : null, before, after: location.hash };
};

test("nav drag-to-switch: smooth at any touch cadence, rests under a still finger, opens the tab under the finger", { timeout: 180000 }, async (t) => {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let br;
  try { br = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return; }
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const open = async (reduced) => {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: reduced ? "reduce" : "no-preference" });
    await ctx.addInitScript(() => { try { localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-set", JSON.stringify({ mode: "dark", pal: "neo", gl: 50, gv: 3, sv: 2, style: "glass", cm: false, snd: false })); } catch (e) {} });
    const p = await ctx.newPage();
    await p.goto(base + "/#/", { waitUntil: "load" });
    await p.waitForSelector("#nv a.t"); await p.waitForTimeout(600);
    return { ctx, p };
  };
  try {
    for (const [name, pattern] of [["every 2nd frame", [1, 0]], ["irregular bunches", [1, 0, 2, 0, 0, 3, 1, 0, 1, 2, 0, 1]]]) {
      const { ctx, p } = await open(false);
      const r = await p.evaluate(DRAG, [pattern, 0.3, 0, false]);
      assert.ok(r.steps > 20, name + ": enough frames measured (" + r.steps + ")");
      assert.strictEqual(r.stalled, 0, name + ": no frame without movement");
      assert.ok(r.cv <= 0.1, name + ": step-size CV " + r.cv.toFixed(3) + " <= 0.1");
      assert.ok(r.maxScale > 1.01, name + ": the stretch still shows while moving");
      await ctx.close();
    }
    {
      const { ctx, p } = await open(false);
      const r = await p.evaluate(DRAG, [[1, 0], 0.3, 0.5, false]);
      assert.ok(Math.abs(r.holdEnd) < 0.5, "a still finger has the indicator under it (" + r.holdEnd.toFixed(2) + "px)");
      await ctx.close();
    }
    {
      // fast drag to the 3rd tab and release at once: the indicator is still behind, the finger is on the 3rd tab
      const { ctx, p } = await open(false);
      const r = await p.evaluate(DRAG, [[1], 1.2, 0.67, true]);
      assert.strictEqual(r.before, "#/");
      assert.strictEqual(r.after, "#/challenge", "the release opens the tab under the finger");
      await ctx.close();
    }
    {
      const { ctx, p } = await open(true);
      const r = await p.evaluate(DRAG, [[1], 0.3, 0, false]);
      assert.ok(Math.abs(r.maxScale - 1) < 1e-6, "reduced motion: no stretch (" + r.maxScale + ")");
      await ctx.close();
    }
  } finally {
    await br.close();
    await new Promise((r) => server.close(r));
  }
});
