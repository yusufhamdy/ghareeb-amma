// Glass-strength slider (read-only): what one full drag does. Opens the settings sheet in glass, drags the thumb slowly
// from one end to the other with the mouse (60 moves over ~1.5s), and records: the range, step and values reached,
// whether the page changes live, how often the CSS variables are written per animation frame (at most once), storage
// writes during the drag and on release (saved on release only), the accessible value text, frame intervals and long
// tasks, Chrome's style/layout counters, and how the blur and fill move across the range (evenly). 390 and 1440, CPU 1x
// and 4x. Targets (390, CPU 4x): median frame <= 16.7ms, p95 <= 33ms, no long tasks.
// Usage: node slider.js   -> OUT (default ./out/slider): slider.json, screenshots at 0/50/100
const fs = require("fs");
const path = require("path");
const { chromium, serve, context } = require("./lib.js");
const OUT = process.env.OUT || path.join(__dirname, "out", "slider");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const { server, base } = await serve();
  const br = await chromium.launch();
  const all = [], fails = [];
  for (const w of [390, 1440]) for (const cpu of [1, 4]) {
    const ctx = await context(br, { style: "glass", mode: "light", pal: "gold", w });
    const p = await ctx.newPage();
    const cdp = await ctx.newCDPSession(p);
    await cdp.send("Performance.enable");
    await p.goto(base + "/#/"); await p.waitForSelector("#app .card"); await p.waitForTimeout(800);
    await p.click("#gear"); await p.waitForSelector("#sh.open #gs"); await p.waitForTimeout(400);
    await p.evaluate(() => { const s = document.getElementById("gs"); s.value = 0; s.dispatchEvent(new Event("input", { bubbles: true })); s.dispatchEvent(new Event("change", { bubbles: true })); });
    await p.waitForTimeout(300);
    const geo = await p.evaluate(() => {
      const s = document.getElementById("gs"), r = s.getBoundingClientRect(), sh = document.querySelector("#sh .p").getBoundingClientRect();
      return { min: +s.min, max: +s.max, step: +s.step, values: (+s.max - +s.min) / +s.step + 1, trackWidth: Math.round(r.width), pxPerStep: +(r.width / ((+s.max - +s.min) / +s.step)).toFixed(2), pageVisible: Math.round(100 * sh.top / innerHeight) + "%", overlay: getComputedStyle(document.getElementById("sh")).backgroundColor, sample: !!document.querySelector("#sh .gsm .g") };
    });
    // instrument: inputs, CSS writes per frame (style attribute of <html>), storage writes, frames, long tasks
    await p.evaluate(() => {
      const M = window.__M = { inputs: [], writesByFrame: {}, frame: 0, ls: [], frames: [], long: [], texts: [] };
      const s = document.getElementById("gs");
      s.addEventListener("input", () => { M.inputs.push(+s.value); }, true);
      // one write = one batch of style changes (the four glass variables are set together); counted per frame
      new MutationObserver((l) => { if (l.some((m) => m.attributeName === "style")) M.writesByFrame[M.frame] = (M.writesByFrame[M.frame] || 0) + 1; }).observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
      const si = Storage.prototype.setItem; Storage.prototype.setItem = function (k) { if (k === "gq-set") M.ls.push(M.up ? "after release" : "during drag"); return si.apply(this, arguments); };
      try { new PerformanceObserver((l) => l.getEntries().forEach((e) => M.long.push(Math.round(e.duration)))).observe({ type: "longtask", buffered: false }); } catch (e) {}
      let last = performance.now(); const tick = (t) => { M.frames.push(t - last); last = t; M.frame++; if (!M.stop) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    });
    if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: cpu });
    const m0 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
    const r = await p.locator("#gs").boundingBox();
    const dir = await p.evaluate(() => getComputedStyle(document.getElementById("gs")).direction);
    const y = r.y + r.height / 2, lo = r.x + 12, hi = r.x + r.width - 12, from = dir === "rtl" ? hi : lo, to = dir === "rtl" ? lo : hi;
    const bl0 = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bl").trim());
    await p.mouse.move(from, y); await p.mouse.down();
    for (let i = 1; i <= 60; i++) { await p.mouse.move(from + (to - from) * i / 60, y); await p.waitForTimeout(25); }
    const mid = await p.evaluate(() => ({ bl: getComputedStyle(document.documentElement).getPropertyValue("--bl").trim(), text: document.getElementById("gs").getAttribute("aria-valuetext") }));
    await p.evaluate(() => { window.__M.up = true; });
    await p.mouse.up(); await p.waitForTimeout(400);
    const m1 = Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((x) => [x.name, x.value]));
    if (cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    const M = await p.evaluate(() => { window.__M.stop = true; return window.__M; });
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem("gq-set")).gl);
    const distinct = M.inputs.filter((v, i) => !i || v !== M.inputs[i - 1]);
    const fr = M.frames.slice(2), sorted = fr.slice().sort((a, b) => a - b), pct = (q) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
    const writes = Object.values(M.writesByFrame);
    const res = {
      w, cpu, dir, ...geo,
      inputEvents: M.inputs.length, distinctValues: distinct.length, firstLast: distinct[0] + "→" + distinct[distinct.length - 1],
      appliedLive: bl0 !== mid.bl, blurMidDrag: mid.bl, valueTextAtEnd: mid.text,
      cssWritesPerFrameMax: writes.length ? Math.max(...writes) : 0, framesWithWrites: writes.length,
      storageWrites: { duringDrag: M.ls.filter((x) => x === "during drag").length, afterRelease: M.ls.filter((x) => x === "after release").length, savedValue: saved },
      frames: { count: fr.length, medianMs: +pct(0.5).toFixed(1), p95Ms: +pct(0.95).toFixed(1), maxMs: +Math.max(...fr).toFixed(1) },
      longTasks: { count: M.long.length, maxMs: Math.max(0, ...M.long) },
      chrome: { recalcStyle: m1.RecalcStyleCount - m0.RecalcStyleCount, recalcStyleMs: +((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000).toFixed(1), layouts: m1.LayoutCount - m0.LayoutCount, taskMs: +((m1.TaskDuration - m0.TaskDuration) * 1000).toFixed(1) },
    };
    // even mapping: blur, fill and saturate at 0, 25, 50, 75, 100 (the settings change path)
    if (cpu === 1) {
      const lv = [];
      for (const v of [0, 25, 50, 75, 100]) {
        await p.evaluate((v) => { const s = document.getElementById("gs"); s.value = v; s.dispatchEvent(new Event("input", { bubbles: true })); s.dispatchEvent(new Event("change", { bubbles: true })); }, v);
        await p.waitForTimeout(150);
        lv.push({ v, ...(await p.evaluate(() => { const s = getComputedStyle(document.documentElement); return { blur: s.getPropertyValue("--bl").trim(), fill: s.getPropertyValue("--gb").trim(), saturate: s.getPropertyValue("--sat").trim(), text: document.getElementById("gs").getAttribute("aria-valuetext") }; })) });
        if (w === 390 && v % 50 === 0) await p.screenshot({ path: path.join(OUT, `glass-${v}-390.png`) });
      }
      res.levels = lv;
      const bl = lv.map((x) => parseFloat(x.blur)), steps = bl.slice(1).map((b, i) => +(b - bl[i]).toFixed(2));
      res.blurStepsPer25 = steps;
      if (new Set(steps).size !== 1) fails.push(`${w}: blur is not even across the range (${steps})`);
    }
    // keyboard: arrows move by 1
    await p.evaluate(() => { const s = document.getElementById("gs"); s.value = 50; s.dispatchEvent(new Event("input", { bubbles: true })); s.dispatchEvent(new Event("change", { bubbles: true })); });
    await p.focus("#gs"); const k0 = await p.evaluate(() => +document.getElementById("gs").value);
    await p.keyboard.press(dir === "rtl" ? "ArrowLeft" : "ArrowRight");
    res.arrowStep = (await p.evaluate(() => +document.getElementById("gs").value)) - k0;
    if (res.min !== 0 || res.max !== 100 || res.step !== 1) fails.push(`${w}: range ${res.min}..${res.max} step ${res.step}`);
    if (!res.appliedLive) fails.push(`${w}/${cpu}x: not applied while dragging`);
    if (res.cssWritesPerFrameMax > 1) fails.push(`${w}/${cpu}x: ${res.cssWritesPerFrameMax} CSS writes in one frame`);
    if (res.storageWrites.duringDrag || res.storageWrites.afterRelease !== 1 || res.storageWrites.savedValue !== 100) fails.push(`${w}/${cpu}x: storage ${JSON.stringify(res.storageWrites)}`);
    if (res.valueTextAtEnd !== "قوي") fails.push(`${w}/${cpu}x: value text at the strong end "${res.valueTextAtEnd}"`);
    if (Math.abs(res.arrowStep) !== 1) fails.push(`${w}/${cpu}x: arrow step ${res.arrowStep}`);
    if (w === 390 && cpu === 4 && (res.frames.medianMs > 16.7 || res.frames.p95Ms > 33 || res.longTasks.count)) fails.push(`390/4x performance: median ${res.frames.medianMs}ms, p95 ${res.frames.p95Ms}ms, long tasks ${res.longTasks.count}`);
    all.push(res);
    console.log(JSON.stringify(res));
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "slider.json"), JSON.stringify(all, null, 1));
  console.log(fails.length ? "FAILURES:\n" + fails.join("\n") : "ALL SLIDER CHECKS PASSED");
  await br.close(); server.close();
  process.exit(fails.length ? 1 : 0);
})();
