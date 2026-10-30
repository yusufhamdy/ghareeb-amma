// Bottom navigation performance (the iPhone report: the floating nav feels heavy).
//   node nav-perf.js [root] [label] [--runs 3] [--cpu 4] [--variant base|no-nav-blur|no-blob-anim|no-blobs|no-glass-blur]
//   node nav-perf.js [root] [label] --only cadence|clocks [--browser chromium|webkit] [--query "?x=y"]
// Same setup as slider-perf.js: Chromium, mobile emulation (390x844, touch, 3x), CPU throttled, glass + dark + neo.
// Scenarios, each traced on its own:
//   scroll-home, scroll-surahs, scroll-surah78: real touch swipes (Input.dispatchTouchEvent at 60Hz; Chromium's synthesized
//     scroll gestures do not scroll in headless mode), four 400px swipes down, then six back up to the top - the nav
//     hides on the way down and returns on the way up (counted);
//   tabs: real touch taps (Input.dispatchTouchEvent) on each tab in turn (home, surahs, challenge, quiz, and around again),
//     800ms apart - the indicator slide, the icon motion and the page change;
//   drag: the drag-to-switch (3e15a9c): a real touch drag along the nav at 60Hz from the home tab to the last tab and
//     back, then release - the indicator follows the finger with its stretch, the labels preview (.pv), and the release
//     opens the tab under the finger.
// Per scenario: frame intervals from requestAnimationFrame (median, p95, worst, frames over 33ms), long tasks, and per
// frame from the DevTools trace: style recalc, layout, paint, composite (main thread), raster + GPU (all threads), and the
// number of Layout events and Paint events per frame. DUMP=1 prints which nodes painted (Paint events by node). --variant switches one suspect off (diagnosis only, never a fix): the nav's backdrop-filter,
// the background blobs' animation, the blobs themselves, or every backdrop-filter.
const { serve } = require("./lib.js");
const { chromium, webkit } = require("playwright");
const path = require("path");

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const ROOT = pos[0] || path.resolve(__dirname, "../../public");
const LABEL = pos[1] || "current";
const RUNS = +opt("--runs", "3"), CPU = +opt("--cpu", "4"), VARIANT = opt("--variant", "base");
const ONLY = opt("--only", "");
// --browser webkit: Playwright WebKit (the engine of Safari; on Windows not the iPhone's graphics stack, so only the
// input and timing logic carry over, not the frame costs). The traced scenarios need Chromium (CDP); cadence and clocks
// run in both.
const BROWSER = opt("--browser", "chromium");
const VCSS = {
  base: "",
  "no-nav-blur": "nav.g{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}",
  "no-blob-anim": "#bg i{animation:none!important}",
  "no-blobs": "#bg{display:none!important}",
  "no-glass-blur": "*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}",
  "ind-layer": "nav.g .ind{will-change:transform}",
};
const CATS = ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "blink", "cc", "gpu", "toplevel"].join(",");
const BUCKET = {
  style: ["UpdateLayoutTree", "RecalculateStyles"],
  layout: ["Layout"],
  paint: ["PrePaint", "Paint", "PaintImage", "UpdateLayer"],
  composite: ["Layerize", "Commit", "CompositeLayers"],
  script: ["FunctionCall", "EvaluateScript", "EventDispatch", "TimerFire", "FireAnimationFrame"],
};
const RASTER = /^(RasterTask|GPUTask|TileManager::FlushAndIssueSignals|SkiaGpuRasterTask|GpuChannel::ExecuteDeferredRequest)$/;
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };

