// PREVIEW-ONLY (remove before release, with its loader in index.html): the ?perf=1 on-device readout. After each drag
// (the nav's drag-to-switch, or the glass slider) it shows, for one screenshot:
//   frames     rAF frames during the drag: count, median and worst interval, how many over 20ms and over 34ms;
//   moves      pointermove events: per second, median interval, whether getCoalescedEvents exists and how many
//              samples each move carries on average;
//   clocks     median of (event timeStamp - performance.now() at receipt), of (rAF timestamp - performance.now() at
//              the callback), and the newest move's age when a frame starts (performance.now() - its timeStamp);
//   indicator  % of frames where the nav's indicator did not move while the finger was moving (a move with a new x in
//              the last 50ms), and the CV of its per-frame step (from the transform the drag writes);
//   script     the most script time in one frame interval: every requestAnimationFrame callback, plus each input
//              event from its first listener (window, capture) to its last (window, bubble);
//   options    the build and the preview switches in the address.
// Also injected, unchanged, into the navref preview of 3e15a9c at deploy time (data-build="3e15a9c"). The live FPS
// updates twice a second and the rest only when a drag ends, so the readout itself does not draw during a drag.
// Nothing is sent anywhere.
(() => {
  let q;
  try { q = new URLSearchParams(location.search); } catch (e) { return; }
  if (q.get("perf") !== "1") return;
  const S = document.currentScript, build = (S && S.dataset.build) || "current", now = () => performance.now();
  const med = (a) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
  const mean = (a) => a.reduce((s, x) => s + x, 0) / (a.length || 1), max = (a) => (a.length ? Math.max(...a) : NaN);
  const f1 = (v) => (isFinite(v) ? v.toFixed(1) : "-");
  const gce = typeof PointerEvent !== "undefined" && typeof PointerEvent.prototype.getCoalescedEvents === "function";
  const opts = build === "current" ? "nd=" + (q.get("nd") || "24") + " nb=" + (q.get("nb") || "1") + " nl=" + (q.get("nl") || "1") + " ns=" + (q.get("ns") || "1") + " gs=" + (q.get("gs") || "a") : "(no switches)";

  // script time per frame interval
  let busy = 0, evS = 0;
  const raf0 = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf0((t) => { const s = now(); try { cb(t); } finally { busy += now() - s; } });
  ["pointerdown", "pointermove", "pointerup", "pointercancel", "touchstart", "touchmove", "touchend", "touchcancel"].forEach((n) => {
    addEventListener(n, () => { evS = now(); }, { capture: true, passive: true });
    addEventListener(n, () => { if (evS) { busy += now() - evS; evS = 0; } }, { passive: true });
  });

  let rec = null, res = ["no drag yet"];
  addEventListener("pointerdown", (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const what = t.id === "gs" ? "slider" : t.closest("#nv") ? "nav drag" : "";
    if (what) rec = { what, t0: now(), fr: [], bz: [], rc: [], age: [], mv: [], co: [], clk: [], steps: [], ix: null, fx: e.clientX, fxT: 0, ts: null };
  }, { capture: true, passive: true });
  addEventListener("pointermove", (e) => {
    if (!rec) return;
    const n = now();
    rec.mv.push(n); rec.clk.push(e.timeStamp - n); rec.ts = e.timeStamp;
    if (e.getCoalescedEvents) rec.co.push(e.getCoalescedEvents().length);
    if (e.clientX !== rec.fx) { rec.fx = e.clientX; rec.fxT = n; }
  }, { capture: true, passive: true });
  const stop = () => {
    if (!rec) return;
    const r = rec, dur = now() - r.t0;
    rec = null;
    if (r.fr.length < 3) { res = [r.what + ": too short (a tap)"]; show(); return; }
    const gaps = []; for (let i = 1; i < r.mv.length; i++) gaps.push(r.mv[i] - r.mv[i - 1]);
    const st = r.steps, mu = mean(st), sd = Math.sqrt(mean(st.map((x) => (x - mu) ** 2)));
    res = [
      r.what + "  " + (dur / 1000).toFixed(1) + "s",
      "frames " + r.fr.length + "  med " + f1(med(r.fr)) + "  worst " + f1(max(r.fr)) + "  >20ms " + r.fr.filter((x) => x > 20).length + "  >34ms " + r.fr.filter((x) => x > 34).length,
      "moves " + Math.round(r.mv.length / (dur / 1000)) + "/s  gap " + f1(med(gaps)) + "ms  coalesced " + (gce ? mean(r.co).toFixed(2) + "/move" : "n/a"),
      "clocks ts-now " + f1(med(r.clk)) + "  rAF-now " + f1(med(r.rc)) + "  age@frame " + f1(med(r.age)) + "ms",
      st.length ? "indicator still " + Math.round((100 * st.filter((x) => x < 0.05).length) / st.length) + "%  CV " + (sd / (mu || 1)).toFixed(2) + "  (" + st.length + " frames)" : "indicator -",
      "script max " + f1(max(r.bz)) + "ms/frame  med " + f1(med(r.bz)),
    ];
    show();
  };
  ["pointerup", "pointercancel"].forEach((n) => addEventListener(n, stop, { capture: true, passive: true }));

  let box = null, fps = [], last = 0, shown = 0;
  const show = () => { if (box) box.textContent = build + " " + opts + "  FPS " + fps.length + "\n" + res.join("\n"); };
  const loop = (t) => {
    const n = now();
    if (last) {
      fps.push(t); while (fps.length && t - fps[0] > 1000) fps.shift();
      if (rec) {
        rec.fr.push(t - last); rec.bz.push(busy); rec.rc.push(t - n);
        if (rec.ts != null) rec.age.push(n - rec.ts);
        const nv = document.getElementById("nv"), ind = nv && nv.querySelector(".ind"), m = ind && /translateX\((-?[\d.]+)px\)/.exec(ind.style.transform);
        if (nv && nv.classList.contains("drag") && m) {
          const x = +m[1];
          if (rec.ix != null && n - rec.fxT < 50) rec.steps.push(Math.abs(x - rec.ix));
          rec.ix = x;
        } else rec.ix = null;
      }
    }
    busy = 0; last = t;
    if (!rec && t - shown > 500) { shown = t; show(); }
    raf0(loop);
  };
  const init = () => {
    box = document.createElement("div");
    box.setAttribute("aria-hidden", "true");
    box.style.cssText = "position:fixed;top:calc(env(safe-area-inset-top,0px) + 4px);left:4px;right:4px;z-index:9999;pointer-events:none;font:12px/1.45 ui-monospace,Menlo,monospace;background:rgba(0,0,0,.82);color:#fff;padding:8px 10px;border-radius:8px;direction:ltr;text-align:left;white-space:pre-wrap";
    document.body.appendChild(box);
    show(); raf0(loop);
  };
  if (document.body) init(); else addEventListener("DOMContentLoaded", init);
})();
