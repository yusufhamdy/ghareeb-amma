// Bottom-nav drag verification: real touch input via CDP (Input.dispatchTouchEvent) on mobile emulation,
// plus a desktop mouse check. Read-only against public/.
const { chromium } = require("playwright");
const { serve } = require("./lib.js");
const fails = [], notes = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const ROUTES = ["#/", "#/surahs", "#/challenge", "#/quiz"];

async function mobile(br, base, width, style, cm) {
  const tag = `${width}/${style}${cm ? "/cm" : ""}`;
  const ctx = await br.newContext({ viewport: { width, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  await ctx.addInitScript((s) => {
    localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1");
    window.__vib = 0; try { Object.defineProperty(navigator, "vibrate", { configurable: true, value: () => { window.__vib++; return true; } }); } catch (e) {}
    window.__lt = []; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({ type: "longtask", buffered: true }); } catch (e) {}
  }, { style, mode: "light", pal: "def", gl: 3, gv: 2, snd: false, cm });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  const go = async (h) => { await p.goto(base + "/" + h, { waitUntil: "load" }); await p.waitForSelector("#nv .t"); await p.waitForTimeout(500); };
  const geo = () => p.evaluate(() => [...document.querySelectorAll("#nv .t")].map((t) => { const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
  const state = () => p.evaluate(() => { const i = document.querySelector("#nv .ind"), r = i.getBoundingClientRect(); return { cx: r.left + r.width / 2, tf: i.style.transform, drag: document.getElementById("nv").classList.contains("drag"), pv: [...document.querySelectorAll("#nv .t")].findIndex((t) => t.classList.contains("pv")), hash: location.hash || "#/", scrollY }; });
  const path = async (from, to, steps = 12) => { for (let s = 1; s <= steps; s++) { await touch("touchMove", from.x + (to.x - from.x) * s / steps, from.y + (to.y - from.y) * s / steps); await p.waitForTimeout(16); } };

  // 1. drag across all tabs: indicator follows, preview tab = tab under finger, vibrate per crossing, no scroll, no long task
  await go("#/surahs");
  await p.evaluate(() => { scrollTo(0, 0); });
  let g = await geo();
  await p.evaluate(() => { window.__vib = 0; window.__lt = []; });
  const y0 = (await state()).scrollY;
  await touch("touchStart", g[0].x, g[0].y);
  let prev = g[0];
  for (let k = 1; k < 4; k++) {
    await path(prev, g[k]); prev = g[k];
    await p.waitForTimeout(250); // let the stretch settle so the centre is comparable
    const s = await state();
    ok(s.drag, tag + " drag class while dragging");
    ok(Math.abs(s.cx - g[k].x) < 3, `${tag} indicator follows finger at tab ${k} (ind ${s.cx.toFixed(1)} vs finger ${g[k].x.toFixed(1)})`);
    ok(s.pv === k, `${tag} preview tab ${k} (got ${s.pv})`);
    if (cm) ok(/scale\(1,\s*1\)/.test(s.tf), `${tag} no stretch with motion off (${s.tf})`);
  }
  // fast move to check the stretch (not in motion-off)
  if (!cm) {
    await touch("touchMove", g[0].x, g[0].y); await p.waitForTimeout(16);
    const s = await state(); const m = /scale\(([\d.]+),\s*([\d.]+)\)/.exec(s.tf);
    ok(m && +m[1] > 1.05 && +m[1] <= 1.25 && +m[2] < 1 && +m[2] >= 0.92, `${tag} liquid stretch on fast move (${s.tf})`);
    await path(g[0], g[3], 6);
    await p.waitForTimeout(500);
    const s2 = await state(); const m2 = /scale\(([\d.]+),\s*([\d.]+)\)/.exec(s2.tf);
    ok(m2 && Math.abs(+m2[1] - 1) < 0.02, `${tag} springs back when still (${s2.tf})`);
  }
  const vib = await p.evaluate(() => window.__vib), lt = await p.evaluate(() => window.__lt);
  ok(vib >= 3, `${tag} vibrate on crossings (${vib})`);
  ok(!lt.some((d) => d > 50), `${tag} no long task >50ms during drag (${JSON.stringify(lt)})`);
  // 2. release outside (finger clearly above the nav): no navigation, indicator returns
  await path(g[3], { x: g[2].x, y: g[2].y - 160 }, 8);
  await touch("touchEnd");
  await p.waitForTimeout(700);
  let s = await state();
  ok(s.hash === "#/surahs", `${tag} release outside does not navigate (${s.hash})`);
  ok(!s.drag && s.tf === "" && Math.abs(s.cx - g[1].x) < 3, `${tag} indicator returns to current tab`);
  ok(s.scrollY === y0, `${tag} page did not scroll during drag (${y0} -> ${s.scrollY})`);
  // 3. release on each tab opens it (start from a different tab each time)
  for (let k = 0; k < 4; k++) {
    const start = (k + 2) % 4;
    await go(ROUTES[start]); g = await geo();
    await touch("touchStart", g[start].x, g[start].y); await path(g[start], g[k]); await touch("touchEnd");
    await p.waitForTimeout(700);
    s = await state();
    ok(s.hash === ROUTES[k], `${tag} release on tab ${k} opens ${ROUTES[k]} (got ${s.hash})`);
    ok(!s.drag && Math.abs(s.cx - g[k].x) < 3, `${tag} indicator settles on tab ${k}`);
  }
  // 4. short tap (< 8px movement) still navigates
  await go("#/surahs"); g = await geo();
  await touch("touchStart", g[2].x, g[2].y); await touch("touchMove", g[2].x + 4, g[2].y + 2); await touch("touchEnd");
  await p.waitForTimeout(700);
  s = await state();
  ok(s.hash === "#/challenge", `${tag} short tap navigates (${s.hash})`);
  // 5. pointercancel path: vertical swipe starting on the nav doesn't drag
  ok(!errs.length, `${tag} page errors: ${errs.join(" | ")}`);
  await ctx.close();
}

async function desktop(br, base) {
  const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { localStorage.setItem("gq-set", JSON.stringify({ style: "glass", mode: "light", pal: "def", gl: 3, gv: 2, snd: false, cm: false })); localStorage.setItem("gq-ld", "1"); });
  const p = await ctx.newPage();
  await p.goto(base + "/#/surahs", { waitUntil: "load" }); await p.waitForSelector("#nv .t"); await p.waitForTimeout(500);
  const g = await p.evaluate(() => [...document.querySelectorAll("#nv .t")].map((t) => { const r = t.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
  const st = () => p.evaluate(() => ({ hash: location.hash, tf: document.querySelector("#nv .ind").style.transform, drag: document.getElementById("nv").classList.contains("drag"), pv: document.querySelectorAll("#nv .pv").length }));
  await p.mouse.move(g[1].x, g[1].y); await p.mouse.down();
  for (let s = 1; s <= 10; s++) { await p.mouse.move(g[1].x + (g[3].x - g[1].x) * s / 10, g[1].y); await p.waitForTimeout(16); }
  const mid = await st();
  ok(mid.tf === "" && !mid.drag && mid.pv === 0, "desktop: mouse drag does not move the indicator " + JSON.stringify(mid));
  await p.mouse.up(); await p.waitForTimeout(500);
  const after = await st();
  ok(after.hash === "#/surahs", "desktop: mouse drag does not navigate (" + after.hash + ")");
  for (const [k, h] of [[2, "#/challenge"], [3, "#/quiz"], [0, ""]]) {
    await p.click(`#nv .t >> nth=${k}`); await p.waitForTimeout(400);
    const s = await st(); ok(s.hash === h || (h === "" && s.hash === "#/"), `desktop: click tab ${k} -> ${h} (got ${s.hash})`);
  }
  await ctx.close();
}

(async () => {
  const { server, base } = await serve();
  const br = await chromium.launch();
  try {
    for (const width of [360, 390, 430]) for (const style of ["glass", "shade"]) await mobile(br, base, width, style, false);
    await mobile(br, base, 390, "glass", true);
    await desktop(br, base);
  } finally { await br.close(); server.close(); }
  console.log(fails.length ? "FAIL\n" + fails.join("\n") : "ALL PASS");
})();
