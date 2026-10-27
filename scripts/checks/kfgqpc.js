// KFGQPC Quran font: component metrics and highlight/divider pixel checks, for a before/after comparison.
//   node kfgqpc.js [root] [out.json]      root defaults to the working tree's public/
// For each theme (glass-dark-gold, shade-light-gold) and width (400, 1440) it records, for every word page:
// the word card, the headword (height, lines), the ayah block (height, lines), each highlight pill (its box, the
// ink it must contain - measured from pixels with everything else hidden - and the margin on each side) and the
// divider gap (dashed line top minus the headword's lowest ink pixel); plus the surah list rows / shade tiles, the
// surah page heading and rows, an open day card and the quiz card. Prints failures (ink outside a pill, divider
// gap not 20px +-1) and writes the numbers to out.json.
const { serve } = require("./lib.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");

const ROOT = process.argv[2] || path.resolve(__dirname, "../../public");
const OUT = process.argv[3] || path.join(__dirname, "out/kfgqpc/metrics.json");
const THEMES = [{ style: "glass", mode: "dark", pal: "gold" }, { style: "shade", mode: "light", pal: "gold" }];
const WIDTHS = [400, 1440];
const DSF = 2;

async function ctxFor(br, t, w) {
  const ctx = await br.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: DSF, reducedMotion: "reduce" });
  await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); },
    { style: t.style, mode: t.mode, pal: t.pal, gl: 50, gv: 3, snd: false, cm: true });
  // the same quiz questions in both runs: a seeded Math.random
  await ctx.addInitScript(() => { let s = 12345; Math.random = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); });
  return ctx;
}

// ink bbox (CSS px, page coords) of what differs between two screenshots of the same clip
async function inkBox(page, clip, show, hide) {
  await page.evaluate(hide); const a = await page.screenshot({ clip, animations: "disabled" });
  await page.evaluate(show); const b = await page.screenshot({ clip, animations: "disabled" });
  return page.evaluate(async ([a, b, clip, dsf]) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + s; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const c = document.createElement("canvas"); c.width = ia.width; c.height = ia.height; const x = c.getContext("2d");
    x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, c.width, c.height).data;
    x.clearRect(0, 0, c.width, c.height); x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, c.width, c.height).data;
    let l = c.width, r = -1, t = c.height, bt = -1;
    for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) {
      const i = (y * c.width + xx) * 4, d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      if (d > 24) { if (xx < l) l = xx; if (xx > r) r = xx; if (y < t) t = y; if (y > bt) bt = y; }
    }
    return r < 0 ? null : { l: clip.x + l / dsf, r: clip.x + (r + 1) / dsf, t: clip.y + t / dsf, b: clip.y + (bt + 1) / dsf };
  }, [a.toString("base64"), b.toString("base64"), clip, DSF]);
}

async function settle(p) {
  await p.waitForTimeout(250);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(900); // word-gap / markInk settle (1.5s cap inside, reduced motion ends animations at once)
}

