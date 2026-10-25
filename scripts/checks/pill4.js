// Prev/next pill checks at 320/340/360/390px for the word page (73 words) and surah page (28 surahs), app + static,
// glass + shade: shape, 58px, equal widths, chevron 20px at the outer edge, gap, second-line alignment, visible label
// (short at <=340px), full label + accessible name, 15px at <=360px, targets, disabled ends, spare >= 8px at <=360px.
const REPO = require("path").resolve(__dirname, "../..").split(require("path").sep).join("/");
const { chromium } = require("playwright");
const fs = require("fs");
const { serve } = require("./lib.js");
const fails = []; let checks = 0; const spare = {};
const ok = (c, m) => { checks++; if (!c) fails.push(m); };
const FULL = { word: ["الكلمة السابقة", "الكلمة التالية"], surah: ["السورة السابقة", "السورة التالية"] }, SHORT = ["السابقة", "التالية"];

function grab() {
  const host = document.querySelector("#app") || document.querySelector("main");
  const one = (sel) => {
    const e = host.querySelector(sel), r = e.getBoundingClientRect(), cs = getComputedStyle(e), pv = e.classList.contains("pv");
    const sv = e.querySelector(":scope>svg").getBoundingClientRect(), ps = e.querySelector(".ps"), pr = ps && ps.getBoundingClientRect();
    const pl = e.querySelector(".pl"), plHidden = pl && parseFloat(getComputedStyle(pl).fontSize) === 0;
    const labelNodes = [...e.childNodes].filter((n) => !(n.nodeType === 1 && (n.tagName.toLowerCase() === "svg" || n.classList.contains("ps"))));
    const full = labelNodes.map((n) => n.textContent).join("").trim();
    const visNodes = labelNodes.filter((n) => n !== pl || !plHidden).filter((n) => n.textContent.trim());
    const rg = document.createRange(); rg.setStartBefore(visNodes[0]); rg.setEndAfter(visNodes[visNodes.length - 1]);
    const t = rg.getBoundingClientRect(); const vis = visNodes.map((n) => n.textContent).join("").trim();
    const lines = new Set([...rg.getClientRects()].filter((x) => x.width > 1).map((x) => Math.round(x.top))).size;
    const bw = parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth), pads = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const L = Math.min(sv.left, t.left, pr ? pr.left : 1e9), R = Math.max(sv.right, t.right, pr ? pr.right : -1e9);
    const padStart = parseFloat(pv ? cs.paddingRight : cs.paddingLeft) + parseFloat(pv ? cs.borderRightWidth : cs.borderLeftWidth);
    const edge = pv ? r.right - sv.right : sv.left - r.left, gap = pv ? sv.left - t.right : t.left - sv.right;
    return {
      tag: e.tagName, href: e.getAttribute("href"), dis: e.getAttribute("aria-disabled"), op: e.style.opacity, aria: e.getAttribute("aria-label"),
      full, vis, lines, ps: ps ? ps.textContent.trim() : null, psIcon: ps ? !!ps.querySelector('svg path[d^="M2 4h7a3"]') : null,
      fs: parseFloat(cs.fontSize), psFs: ps ? parseFloat(getComputedStyle(ps).fontSize) : null,
      chev: e.querySelector(":scope>svg path").getAttribute("d"), sw: sv.width,
      pill: parseFloat(cs.borderTopLeftRadius) >= r.height / 2 - 0.5, h: r.height, w: r.width,
      edgeOk: Math.abs(edge - padStart) < 1, gapOk: Math.abs(gap - parseFloat(cs.columnGap)) < 1.5, edge, gap,
      psAl: !ps || (pv ? Math.abs(pr.right - t.right) < 1 : Math.abs(pr.left - t.left) < 1),
      padMin: Math.min(parseFloat(cs.paddingLeft), parseFloat(cs.paddingRight)), colGap: parseFloat(cs.columnGap),
      spare: r.width - bw - pads - (R - L), overflow: e.scrollWidth > e.clientWidth + 0.5,
    };
  };
  return { pv: one(".cw .pnb.pv"), nx: one(".cw .pnb.nx"), docOverflow: document.documentElement.scrollWidth > innerWidth };
}

