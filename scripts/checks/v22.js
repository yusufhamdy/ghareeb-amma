// One-pass checks for: icon motion (S12) and its coverage of every button with a motion icon, done/undo animation, the locked next-day pill and day dots, the quiz marks, the per-platform video card
// and the admin link fields. Serves the working tree's public/ (read-only); never touches Firebase (the admin page is
// loaded with an empty Firebase config, so it runs on its local demo store, and gstatic is blocked).
// Usage: node v22.js            (all sections)
//        node v22.js icons cover done lock quiz video admin   (any subset)
const pw = require("playwright");
const fs = require("fs");
const { serve, ROOT } = require("./lib.js");
const { shadowViolations } = require("./shadowrule.js");
const ONLY = process.argv.slice(2);
const want = (k) => !ONLY.length || ONLY.includes(k);
const fails = [], n = {};
const bump = (k) => { n[k] = (n[k] || 0) + 1; };
const fail = (m) => fails.push(m);
const CH0 = JSON.parse(fs.readFileSync(ROOT + "/challenge.json", "utf8"));
const firstSurah = fs.readdirSync(ROOT + "/surah").find((x) => x.endsWith(".html"));
const firstWord = fs.readdirSync(ROOT + "/word").find((x) => x.endsWith(".html"));
const settings = (o) => Object.assign({ style: "glass", mode: "light", pal: "def", gl: 3, gv: 2, snd: false, cm: false }, o);
const LINKS = { reelIg: "https://www.instagram.com/reel/abc/", reelTt: "https://www.tiktok.com/@x/video/1", reelYt: "https://youtu.be/xyz" };
// challenge with day 1 links set as asked (null = leave the day untouched)
const chWith = (day1) => { const c = JSON.parse(JSON.stringify(CH0)); if (day1) Object.assign(c.days[0], day1); return c; };

async function ctxFor(br, o) {
  const ctx = await br.newContext({ viewport: { width: o.w || 390, height: 900 }, reducedMotion: o.rm || "no-preference", hasTouch: !!o.touch, isMobile: !!o.touch });
  await ctx.addInitScript((a) => {
    if (!sessionStorage.getItem("__seeded")) { localStorage.setItem("gq-set", JSON.stringify(a.set)); localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-prog", JSON.stringify(a.prog)); sessionStorage.setItem("__seeded", "1"); }
    if (a.ch) window.__CH__ = a.ch;
    // count animation starts/iterations inside icons (and the lock), per animation name
    window.__AS = []; window.__AI = 0;
    addEventListener("animationstart", (e) => { const t = e.target; if (t.closest && t.closest("svg")) window.__AS.push(e.animationName + "|" + (t.getAttribute("class") || t.tagName)); }, true);
    addEventListener("animationiteration", () => { window.__AI++; }, true);
  }, { set: settings(o.set || {}), prog: o.prog || { done: [] }, ch: o.ch || null });
  return ctx;
}
// every animation frame from now until nothing inside `scope` is animating (at least minMs, at most 3s): [snap(arg), ...]
const frames = (p, scope, snap, arg, minMs = 300) => p.evaluate(([scope, src, arg, minMs]) => new Promise((res) => {
  const f = eval(src), sc = document.querySelector(scope), t0 = performance.now(), out = [];
  const tick = () => {
    out.push(f(arg));
    const el = performance.now() - t0, run = !!sc && sc.getAnimations({ subtree: true }).some((a) => a.playState === "running");
    if ((run || el < minMs) && el < 3000) requestAnimationFrame(tick); else res(out);
  };
  tick();
}), [scope, snap.toString(), arg, minMs]);
// Exact motion samples, independent of frame rate: the moment animations or transitions run inside `sc`, every one of them
// is paused and seeked to each of its keyframe times and to every 4ms of its own timeline, `f(arg)` is read at each
// point, and then each is put back at its own current time and resumed. All of it runs in one task with every seek
// inside the active phase (never before the delay, never at the end), so no extra animation events fire and the real
// motion carries on unchanged: "starts exactly once" and "ends at rest" stay measured on the real frames.
const KEYSCAN = `(sc, f, arg) => {
  const as = sc.getAnimations({ subtree: true }).filter((a) => a.playState === "running");
  if (!as.length) return null;
  const T = as.map((a) => { const c = a.effect.getComputedTiming(); return { a, cur: a.currentTime, lo: c.delay || 0, hi: (c.delay || 0) + c.activeDuration - 0.01, offs: a.effect.getKeyframes().map((k) => k.computedOffset), dur: c.duration }; });
  const pts = new Set(), end = Math.max(...T.map((x) => x.hi));
  T.forEach((x) => x.offs.forEach((o) => pts.add(Math.min(x.lo + o * x.dur, x.hi))));
  for (let t = 0; t <= end; t += 4) pts.add(t);
  T.forEach((x) => x.a.pause());
  const t = [], s = [];
  [...pts].sort((a, b) => a - b).forEach((v) => { T.forEach((x) => { x.a.currentTime = Math.max(x.lo, Math.min(v, x.hi)); }); t.push(v); s.push(f(arg)); });
  T.forEach((x) => { x.a.currentTime = x.cur; x.a.play(); });
  return { t, s, names: as.map((a) => a.animationName || a.transitionProperty) };
}`;
// the real frames (fr), as frames() does, plus the exact samples of the motion that started (key: { t, s, names })
const framesK = (p, scope, snap, arg, minMs = 300) => p.evaluate(([scope, src, arg, minMs, ks]) => new Promise((res) => {
  const f = eval(src), K = eval(ks), sc = document.querySelector(scope), t0 = performance.now(), out = [];
  let key = null;
  const tick = () => {
    if (!key && sc) key = K(sc, f, arg);
    out.push(f(arg));
    const el = performance.now() - t0, run = !!sc && sc.getAnimations({ subtree: true }).some((a) => a.playState === "running");
    if ((run || el < minMs) && el < 3000) requestAnimationFrame(tick); else res({ fr: out, key: key || { t: [], s: [], names: [] } });
  };
  tick();
}), [scope, snap.toString(), arg, minMs, KEYSCAN]);
// wait until nothing inside `scope` animates any more (at least minMs, at most 3s), whatever the frame rate
const settle = (p, scope, minMs = 0) => frames(p, scope, () => 0, null, minMs);
const go = async (p, base, url, sel) => { await p.goto("about:blank"); await p.goto(base + url, { waitUntil: "load" }); await p.waitForSelector(sel, { timeout: 20000 }); await p.waitForTimeout(400); };

// ------------------------------------------------------------------------------------------------------------ icons
// The old (HEAD~) single-path icons, to prove the shape at rest is unchanged.
const SA = 'width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"';
const OLD = {
  "i-sh": `<svg ${SA}><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>`,
  "i-dl": `<svg ${SA}><path d="M12 3v12m0 0-4-4m4 4 4-4M4 21h16"/></svg>`,
  "i-sr": `<svg ${SA}><path d="M12 15V3m0 0L8 7m4-4 4 4M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8"/></svg>`,
  "i-bk": `<svg ${SA}><path d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z"/></svg>`,
};
// [label, url, control selector, svg class, moving parts (class or "svg"), still parts]
const CONTROLS = [
  ["home shuffle", "/#/", '#app [data-a="rnd"]', "i-sh", ["s", "h"], []],
  ["word shuffle", "/#/word/79-3", '#app [data-a="rnd"]', "i-sh", ["s", "h"], []],
  ["word save", "/#/word/79-3", '#app [data-a="card"]', "i-dl", ["ar"], ["tray"]],
  ["word share", "/#/word/79-3", '#app [data-a="share"]', "i-sr", ["ar"], ["box"]],
  ["word book", "/#/word/79-3", "#app a.mib", "i-bk", ["bl", "br"], []],
  ["surah book", "/#/surah/90", "#app a.mib", "i-bk", ["bl", "br"], []],
  ["surah share", "/#/surah/90", '#app [data-a="share"]', "i-sr", ["ar"], ["box"]],
  ["static surah book", "/surah/" + encodeURIComponent(firstSurah), "main a.mib", "i-bk", ["bl", "br"], []],
  ["home browse book", "/#/", '#app .hacts a[href="#/surahs"]', "i-bk", ["bl", "br"], []],
  ["static word book", "/word/" + encodeURIComponent(firstWord), "main .acts a.btn", "i-bk", ["bl", "br"], []],
  ["day platform", "/#/day/1", "#app a.vb", "i-pf", ["svg"], []],
];

async function iconRestShape(br) {
  // Render each old icon and the new one (from the live markup) at 4x and compare pixels.
  const p = await br.newPage({ viewport: { width: 400, height: 200 }, deviceScaleFactor: 4 });
  const { base, server } = await serve();
  await p.goto(base + "/#/word/79-3"); await p.waitForSelector('#app [data-a="share"]');
  const NEW = await p.evaluate(() => ({ "i-sh": BI.sh, "i-dl": BI.dl, "i-sr": BI.sr, "i-bk": BI.bk }));
  // the static page's book is the same markup
  const st = fs.readFileSync(ROOT + "/surah/" + firstSurah, "utf8"), m = /<svg class="im i-bk"[^]*?<\/svg>/.exec(st);
  NEW["i-bk static"] = m ? m[0] : "";
  for (const [k, svg] of Object.entries(NEW)) {
    const old = OLD[k.split(" ")[0]];
    const shot = async (html) => { await p.setContent(`<style>svg.im .pt{opacity:0}</style><body style="margin:0;background:#fff;color:#000"><div id=w style="display:inline-block;padding:4px">${html}</div></body>`); return p.locator("#w").screenshot(); };
    const a = await shot(old), b = await shot(svg);
    const d = await p.evaluate(async ([x, y]) => {
      const ld = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + s; });
      const [ia, ib] = await Promise.all([ld(x), ld(y)]); const c = document.createElement("canvas"); c.width = ia.width; c.height = ia.height; const g = c.getContext("2d");
      g.drawImage(ia, 0, 0); const da = g.getImageData(0, 0, c.width, c.height).data; g.clearRect(0, 0, c.width, c.height); g.drawImage(ib, 0, 0); const db = g.getImageData(0, 0, c.width, c.height).data;
      let mx = 0, cnt = 0; for (let i = 0; i < da.length; i += 4) { const v = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2])); if (v > mx) mx = v; if (v > 8) cnt++; } return { mx, cnt, same: ia.width === ib.width && ia.height === ib.height };
    }, [a.toString("base64"), b.toString("base64")]);
    bump("restShape");
    // identical geometry; split paths may differ by anti-aliasing where two strokes overlap (a few pixels at most)
    if (!d.same || d.cnt > 6) fail(`icons: ${k} shape at rest differs from the old icon (max ${d.mx}, ${d.cnt} px > 8)`);
    else console.log(`  rest shape ${k}: max diff ${d.mx}, ${d.cnt} px > 8`);
  }
  await p.close(); server.close();
}

