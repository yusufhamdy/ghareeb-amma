// Glass-strength slider drag performance (the iPhone lag report).
//   node slider-perf.js [root] [label] [--runs 3] [--cpu 4]
// Chromium, mobile emulation (390x844, touch, 3x), CPU throttled, glass + dark + neo, settings sheet open on the home
// page. The slider is driven with real touch input through CDP: touchStart on the thumb, touchMove every ~16.7ms (60Hz)
// across the full track in 90 steps, then back, then touchEnd. Measured during the drag:
//   - frame intervals from requestAnimationFrame (median, p95, worst), and frames over 33ms;
//   - long tasks (PerformanceObserver), count and total;
//   - from a DevTools timeline trace on the renderer main thread: total time in style recalc (UpdateLayoutTree /
//     RecalculateStyles), layout (Layout), pre-paint + paint (PrePaint, Paint, PaintImage, RasterTask on other threads is
//     not included), layerize/commit (Layerize, UpdateLayer, Commit), script (FunctionCall, EvaluateScript,
//     EventDispatch) - per drag frame; and raster + GPU work (RasterTask, GPUTask...) on all threads, where backdrop-filter
//     blurs are drawn;
//   - how many input events changed the value, and the final value.
// Prints one JSON line per run and the medians.
const { serve } = require("./lib.js");
const { chromium } = require("playwright");
const path = require("path");

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const ROOT = pos[0] || path.resolve(__dirname, "../../public");
const LABEL = pos[1] || "current";
const RUNS = +opt("--runs", "3"), CPU = +opt("--cpu", "4");
const CATS = ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "blink", "cc", "gpu", "toplevel"].join(",");
const BUCKET = {
  style: ["UpdateLayoutTree", "RecalculateStyles", "ScheduleStyleRecalculation"],
  layout: ["Layout", "UpdateLayerTree"],
  paint: ["PrePaint", "Paint", "PaintImage", "UpdateLayer"],
  composite: ["Layerize", "Commit", "CompositeLayers", "ProxyMain::BeginMainFrame::commit"],
  script: ["FunctionCall", "EvaluateScript", "EventDispatch", "TimerFire", "FireAnimationFrame"],
};
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };

