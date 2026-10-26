// Settings sheet and gear (read-only). Checks: section order (المظهر, اللون, النمط, شدة الزجاج under النمط and only for
// glass), no overlay and an outside tap still closes, how much of the page stays visible, five swatches in one row
// (320/390/1440), every control >= 44px tall, each switch row toggles from anywhere on the row, radio groups (one Tab
// stop each, arrow keys move the selection, right-to-left aware), swatches = the current mode's accent with the glow as
// a ring and redrawn when the mode changes, Esc / "تم" close with focus back on the gear. Gear: one 60-degree turn of
// about 400ms with no overshoot, never held and never turned back, on hover, focus-visible, press and phone tap; none
// with motion off or reduced motion.
// Usage: node settings.js   -> OUT (default ./out/settings): settings.json and screenshots
const fs = require("fs");
const path = require("path");
const { chromium, serve, context } = require("./lib.js");
const OUT = process.env.OUT || path.join(__dirname, "out", "settings");
fs.mkdirSync(OUT, { recursive: true });
const ROT = () => { const s = document.querySelector("#gear svg"), t = getComputedStyle(s).transform; if (!t || t === "none") return 0; const m = new DOMMatrix(t); return Math.round(Math.atan2(m.b, m.a) * 1800 / Math.PI) / 10; };
const sample = (p, ms) => p.evaluate(([ms, src]) => new Promise((res) => { const f = eval(src), t0 = performance.now(), out = []; const tick = () => { const t = performance.now() - t0; out.push([Math.round(t), f()]); if (t < ms) requestAnimationFrame(tick); else res(out); }; tick(); }), [ms, ROT.toString()]);
// one turn: rises to its peak without going back, then is at 0 (identical look) and stays there
const turn = (s) => { const v = s.map((x) => x[1]), pk = Math.max(...v), at = v.indexOf(pk), end = v[v.length - 1], rising = v.slice(0, at + 1).every((x, i) => !i || x >= v[i - 1] - 0.05), moving = s.filter((x) => x[1] > 0.05), dur = moving.length ? moving[moving.length - 1][0] - moving[0][0] : 0, after = v.slice(at + 1); return { peakDeg: pk, durationMs: dur, rising, heldOrTurnedBack: after.some((x) => x > 0.05 && x < pk - 0.05) || end !== 0, end }; };