(async () => {
  const { server, base } = await serve(ROOT);
  const br = await chromium.launch();
  const words = JSON.parse(fs.readFileSync(path.join(ROOT, "words.json"), "utf8"));
  const out = { root: ROOT, themes: {} }, fails = [];
  for (const t of THEMES) for (const w of WIDTHS) {
    const tag = `${t.style}-${t.mode}-${t.pal}/${w}`, rec = (out.themes[tag] = { words: {}, surahs: null, surah: null, day: null, quiz: null });
    const ctx = await ctxFor(br, t, w), p = await ctx.newPage();
    await p.goto(base + "/#/"); await settle(p);
    const ids = await p.evaluate(() => W.map((x) => x.id));
    for (const id of ids) {
      await p.goto(base + "/#/word/" + id); await settle(p);
      const m = await p.evaluate(() => {
        const card = document.querySelector(".cols .card"), wd = card.querySelector(".wd"), ay = card.querySelector(".ay"), vr = card.querySelector(".vr");
        const h = (e) => e.getBoundingClientRect().height, lh = (e) => parseFloat(getComputedStyle(e).lineHeight);
        const marks = [...card.querySelectorAll("mark")].map((mk) => {
          const r = mk.getBoundingClientRect(), cs = getComputedStyle(mk), v = (k) => parseFloat(mk.style.getPropertyValue(k));
          return { text: mk.textContent, rect: { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height },
            pill: isFinite(v("--hl-t")) ? { l: r.left + scrollX + v("--hl-l"), t: r.top + scrollY + v("--hl-t"), w: v("--hl-w"), h: v("--hl-h") } : null, fs: parseFloat(cs.fontSize) };
        });
        return { font: getComputedStyle(wd).fontFamily, card: h(card), wd: h(wd), wdLines: Math.round((h(wd) - parseFloat(getComputedStyle(wd).paddingBottom)) / lh(wd)), ay: h(ay), ayLines: Math.round(h(ay) / lh(ay)), vrTop: vr.getBoundingClientRect().top + scrollY, marks };
      });
      // highlight pills: ink of the mark's own text only (pill and every other text hidden)
      for (let i = 0; i < m.marks.length; i++) {
        const mk = m.marks[i]; if (!mk.pill) { fails.push(`${tag} ${id}: mark ${i} not measured`); continue; }
        const pad = 30, clip = { x: Math.max(0, mk.pill.l - pad), y: Math.max(0, mk.pill.t - pad), width: mk.pill.w + 2 * pad, height: mk.pill.h + 2 * pad };
        const css = (on) => `(() => { let s = document.getElementById("__k"); if (!s) { s = document.createElement("style"); s.id = "__k"; document.head.appendChild(s); }
          s.textContent = "mark::before{opacity:0!important} #app, #app *{color:transparent!important;text-shadow:none!important} #app .cols .card mark:nth-of-type(${i + 1}){color:${on ? "#000" : "transparent"}!important}"; })()`;
        await p.evaluate(() => scrollTo(0, 0));
        const ink = await inkBox(p, clip, css(true), css(false));
        await p.evaluate(() => { const s = document.getElementById("__k"); if (s) s.remove(); });
        if (!ink) { fails.push(`${tag} ${id}: no ink found for mark ${i}`); continue; }
        const P = mk.pill, mg = { top: ink.t - P.t, bottom: P.t + P.h - ink.b, left: ink.l - P.l, right: P.l + P.w - ink.r };
        mk.ink = ink; mk.margin = mg;
        const worst = Math.min(mg.top, mg.bottom, mg.left, mg.right);
        if (worst < -0.5) fails.push(`${tag} ${id}: ink outside the pill of mark ${i} (${JSON.stringify(mg)})`);
      }
      // divider: lowest ink of the headword vs the dashed line
      {
        const box = await p.evaluate(() => { const r = document.querySelector(".cols .card .wd").getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; });
        const clip = { x: Math.max(0, box.x - 20), y: Math.max(0, box.y), width: box.w + 40, height: box.h + 10 };
        const css = (on) => `(() => { let s = document.getElementById("__k"); if (!s) { s = document.createElement("style"); s.id = "__k"; document.head.appendChild(s); }
          s.textContent = "#app, #app *{color:transparent!important;text-shadow:none!important;border-color:transparent!important} #app .cols .card .wd{color:${on ? "#000" : "transparent"}!important}"; })()`;
        const ink = await inkBox(p, clip, css(true), css(false));
        await p.evaluate(() => { const s = document.getElementById("__k"); if (s) s.remove(); });
        m.gap = ink ? +(m.vrTop - ink.b).toFixed(2) : null;
        if (m.gap == null || Math.abs(m.gap - 20) > 1) fails.push(`${tag} ${id}: divider gap ${m.gap}`);
      }
      rec.words[id] = m;
    }
    // surah list rows / shade tiles
    await p.goto(base + "/#/surahs"); await settle(p);
    rec.surahs = await p.evaluate(() => ({ list: document.querySelector(".list.sl").getBoundingClientRect().height, rows: [...document.querySelectorAll(".list.sl .row")].map((r) => +r.getBoundingClientRect().height.toFixed(2)), names: [...document.querySelectorAll(".list.sl .row .q")].map((r) => +r.getBoundingClientRect().height.toFixed(2)) }));
    await p.goto(base + "/#/surah/78"); await settle(p);
    rec.surah = await p.evaluate(() => ({ h1: document.querySelector("#app h1.q").getBoundingClientRect().height, h1Font: getComputedStyle(document.querySelector("#app h1.q")).fontFamily, rows: [...document.querySelectorAll(".list.rs .row")].map((r) => +r.getBoundingClientRect().height.toFixed(2)) }));
    // an open day card (day 1, first word) and the quiz card
    await p.goto(base + "/#/day/1"); await settle(p);
    rec.day = await p.evaluate(async () => {
      const c = document.querySelector(".dcard"); if (!c) return null;
      const closed = c.getBoundingClientRect().height; if (!c.classList.contains("open")) c.click();
      await new Promise((r) => setTimeout(r, 700));
      const d = document.querySelector(".dcard.open") || c, ay = d.querySelector(".ay");
      return { closed, open: d.getBoundingClientRect().height, word: (d.querySelector(".dword") || {}).getBoundingClientRect ? d.querySelector(".dword").getBoundingClientRect().height : null, ay: ay ? ay.getBoundingClientRect().height : null };
    });
    await p.goto(base + "/#/quiz"); await settle(p);
    rec.quiz = await p.evaluate(() => { const ay = document.querySelector("#app .ay"), c = ay && ay.closest(".card"); return c ? { card: c.getBoundingClientRect().height, ay: ay.getBoundingClientRect().height } : null; });
    await ctx.close();
    console.log(tag, "done");
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  await br.close(); server.close();
  if (fails.length) { console.log(fails.length + " FAILURES"); fails.slice(0, 80).forEach((f) => console.log("  " + f)); process.exitCode = 1; }
  else console.log("ALL CHECKS PASSED");
})();
