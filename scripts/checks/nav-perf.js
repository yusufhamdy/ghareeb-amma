// Bottom navigation performance (the iPhone report: the floating nav feels heavy).
//   node nav-perf.js [root] [label] [--runs 3] [--cpu 4] [--variant base|no-nav-blur|no-blob-anim|no-blobs|no-glass-blur]
// Same setup as slider-perf.js: Chromium, mobile emulation (390x844, touch, 3x), CPU throttled, glass + dark + neo.
// Scenarios, each traced on its own:
//   scroll-home, scroll-surahs, scroll-surah78: real touch swipes (Input.dispatchTouchEvent at 60Hz; Chromium's synthesized
//     scroll gestures do not scroll in headless mode), four 400px swipes down, then six back up to the top - the nav
//     hides on the way down and returns on the way up (counted);
//   tabs: real touch taps (Input.dispatchTouchEvent) on each tab in turn (home, surahs, challenge, quiz, and around again),
//     800ms apart - the indicator slide, the icon motion and the page change.
// Per scenario: frame intervals from requestAnimationFrame (median, p95, worst, frames over 33ms), long tasks, and per
// frame from the DevTools trace: style recalc, layout, paint, composite (main thread), raster + GPU (all threads), and the
// number of Layout events. --variant switches one suspect off (diagnosis only, never a fix): the nav's backdrop-filter,
// the background blobs' animation, the blobs themselves, or every backdrop-filter.
const { serve } = require("./lib.js");
const { chromium } = require("playwright");
const path = require("path");

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const ROOT = pos[0] || path.resolve(__dirname, "../../public");
const LABEL = pos[1] || "current";
const RUNS = +opt("--runs", "3"), CPU = +opt("--cpu", "4"), VARIANT = opt("--variant", "base");
const ONLY = opt("--only", "");
const VCSS = {
  base: "",
  "no-nav-blur": "nav.g{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}",
  "no-blob-anim": "#bg i{animation:none!important}",
  "no-blobs": "#bg{display:none!important}",
  "no-glass-blur": "*{backdrop-filter:none!important;-webkit-backdrop-filter:none!important}",
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
  const route = { "scroll-home": "/#/", "scroll-surahs": "/#/surahs", "scroll-surah78": "/#/surah/78", tabs: "/#/" }[name];
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
  if (name === "tabs") {
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
  const main = new Set();
  for (const e of tr) if (e.name === "thread_name" && e.args && e.args.name === "CrRendererMain") main.add(e.pid + ":" + e.tid);
  const xs = tr.filter((e) => e.ph === "X" && main.has(e.pid + ":" + e.tid));
  const frames = res.d.length || 1, sum = {};
  for (const [k, names] of Object.entries(BUCKET)) sum[k] = xs.filter((e) => names.includes(e.name)).reduce((s, e) => s + (e.dur || 0), 0) / 1000;
  sum.rasterGpu = tr.filter((e) => e.ph === "X" && RASTER.test(e.name)).reduce((s, e) => s + (e.dur || 0), 0) / 1000;
  return {
    scenario: name, frames: res.d.length, medianMs: +med(res.d).toFixed(1), p95Ms: +pct(res.d, 0.95).toFixed(1), worstMs: +Math.max(0, ...res.d).toFixed(1), over33: res.d.filter((x) => x > 33.4).length,
    longTasks: res.lt.length, layouts: xs.filter((e) => e.name === "Layout").length, navHid: res.hid, navShown: res.shown,
    perFrame: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, +(v / frames).toFixed(2)])),
  };
}

(async () => {
  const { server, base } = await serve(ROOT);
  const br = await chromium.launch();
  const all = {};
  for (const s of ["scroll-home", "scroll-surahs", "scroll-surah78", "tabs"].filter((s) => !ONLY || s === ONLY)) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await scenario(br, base, s));
    const m = (f) => med(runs.map(f));
    all[s] = { medianMs: m((r) => r.medianMs), p95Ms: m((r) => r.p95Ms), worstMs: m((r) => r.worstMs), over33: m((r) => r.over33), longTasks: m((r) => r.longTasks), layouts: m((r) => r.layouts), navHid: m((r) => r.navHid), navShown: m((r) => r.navShown),
      perFrame: Object.fromEntries(Object.keys(runs[0].perFrame).map((k) => [k, m((r) => r.perFrame[k])])) };
    console.log(LABEL + " " + VARIANT + " " + s + " " + JSON.stringify(all[s]));
  }
  await br.close(); server.close();
  console.log("SUMMARY " + JSON.stringify({ label: LABEL, variant: VARIANT, scenarios: all }));
})();