(async () => {
  const { server, base } = await serve(); const br = await chromium.launch();
  try {
    const p0 = await br.newPage(); await p0.goto(base + "/", { waitUntil: "load" }); await p0.waitForSelector("#app h1");
    const D = await p0.evaluate(() => ({ W: W.map((w) => ({ id: w.id, s: w.s.num, name: w.s.name })), S: S.map((s) => ({ num: s.num, name: s.name })) })); await p0.close();
    const wslug = {}, sfile = {};
    for (const f of fs.readdirSync(REPO + "/public/word")) wslug[/href="\/#\/word\/([\d-]+)"/.exec(fs.readFileSync(REPO + "/public/word/" + f, "utf8"))[1]] = f;
    for (const f of fs.readdirSync(REPO + "/public/surah")) sfile[+/href="\/#\/surah\/(\d+)"/.exec(fs.readFileSync(REPO + "/public/surah/" + f, "utf8"))[1]] = f;
    for (const w of [320, 340, 360, 390]) for (const style of ["glass", "shade"]) {
      const ctx = await br.newContext({ viewport: { width: w, height: 900 } });
      await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); }, { style, mode: "light", pal: "def", gl: 3, gv: 2, snd: false, cm: true });
      const p = await ctx.newPage(); await p.goto(base + "/", { waitUntil: "load" }); await p.waitForSelector("#app h1"); await p.evaluate(() => document.fonts.ready);
      for (const page of ["word", "surah"]) for (const view of ["app", "static"]) {
        const tag = `${w}/${style}/${page}/${view}`, hs = new Set();
        if (view === "app") { await p.goto(base + "/", { waitUntil: "load" }); await p.waitForSelector("#app h1"); await p.evaluate(() => document.fonts.ready); }
        const items = page === "word" ? D.W : D.S;
        for (let k = 0; k < items.length; k++) {
          const cur = items[k], prev = items[k - 1], next = items[k + 1];
          if (view === "app") {
            const h = page === "word" ? "#/word/" + cur.id : "#/surah/" + cur.num;
            await p.evaluate((h) => { location.hash = h; }, h);
            if (page === "word") await p.waitForFunction((id) => { const b = document.querySelector('[data-a="card"]'); return b && b.dataset.id === id; }, cur.id);
            else await p.waitForFunction((n) => location.hash === "#/surah/" + n && document.querySelector(`#app .cw.snav .list .row[href^='#/word/${n}-']`), cur.num);
          } else { await p.goto(base + (page === "word" ? "/word/" + wslug[cur.id] : "/surah/" + sfile[cur.num]), { waitUntil: "load" }); await p.evaluate(() => document.fonts.ready); }
          const d = await p.evaluate(grab);
          const href = (o) => page === "word" ? (view === "app" ? "#/word/" + o.id : "/word/" + wslug[o.id]) : (view === "app" ? "#/surah/" + o.num : "/surah/" + sfile[o.num]);
          for (const [b, o, i, dir] of [[d.pv, prev, 0, "pv"], [d.nx, next, 1, "nx"]]) {
            const t = `${tag} ${page === "word" ? cur.id : cur.num} ${dir}`, full = FULL[page][i];
            ok(b.full === full, t + " full label " + b.full);
            ok(b.vis === (w <= 340 ? SHORT[i] : full), t + " visible label " + b.vis);
            ok(b.chev === (dir === "pv" ? "M9 5l7 7-7 7" : "M15 5l-7 7 7 7") && Math.abs(b.sw - 20) < 0.5, t + " chevron 20px, direction");
            ok(b.pill && Math.abs(b.h - 58) < 0.5, t + ` pill 58px (${b.h})`);
            ok(b.edgeOk && b.gapOk && b.psAl, t + ` anchored edge ${b.edge.toFixed(1)} gap ${b.gap.toFixed(1)} psAl ${b.psAl}`);
            ok(b.lines === 1 && !b.overflow, t + ` no truncation (lines ${b.lines})`);
            if (w <= 360) {
              ok(b.fs === 15 && (b.psFs === null || Math.abs(b.psFs - 11.7) < 0.05), t + ` 15px label, 11.7px second line (${b.fs}/${b.psFs})`);
              ok(b.padMin >= 12 && Math.abs(b.colGap - 8) < 0.5, t + ` balanced padding >= 12, gap 8 (${b.padMin}/${b.colGap})`);
              ok(b.spare >= 8, t + ` spare >= 8px (${b.spare.toFixed(1)})`);
            }
            const sk = `${w} ${page}`; spare[sk] = Math.min(spare[sk] ?? 1e9, +b.spare.toFixed(1));
            if (!o) { ok(b.tag === "SPAN" && b.dis === "true" && b.op === "0.5", t + " disabled at the end"); continue; }
            ok(b.tag === "A" && b.href === href(o), t + ` target ${b.href} want ${href(o)}`);
            const cross = page === "surah" || o.s !== cur.s;
            if (cross) {
              ok(b.ps === o.name && b.psIcon, t + ` second line ${b.ps} want ${o.name}`);
              ok(b.aria === (page === "word" ? full + "، من سورة " + o.name : full + "، " + o.name), t + " aria-label " + b.aria);
            } else ok(b.ps === null && !b.aria, t + " no second line inside the surah (name from the full text)");
          }
          ok(Math.abs(d.pv.w - d.nx.w) < 0.5, `${tag} ${cur.id || cur.num} equal widths`);
          ok(!d.docOverflow, `${tag} ${cur.id || cur.num} no page overflow`);
          hs.add(d.pv.h); hs.add(d.nx.h);
        }
        ok(hs.size === 1, `${tag} constant height (${[...hs]})`);
      }
      await ctx.close();
    }
  } finally { await br.close(); server.close(); }
  console.log("min spare (px) by width/page:", JSON.stringify(spare));
  console.log("checks", checks, fails.length ? "FAIL (" + fails.length + ")\n" + fails.slice(0, 30).join("\n") : "ALL PASS");
})();