async function once(br, base) {
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: "no-preference" });
  await ctx.addInitScript(() => { try { localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-set", JSON.stringify({ mode: "dark", pal: "neo", gl: 3, gv: 2, style: "glass", cm: false, snd: false })); } catch (e) {} });
  const p = await ctx.newPage();
  await p.goto(base + "/#/", { waitUntil: "load" });
  await p.waitForSelector("#app .acts, #app h1", { timeout: 30000 });
  await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(800);
  await p.click('[data-a="set"]');
  await p.waitForSelector("#gs", { state: "visible" }); await p.waitForTimeout(900);
  const box = await p.$eval("#gs", (e) => { const r = e.getBoundingClientRect(); return { x: r.left, y: r.top + r.height / 2, w: r.width, min: +e.min, max: +e.max, v: +e.value }; });
  const cdp = await ctx.newCDPSession(p);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  await p.evaluate(() => {
    window.__f = []; window.__lt = []; window.__inputs = 0; window.__run = true;
    const loop = (t) => { if (!window.__run) return; window.__f.push(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: "longtask" }); } catch (e) {}
    document.getElementById("gs").addEventListener("input", () => { window.__inputs++; });
  });
  // the thumb's position for the current value (RTL range: value grows to the left)
  const rtl = await p.$eval("#gs", (e) => getComputedStyle(e).direction === "rtl");
  const xAt = (v) => { const t = (v - box.min) / (box.max - box.min), pad = 12; const fx = pad + t * (box.w - 2 * pad); return rtl ? box.x + box.w - fx : box.x + fx; };
  const events = [];
  const tr = [];
  cdp.on("Tracing.dataCollected", (d) => tr.push(...d.value));
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.start", { categories: CATS, transferMode: "ReportEvents" });
  const t0 = await p.evaluate(() => performance.now());
  const touch = (type, x) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y: box.y, id: 1 }] });
  await touch("touchStart", xAt(box.v));
  const steps = 90, path = [];
  for (let i = 0; i <= steps; i++) path.push(box.min + (box.max - box.min) * (i / steps));
  for (let i = steps; i >= 0; i--) path.push(box.min + (box.max - box.min) * (i / steps));
  const start = Date.now();
  for (let i = 0; i < path.length; i++) {
    await touch("touchMove", xAt(path[i]));
    const wait = start + (i + 1) * 16.7 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
  await touch("touchEnd", 0);
  const t1 = await p.evaluate(() => performance.now());
  await p.waitForTimeout(300);
  await cdp.send("Tracing.end");
  await done;
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const res = await p.evaluate(([t0, t1]) => { window.__run = false; const f = window.__f.filter((t) => t >= t0 && t <= t1); const d = []; for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]); return { d, lt: window.__lt, inputs: window.__inputs, value: +document.getElementById("gs").value }; }, [t0, t1]);
  await ctx.close();
  // trace: renderer main thread (CrRendererMain) of the page, events inside the drag window
  const main = new Set();
  for (const e of tr) if (e.name === "thread_name" && e.args && e.args.name === "CrRendererMain") main.add(e.pid + ":" + e.tid);
  const xs = tr.filter((e) => e.ph === "X" && main.has(e.pid + ":" + e.tid));
  const tsMin = Math.min(...xs.map((e) => e.ts));
  const sum = {};
  for (const [k, names] of Object.entries(BUCKET)) sum[k] = xs.filter((e) => names.includes(e.name)).reduce((s, e) => s + (e.dur || 0), 0) / 1000;
  // raster and GPU work (where backdrop-filter blurs are drawn), on every thread of every process
  sum.rasterGpu = tr.filter((e) => e.ph === "X" && /^(RasterTask|GPUTask|TileManager::FlushAndIssueSignals|SkiaGpuRasterTask|GpuChannel::ExecuteDeferredRequest)$/.test(e.name)).reduce((s, e) => s + (e.dur || 0), 0) / 1000;
  const frames = res.d.length || 1;
  return {
    max: await Promise.resolve(box.max), frames: res.d.length, medianMs: +med(res.d).toFixed(1), p95Ms: +pct(res.d, 0.95).toFixed(1), worstMs: +Math.max(0, ...res.d).toFixed(1), over33: res.d.filter((x) => x > 33.4).length,
    longTasks: res.lt.length, longTaskMs: +res.lt.reduce((s, x) => s + x, 0).toFixed(0), inputs: res.inputs, value: res.value,
    perFrame: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, +(v / frames).toFixed(2)])),
    totals: Object.fromEntries(Object.entries(sum).map(([k, v]) => [k, +v.toFixed(0)])),
    dragMs: +(t1 - t0).toFixed(0), traceSpanMs: +((Math.max(...xs.map((e) => e.ts)) - tsMin) / 1000).toFixed(0),
  };
}

(async () => {
  const { server, base } = await serve(ROOT);
  const br = await chromium.launch();
  const runs = [];
  for (let i = 0; i < RUNS; i++) { const r = await once(br, base); runs.push(r); console.log(LABEL + " run " + (i + 1) + " " + JSON.stringify(r)); }
  await br.close(); server.close();
  const m = (f) => med(runs.map(f));
  const out = { label: LABEL, sliderMax: runs[0].max, dragMs: m((r) => r.dragMs), medianFrameMs: m((r) => r.medianMs), p95FrameMs: m((r) => r.p95Ms), worstFrameMs: m((r) => r.worstMs), framesOver33: m((r) => r.over33), longTasks: m((r) => r.longTasks), longTaskMs: m((r) => r.longTaskMs), inputs: m((r) => r.inputs),
    perFrame: Object.fromEntries(Object.keys(BUCKET).concat(["rasterGpu"]).map((k) => [k, m((r) => r.perFrame[k])])) };
  console.log("SUMMARY " + JSON.stringify(out));
})();
