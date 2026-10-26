// Settings sheet and gear (read-only). Checks: order and grouping (المظهر with the note "يتبع إعداد جهازك", النمط with
// شدة الزجاج inside it (shown only for glass: it collapses to hidden and inert in shade and expands again, ~200ms height
// and opacity), اللون, a divider, the motion and sound switches, the reset link), no overlay and an outside tap still
// closes, how much of the page stays visible, five swatches in one row (320/390/1440), every control >= 44px tall, each
// switch row toggles from anywhere on the row, radio groups (one Tab stop each, arrow keys move the selection,
// right-to-left aware), swatches (135deg gradient per palette at 48px, the selected one ringed in the accent 3px off the
// circle, accent bars 14x3 or 24 when selected, name semibold, following the mode), the segmented controls' sliding
// indicator (the bottom nav indicator's timing and easing, intermediate positions, ends on the selected option, no layout
// shift; instant with motion off or reduced motion), the reset link (site defaults at once, a toast with "تراجع" for about
// 5s that restores the previous settings), the slider's focus ring on the thumb only (pixels: the thumb changes, the track
// and its container do not), and Esc / outside / "تم" close with focus back on the gear. Gear: one 60-degree turn of about
// 400ms with no overshoot, never held and never turned back, on hover, focus-visible, press and phone tap; none with motion
// off or reduced motion.
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
    await p.screenshot({ path: path.join(OUT, `sheet-${w}-${mode}-glass.png`) });
    if (w !== 320) { await p.click('#sh [data-st="shade"]'); await p.waitForTimeout(300); await p.screenshot({ path: path.join(OUT, `sheet-${w}-${mode}-shade.png`) }); await p.click('#sh [data-st="glass"]'); await p.waitForTimeout(300); }
    const L = await p.evaluate(() => {
      const P = document.querySelector("#sh .p"), r = P.getBoundingClientRect(), css = getComputedStyle(document.documentElement);
      const sw = [...P.querySelectorAll(".psw button")];
      return {
        heads: [...P.querySelectorAll(".grp > .m:not(.shn), .gsw > .m")].map((e) => e.textContent.trim()),
        glassUnderStyle: !!P.querySelector('.grp [role="radiogroup"][aria-labelledby="lbs"] ~ .gsx .gsw #gs'),
        note: (() => { const n = P.querySelector(".shn"); return n && n.previousElementSibling && n.previousElementSibling.matches('[data-sg="m"]') ? n.textContent.trim() : null; })(),
        tail: (() => { const g = [...P.children]; const i = g.findIndex((e) => e.matches("hr.shd")); return i < 0 ? null : g.slice(i).map((e) => e.tagName.toLowerCase() + "." + e.className.split(" ")[0]).join(" "); })(),
        colourBeforeDivider: (() => { const d = P.querySelector("hr.shd"); return !!d && !!d.previousElementSibling && !!d.previousElementSibling.querySelector(".psw"); })(),
        overlay: getComputedStyle(document.getElementById("sh")).backgroundColor,
        pageVisiblePct: Math.round(100 * Math.max(0, r.top) / innerHeight),
        swatchRows: new Set(sw.map((b) => Math.round(b.getBoundingClientRect().top))).size,
        swatches: sw.map((b) => { const i = b.querySelector("i"), c = getComputedStyle(i), bar = b.querySelector(".pbar"), bc = getComputedStyle(bar), r = bar.getBoundingClientRect(); return { k: b.dataset.p, on: b.classList.contains("on"), img: c.backgroundImage, size: [Math.round(i.getBoundingClientRect().width), Math.round(i.getBoundingClientRect().height)], ring: c.boxShadow, bar: bc.backgroundColor, barW: Math.round(r.width), barH: Math.round(r.height), weight: getComputedStyle(b.querySelector("span")).fontWeight }; }),
        sheetBg: getComputedStyle(P).backgroundColor,
        accent: css.getPropertyValue("--ac").trim(), glow: css.getPropertyValue("--b1").trim(),
        under44: [...P.querySelectorAll("button, input")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 44).map((e) => (e.dataset.m || e.dataset.p || e.dataset.st || e.id || e.className) + ":" + Math.round(e.getBoundingClientRect().height)),
        groups: [...P.querySelectorAll('[role="radiogroup"]')].map((g) => ({ label: document.getElementById(g.getAttribute("aria-labelledby")).textContent, radios: g.querySelectorAll('[role="radio"]').length, tabStops: [...g.querySelectorAll('[role="radio"]')].filter((x) => x.tabIndex >= 0).length, checked: g.querySelectorAll('[aria-checked="true"]').length })),
      };
    });
    // swatches: the exact gradient per palette, 48px; the selected one ringed in the applied accent with a 3px gap in the
    // sheet's colour; bars in each palette's accent of this mode, 14x3 (24 wide when selected, name semibold)
    const hexToRgb = (h) => "rgb(" + [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16)).join(", ") + ")";
    const SW = { gold: ["#B59045", "#F0CD78"], def: ["#56A882", "#8EE6B4"], lav: ["#8177EC", "#B7B2FF"], sun: ["#D47654", "#FFB38A"], neo: ["#45AAC4", "#7FE7FF"] };
    const ACC = await p.evaluate((dark) => Object.fromEntries(Object.keys(PAL).map((k) => [k, (dark ? PAL[k][2] : PAL[k][1])[1]])), mode === "dark");
    for (const x of L.swatches) {
      ok(x.img === `linear-gradient(135deg, ${hexToRgb(SW[x.k][0])}, ${hexToRgb(SW[x.k][1])})`, `${w}/${mode}: swatch ${x.k} is ${x.img}`);
      ok(x.size[0] === 48 && x.size[1] === 48, `${w}/${mode}: swatch ${x.k} size ${x.size}`);
      ok(x.bar === hexToRgb(ACC[x.k]) && x.barH === 3 && x.barW === (x.on ? 24 : 14), `${w}/${mode}: bar ${x.k} ${x.bar} ${x.barW}x${x.barH} (accent ${ACC[x.k]})`);
      ok(x.on ? +x.weight === 600 && x.ring === `${L.sheetBg} 0px 0px 0px 3px, ${hexToRgb(L.accent)} 0px 0px 0px 5px` : x.ring === "none" && +x.weight < 600, `${w}/${mode}: ${x.k} selected=${x.on} ring "${x.ring}" weight ${x.weight}`);
    }
    ok(L.swatches.filter((x) => x.on).length === 1, `${w}/${mode}: selected swatches ${L.swatches.filter((x) => x.on).length}`);
    ok(JSON.stringify(L.heads) === JSON.stringify(["المظهر", "النمط", "شدة الزجاج", "اللون"]), `${w}/${mode}: order ${L.heads}`);
    ok(L.note === "يتبع إعداد جهازك", `${w}/${mode}: the note under المظهر is "${L.note}"`);
    ok(L.colourBeforeDivider && L.tail === "hr.shd div.tgs button.rst", `${w}/${mode}: after the colours: ${L.tail}`);
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
      ok(order.slice(0, 8).join() === `mode:auto,style:glass,#gs,pal:gold,motion,sound,reset,close`.replace("mode:auto", "mode:" + mode), `390/${mode}: Tab order ${order}`);
      // arrows: the next mode in reading order (right-to-left: ArrowLeft), focus and selection move together
      await p.focus(`#sh [data-m="${mode}"]`);
      await p.keyboard.press("ArrowLeft");
      const a1 = await p.evaluate(() => ({ focus: document.activeElement.dataset.m, saved: JSON.parse(localStorage.getItem("gq-set")).mode, checked: document.querySelector('#sh [data-m][aria-checked="true"]').dataset.m }));
      const want = { auto: "light", light: "dark", dark: "auto" }[mode];
      ok(a1.focus === want && a1.saved === want && a1.checked === want, `390/${mode}: ArrowLeft from ${mode} -> ${JSON.stringify(a1)} want ${want}`);
      // the swatches follow the mode: after the arrow changed it, each bar is that palette's accent in the new mode (the
      // gradients stay the same)
      const sw2 = await p.evaluate(() => { const dark = set.mode === "dark" || (set.mode === "auto" && matchMedia("(prefers-color-scheme:dark)").matches); return [...document.querySelectorAll("#sh .psw button")].map((b) => ({ k: b.dataset.p, bar: getComputedStyle(b.querySelector(".pbar")).backgroundColor, want: (dark ? PAL[b.dataset.p][2] : PAL[b.dataset.p][1])[1] })); });
      ok(sw2.every((s) => s.bar === hexToRgb(s.want)), `390/${mode}: swatch bars did not follow the mode ${JSON.stringify(sw2)}`);
      await p.keyboard.press("ArrowRight");
      // pick palettes with the arrows from the selected one
      await p.focus('#sh [data-p="gold"]'); await p.keyboard.press("ArrowLeft");
      ok(await p.evaluate(() => JSON.parse(localStorage.getItem("gq-set")).pal === "def" && document.activeElement.dataset.p === "def"), `390/${mode}: ArrowLeft on the palettes did not select زمردي`);
      await p.keyboard.press("Home"); ok(await p.evaluate(() => JSON.parse(localStorage.getItem("gq-set")).pal === "gold"), `390/${mode}: Home did not select the first palette`);
      // shade collapses the glass strength (height and opacity, ~200ms) to hidden and inert; glass expands it again
      const gx = () => p.evaluate(() => { const x = document.querySelector("#sh .gsx"); return { h: Math.round(x.getBoundingClientRect().height), vis: getComputedStyle(x).visibility, inert: x.inert, open: x.classList.contains("open"), anims: x.getAnimations().filter((a) => a.transitionProperty !== "visibility").map((a) => a.transitionProperty + " " + Math.round(a.effect.getComputedTiming().duration)).sort() }; });
      await p.click('#sh [data-st="shade"]'); const c0 = await gx(); await p.waitForTimeout(450); const c1 = await gx(); const gsVisibleInShade = await p.isVisible("#gs");
      await p.click('#sh [data-st="glass"]'); const e0 = await gx(); await p.waitForTimeout(450); const e1 = await gx(); const gsVisibleInGlass = await p.isVisible("#gs");
      R[`glass strength ${mode}`] = { collapse: [c0, c1], expand: [e0, e1] };
      ok(c0.anims.join() === "grid-template-rows 200,opacity 200" && e0.anims.join() === "grid-template-rows 200,opacity 200", `390/${mode}: expand/collapse transitions ${c0.anims} / ${e0.anims}`);
      ok(c1.h === 0 && c1.vis === "hidden" && c1.inert && !gsVisibleInShade, `390/${mode}: glass strength not hidden in shade ${JSON.stringify(c1)}`);
      ok(e1.h > 40 && e1.vis === "visible" && !e1.inert && gsVisibleInGlass, `390/${mode}: glass strength not shown in glass ${JSON.stringify(e1)}`);
      // the sliding indicator: same transition as the bottom nav indicator; it moves through intermediate positions and
      // ends on the selected option; the buttons do not move
      const nav = await p.evaluate(() => { const c = getComputedStyle(document.querySelector("nav .ind")); return c.transitionDuration + " " + c.transitionTimingFunction; });
      const segSnap = () => p.evaluate(() => { const g = document.querySelector('#sh [data-sg="m"]'), i = g.querySelector(".si"); return { x: Math.round(i.getBoundingClientRect().left * 10) / 10, btns: [...g.querySelectorAll("button")].map((b) => Math.round(b.getBoundingClientRect().left) + ":" + Math.round(b.getBoundingClientRect().width)).join(), tr: getComputedStyle(i).transitionDuration + " " + getComputedStyle(i).transitionTimingFunction }; });
      const s0 = await segSnap(), target = mode === "dark" ? "auto" : "dark";
      await p.click(`#sh [data-m="${target}"]`);
      const xs = await p.evaluate(() => new Promise((res) => { const out = [], t0 = performance.now(); const tick = () => { const i = document.querySelector('#sh [data-sg="m"] .si'); out.push(i.getBoundingClientRect().left); if (performance.now() - t0 < 700) requestAnimationFrame(tick); else res(out); }; tick(); }));
      const s1 = await segSnap(), onX = await p.evaluate(() => Math.round(document.querySelector('#sh [data-sg="m"] button.on').getBoundingClientRect().left * 10) / 10);
      const inter = new Set(xs.map((v) => Math.round(v)).filter((v) => Math.abs(v - s0.x) > 1 && Math.abs(v - s1.x) > 1)).size;
      R[`indicator ${mode}`] = { nav, seg: s1.tr, from: s0.x, to: s1.x, selected: onX, intermediate: inter };
      ok(s1.tr === nav, `390/${mode}: indicator transition "${s1.tr}" differs from the bottom nav "${nav}"`);
      ok(inter >= 3 && Math.abs(s1.x - onX) < 1, `390/${mode}: indicator did not slide (${inter} intermediate positions) or ends at ${s1.x} not ${onX}`);
      ok(s0.btns === s1.btns, `390/${mode}: the segment buttons moved (${s0.btns} -> ${s1.btns})`);
      await p.click(`#sh [data-m="${mode}"]`); await p.waitForTimeout(600);
      // reset: the site defaults at once, a toast with "تراجع" (~5s); undo restores the previous settings exactly
      await p.click('#sh [data-p="neo"]'); await p.click('#sh [data-st="shade"]'); await p.waitForTimeout(300);
      const before = await p.evaluate(() => localStorage.getItem("gq-set"));
      await p.click("#sh .rst"); await p.waitForTimeout(200);
      const rs = await p.evaluate(() => { const t = document.querySelector(".toast.tu"); return { saved: JSON.parse(localStorage.getItem("gq-set")), text: t && t.firstChild.textContent.trim(), btn: t && t.querySelector("button").textContent, top: t && t.getBoundingClientRect().top, sheetTop: document.querySelector("#sh .p").getBoundingClientRect().top }; });
      const defaults = await p.evaluate(() => ({ mode: "auto", pal: GQT.DEFAULT, gl: GQT.GLASS_DEFAULT, gv: 3, style: "glass", cm: matchMedia("(prefers-reduced-motion:reduce)").matches, snd: true }));
      ok(JSON.stringify(rs.saved) === JSON.stringify(defaults), `390/${mode}: reset saved ${JSON.stringify(rs.saved)} want ${JSON.stringify(defaults)}`);
      ok(rs.text === "تمت استعادة الإعدادات الافتراضية" && rs.btn === "تراجع", `390/${mode}: reset toast "${rs.text}" / "${rs.btn}"`);
      ok(rs.top < rs.sheetTop, `390/${mode}: the toast covers the sheet (toast top ${rs.top}, sheet top ${rs.sheetTop})`);
      await p.screenshot({ path: path.join(OUT, `reset-toast-390-${mode}.png`) });
      await p.click(".toast.tu .tub"); await p.waitForTimeout(300);
      ok((await p.evaluate(() => localStorage.getItem("gq-set"))) === before && !(await p.$(".toast.tu")), `390/${mode}: undo did not restore the previous settings`);
      await p.click("#sh .rst"); await p.waitForTimeout(5300);
      ok(!(await p.$(".toast.tu")), `390/${mode}: the reset toast is still there after 5.3s`);
      await p.evaluate((b) => { localStorage.setItem("gq-set", b); }, before);
      // the slider's focus ring: around the thumb only (keyboard focus; the track and its container stay the same)
      await p.click('#sh [data-st="glass"]'); await p.waitForTimeout(450);
      const gb = await p.locator("#gs").boundingBox(), cb = await p.locator("#sh .gs").boundingBox();
      const thumbX = await p.evaluate(() => { const g = document.getElementById("gs"), r = g.getBoundingClientRect(), t = (g.value - g.min) / (g.max - g.min); return r.right - 12 - t * (r.width - 24); });
      const thumbClip = { x: thumbX - 20, y: gb.y + gb.height / 2 - 20, width: 40, height: 40 }, trackClip = { x: cb.x, y: cb.y - 6, width: cb.width, height: cb.height + 12 };
      await p.mouse.move(1, 1); await p.evaluate(() => document.activeElement.blur());
      const th0 = await p.screenshot({ clip: thumbClip }), tr0 = await p.screenshot({ clip: trackClip });
      await p.keyboard.press("Shift"); await p.focus("#gs"); await p.waitForTimeout(150);
      const th1 = await p.screenshot({ clip: thumbClip }), tr1 = await p.screenshot({ clip: trackClip });
      const diff = (x, y, tx, ty) => p.evaluate(async ([x, y, tx, ty]) => { const ld = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + s; }); const [i, j] = await Promise.all([ld(x), ld(y)]); const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d"); g.drawImage(i, 0, 0); const d1 = g.getImageData(0, 0, c.width, c.height).data; g.drawImage(j, 0, 0); const d2 = g.getImageData(0, 0, c.width, c.height).data; let n = 0, far = 0; const cx = tx == null ? c.width / 2 : tx, cy = ty == null ? c.height / 2 : ty; for (let k = 0; k < d1.length; k += 4) { const dd = Math.abs(d1[k] - d2[k]) + Math.abs(d1[k + 1] - d2[k + 1]) + Math.abs(d1[k + 2] - d2[k + 2]); if (dd > 40) { n++; const px = (k / 4) % c.width, py = Math.floor(k / 4 / c.width); if (Math.hypot(px - cx, py - cy) > 22) far++; } } return { changed: n, outsideThumb: far }; }, [x.toString("base64"), y.toString("base64"), tx, ty]);
      const dThumb = await diff(th0, th1), dTrack = await diff(tr0, tr1, thumbX - trackClip.x, gb.y + gb.height / 2 - trackClip.y);
      const outline = await p.evaluate(() => getComputedStyle(document.getElementById("gs")).outlineStyle);
      R[`focus ring ${mode}`] = { thumb: dThumb, track: dTrack, outline };
      await p.screenshot({ path: path.join(OUT, `slider-focus-390-${mode}.png`), clip: trackClip });
      ok(dThumb.changed > 20 && dTrack.outsideThumb === 0 && outline === "none", `390/${mode}: focus ring thumb ${JSON.stringify(dThumb)}, track ${JSON.stringify(dTrack)}, outline ${outline}`);
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
  // ---- motion off (toggle) and reduced motion: the indicator jumps and the glass strength opens or closes at once
  for (const [label, cm, rm] of [["motion off (toggle)", true, "no-preference"], ["motion off (OS)", false, "reduce"]]) {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: rm });
    await ctx.addInitScript((cm) => { localStorage.setItem("gq-set", JSON.stringify({ style: "glass", mode: "light", pal: "gold", gl: 50, gv: 3, snd: false, cm })); localStorage.setItem("gq-ld", "1"); }, cm);
    const p = await ctx.newPage(); await p.goto(base + "/#/"); await p.waitForSelector("#gear"); await p.waitForTimeout(500);
    await p.click("#gear"); await p.waitForSelector("#sh.open .psw"); await p.waitForTimeout(200);
    await p.click('#sh [data-m="dark"]');
    const m = await p.evaluate(() => { const g = document.querySelector('#sh [data-sg="m"]'), i = g.querySelector(".si"); return { anims: i.getAnimations().length, x: Math.round(i.getBoundingClientRect().left), on: Math.round(g.querySelector("button.on").getBoundingClientRect().left) }; });
    await p.click('#sh [data-st="shade"]');
    const x = await p.evaluate(() => { const e = document.querySelector("#sh .gsx"); return { anims: e.getAnimations().length, h: Math.round(e.getBoundingClientRect().height), vis: getComputedStyle(e).visibility }; });
    R["instant " + label] = { indicator: m, glassStrength: x };
    ok(!m.anims && Math.abs(m.x - m.on) <= 1 && !x.anims && x.h === 0 && x.vis === "hidden", `${label}: not instant ${JSON.stringify({ m, x })}`);
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
  for (const [k, v] of Object.entries(R)) if (/gear|tab order|close|indicator|instant|focus ring|glass strength/.test(k)) console.log(k, JSON.stringify(v).slice(0, 400));
  for (const w of [320, 390, 1440]) console.log(`layout ${w} light: page visible ${R[`layout ${w} light`].pageVisiblePct}%, swatch rows ${R[`layout ${w} light`].swatchRows}`);
  console.log(fails.length ? "FAILURES (" + fails.length + "):\n" + fails.join("\n") : "ALL SETTINGS CHECKS PASSED");
  await br.close(); server.close();
  process.exit(fails.length ? 1 : 0);
})();
