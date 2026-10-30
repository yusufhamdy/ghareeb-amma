// Highlight vs real ink, from pixels. Page: three element screenshots per mark (normal / mark text transparent /
// mark text transparent + no highlight); ink = diff(1,2), highlight = diff(2,3). Card: the same with the card's
// fillText (mark text) and highlight fill skipped. Reports the four paddings per word; pass = spread <= 2px, all > 0.
const REPO = require("path").resolve(__dirname, "../..").split(require("path").sep).join("/");
const pw = require("playwright");
const { PNG } = require("playwright-core/lib/utilsBundle");
const fs = require("fs"); const { serve } = require("./lib.js");
const args = process.argv.slice(2), WIDTHS = (args[0] || "390").split(",").map(Number), STYLES = (args[1] || "glass").split(","), ENG = args[2] || "chromium", CARD = args[3] !== "nocard";
const bbox = (a, b, w, h, thr) => { let l = 1e9, r = -1, t = 1e9, bt = -1; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); if (d > thr) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > bt) bt = y; } } return r < 0 ? null : { l, r: r + 1, t, b: bt + 1 }; };
const pads = (ink, hl, s) => ink && hl ? { t: (ink.t - hl.t) / s, b: (hl.b - ink.b) / s, l: (ink.l - hl.l) / s, r: (hl.r - ink.r) / s } : null;
(async () => {
  const { server, base } = await serve(); const br = await pw[ENG].launch(); const out = { fails: [], rows: [] }; let n = 0;
  const shotPNG = async (p, clip) => PNG.sync.read(await p.screenshot({ clip }));
  for (const w of WIDTHS) for (const style of STYLES) {
    const ctx = await br.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2 });
    await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); }, { style, mode: "light", pal: "def", gl: 3, gv: 2, snd: false, cm: true });
    const p = await ctx.newPage(); await p.goto(base + "/", { waitUntil: "load" }); await p.waitForSelector("#app h1"); await p.evaluate(() => document.fonts.ready);
    const ids = await p.evaluate(() => W.map((x) => x.id));
    await p.addStyleTag({ content: ".hlx-t mark[data-hx]{color:transparent!important}.hlx-h mark[data-hx]::before{visibility:hidden}" });
    const statics = Object.fromEntries(fs.readdirSync(REPO + "/public/word").map((f) => [/href="\/#\/word\/([\d-]+)"/.exec(fs.readFileSync(REPO + "/public/word/" + f, "utf8"))[1], f]));
    for (const view of ["app", "static"]) for (const id of ids) {
      if (view === "app") { await p.evaluate((h) => { location.hash = h; }, "#/word/" + id); await p.waitForFunction((id) => { const b = document.querySelector('[data-a="card"]'); return b && b.dataset.id === id; }, id); }
      else { await p.goto(base + "/word/" + statics[id], { waitUntil: "load" }); await p.addStyleTag({ content: ".hlx-t mark[data-hx]{color:transparent!important}.hlx-h mark[data-hx]::before{visibility:hidden}" }); }
      await p.waitForTimeout(250);
      const marks = await p.evaluate(() => [...document.querySelectorAll("main mark, #app mark")].map((m) => { m.scrollIntoView({ block: "center" }); const r = m.getBoundingClientRect(), fs = parseFloat(getComputedStyle(m).fontSize); return { x: r.x - fs, y: r.y - fs, w: r.width + 2 * fs, h: r.height + 2 * fs, fs, measured: !!m.style.getPropertyValue("--hl-w"), t: m.textContent }; }));
      for (const [k, m] of marks.entries()) {
        await p.evaluate((k) => { const m = [...document.querySelectorAll("main mark, #app mark")][k]; m.scrollIntoView({ block: "center" }); document.documentElement.classList.remove("hlx-t", "hlx-h"); document.querySelectorAll("mark[data-hx]").forEach((x) => x.removeAttribute("data-hx")); m.setAttribute("data-hx", ""); }, k);
        const r = await p.evaluate((k) => { const m = [...document.querySelectorAll("main mark, #app mark")][k], b = m.getBoundingClientRect(), fs = parseFloat(getComputedStyle(m).fontSize); return { x: Math.max(0, b.x - fs), y: Math.max(0, b.y - fs), width: b.width + 2 * fs, height: b.height + 2 * fs }; }, k);
        const a = await shotPNG(p, r); await p.evaluate(() => document.documentElement.classList.add("hlx-t"));
        const b = await shotPNG(p, r); await p.evaluate(() => document.documentElement.classList.add("hlx-h"));
        const c = await shotPNG(p, r); await p.evaluate(() => document.documentElement.classList.remove("hlx-t", "hlx-h"));
        const ink = bbox(a.data, b.data, a.width, a.height, 20), hl = bbox(b.data, c.data, b.width, b.height, 6);
        const pd = pads(ink, hl, 2), vals = pd ? Object.values(pd) : [];
        const edge = ink && (ink.l <= 0 || ink.t <= 0 || ink.r >= a.width || ink.b >= a.height);
        const okk = pd && Math.max(...vals) - Math.min(...vals) <= 2 && Math.min(...vals) > 0 && !edge && m.measured; n++;
        out.rows.push({ w, style, view, id, k, t: m.t, fs: m.fs, pad: pd && Object.fromEntries(Object.entries(pd).map(([x, v]) => [x, +v.toFixed(1)])), measured: m.measured });
        if (!okk) out.fails.push(`${w}/${style}/${view} ${id}#${k} «${m.t}» pads ${JSON.stringify(pd && Object.fromEntries(Object.entries(pd).map(([x, v]) => [x, +v.toFixed(1)])))} measured=${m.measured} edge=${edge}`);
      }
    }
    // save-as-image card (both sizes): ink from skipping the mark's fillText, highlight from skipping its fill
    if (CARD && w === WIDTHS[0]) {
      await p.goto(base + "/", { waitUntil: "load" }); await p.waitForSelector("#app h1"); await p.evaluate(() => document.fonts.ready);
      await p.evaluate(() => cardFonts());
      for (const id of ids) for (const size of ["n", "s"]) {
        const res = await p.evaluate(({ id, size }) => {
          const w = byId(id), hl = w.ay.segments.map((g) => g.hl).filter(Boolean), P = CanvasRenderingContext2D.prototype, ft = P.fillText, fl = P.fill; let mode = 0;
          P.fillText = function (t, ...r) { if (mode >= 1 && this.canvas.width === 1080 && hl.includes(t) && parseFloat((String(this.font).match(/([\d.]+)px/) || [0, 999])[1]) < 100) return; return ft.call(this, t, ...r); };
          P.fill = function (...r) { if (mode >= 2 && /0\.2\)$/.test(String(this.fillStyle).replace(/\s/g, "")) ) return; return fl.apply(this, r); };
          const shots = [0, 1].map((md) => { mode = md; const c = renderCard(w, size); return { d: c.getContext("2d").getImageData(0, 0, c.width, c.height).data, W: c.width, H: c.height, marks: c.__card.marks }; });
          P.fillText = ft; P.fill = fl;
          const bb = (a, b, thr) => { let l = 1e9, r = -1, t = 1e9, bt = -1; const W = shots[0].W; for (let y = 0; y < shots[0].H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4; const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); if (d > thr) { if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > bt) bt = y; } } return r < 0 ? null : { l, r: r + 1, t, b: bt + 1 }; };
          const ms = shots[0].marks; return { ink: bb(shots[0].d, shots[1].d, 20), hl: ms.length ? { l: Math.min(...ms.map((m) => m.x)), r: Math.max(...ms.map((m) => m.x + m.w)), t: Math.min(...ms.map((m) => m.y)), b: Math.max(...ms.map((m) => m.y + m.h)) } : null, n: ms.length };
        }, { id, size });
        const pd = pads(res.ink, res.hl, 1), vals = pd ? Object.values(pd) : []; n++;
        const okk = pd && Math.max(...vals) - Math.min(...vals) <= 2 && Math.min(...vals) > 0;
        out.rows.push({ w: "card", style, view: "card-" + size, id, pad: pd && Object.fromEntries(Object.entries(pd).map(([x, v]) => [x, +v.toFixed(1)])) });
        if (!okk) out.fails.push(`card-${size}/${style} ${id} pads ${JSON.stringify(pd)} marks=${res.n}`);
      }
    }
    await ctx.close();
  }
  fs.writeFileSync(__dirname + "/hl-" + ENG + ".json", JSON.stringify(out, null, 1));
  console.log(ENG, "highlights", n, out.fails.length ? "FAIL (" + out.fails.length + ")\n" + out.fails.slice(0, 25).join("\n") : "ALL PASS");
  await br.close(); server.close();
})();