async function scenario(br, base, name) {
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: "no-preference" });
  await ctx.addInitScript(() => { try { localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-set", JSON.stringify({ mode: "dark", pal: "neo", gl: 50, gv: 3, sv: 2, style: "glass", cm: false, snd: false })); } catch (e) {} });
  if (VCSS[VARIANT]) await ctx.addInitScript((css) => { document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); }); }, VCSS[VARIANT]);
  const p = await ctx.newPage();
  const route = { "scroll-home": "/#/", "scroll-surahs": "/#/surahs", "scroll-surah78": "/#/surah/78", tabs: "/#/", drag: "/#/" }[name];
  await p.goto(base + route, { waitUntil: "load" });
  await p.waitForSelector("#nv a.t", { timeout: 30000 });
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1200);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  await p.evaluate(() => {
    window.__f = []; window.__lt = []; window.__run = true; window.__hid = 0; window.__shown = 0;
    const loop = (t) => { if (!window.__run) return; window.__f.push(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: "longtask" }); } catch (e) {}
    new MutationObserver(() => { const h = document.getElementById("nv").classList.contains("hide"); if (h) window.__hid++; else window.__shown++; }).observe(document.getElementById("nv"), { attributes: true, attributeFilter: ["class"] });
  });
  const tr = [];
  cdp.on("Tracing.dataCollected", (d) => tr.push(...d.value));
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.start", { categories: CATS, transferMode: "ReportEvents" });
  const t0 = await p.evaluate(() => performance.now());
  if (name === "drag") {
    const tabs = await p.$$eval("#nv a.t", (as) => as.map((a) => { const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
    const xs = tabs.map((t) => t.x), y = tabs[0].y, from = xs[0], to = xs[xs.length - 1];
    const path = []; const n = 60;
    for (let i = 0; i <= n; i++) path.push(from + ((to - from) * i) / n);
    for (let i = n; i >= 0; i--) path.push(from + ((to - from) * i) / n);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y, id: 1 }] });
    const t0d = Date.now();
    for (let i = 0; i < path.length; i++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: path[i], y, id: 1 }] });
      const w = t0d + (i + 1) * 16.7 - Date.now(); if (w > 0) await new Promise((r) => setTimeout(r, w));
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await new Promise((r) => setTimeout(r, 700));
  } else if (name === "tabs") {
    const tabs = await p.$$eval("#nv a.t", (as) => as.map((a) => { const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
    // home -> surahs -> challenge -> quiz -> home ..., the DOM order is RTL (first = home on the right)
    for (const i of [1, 2, 3, 0, 1, 2, 3, 0]) {
      const pt = tabs[i];
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: pt.x, y: pt.y, id: 1 }] });
      await new Promise((r) => setTimeout(r, 60));
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await new Promise((r) => setTimeout(r, 800));
    }
  } else {
    // real touch swipes: touchStart, a touchMove every ~16.7ms (60Hz) over 400px, touchEnd
    const swipe = async (y0, y1) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 195, y: y0, id: 1 }] });
      const n = 12, t = Date.now();
      for (let i = 1; i <= n; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 195, y: y0 + ((y1 - y0) * i) / n, id: 1 }] });
        const w = t + i * 16.7 - Date.now(); if (w > 0) await new Promise((r) => setTimeout(r, w));
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await new Promise((r) => setTimeout(r, 250));
    };
    for (let k = 0; k < 4; k++) await swipe(600, 200);
    await new Promise((r) => setTimeout(r, 500));
    for (let k = 0; k < 6; k++) await swipe(200, 600);
    await new Promise((r) => setTimeout(r, 500));
  }
  const t1 = await p.evaluate(() => performance.now());
  await cdp.send("Tracing.end"); await done;
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const res = await p.evaluate(([t0, t1]) => { window.__run = false; const f = window.__f.filter((t) => t >= t0 && t <= t1); const d = []; for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]); return { d, lt: window.__lt, hid: window.__hid, shown: window.__shown, y: scrollY, hash: location.hash }; }, [t0, t1]);
  await ctx.close();
  if (process.env.DUMP) { const ps = tr.filter((e) => e.name === "Paint" && e.ph === "X"); const by = {}; ps.forEach((e) => { const d = (e.args && e.args.data) || {}; const k = d.nodeName + " #" + d.nodeId; by[k] = (by[k] || 0) + 1; }); console.log("PAINTS", JSON.stringify(by), JSON.stringify(ps[0] && ps[0].args)); }
  const main = new Set();
  for (const e of tr) if (e.name === "thread_name" && e.args && e.args.name === "CrRendererMain") main.add(e.pid + ":" + e.tid);
  const xs = tr.filter((e) => e.ph === "X" && main.has(e.pid + ":" + e.tid));
  const frames = res.d.length || 1, sum = {};
  for (const [k, names] of Object.entries(BUCKET)) sum[k] = xs.filter((e) => names.includes(e.name)).reduce((s, e) => s + (e.dur || 0), 0) / 1000;
  sum.rasterGpu = tr.filter((e) => e.ph === "X" && RASTER.test(e.name)).reduce((s, e) => s + (e.dur || 0), 0) / 1000;
  return {
    scenario: name, frames: res.d.length, medianMs: +med(res.d).toFixed(1), p95Ms: +pct(res.d, 0.95).toFixed(1), worstMs: +Math.max(0, ...res.d).toFixed(1), over33: res.d.filter((x) => x > 33.4).length,
    longTasks: res.lt.length, layouts: xs.filter((e) => e.name === "Layout").length, paints: xs.filter((e) => e.name === "Paint").length, paintsPerFrame: +(xs.filter((e) => e.name === "Paint").length / frames).toFixed(2), navHid: res.hid, navShown: res.shown,
    perFrame: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, +(v / frames).toFixed(2)])),
  };
}