// state of every path/the svg of a control: transform, opacity, dashoffset
const PARTS = (sel) => {
  const c = document.querySelector(sel), svg = c && c.querySelector(":scope>svg.im"); if (!svg) return null;
  const g = (e) => { const s = getComputedStyle(e); return { tr: s.transform, op: s.opacity, dof: s.strokeDashoffset }; };
  const out = { svg: g(svg) };
  svg.querySelectorAll("path,rect,circle").forEach((e, i) => { const k = (e.getAttribute("class") || "p").replace("pt ", ""); out[k + "#" + i] = g(e); });
  return out;
};
// animations that swap the single rest path (.w) for the parts (.st = still parts) per icon
const SWAP = { "i-sh": 1, "i-dl": 2, "i-sr": 2, "i-bk": 1, "i-pf": 0 };
const moved = (a, b) => a.tr !== b.tr || a.op !== b.op || a.dof !== b.dof;

async function iconMotion(br, base) {
  for (const style of ["glass", "shade"]) for (const w of [390, 1440]) {
    const ctx = await ctxFor(br, { w, set: { style }, ch: chWith(LINKS), prog: { done: [] } });
    const p = await ctx.newPage();
    // no navigation/side effects from presses during the check
    await p.addInitScript(() => addEventListener("click", (e) => { if (window.__noClick && e.target.closest("a,button")) { e.preventDefault(); e.stopPropagation(); } }, true));
    for (const [label, url, sel, cls, parts] of CONTROLS) {
      const id = `icons ${style}/${w} ${label}`;
      await go(p, base, url, sel);
      await p.evaluate(() => { window.__noClick = true; });
      const h = p.locator(sel).first();
      await h.scrollIntoViewIfNeeded(); await p.mouse.move(1, 1); await p.waitForTimeout(700);
      const rest = await p.evaluate(PARTS, sel);
      if (!rest) { fail(id + ": icon not found"); continue; }
      const isMoving = (k) => parts.includes(k.split("#")[0]);
      for (const [trig, run] of [
        ["hover", async () => { await h.hover(); }],
        ["focus", async () => { await p.mouse.move(1, 1); await p.keyboard.press("Shift"); await h.evaluate((e) => e.focus({ preventScroll: true })); }],
        ["press", async () => { await p.mouse.move(1, 1); await h.evaluate((e) => e.blur()); const b = await h.boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await p.waitForTimeout(700); await p.evaluate(() => { window.__AS = []; }); await p.mouse.down(); await p.mouse.up(); }],
      ]) {
        await p.evaluate(() => { window.__AS = []; window.__AI = 0; });
        await run();
        // every frame until the motion ends, plus the exact keyframe samples: only the named parts may differ from rest
        const { fr: real, key } = await framesK(p, sel, PARTS, sel, 300);
        const mids = real.concat(key.s);
        await p.waitForTimeout(400);
        const after = await p.evaluate(PARTS, sel);
        const st = await p.evaluate(() => ({ as: window.__AS.slice(), ai: window.__AI }));
        bump("iconTriggers");
        let movedNamed = false;
        for (const m of mids) for (const k of Object.keys(rest)) {
          if (moved(rest[k], m[k])) { if (isMoving(k)) movedNamed = true; else if (/^(w|st)#/.test(k) && rest[k].tr === m[k].tr && rest[k].dof === m[k].dof) continue; else fail(`${id} ${trig}: part ${k} moved (${JSON.stringify(m[k])})`); }
        }
        if (!movedNamed) fail(`${id} ${trig}: the named part never moved`);
        for (const k of Object.keys(rest)) if (moved(rest[k], after[k])) fail(`${id} ${trig}: ${k} not back at rest (${JSON.stringify(after[k])})`);
        // once per trigger: one start per moving element, no iterations
        const per = {}; st.as.forEach((x) => { const k = x.split("|")[1].replace("pt ", ""); per[k] = (per[k] || 0) + 1; });
        const expect = parts.map((x) => x === "svg" ? "im i-pf" : x);
        const counts = expect.map((x) => Object.entries(per).filter(([k]) => k === x).reduce((s, [, v]) => s + v, 0));
        const nEl = { s: 2, h: 2, ar: 1, bl: 1, br: 1, "im i-pf": 1 };
        expect.forEach((x, i) => { if (counts[i] !== nEl[x]) fail(`${id} ${trig}: ${x} started ${counts[i]}x, want ${nEl[x]} (${st.as.join(",")})`); });
        if (st.ai) fail(`${id} ${trig}: animation iterated (${st.ai})`);
        if (trig === "press" && !st.as.every((x) => x.split("|")[0].endsWith("-p"))) fail(`${id} press: expected the press keyframes (${st.as.join(",")})`);
        await h.evaluate((e) => e.blur()).catch(() => {}); await p.mouse.move(1, 1);
      }
      // press while hovered replays exactly once more, and dropping .imp later does not replay it again
      await p.mouse.move(1, 1); await p.waitForTimeout(300);
      await h.hover(); await p.waitForTimeout(700); await p.evaluate(() => { window.__AS = []; });
      await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(1600); await settle(p, sel);
      const rep = await p.evaluate(() => window.__AS.length);
      const per1 = parts.reduce((s, x) => s + ({ s: 2, h: 2, ar: 1, bl: 1, br: 1, svg: 1 })[x], 0) + SWAP[cls];
      bump("iconHoverPress");
      if (rep !== per1) fail(`${id}: press while hovered started ${rep} animations, want ${per1}`);
      await p.mouse.move(1, 1); await p.waitForTimeout(300);
    }
    await ctx.close();
    process.stdout.write(".");
  }
  // touch tap at 390: runs once and finishes
  for (const style of ["glass", "shade"]) {
    const ctx = await ctxFor(br, { w: 390, touch: true, set: { style }, ch: chWith(LINKS) });
    const p = await ctx.newPage();
    await p.addInitScript(() => addEventListener("click", (e) => { if (e.target.closest("a,button")) { e.preventDefault(); e.stopPropagation(); } }, true));
    for (const [label, url, sel, cls, parts] of CONTROLS) {
      await go(p, base, url, sel); await p.locator(sel).first().scrollIntoViewIfNeeded(); await p.waitForTimeout(600);
      await p.evaluate(() => { window.__AS = []; window.__AI = 0; });
      await p.locator(sel).first().tap(); await p.waitForTimeout(1500); await settle(p, sel);
      const st = await p.evaluate(() => ({ as: window.__AS.slice(), ai: window.__AI, imp: document.querySelectorAll(".imp").length }));
      const per1 = parts.reduce((s, x) => s + ({ s: 2, h: 2, ar: 1, bl: 1, br: 1, svg: 1 })[x], 0) + SWAP[cls];
      bump("iconTap");
      if (st.as.length !== per1 || st.ai) fail(`icons touch ${style} ${label}: tap started ${st.as.length} (want ${per1}), iterations ${st.ai}`);
    }
    await ctx.close();
  }
  // motion off (toggle or OS setting) and disabled controls: nothing moves on hover, focus or press
  for (const [mode, cm, rm] of [["cm", true, "no-preference"], ["reduced", false, "reduce"], ["disabled", false, "no-preference"]]) for (const style of ["glass", "shade"]) for (const w of [390, 1440]) {
    const ctx = await ctxFor(br, { w, rm, set: { style, cm }, ch: chWith(LINKS) });
    const p = await ctx.newPage();
    await p.addInitScript(() => addEventListener("click", (e) => { if (e.target.closest("a,button")) { e.preventDefault(); e.stopPropagation(); } }, true));
    for (const [label, url, sel] of CONTROLS) {
      await go(p, base, url, sel);
      if (mode === "disabled") { const ok = await p.evaluate((s) => { const e = document.querySelector(s); if (e.tagName === "BUTTON") e.disabled = true; else e.setAttribute("aria-disabled", "true"); return true; }, sel); void ok; }
      const h = p.locator(sel).first(); await h.scrollIntoViewIfNeeded(); await p.mouse.move(1, 1); await p.waitForTimeout(300);
      const rest = await p.evaluate(PARTS, sel);
      await p.evaluate(() => { window.__AS = []; });
      await h.hover({ force: true }); await p.waitForTimeout(120); const a = await p.evaluate(PARTS, sel);
      await p.mouse.down(); await p.waitForTimeout(120); const b = await p.evaluate(PARTS, sel); await p.mouse.up();
      await p.mouse.move(1, 1); await p.keyboard.press("Shift"); await h.evaluate((e) => e.focus({ preventScroll: true })); await p.waitForTimeout(120); const c = await p.evaluate(PARTS, sel);
      const as = await p.evaluate(() => window.__AS.length);
      bump("iconOff");
      for (const [st, x] of [["hover", a], ["press", b], ["focus", c]]) for (const k of Object.keys(rest)) if (moved(rest[k], x[k])) fail(`icons ${mode} ${style}/${w} ${label} ${st}: ${k} moved`);
      if (as) fail(`icons ${mode} ${style}/${w} ${label}: ${as} animations started`);
    }
    await ctx.close();
  }
}

// --------------------------------------------------------------------------------------------------------- coverage
// Motion is tied to the icon, not the label: every enabled link or button on every page/state (app, static, 404) that
// contains the book, shuffle, download, share, platform, external-link, chevron or forward-arrow icon must run that
// icon's motion on hover, focus-visible and press, measured every frame for the whole motion plus exact samples at its
// keyframe times (KEYSCAN), and judged on its peak.
// The small book in a prev/next pill's second line must stay still (only the pill's chevron moves). Out of scope by
// design: the bottom nav, the gear, the social links and list rows (rows are not buttons). Prints every control found
// per icon, plus any other icon inside a button (no motion defined for it).
const ICON_KIND = (svg) => {
  const d = [...svg.querySelectorAll("path")].map((x) => x.getAttribute("d")).join("|");
  if (svg.classList.contains("i-pf")) return "platform";
  if (d.startsWith("M2 4h7")) return svg.closest(".ps") ? "pillbook" : "book";
  return d.startsWith("M16 3h5") ? "shuffle" : d.startsWith("M12 3v12") ? "download" : d.startsWith("M12 15V3") ? "share" : d.startsWith("M14 4h6v6") ? "external"
    : d === "M9 5l7 7-7 7" ? "chevR" : d === "M15 5l-7 7 7 7" ? "chevL" : d === "M19 12H5M11 6l-6 6 6 6" ? "arrowL" : d === "M5 12h14M13 6l6 6-6 6" ? "arrowR"
    : "other:" + (d || svg.innerHTML).slice(0, 22);
};
// per svg in the control: [svg, ...its parts] as [tx, ty, rotation deg, opacity, dashoffset], plus running animation names
const COV_SNAP = (s) => [...document.querySelector(s).querySelectorAll("svg")].map((v) => {
  const m = (x) => { const c = getComputedStyle(x), M = new DOMMatrix(c.transform === "none" ? undefined : c.transform); return [M.m41, M.m42, Math.atan2(M.m12, M.m11) * 180 / Math.PI, +c.opacity, parseFloat(c.strokeDashoffset) || 0]; };
  return { st: [m(v), ...[...v.querySelectorAll("path,rect,circle")].map(m)], an: v.getAnimations({ subtree: true }).filter((a) => a.playState === "running").map((a) => a.animationName) };
});
// peaks of one svg over the frames, relative to rest
const peaks = (rest, fr, i) => {
  const r = rest[i].st, pk = { svgTx: 0, svgTy: 0, move: 0, rot: 0, dof: 0, op: 0, an: new Set() };
  for (const f of fr) {
    const s = f[i].st; f[i].an.forEach((a) => pk.an.add(a));
    if (Math.abs(s[0][0]) > Math.abs(pk.svgTx)) pk.svgTx = s[0][0];
    if (Math.abs(s[0][1]) > Math.abs(pk.svgTy)) pk.svgTy = s[0][1];
    s.forEach((x, j) => { pk.move = Math.max(pk.move, Math.abs(x[0] - r[j][0]), Math.abs(x[1] - r[j][1])); pk.rot = Math.max(pk.rot, Math.abs(x[2] - r[j][2])); pk.op = Math.max(pk.op, Math.abs(x[3] - r[j][3])); pk.dof = Math.max(pk.dof, Math.abs(x[4] - r[j][4])); });
  }
  return pk;
};
const atRest = (rest, f, i) => rest[i].st.every((x, j) => x.every((v, k) => Math.abs(v - f[i].st[j][k]) < 0.01));
// what each icon's peak must reach (expected values from the spec; the exact samples land on the keyframes)
const PEAK = {
  book: (k) => k.rot >= 8 || `halves opened only ${k.rot.toFixed(2)}deg (want 9)`,
  shuffle: (k) => (k.dof >= 0.9 && k.move >= 2.7) || `strands redraw ${k.dof.toFixed(2)}, heads slid ${k.move.toFixed(2)}px`,
  download: (k) => k.move >= 6.3 || `arrow moved only ${k.move.toFixed(2)}px (want 6 down, 7 above)`,
  share: (k) => k.move >= 6.3 || `arrow moved only ${k.move.toFixed(2)}px (want 7 up, 5 below)`,
  platform: (k) => (k.svgTy <= -1.8 && k.svgTy >= -2.01) || `lift ${k.svgTy.toFixed(2)}px (want -2)`,
  external: (k) => (k.svgTx >= 1.8 && k.svgTx <= 2.01 && k.svgTy <= -1.8 && k.svgTy >= -2.01) || `moved ${k.svgTx.toFixed(2)},${k.svgTy.toFixed(2)} (want 2,-2)`,
  chevR: (k) => Math.abs(k.svgTx - 3) < 0.05 || `nudge peak ${k.svgTx.toFixed(2)}px (want 3)`,
  arrowR: (k) => Math.abs(k.svgTx - 3) < 0.05 || `nudge peak ${k.svgTx.toFixed(2)}px (want 3)`,
  chevL: (k) => Math.abs(k.svgTx + 3) < 0.05 || `nudge peak ${k.svgTx.toFixed(2)}px (want -3)`,
  arrowL: (k) => Math.abs(k.svgTx + 3) < 0.05 || `nudge peak ${k.svgTx.toFixed(2)}px (want -3)`,
  pillbook: (k) => (k.move < 0.01 && k.rot < 0.01 && k.op < 0.01 && !k.an.size) || `the pill's small book moved (${k.move.toFixed(2)}px, ${k.rot.toFixed(2)}deg, op ${k.op.toFixed(2)})`,
};
const NUDGE = new Set(["chevR", "chevL", "arrowR", "arrowL"]);
async function coverage(br, base) {
  const PAGES = require("./pages.js");
  const found = {}, other = {};
  for (const [style, w] of [["glass", 1440], ["shade", 390]]) {
    const ctx = await ctxFor(br, { w, set: { style }, ch: chWith(LINKS), prog: { done: [1] } });
    const p = await ctx.newPage();
    await p.addInitScript(() => addEventListener("click", (e) => { if (window.__noClick && e.target.closest("a,button")) { e.preventDefault(); e.stopPropagation(); } }, true));
    for (const [name, url, setup] of PAGES) {
      await p.goto("about:blank"); await p.goto(base + url, { waitUntil: "load" }); await p.waitForTimeout(700);
      if (setup) await setup(p);
      await p.waitForTimeout(400);
      await p.evaluate(() => { window.__noClick = true; });
      const list = await p.evaluate((kindSrc) => {
        const kind = eval(kindSrc);
        return [...document.querySelectorAll("a,button")].filter((c) => !c.closest("nav") && c.id !== "gear" && !c.classList.contains("so") && !c.classList.contains("row") && c.querySelector("svg") && c.getClientRects().length)
          .map((c, i) => { c.dataset.cov = i; return { i, label: c.textContent.trim().replace(/\s+/g, " ").slice(0, 40), dis: !!(c.disabled || c.getAttribute("aria-disabled") === "true"), icons: [...c.querySelectorAll("svg")].map(kind) }; });
      }, ICON_KIND.toString());
      for (const c of list) {
        const id = `cover ${style}/${w} ${name} "${c.label}"`;
        const mine = c.icons.filter((k) => !k.startsWith("other:"));
        c.icons.filter((k) => k.startsWith("other:")).forEach((k) => { (other[k] = other[k] || new Set()).add(name + ' "' + c.label + '"' + (c.dis ? " (disabled)" : "")); });
        if (!mine.length) continue;
        mine.forEach((k) => { (found[k] = found[k] || new Set()).add((url.startsWith("/#") ? "app " : "static ") + name + ' "' + c.label + '"' + (c.dis ? " (disabled: no motion)" : "")); });
        if (c.dis) continue;
        const sel = `[data-cov="${c.i}"]`, h = p.locator(sel);
        await h.scrollIntoViewIfNeeded(); await p.mouse.move(1, 1); await p.waitForTimeout(250);
        // a control under an open sheet cannot be reached: it is checked on the page without the sheet
        const top = await p.evaluate((s) => { const e = document.querySelector(s), r = e.getBoundingClientRect(), x = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return !!x && x.closest("a,button") === e; }, sel);
        if (!top) { bump("coverCovered"); continue; }
        const centre = async () => { const b = await h.boundingBox(); await p.mouse.move(b.x + b.width / 2, b.y + b.height / 2); };
        for (const [trig, pre, run, after] of [
          ["hover", null, centre, null],
          ["focus", null, async () => { await p.keyboard.press("Shift"); await h.evaluate((e) => e.focus({ preventScroll: true })); }, null],
          ["press", async () => { await centre(); await frames(p, sel, () => 0, null, 300); }, async () => { await p.mouse.down(); }, async () => { await p.mouse.up(); }],
        ]) {
          if (pre) await pre();
          const rest = await p.evaluate(COV_SNAP, sel);
          await run();
          const { fr, key } = await framesK(p, sel, COV_SNAP, sel, 300);
          if (after) await after();
          bump("coverTriggers"); n.coverFrames = (n.coverFrames || 0) + fr.length; n.coverKeySamples = (n.coverKeySamples || 0) + key.s.length;
          c.icons.forEach((k, i) => {
            if (!PEAK[k]) return;
            // the peak is judged on the exact keyframe samples together with the real frames
            const pk = peaks(rest, fr.concat(key.s), i), v = PEAK[k](pk);
            if (v !== true) fail(`${id} ${trig}: ${k} ${v} (${fr.length} frames, ${key.s.length} exact samples)`);
            if (!NUDGE.has(k) && k !== "pillbook") {
              if (!atRest(rest, fr[fr.length - 1], i)) fail(`${id} ${trig}: ${k} not back at rest at the end`);
              if (trig === "press" && ![...pk.an].some((a) => a.endsWith("-p"))) fail(`${id} press: ${k} ran ${[...pk.an].join(",")} without the press keyframes`);
            }
          });
          await h.evaluate((e) => e.blur()); await p.mouse.move(1, 1); await frames(p, sel, () => 0, null, 250);
        }
      }
    }
    await ctx.close();
    process.stdout.write(".");
  }
  console.log("\n  controls with each motion icon:");
  for (const [k, v] of Object.entries(found)) { console.log("   " + k + ":"); [...v].sort().forEach((x) => console.log("     " + x)); }
  console.log("  other icons inside buttons (no hover motion defined):");
  for (const [k, v] of Object.entries(other)) console.log("   " + k + ": " + [...v].sort().join(" | "));
  // the back arrow is defined but not used in any button today
  for (const k of Object.keys(PEAK).filter((x) => x !== "arrowR")) if (!found[k]) fail("cover: no control with the " + k + " icon was found (the scan is broken)");
}

// ------------------------------------------------------------------------------------------------------------- done
async function doneUndo(br, base) {
  for (const style of ["glass", "shade"]) for (const w of [320, 390, 1440]) for (const [mode, cm, rm] of [["normal", false, "no-preference"], ["cm", true, "no-preference"], ["reduced", false, "reduce"]]) {
    const id = `done ${mode} ${style}/${w}`;
    const ctx = await ctxFor(br, { w, rm, set: { style, cm, snd: true }, ch: chWith(LINKS) });
    const p = await ctx.newPage();
    await go(p, base, "/#/day/1", "#dw .dcard");
    await p.evaluate(() => { window.__SN = { done: 0, undo: 0 }; for (const k of ["done", "undo"]) { const f = SND[k]; SND[k] = (...a) => { window.__SN[k]++; return f && f(...a); }; } });
    await p.evaluate(() => document.querySelectorAll("#dw .dcard").forEach((c) => c.click()));
    await p.waitForFunction(() => { const b = document.querySelector('[data-a="done"]'); return b && !b.disabled; });
    await p.waitForTimeout(1200);
    for (const step of ["done", "undo"]) {
      const r = await p.evaluate(([step, ks]) => new Promise((res) => {
        const K = eval(ks), b = document.querySelector('[data-a="done"]'), svg = b.querySelector(".dck"), path = svg.querySelector("path");
        const L = [...b.querySelectorAll(".dlb>span")].filter((e) => getComputedStyle(e).display !== "none");
        const R = (e) => { const r = e.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; };
        const snap = () => ({ t: performance.now(), b: R(b), svg: R(svg), lab: L.map(R), dof: parseFloat(getComputedStyle(path).strokeDashoffset), op: L.map((e) => +getComputedStyle(e).opacity), ds: b.dataset.ds });
        const out = [snap()], t0 = performance.now();
        let key = null;
        b.click();
        out.push(snap());
        // the exact samples of the draw/erase and the label crossfade (transitions), taken when they start
        const tick = () => { if (!key) key = K(b, snap); out.push(snap()); const el = performance.now() - t0; if ((el < 650 || b.getAnimations({ subtree: true }).some((a) => a.playState === "running")) && el < 3000) requestAnimationFrame(tick); else res({ out, key: key || { t: [], s: [], names: [] }, sn: Object.assign({}, window.__SN), name: b.textContent, hidden: [...b.querySelectorAll('.dlb>span[aria-hidden="true"]')].map((e) => e.dataset.l), pressed: b.className }); };
        requestAnimationFrame(tick);
      }), [step, KEYSCAN]);
      bump("doneSteps");
      const s0 = r.out[0];
      let maxd = 0;
      for (const s of r.out.concat(r.key.s)) { [["b", s.b, s0.b], ["svg", s.svg, s0.svg]].forEach(([, a, z]) => a.forEach((v, j) => { maxd = Math.max(maxd, Math.abs(v - z[j])); })); s.lab.forEach((a, i) => a.forEach((v, j) => { maxd = Math.max(maxd, Math.abs(v - s0.lab[i][j])); })); }
      if (maxd > 0.5) fail(`${id} ${step}: something moved ${maxd.toFixed(2)}px`);
      const end = r.out[r.out.length - 1], seq = r.out.slice(1).map((s) => s.dof);
      const wantDof = step === "done" ? 0 : 1;
      if (Math.abs(end.dof - wantDof) > 0.01) fail(`${id} ${step}: check dashoffset ends at ${end.dof}, want ${wantDof}`);
      if (mode === "normal") {
        // draw: the dashoffset falls along the transition's own timeline (erase: rises), never back, and the real frames
        // end exactly at its target; judged on the exact samples, so frame spacing cannot hide or fake a step
        const kd = r.key.s.map((s) => s.dof);
        const inter = kd.filter((v) => v > 0.01 && v < 0.99), mono = kd.every((v, i) => !i || (step === "done" ? v <= kd[i - 1] + 1e-6 : v >= kd[i - 1] - 1e-6));
        if (!r.key.s.length) fail(`${id} ${step}: no transition started`);
        if (inter.length < 3 || !mono) fail(`${id} ${step}: the check did not ${step === "done" ? "draw" : "erase"} gradually (${kd.filter((_, i) => i % 10 === 0).map((v) => v.toFixed(2)).join(",")})`);
        if (!r.key.s.some((s) => s.op.some((o) => o > 0.05 && o < 0.95))) fail(`${id} ${step}: labels did not crossfade`);
        // the crossfade is over 200ms into its own timeline
        const late = r.key.s.filter((_, i) => r.key.t[i] >= 200);
        if (!late.length || late.some((s) => s.op.some((o) => o > 0.02 && o < 0.98))) fail(`${id} ${step}: crossfade still running at 200ms (${late.length} samples after 200ms)`);
      } else {
        const first = r.out[1]; if (Math.abs(first.dof - wantDof) > 0.01 || first.op.some((o) => o > 0.01 && o < 0.99)) fail(`${id} ${step}: not instant with motion off (dof ${first.dof}, op ${first.op})`);
      }
      const wantSn = step === "done" ? { done: 1, undo: 0 } : { done: 1, undo: 1 };
      if (r.sn.done !== wantSn.done || r.sn.undo !== wantSn.undo) fail(`${id} ${step}: sounds ${JSON.stringify(r.sn)} want ${JSON.stringify(wantSn)}`);
      const visible = step === "done" ? "u" : "d";
      if (r.hidden.slice().sort().join() !== ["r", "d", "u"].filter((x) => x !== visible).sort().join()) fail(`${id} ${step}: aria-hidden labels ${r.hidden} (visible should be ${visible})`);
      if ((step === "done") !== /\bo\b/.test(r.pressed)) fail(`${id} ${step}: outlined state wrong (${r.pressed})`);
      await p.waitForTimeout(300);
    }
    // a day already done when the page opens: check fully drawn, nothing animating
    await p.evaluate(() => { localStorage.setItem("gq-prog", JSON.stringify({ done: [1] })); });
    await p.reload(); await p.waitForSelector('[data-a="done"]');
    const ad = await p.evaluate(() => new Promise((res) => {
      const b = document.querySelector('[data-a="done"]'), path = b.querySelector(".dck path"), samples = [];
      const tick = () => { samples.push(parseFloat(getComputedStyle(path).strokeDashoffset)); if (samples.length < 20) requestAnimationFrame(tick); else res({ samples, anims: b.getAnimations({ subtree: true }).length, ds: b.dataset.ds }); };
      tick();
    }));
    bump("doneAlready");
    if (ad.ds !== "u" || ad.samples.some((v) => v !== 0) || ad.anims) fail(`${id} already-done day: ds ${ad.ds}, dashoffset ${ad.samples.join(",")}, ${ad.anims} running animations`);
    await ctx.close();
  }
  // no sound on open, measured with a counter installed before the page scripts
  for (const style of ["glass", "shade"]) {
    const ctx = await ctxFor(br, { w: 390, set: { style, snd: true }, prog: { done: [1] }, ch: chWith(LINKS) });
    await ctx.addInitScript(() => { let n = 0; const O = window.AudioContext; if (O) { window.AudioContext = function (...a) { n++; return new O(...a); }; } window.__acn = () => n; });
    const p = await ctx.newPage(); await go(p, base, "/#/day/1", '[data-a="done"]'); await p.waitForTimeout(800);
    const acn = await p.evaluate(() => window.__acn());
    bump("doneSilentOpen");
    if (acn) fail(`done ${style}: opening an already-done day created ${acn} audio context(s)`);
    await ctx.close();
  }
}

// -------------------------------------------------------------------------------------------------------------- lock
async function lockPill(br, base) {
  for (const style of ["glass", "shade"]) for (const w of [390, 1440]) for (const [mode, cm, touch] of [["mouse", false, false], ["touch", false, true], ["keyboard", false, false], ["cm", true, false]]) {
    const id = `lock ${mode} ${style}/${w}`;
    const ctx = await ctxFor(br, { w, touch, set: { style, cm }, prog: { done: [] } });
    const p = await ctx.newPage();
    await go(p, base, "/#/day/1", "#app .cw.dnav .nx");
    const sel = "#app .cw.dnav .nx";
    const info = await p.evaluate((s) => { const e = document.querySelector(s); return { tag: e.tagName, dis: e.getAttribute("aria-disabled"), hasDisabled: e.hasAttribute("disabled"), href: e.getAttribute("href"), pe: getComputedStyle(e).pointerEvents }; }, sel);
    if (info.tag !== "BUTTON" || info.dis !== "true" || info.hasDisabled || info.href !== null || info.pe === "none") fail(`${id}: locked pill is ${JSON.stringify(info)}`);
    const snap = () => p.evaluate((s) => { const e = document.querySelector(s), c = getComputedStyle(e), k = e.querySelector(".ps svg"); return { sh: c.boxShadow, tr: c.transform, bg: c.backgroundColor, op: c.opacity, ktr: getComputedStyle(k).transform, an: k.getAnimations().length }; }, sel);
    await p.locator(sel).scrollIntoViewIfNeeded(); await p.mouse.move(1, 1); await p.waitForTimeout(400);
    const rest = await snap();
    if (!touch) {
      await p.hover(sel, { force: true }); await p.waitForTimeout(400); const hv = await snap();
      bump("lockHover");
      if (JSON.stringify(hv) !== JSON.stringify(rest)) fail(`${id}: hover changed the locked pill ${JSON.stringify(rest)} -> ${JSON.stringify(hv)}`);
      await p.mouse.move(1, 1);
    }
    await p.evaluate(() => { window.__AS = []; document.querySelectorAll(".toast").forEach((t) => t.remove()); });
    const hash0 = await p.evaluate(() => location.hash);
    if (touch) await p.tap(sel, { force: true }); else if (mode === "keyboard") { await p.keyboard.press("Shift"); await p.focus(sel); await p.keyboard.press("Enter"); } else await p.click(sel, { force: true });
    const { fr: realL, key: keyL } = await framesK(p, sel, (s) => new DOMMatrix(getComputedStyle(document.querySelector(s + " .ps svg")).transform).m41, sel, 300);
    const mids = realL.concat(keyL.s);
    const r = await p.evaluate(() => ({ toast: [...document.querySelectorAll(".toast")].map((t) => t.textContent.trim()), hash: location.hash, as: window.__AS.slice() }));
    const lockText = await p.evaluate(() => lockMsg(2));
    bump("lockTap");
    if (r.hash !== hash0) fail(`${id}: tap navigated ${hash0} -> ${r.hash}`);
    if (r.toast.length !== 1 || r.toast[0] !== lockText) fail(`${id}: toast ${JSON.stringify(r.toast)} want ${lockText}`);
    const amp = Math.max(...mids.map(Math.abs));
    if (mode === "cm") { if (amp || r.as.length) fail(`${id}: shook with motion off (${mids})`); }
    else {
      if (!(amp >= 1.8 && amp <= 2.01) || r.as.filter((x) => x.startsWith("i-shake")).length !== 1) fail(`${id}: shake amplitude ${amp} (${mids.map((x) => x.toFixed(2))}), starts ${r.as}`);
    }
    const end = await snap(); if (end.ktr !== "none") fail(`${id}: lock not back at rest (${end.ktr})`);
    await ctx.close();
  }
  // reduced motion: toast, no shake
  const ctx = await ctxFor(br, { w: 390, rm: "reduce", prog: { done: [] } });
  const p = await ctx.newPage(); await go(p, base, "/#/day/1", "#app .cw.dnav .nx");
  await p.evaluate(() => { window.__AS = []; }); await p.click("#app .cw.dnav .nx", { force: true }); await p.waitForTimeout(500);
  const r = await p.evaluate(() => ({ as: window.__AS.length, toast: document.querySelectorAll(".toast").length }));
  bump("lockReduced");
  if (r.as || r.toast !== 1) fail(`lock reduced: ${r.as} animations, ${r.toast} toasts`);
  await ctx.close();
}

// locked day dots on the challenge page: a tap (mouse, touch, Enter) shows the lock toast and shakes the lock once
// (peak +-2px, measured every frame); hover does nothing; motion off (toggle or OS) shows the toast without the shake
async function lockDots(br, base) {
  const LOCK_TX = (s) => new DOMMatrix(getComputedStyle(document.querySelector(s + " svg.i-lk")).transform).m41;
  for (const style of ["glass", "shade"]) for (const w of [390, 1440]) for (const [mode, cm, touch, rm] of [["mouse", false, false], ["touch", false, true], ["keyboard", false, false], ["cm", true, false], ["reduced", false, false, "reduce"]]) {
    const id = `lockdot ${mode} ${style}/${w}`;
    const ctx = await ctxFor(br, { w, touch, rm, set: { style, cm }, prog: { done: [] } });
    const p = await ctx.newPage();
    await go(p, base, "/#/challenge", "#app .dy.lk");
    const d = await p.evaluate(() => { const e = document.querySelector("#app .dy.lk"); e.id = "ldot"; return +e.dataset.d; });
    const sel = "#ldot";
    await p.locator(sel).scrollIntoViewIfNeeded(); await p.mouse.move(1, 1); await p.waitForTimeout(300);
    if (!touch) {
      await p.hover(sel); const hk = await framesK(p, sel, LOCK_TX, sel, 400), fr = hk.fr.concat(hk.key.s);
      bump("lockDotHover");
      if (fr.some((x) => Math.abs(x) > 0.001)) fail(`${id}: the lock moved on hover (${Math.max(...fr.map(Math.abs)).toFixed(2)}px)`);
      await p.mouse.move(1, 1);
    }
    await p.evaluate(() => { window.__AS = []; document.querySelectorAll(".toast").forEach((t) => t.remove()); });
    const hash0 = await p.evaluate(() => location.hash);
    if (touch) await p.tap(sel); else if (mode === "keyboard") { await p.keyboard.press("Shift"); await p.focus(sel); await p.keyboard.press("Enter"); } else await p.click(sel);
    const { fr, key } = await framesK(p, sel, LOCK_TX, sel, 300);
    const r = await p.evaluate(() => ({ toast: [...document.querySelectorAll(".toast")].map((t) => t.textContent.trim()), hash: location.hash, as: window.__AS.slice() }));
    const want = await p.evaluate((n) => lockMsg(n), d);
    // peak over the real frames and the exact keyframe samples; "back at rest" stays on the last real frame
    const amp = Math.max(...fr.concat(key.s).map(Math.abs));
    bump("lockDotTap");
    if (r.hash !== hash0) fail(`${id}: tap navigated ${hash0} -> ${r.hash}`);
    if (r.toast.length !== 1 || r.toast[0] !== want) fail(`${id}: toast ${JSON.stringify(r.toast)} want ${want}`);
    if (cm || rm) { if (amp || r.as.length) fail(`${id}: shook with motion off (${amp.toFixed(2)}px, ${r.as})`); }
    else if (!(amp >= 1.8 && amp <= 2.01) || r.as.filter((x) => x.startsWith("i-shake")).length !== 1) fail(`${id}: shake peak ${amp.toFixed(2)}px over ${fr.length} frames (want 2), starts ${r.as}`);
    if (Math.abs(fr[fr.length - 1]) > 0.001) fail(`${id}: lock not back at rest`);
    await ctx.close();
  }
}

// ------------------------------------------------------------------------------------------------------------- quiz
// Quiz marks, when an answer is revealed: the correct mark draws (dashoffset falls over several frames to 0), the wrong
// mark shakes once (peak +-2px). Motion off (toggle or OS) shows both at once. A later re-render does not replay them.
async function quizMarks(br, base) {
  const SNAP = () => { const k = document.querySelector("#app .opt svg.qk path"), x = document.querySelector("#app .opt svg.qx"); return { dof: k ? parseFloat(getComputedStyle(k).strokeDashoffset) || 0 : null, tx: x ? new DOMMatrix(getComputedStyle(x).transform).m41 : null }; };
  for (const style of ["glass", "shade"]) for (const w of [390, 1440]) for (const [mode, cm, rm] of [["normal", false], ["cm", true], ["reduced", false, "reduce"]]) {
    const id = `quiz ${mode} ${style}/${w}`;
    const ctx = await ctxFor(br, { w, rm, set: { style, cm } });
    const p = await ctx.newPage();
    await go(p, base, "/#/quiz", "#app .opt");
    await p.evaluate(() => { window.__AS = []; });
    // answer wrongly so both marks show
    await p.evaluate(() => { const q = Q.qs[Q.i], i = q.o.findIndex((x) => x !== q.w); document.querySelector(`#app .opt[data-o="${i}"]`).click(); });
    const { fr, key } = await framesK(p, "#app .opts", SNAP, null, 300);
    const as = await p.evaluate(() => window.__AS.slice());
    bump("quizReveal");
    if (fr[0].dof === null || fr[0].tx === null) { fail(`${id}: marks not shown (${JSON.stringify(fr[0])})`); await ctx.close(); continue; }
    // the draw and the shake are judged on the exact samples along their own timelines (plus the real frames for the
    // shake's peak); "at rest at the end" stays on the last real frame
    const all = fr.concat(key.s), end = fr[fr.length - 1], amp = Math.max(...all.map((x) => Math.abs(x.tx)));
    const dofs = cm || rm ? all.map((x) => x.dof) : key.s.map((x) => x.dof);
    if (Math.abs(end.dof) > 0.001 || Math.abs(end.tx) > 0.001) fail(`${id}: marks not at rest at the end (${JSON.stringify(end)})`);
    if (cm || rm) {
      if (dofs.some((v) => Math.abs(v) > 0.001) || amp > 0.001 || as.length) fail(`${id}: marks animated with motion off (dof ${dofs.slice(0, 5)}, shake ${amp}, ${as})`);
    } else {
      const inter = dofs.filter((v) => v > 0.01 && v < 0.99), mono = dofs.every((v, i) => !i || v <= dofs[i - 1] + 1e-6);
      if (inter.length < 3 || !mono) fail(`${id}: the correct mark did not draw (${dofs.map((v) => v.toFixed(2)).join(",")})`);
      if (!(amp >= 1.8 && amp <= 2.01)) fail(`${id}: the wrong mark shook ${amp.toFixed(2)}px over ${fr.length} frames (want 2)`);
      if (as.filter((x) => x.startsWith("i-shake")).length !== 1 || as.filter((x) => x.startsWith("i-draw")).length !== 1) fail(`${id}: animation starts ${as}`);
    }
    // re-render (e.g. a theme change): no replay
    await p.evaluate(() => { window.__AS = []; render(); });
    const ag = await framesK(p, "#app .opts", SNAP, null, 300), again = ag.fr.concat(ag.key.s);
    bump("quizRerender");
    if ((await p.evaluate(() => window.__AS.length)) || again.some((x) => Math.abs(x.dof) > 0.001 || Math.abs(x.tx) > 0.001)) fail(`${id}: marks replayed on re-render`);
    await ctx.close();
  }
}

// ------------------------------------------------------------------------------------------------------------ video
async function videoCard(br, base) {
  const CASES = [
    ["0 links", {}], ["1 link", { reelTt: LINKS.reelTt }], ["2 links", { reelIg: LINKS.reelIg, reelYt: LINKS.reelYt }], ["3 links", LINKS],
    ["old link only", { reel: "https://www.instagram.com/reel/old/" }], ["old link, unknown host", { reel: "https://example.com/r" }],
    ["new + old", { reelYt: LINKS.reelYt, reel: "https://www.instagram.com/reel/old/" }],
  ];
  const WANT = { "0 links": [], "1 link": ["تيك توك"], "2 links": ["إنستجرام", "يوتيوب"], "3 links": ["إنستجرام", "تيك توك", "يوتيوب"], "old link only": ["إنستجرام"], "old link, unknown host": [], "new + old": ["يوتيوب"] };
  for (const style of ["glass", "shade"]) for (const w of [320, 390, 1440]) for (const [label, links] of CASES) for (const done of [false, true]) {
    const id = `video ${style}/${w} ${label}${done ? " (done)" : ""}`;
    const ctx = await ctxFor(br, { w, set: { style, cm: true }, ch: chWith(links), prog: { done: done ? [1] : [] } });
    const p = await ctx.newPage();
    await go(p, base, "/#/day/1", "#dw .dcard");
    const r = await p.evaluate(() => {
      const R = (e) => e && e.getBoundingClientRect();
      const cards = [...document.querySelectorAll("#dw .dcard")], vc = document.querySelector(".vcard"), db = document.querySelector('[data-a="done"]');
      const pv = document.querySelector(".cw.dnav .pv"), nx = document.querySelector(".cw.dnav .nx");
      const vbs = [...document.querySelectorAll(".vcard a.vb")].map((a) => {
        const s = a.querySelector("span"), r = a.getBoundingClientRect(), rs = s.getBoundingClientRect(), ri = a.querySelector("svg").getBoundingClientRect();
        return { t: s.textContent, href: a.getAttribute("href"), target: a.target, rel: a.rel, w: r.width, top: r.top, h: r.height, trunc: s.scrollWidth > s.clientWidth + 0.5 || rs.left < r.left || rs.right > r.right || ri.left < r.left || ri.right > r.right, o: a.classList.contains("o") && a.classList.contains("btn"), icon: a.querySelector("svg").outerHTML.replace(/ class="im i-pf" aria-hidden="true"/, "") };
      });
      const lastCard = cards[cards.length - 1];
      return { title: vc && vc.querySelector("h2").textContent, vbs, order: { cardsBottom: R(lastCard).bottom, vcTop: vc && R(vc).top, vcBottom: vc && R(vc).bottom, doneTop: R(db).top, doneBottom: R(db).bottom, pillTop: Math.min(R(pv).top, R(nx).top) }, overflowX: document.documentElement.scrollWidth > innerWidth, IC: Object.fromEntries(Object.entries(IC).map(([k, v]) => { const t = document.createElement("template"); t.innerHTML = v; return [k, t.content.firstChild.outerHTML]; })) };
    });
    bump("videoCases");
    const names = r.vbs.map((x) => x.t);
    if (JSON.stringify(names) !== JSON.stringify(WANT[label])) fail(`${id}: buttons ${JSON.stringify(names)} want ${JSON.stringify(WANT[label])}`);
    if (!WANT[label].length && r.title) fail(`${id}: the card shows with no links`);
    if (WANT[label].length && r.title !== "شاهد شرح اليوم") fail(`${id}: title ${r.title}`);
    for (const b of r.vbs) {
      if (b.target !== "_blank" || b.rel !== "noopener") fail(`${id} ${b.t}: target ${b.target} rel ${b.rel}`);
      if (b.trunc) fail(`${id} ${b.t}: truncated or overflowing`);
      if (!b.o) fail(`${id} ${b.t}: not an outlined .btn`);
      const pf = { "إنستجرام": "ig", "تيك توك": "tt", "يوتيوب": "yt" }[b.t];
      if (b.icon !== r.IC[pf]) fail(`${id} ${b.t}: icon is not the footer social icon`);
    }
    if (r.vbs.length > 1) {
      if (Math.max(...r.vbs.map((b) => b.w)) - Math.min(...r.vbs.map((b) => b.w)) > 0.5) fail(`${id}: unequal widths ${r.vbs.map((b) => b.w.toFixed(1))}`);
      if (Math.max(...r.vbs.map((b) => b.top)) - Math.min(...r.vbs.map((b) => b.top)) > 0.5) fail(`${id}: not one row`);
    }
    const o = r.order;
    const seq = o.vcTop == null ? [o.cardsBottom, o.doneTop, o.doneBottom, o.pillTop] : [o.cardsBottom, o.vcTop, o.vcBottom, o.doneTop, o.doneBottom, o.pillTop];
    if (seq.some((v, i) => i && v < seq[i - 1] - 0.5)) fail(`${id}: block order wrong ${JSON.stringify(o)}`);
    if (r.overflowX) fail(`${id}: horizontal overflow`);
    // shadow rule on this page
    await p.addScriptTag({ content: shadowViolations.toString() }); await p.mouse.move(1, 1);
    const v = await p.evaluate(() => shadowViolations());
    for (const x of v) fail(`${id} shadow: ${x.a} -> ${x.b} gap ${x.gap} < reach ${x.reach}`);
    if (label === "3 links" && !done) await p.screenshot({ path: __dirname + `/out/video-${style}-${w}.png`, fullPage: true });
    if (label === "1 link" && !done && w === 320) await p.screenshot({ path: __dirname + `/out/video1-${style}-${w}.png`, fullPage: true });
    if (label === "2 links" && !done && w === 320) await p.screenshot({ path: __dirname + `/out/video2-${style}-${w}.png`, fullPage: true });
    // the platform buttons follow the outlined tier: glass never changes colour, shade inverts with no size change
    if (r.vbs.length && w !== 320) {
      const snap = () => p.evaluate(() => { const a = document.querySelector(".vcard a.vb"), c = getComputedStyle(a), r = a.getBoundingClientRect(); return { bg: c.backgroundColor, c: c.color, w: r.width.toFixed(2), h: r.height.toFixed(2) }; });
      const vars = await p.evaluate(() => { const d = document.createElement("div"); document.body.appendChild(d); const g = (v) => { d.style.background = "var(" + v + ")"; return getComputedStyle(d).backgroundColor; }; const o = { tx: g("--tx"), bg: g("--bg") }; d.remove(); return o; });
      await p.locator(".vcard a.vb").first().scrollIntoViewIfNeeded(); await p.mouse.move(1, 1); await p.waitForTimeout(450); await settle(p, ".vcard a.vb"); const rest = await snap();
      await p.hover(".vcard a.vb"); await p.waitForTimeout(450); await settle(p, ".vcard a.vb"); const hov = await snap(); await p.mouse.move(1, 1);
      await p.keyboard.press("Shift"); await p.focus(".vcard a.vb"); await p.waitForTimeout(450); await settle(p, ".vcard a.vb"); const foc = await snap(); await p.evaluate(() => document.activeElement.blur());
      bump("videoTier");
      for (const [st, s] of [["hover", hov], ["focus", foc]]) {
        if (style === "glass" && (s.bg !== rest.bg || s.c !== rest.c)) fail(`${id} ${st}: glass colour changed`);
        if (style === "shade" && !(s.bg === vars.tx && s.c === vars.bg)) fail(`${id} ${st}: shade did not invert (${s.bg} ${s.c})`);
        if (s.w !== rest.w || s.h !== rest.h) fail(`${id} ${st}: size changed`);
      }
    }
    await ctx.close();
  }
  // the old "watch the clip" button is gone
  const html = fs.readFileSync(ROOT + "/index.html", "utf8");
  if (html.includes("شاهد المقطع")) fail("video: the old button label is still in index.html");
}

// ------------------------------------------------------------------------------------------------------------ admin
async function admin(br, base) {
  const ctx = await br.newContext({ viewport: { width: 1200, height: 900 } });
  // demo mode only: an empty Firebase config, and nothing may reach Google
  await ctx.route("**/firebase-config.js", (r) => r.fulfill({ contentType: "text/javascript", body: "window.FIREBASE_CONFIG={};" }));
  await ctx.route(/googleapis|gstatic|firebaseio|firebaseapp/, (r) => { fail("admin: a request reached " + r.request().url()); return r.abort(); });
  const ch = JSON.parse(JSON.stringify(CH0));
  ch.days[1].reel = "https://www.tiktok.com/@a/video/9"; // day 2: only the old link
  ch.days[2].reel = "https://example.com/r"; // day 3: old link on an unknown host
  // the demo store needs the words so day references resolve
  const words = JSON.parse(fs.readFileSync(ROOT + "/words.json", "utf8"));
  await ctx.addInitScript(([c, w]) => { if (!localStorage.getItem("gqch")) { localStorage.setItem("gqch", JSON.stringify(c)); localStorage.setItem("gqad", JSON.stringify({ rev: 1, surahs: w })); } }, [ch, words]);
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(base + "/admin/index.html"); await p.waitForSelector('[data-a="tab"][data-v="c"]', { timeout: 20000 });
  await p.click('[data-a="tab"][data-v="c"]'); // the challenge tab
  await p.waitForSelector('[data-a="chDay"]', { timeout: 20000 });
  const open = async (d) => { await p.click(`[data-a="chDay"][data-v="${d}"]`); await p.waitForSelector('[data-f="c.reelIg"]'); };
  // closing a window with edits asks first ("تجاهل" discards them)
  const closeMd = async () => { await p.click('#md [data-a="close"]'); if (await p.isVisible("#cd.open")) await p.click('#cd [data-cd="yes"]'); await p.waitForSelector("#md .mb", { state: "detached" }); };
  const fields = () => p.evaluate(() => ["reelIg", "reelTt", "reelYt"].map((k) => document.querySelector(`[data-f="c.${k}"]`).value));
  const labels = await (async () => { await open(1); return p.evaluate(() => [...document.querySelectorAll("label.lb")].map((l) => l.textContent.trim())); })();
  bump("adminFields");
  for (const l of ["رابط إنستجرام", "رابط تيك توك", "رابط يوتيوب"]) if (!labels.some((x) => x.startsWith(l))) fail("admin: missing field " + l);
  if (await p.$('[data-f="c.reel"]')) fail("admin: the old single link field is still shown");
  await closeMd();
  // prefill from the old single link by host
  await open(2); const pre2 = await fields(); bump("adminPrefill");
  if (JSON.stringify(pre2) !== JSON.stringify(["", "https://www.tiktok.com/@a/video/9", ""])) fail("admin: day 2 prefill " + JSON.stringify(pre2));
  await closeMd();
  await open(3); const pre3 = await fields();
  if (JSON.stringify(pre3) !== JSON.stringify(["", "", ""])) fail("admin: day 3 (unknown host) prefill " + JSON.stringify(pre3));
  await closeMd();
  // save and wait until the modal closed (saved) or shows a field error (rejected)
  const saveDay = async () => { await p.click('[data-a="chSaveDay"]'); await p.waitForFunction(() => getComputedStyle(document.getElementById("md")).display === "none" || document.querySelector('#md [aria-invalid="true"]'), null, { timeout: 5000 }).catch(() => {}); await p.waitForTimeout(50); };
  const saved = () => p.evaluate(() => JSON.parse(localStorage.getItem("gqch")).days[0]);
  const VALID = {
    reelIg: ["https://instagram.com/reel/a", "https://www.instagram.com/reel/a/", "HTTPS://INSTAGRAM.COM/p/x"],
    reelTt: ["https://tiktok.com/@a/video/1", "https://vm.tiktok.com/ZM123/", "https://www.tiktok.com/@a/video/1"],
    reelYt: ["https://youtube.com/shorts/a", "https://www.youtube.com/watch?v=a", "https://m.youtube.com/watch?v=a", "https://youtu.be/a"],
  };
  const INVALID = {
    reelIg: ["http://instagram.com/reel/a", "https://instagram.com.evil.io/x", "https://youtube.com/shorts/a", "instagram.com/reel/a", "https://evilinstagram.com/x", "javascript:alert(1)"],
    reelTt: ["http://tiktok.com/@a", "https://tiktok.co/@a", "https://vm.tiktok.com.evil.io/x", "https://instagram.com/reel/a", "ftp://tiktok.com/x"],
    reelYt: ["http://youtu.be/a", "https://youtube.co/watch", "https://music.youtube.com/watch?v=a", "https://youtu.be.evil.io/a", "https://tiktok.com/@a"],
  };
  for (const [k, list] of Object.entries(INVALID)) for (const v of list) {
    await open(1);
    const before = await saved();
    await p.fill(`[data-f="c.${k}"]`, v); await saveDay();
    const r = await p.evaluate((k) => { const i = document.querySelector(`[data-f="c.${k}"]`), e = i && document.getElementById(i.getAttribute("aria-describedby") || "-"); return { open: !!i, invalid: i && i.getAttribute("aria-invalid"), err: e && e.textContent, near: e && i.nextElementSibling === e }; }, k);
    const after = await saved();
    bump("adminInvalid");
    if (!r.open || r.invalid !== "true" || !r.err || !r.near || !/[؀-ۿ]/.test(r.err)) fail(`admin: invalid ${k} ${v} shows no error next to the field ${JSON.stringify(r)}`);
    if (JSON.stringify(after) !== JSON.stringify(before)) fail(`admin: invalid ${k} ${v} was saved`);
    await closeMd();
  }
  for (const [k, list] of Object.entries(VALID)) for (const v of list) {
    await open(1);
    await p.fill(`[data-f="c.${k}"]`, v); await saveDay();
    const after = await saved();
    bump("adminValid");
    if (await p.$('[data-f="c.reelIg"]')) { fail(`admin: valid ${k} ${v} was rejected`); await closeMd(); continue; }
    if (after[k] !== v) fail(`admin: valid ${k} ${v} saved as ${after[k]}`);
    if (after.reel !== CH0.days[0].reel) fail(`admin: the old link changed (${after.reel})`);
  }
  // clearing a link removes it; the old link of day 2 survives saving the prefilled form
  await open(1); for (const k of ["reelIg", "reelTt", "reelYt"]) await p.fill(`[data-f="c.${k}"]`, ""); await saveDay();
  const cleared = await saved(); bump("adminClear");
  if (["reelIg", "reelTt", "reelYt"].some((k) => k in cleared)) fail("admin: cleared links still stored " + JSON.stringify(cleared));
  await open(2); await saveDay();
  const d2 = await p.evaluate(() => JSON.parse(localStorage.getItem("gqch")).days[1]);
  if (d2.reel !== "https://www.tiktok.com/@a/video/9" || d2.reelTt !== "https://www.tiktok.com/@a/video/9") fail("admin: day 2 after save " + JSON.stringify(d2));
  // the Firestore document the admin would write keeps the links next to the old link (no notes)
  const doc = await p.evaluate(() => chDoc(CH));
  if (doc.days[1].reelTt !== d2.reelTt || doc.days[1].reel !== d2.reel || JSON.stringify(doc).includes("note")) fail("admin: chDoc " + JSON.stringify(doc.days[1]));
  if (errs.length) fail("admin: page errors " + errs.join(" | "));
  await ctx.close();
}

(async () => {
  fs.mkdirSync(__dirname + "/out", { recursive: true });
  const { server, base } = await serve();
  const br = await pw.chromium.launch();
  if (want("icons")) { await iconRestShape(br); await iconMotion(br, base); console.log("\nicons done"); }
  if (want("cover")) { await coverage(br, base); console.log("\ncoverage done"); }
  if (want("done")) { await doneUndo(br, base); console.log("done/undo done"); }
  if (want("lock")) { await lockPill(br, base); await lockDots(br, base); console.log("lock done"); }
  if (want("quiz")) { await quizMarks(br, base); console.log("quiz done"); }
  if (want("video")) { await videoCard(br, base); console.log("video done"); }
  if (want("admin")) { await admin(br, base); console.log("admin done"); }
  await br.close(); server.close();
  console.log("counts", JSON.stringify(n));
  console.log(fails.length ? "FAILURES (" + fails.length + "):\n" + fails.join("\n") : "ALL CHECKS PASSED");
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