(async () => {
  const { server, base } = await serve();
  const br = await chromium.launch();
  const R = {}, fails = [];
  const ok = (c, m) => { if (!c) fails.push(m); };
  for (const w of [320, 390, 1440]) for (const mode of ["light", "dark"]) {
    const ctx = await context(br, { style: "glass", mode, pal: "gold", w });
    const p = await ctx.newPage();
    await p.goto(base + "/#/"); await p.waitForSelector("#gear"); await p.waitForTimeout(600);
    await p.click("#gear"); await p.waitForSelector("#sh.open .psw"); await p.waitForTimeout(300);
    await p.screenshot({ path: path.join(OUT, `sheet-${w}-${mode}.png`) });
    const L = await p.evaluate(() => {
      const P = document.querySelector("#sh .p"), r = P.getBoundingClientRect(), css = getComputedStyle(document.documentElement);
      const sw = [...P.querySelectorAll(".psw button")];
      return {
        heads: [...P.querySelectorAll(".grp > .m, .gsr > .m")].map((e) => e.textContent.trim()),
        glassUnderStyle: !!P.querySelector('.grp [role="radiogroup"][aria-labelledby="lbs"] ~ .gsw'),
        overlay: getComputedStyle(document.getElementById("sh")).backgroundColor,
        pageVisiblePct: Math.round(100 * Math.max(0, r.top) / innerHeight),
        swatchRows: new Set(sw.map((b) => Math.round(b.getBoundingClientRect().top))).size,
        swatches: sw.map((b) => { const i = b.querySelector("i"), c = getComputedStyle(i); return { k: b.dataset.p, fill: c.backgroundColor, ring: c.borderTopColor }; }),
        accent: css.getPropertyValue("--ac").trim(), glow: css.getPropertyValue("--b1").trim(),
        under44: [...P.querySelectorAll("button, input")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 44).map((e) => (e.dataset.m || e.dataset.p || e.dataset.st || e.id || e.className) + ":" + Math.round(e.getBoundingClientRect().height)),
        groups: [...P.querySelectorAll('[role="radiogroup"]')].map((g) => ({ label: document.getElementById(g.getAttribute("aria-labelledby")).textContent, radios: g.querySelectorAll('[role="radio"]').length, tabStops: [...g.querySelectorAll('[role="radio"]')].filter((x) => x.tabIndex >= 0).length, checked: g.querySelectorAll('[aria-checked="true"]').length })),
      };
    });
    // the selected palette's swatch must be the applied accent with the applied glow as its ring
    const hexToRgb = (h) => "rgb(" + [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16)).join(", ") + ")";
    const mine = L.swatches.find((s) => s.k === "gold");
    ok(mine.fill === hexToRgb(L.accent) && mine.ring === hexToRgb(L.glow), `${w}/${mode}: swatch ${mine.fill}/${mine.ring} vs accent ${L.accent}, glow ${L.glow}`);
    ok(JSON.stringify(L.heads) === JSON.stringify(["المظهر", "اللون", "النمط", "شدة الزجاج"]), `${w}/${mode}: order ${L.heads}`);
    ok(L.glassUnderStyle, `${w}/${mode}: glass strength not under النمط`);
    ok(L.overlay === "rgba(0, 0, 0, 0)", `${w}/${mode}: overlay ${L.overlay}`);
    ok(L.swatchRows === 1, `${w}/${mode}: swatches in ${L.swatchRows} rows`);
    ok(!L.under44.length, `${w}/${mode}: controls under 44px ${L.under44}`);
    ok(L.groups.length === 3 && L.groups.every((g) => g.tabStops === 1 && g.checked === 1), `${w}/${mode}: radio groups ${JSON.stringify(L.groups)}`);
    R[`layout ${w} ${mode}`] = L;
    if (w === 390) {
      // switches: a click on the label toggles; keyboard: Tab order and arrows
      const cm0 = await p.evaluate(() => JSON.parse(localStorage.getItem("gq-set")).cm);
      await p.click('#sh .tg[data-c] span'); const cm1 = await p.evaluate(() => JSON.parse(localStorage.getItem("gq-set")).cm);
      await p.click('#sh .tg[data-c] span');
      ok(cm1 === !cm0, `390/${mode}: clicking the switch label did not toggle (${cm0} -> ${cm1})`);
      await p.focus('#sh [data-a="close"]');
      const order = []; for (let i = 0; i < 9; i++) { await p.keyboard.press("Tab"); order.push(await p.evaluate(() => { const a = document.activeElement; return a.dataset.m ? "mode:" + a.dataset.m : a.dataset.p ? "pal:" + a.dataset.p : a.dataset.st ? "style:" + a.dataset.st : a.dataset.c ? "motion" : a.dataset.s ? "sound" : a.id ? "#" + a.id : a.dataset.a || a.tagName; })); }
      R[`tab order ${mode}`] = order;
      ok(order.slice(0, 7).join() === `mode:auto,pal:gold,style:glass,#gs,motion,sound,close`.replace("mode:auto", "mode:" + mode), `390/${mode}: Tab order ${order}`);
      // arrows: the next mode in reading order (right-to-left: ArrowLeft), focus and selection move together
      await p.focus(`#sh [data-m="${mode}"]`);
      await p.keyboard.press("ArrowLeft");
      const a1 = await p.evaluate(() => ({ focus: document.activeElement.dataset.m, saved: JSON.parse(localStorage.getItem("gq-set")).mode, checked: document.querySelector('#sh [data-m][aria-checked="true"]').dataset.m }));
      const want = { auto: "light", light: "dark", dark: "auto" }[mode];
      ok(a1.focus === want && a1.saved === want && a1.checked === want, `390/${mode}: ArrowLeft from ${mode} -> ${JSON.stringify(a1)} want ${want}`);
      // the swatches follow the mode: after the arrow changed it, each fill is that palette's accent in the new mode
      const sw2 = await p.evaluate(() => { const dark = set.mode === "dark" || (set.mode === "auto" && matchMedia("(prefers-color-scheme:dark)").matches); return [...document.querySelectorAll("#sh .psw button")].map((b) => ({ k: b.dataset.p, fill: getComputedStyle(b.querySelector("i")).backgroundColor, want: (dark ? PAL[b.dataset.p][2] : PAL[b.dataset.p][1])[1] })); });
      ok(sw2.every((s) => s.fill === hexToRgb(s.want)), `390/${mode}: swatches did not follow the mode ${JSON.stringify(sw2)}`);
      await p.keyboard.press("ArrowRight");
      // pick palettes with the arrows from the selected one
      await p.focus('#sh [data-p="gold"]'); await p.keyboard.press("ArrowLeft");
      ok(await p.evaluate(() => JSON.parse(localStorage.getItem("gq-set")).pal === "def" && document.activeElement.dataset.p === "def"), `390/${mode}: ArrowLeft on the palettes did not select زمردي`);
      await p.keyboard.press("Home"); ok(await p.evaluate(() => JSON.parse(localStorage.getItem("gq-set")).pal === "gold"), `390/${mode}: Home did not select the first palette`);
      // shade hides the glass strength; glass brings it back
      await p.click('#sh [data-st="shade"]'); const noGs = !(await p.$("#gs")); await p.click('#sh [data-st="glass"]'); const gs = !!(await p.$("#gs"));
      ok(noGs && gs, `390/${mode}: glass strength shown for shade (${noGs}) or missing for glass (${gs})`);
      // closing: outside tap, Esc, "تم"; focus back on the gear
      const close = {};
      for (const [k, act] of [["outside", () => p.mouse.click(200, 30)], ["esc", () => p.keyboard.press("Escape")], ["done", () => p.click('#sh [data-a="close"]')]]) {
        if (!(await p.evaluate(() => document.getElementById("sh").classList.contains("open")))) { await p.click("#gear"); await p.waitForSelector("#sh.open .psw"); await p.waitForTimeout(150); }
        await act(); await p.waitForTimeout(250);
        close[k] = await p.evaluate(() => ({ closed: !document.getElementById("sh").classList.contains("open"), focusOnGear: document.activeElement && document.activeElement.id === "gear" }));
        ok(close[k].closed, `390/${mode}: ${k} did not close`);
      }
      R[`close ${mode}`] = close;
    }
    await ctx.close();
  }
  // ---- gear
  for (const [label, cm, rm] of [["motion on", false, "no-preference"], ["motion off (toggle)", true, "no-preference"], ["motion off (OS)", false, "reduce"]]) {
    const ctx = await br.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: rm });
    await ctx.addInitScript((cm) => { localStorage.setItem("gq-set", JSON.stringify({ style: "glass", mode: "light", pal: "gold", gl: 50, gv: 3, snd: false, cm })); localStorage.setItem("gq-ld", "1"); }, cm);
    const p = await ctx.newPage(); await p.goto(base + "/#/"); await p.waitForSelector("#gear"); await p.waitForTimeout(600);
    const g = await p.locator("#gear").boundingBox(), cx = g.x + g.width / 2, cy = g.y + g.height / 2;
    const out = {};
    await p.mouse.move(cx, cy); out.hover = turn(await sample(p, 1200));
    await p.mouse.move(5, 400); out.leave = turn(await sample(p, 800));
    await p.keyboard.press("Shift"); await p.focus("#gear"); out.focusVisible = turn(await sample(p, 900));
    await p.evaluate(() => document.activeElement.blur()); await p.waitForTimeout(300);
    await p.mouse.move(cx, cy); await p.waitForTimeout(700);
    const pr = sample(p, 900); await p.mouse.down(); const prs = await pr; await p.mouse.up(); out.pressWhileHovered = turn(prs);
    await p.keyboard.press("Escape"); await p.waitForTimeout(300); await p.mouse.move(5, 400); await p.waitForTimeout(500);
    R["gear " + label] = out;
    if (cm || rm === "reduce") ok(Object.values(out).every((x) => x.peakDeg === 0), `gear ${label}: moved ${JSON.stringify(out)}`);
    else {
      for (const k of ["hover", "focusVisible", "pressWhileHovered"]) { const x = out[k]; ok(x.peakDeg >= 55 && x.peakDeg <= 60.5 && x.rising && !x.heldOrTurnedBack && x.durationMs >= 300 && x.durationMs <= 500, `gear ${k}: ${JSON.stringify(x)}`); }
      ok(out.leave.peakDeg === 0, `gear: moved on leave ${JSON.stringify(out.leave)}`);
    }
    await ctx.close();
  }
  {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await ctx.addInitScript(() => { localStorage.setItem("gq-set", JSON.stringify({ style: "glass", mode: "light", pal: "gold", gl: 50, gv: 3, snd: false, cm: false })); localStorage.setItem("gq-ld", "1"); });
    const p = await ctx.newPage(); await p.goto(base + "/#/"); await p.waitForSelector("#gear"); await p.waitForTimeout(600);
    const s = sample(p, 900); await p.tap("#gear"); const t = turn(await s);
    R["gear touch tap 390"] = { ...t, sheetOpened: await p.evaluate(() => document.getElementById("sh").classList.contains("open")) };
    ok(t.peakDeg >= 55 && t.peakDeg <= 60.5 && !t.heldOrTurnedBack, `gear tap: ${JSON.stringify(t)}`);
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "settings.json"), JSON.stringify(R, null, 1));
  for (const [k, v] of Object.entries(R)) if (/gear|tab order|close/.test(k)) console.log(k, JSON.stringify(v));
  for (const w of [320, 390, 1440]) console.log(`layout ${w} light: page visible ${R[`layout ${w} light`].pageVisiblePct}%, swatch rows ${R[`layout ${w} light`].swatchRows}`);
  console.log(fails.length ? "FAILURES (" + fails.length + "):\n" + fails.join("\n") : "ALL SETTINGS CHECKS PASSED");
  await br.close(); server.close();
  process.exit(fails.length ? 1 : 0);
})();