// ---- cadence: how smoothly the drag-to-switch indicator follows a finger moving at constant speed, when touch input
// does not line up with frames. Drives the drag inside the page with pointer events whose timeStamp is set to the
// time the finger was at that point: per frame, the events of the pattern ([1] every frame, [1,0] every 2nd frame,
// the irregular bunches, spread between the previous sample and the frame). Samples the indicator (bounding-box centre
// and transform scale) at every frame, and reports over the steady part of the drag: % of frames that did not move
// while the finger did, the CV of the step size, the mean |change of scale x| per frame, and the lag (px, ms).
// Also lists every CSS transition or animation that starts on the labels or icons during the drag (there should be
// none until the release).
const CADENCES = { "every-frame": [1], "every-2nd": [1, 0], bunches: [1, 0, 2, 0, 0, 3, 1, 0, 1, 2, 0, 1] };
async function cadence(br, base, name, query) {
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: "no-preference" });
  await ctx.addInitScript(() => { try { localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-set", JSON.stringify({ mode: "dark", pal: "neo", gl: 50, gv: 3, sv: 2, style: "glass", cm: false, snd: false })); } catch (e) {} });
  const p = await ctx.newPage();
  await p.goto(base + "/" + (query || "") + "#/", { waitUntil: "load" });
  await p.waitForSelector("#nv a.t"); await p.evaluate(() => document.fonts.ready);
  // Playwright WebKit on Windows draws the page's blurred background blobs in software at ~400ms a frame (15ms without
  // them), which would make every frame a drop; they are behind everything and play no part in the drag, so hide them
  if (BROWSER === "webkit") await p.addStyleTag({ content: "#bg{display:none!important}" });
  await p.waitForTimeout(1000);
  const r = await p.evaluate(async ([pattern, speed]) => {
    const nv = document.getElementById("nv"), ind = nv.querySelector(".ind"), ts = [...nv.querySelectorAll(".t")].map((t) => t.getBoundingClientRect());
    const y = ts[0].top + ts[0].height / 2, x0 = ts[0].left + ts[0].width / 2, x1 = ts[ts.length - 1].left + ts[ts.length - 1].width / 2, dir = Math.sign(x1 - x0);
    const mk = (type, x, t) => { const e = new PointerEvent(type, { pointerId: 7, pointerType: "touch", isPrimary: true, clientX: x, clientY: y, bubbles: true, cancelable: true }); if (t != null) Object.defineProperty(e, "timeStamp", { value: t }); return e; };
    const raf = () => new Promise((res) => requestAnimationFrame(res));
    const seen = new Set(), started = [];
    const watch = () => { for (const a of document.getAnimations()) { if (seen.has(a)) continue; seen.add(a); const el = a.effect && a.effect.target; if (el && el.closest && el.closest("#nv .t")) started.push((a.transitionProperty ? "transition " + a.transitionProperty : "animation " + (a.animationName || "?")) + " on " + el.tagName.toLowerCase() + "." + [...(el.classList || [])].join(".")); } };
    document.getAnimations().forEach((a) => seen.add(a));
    let t = await raf();
    nv.dispatchEvent(mk("pointerdown", x0, t));
    const t0 = t, fx = (tt) => x0 + dir * speed * (tt - t0);
    let last = t0, prevT = t, i = 0;
    const out = [];
    while (true) {
      t = await raf();
      const b = ind.getBoundingClientRect(), m = new DOMMatrix(getComputedStyle(ind).transform);
      out.push({ cx: b.left + b.width / 2, sx: m.a, finger: fx(prevT), drag: nv.classList.contains("drag") });
      watch();
      const n = pattern[i++ % pattern.length];
      for (let k = 0; k < n; k++) { const tk = last + ((k + 1) * (t - last)) / n; nv.dispatchEvent(mk("pointermove", fx(tk), tk)); }
      if (n) last = t;
      prevT = t;
      if (dir * (fx(t) - x1) > 0) break;
    }
    for (let k = 0; k < 20; k++) { await raf(); watch(); }
    const beforeUp = started.slice();
    nv.dispatchEvent(mk("pointerup", fx(last), performance.now()));
    // steady part: the finger at least 40px inside both ends, the drag active
    const st = out.filter((o) => o.drag && dir * (o.finger - x0) > 40 && dir * (x1 - o.finger) > 40);
    const steps = [], ds = [];
    for (let k = 1; k < st.length; k++) { steps.push(Math.abs(st[k].cx - st[k - 1].cx)); ds.push(Math.abs(st[k].sx - st[k - 1].sx)); }
    const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
    const mu = mean(steps), sd = Math.sqrt(mean(steps.map((x) => (x - mu) ** 2)));
    const lag = mean(st.map((o) => dir * (o.finger - o.cx)));
    return { frames: st.length, stalledPct: +((100 * steps.filter((x) => x < 0.05).length) / (steps.length || 1)).toFixed(1), stepCV: +(sd / (mu || 1)).toFixed(2), meanStepPx: +mu.toFixed(2), meanDScale: +mean(ds).toFixed(4), lagPx: +lag.toFixed(1), lagMs: +(lag / speed).toFixed(1), startedDuringDrag: beforeUp };
  }, [CADENCES[name], 0.3]);
  await ctx.close();
  return r;
}

// ---- clocks: real input (Playwright's own mouse moves and touch taps, not synthetic events) - is each event's timeStamp
// on the same clock as performance.now() and the requestAnimationFrame timestamp, and does getCoalescedEvents exist?
async function clocks(br, base) {
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await ctx.addInitScript(() => { try { localStorage.setItem("gq-ld", "1"); } catch (e) {} });
  const p = await ctx.newPage();
  await p.goto(base + "/#/", { waitUntil: "load" });
  await p.waitForSelector("#nv a.t"); await p.waitForTimeout(500);
  await p.evaluate(() => {
    const L = (window.__clk = { ev: {}, raf: [], gce: typeof PointerEvent !== "undefined" && typeof PointerEvent.prototype.getCoalescedEvents === "function", coalesced: [] });
    for (const type of ["pointerdown", "pointermove", "pointerup", "touchstart", "touchend", "mousemove"]) addEventListener(type, (e) => { const n = performance.now(); (L.ev[type + (e.pointerType ? ":" + e.pointerType : "")] ||= []).push(e.timeStamp - n); if (type === "pointermove" && e.getCoalescedEvents) L.coalesced.push(e.getCoalescedEvents().length); }, { capture: true, passive: true });
    let k = 0; const f = (t) => { L.raf.push(t - performance.now()); if (++k < 60) requestAnimationFrame(f); }; requestAnimationFrame(f);
  });
  for (let i = 0; i < 30; i++) await p.mouse.move(40 + i * 10, 300);
  for (let i = 0; i < 4; i++) await p.touchscreen.tap(100 + i * 40, 400);
  await p.waitForTimeout(1200);
  const L = await p.evaluate(() => window.__clk);
  await ctx.close();
  const sm = (a) => (a.length ? { n: a.length, median: +med(a).toFixed(2), min: +Math.min(...a).toFixed(2), max: +Math.max(...a).toFixed(2) } : null);
  return { timeStampMinusNow: Object.fromEntries(Object.entries(L.ev).map(([k, a]) => [k, sm(a)])), rafMinusNow: sm(L.raf), getCoalescedEvents: L.gce, coalescedPerMove: sm(L.coalesced) };
}

(async () => {
  const { server, base } = await serve(ROOT);
  const br = await (BROWSER === "webkit" ? webkit : chromium).launch();
  if (ONLY === "clocks") {
    console.log(LABEL + " " + BROWSER + " clocks " + JSON.stringify(await clocks(br, base)));
    await br.close(); server.close();
    return;
  }
  if (ONLY === "cadence") {
    for (const c of Object.keys(CADENCES)) {
      const r = await cadence(br, base, c, opt("--query", ""));
      console.log(LABEL + " " + BROWSER + " cadence " + c.padEnd(12) + " " + JSON.stringify(r));
    }
    await br.close(); server.close();
    return;
  }
  const all = {};
  for (const s of ["scroll-home", "scroll-surahs", "scroll-surah78", "tabs", "drag"].filter((s) => !ONLY || s === ONLY)) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await scenario(br, base, s));
    const m = (f) => med(runs.map(f));
    all[s] = { medianMs: m((r) => r.medianMs), p95Ms: m((r) => r.p95Ms), worstMs: m((r) => r.worstMs), over33: m((r) => r.over33), longTasks: m((r) => r.longTasks), layouts: m((r) => r.layouts), paintsPerFrame: m((r) => r.paintsPerFrame), navHid: m((r) => r.navHid), navShown: m((r) => r.navShown),
      perFrame: Object.fromEntries(Object.keys(runs[0].perFrame).map((k) => [k, m((r) => r.perFrame[k])])) };
    console.log(LABEL + " " + VARIANT + " " + s + " " + JSON.stringify(all[s]));
  }
  await br.close(); server.close();
  console.log("SUMMARY " + JSON.stringify({ label: LABEL, variant: VARIANT, scenarios: all }));
})();
