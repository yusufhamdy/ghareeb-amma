// Surah-page pill verification: all 28 surahs, app view + static pages, 320/390/1440 x glass/shade.
// Also compares the word rows' sizes against a reference build (argv[2] = public dir of the previous commit).
const REPO = require("path").resolve(__dirname, "../..").split(require("path").sep).join("/");
const { chromium } = require("playwright");
const fs = require("fs");
const { serve } = require("./lib.js");
const REF = process.argv[2];
const fails = []; let checks = 0;
const ok = (c, m) => { checks++; if (!c) fails.push(m); };
const PV = "السورة السابقة", NX = "السورة التالية", BOOK = "M2 4h7a3";

function grab() {
  const host = document.querySelector("#app") || document.querySelector("main");
  const one = (sel) => {
    const e = host.querySelector(sel); const r = e.getBoundingClientRect(); const cs = getComputedStyle(e);
    const tn = [...e.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    const rg = document.createRange(); rg.selectNodeContents(tn); const t = rg.getBoundingClientRect();
    const lines = new Set([...rg.getClientRects()].filter((x) => x.width > 1).map((x) => Math.round(x.top))).size;
    const sv = e.querySelector(":scope>svg"), svr = sv.getBoundingClientRect();
    const ps = e.querySelector(".ps");
    const inside = [...e.querySelectorAll("*")].every((c) => { const q = c.getBoundingClientRect(); return q.width === 0 || (q.left >= r.left - 0.5 && q.right <= r.right + 0.5 && q.top >= r.top - 0.5 && q.bottom <= r.bottom + 0.5); });
    const padIn = t.left >= r.left + parseFloat(cs.paddingLeft) - 0.5 && t.right <= r.right - parseFloat(cs.paddingRight) + 0.5;
    return {
      tag: e.tagName, href: e.getAttribute("href"), dis: e.getAttribute("aria-disabled"), op: e.style.opacity, aria: e.getAttribute("aria-label"),
      label: tn.textContent.trim(), ps: ps ? ps.textContent.trim() : null, psIcon: ps ? !!ps.querySelector(`svg path[d^="M2 4h7a3"]`) : null,
      psSize: ps ? parseFloat(getComputedStyle(ps).fontSize) : null, psOp: ps ? getComputedStyle(ps).opacity : null, psColor: ps ? getComputedStyle(ps).color : null, ac: cs.color,
      chev: sv.querySelector("path").getAttribute("d"),
      anchor: (() => { const cs = getComputedStyle(e), r = e.getBoundingClientRect(), pv = e.classList.contains("pv");
        const sv = e.querySelector(":scope>svg").getBoundingClientRect(); const tnn = [...e.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
        const rg = document.createRange(); rg.selectNodeContents(tnn); const t = rg.getBoundingClientRect(); const ps = e.querySelector(".ps"); const pr = ps && ps.getBoundingClientRect();
        const pad = parseFloat(pv ? cs.paddingRight : cs.paddingLeft) + parseFloat(pv ? cs.borderRightWidth : cs.borderLeftWidth), gap = parseFloat(cs.columnGap);
        const edge = pv ? r.right - sv.right : sv.left - r.left, g = pv ? sv.left - t.right : t.left - sv.right;
        const psAl = !ps || (pv ? Math.abs(pr.right - t.right) < 1 : Math.abs(pr.left - t.left) < 1);
        return { ok: Math.abs(edge - pad) < 1 && Math.abs(g - gap) < 1.5 && psAl && Math.abs(sv.width - 20) < 0.5, edge: +edge.toFixed(1), pad, g: +g.toFixed(1), gap, psAl, sw: sv.width }; })(),
      pill: parseFloat(cs.borderTopLeftRadius) >= r.height / 2 - 0.5,
      beside: svr.top < t.bottom && svr.bottom > t.top && (e.classList.contains("pv") ? svr.left >= t.right - 2 : svr.right <= t.left + 2),
      h: r.height, w: r.width, top: r.top, bottom: r.bottom, left: r.left, right: r.right, inside, padIn, lines,
      overflow: e.scrollWidth > e.clientWidth + 0.5 || (ps && ps.scrollWidth > ps.clientWidth + 0.5),
    };
  };
  const list = host.querySelector(".cw.snav .list").getBoundingClientRect();
  const all = [...host.querySelectorAll(".btn")].find((b) => /\/#\/surahs?|#\/surahs/.test(b.getAttribute("href") || "") || b.closest(".acts"));
  const rows = [...host.querySelectorAll(".cw.snav .list .row")].map((x) => { const q = x.getBoundingClientRect(); return Math.round(q.width) + "x" + Math.round(q.height); });
  return { pv: one(".cw .pnb.pv"), nx: one(".cw .pnb.nx"), listBottom: list.bottom, listCx: (list.left + list.right) / 2, wrapCx: (() => { const c = host.querySelector(".cw.snav").getBoundingClientRect(); return (c.left + c.right) / 2; })(), allTop: all ? all.getBoundingClientRect().top : null, rows, docOverflow: document.documentElement.scrollWidth > innerWidth };
}

(async () => {
  const cur = await serve(); const ref = REF ? await serve(REF) : null;
  const br = await chromium.launch();
  try {
    const p0 = await br.newPage(); await p0.goto(cur.base + "/", { waitUntil: "load" }); await p0.waitForSelector("#app h1");
    const S = await p0.evaluate(() => S.map((s) => ({ num: s.num, name: s.name }))); await p0.close();
    ok(S.length === 28, "28 surahs");
    const files = fs.readdirSync(REPO + "/public/surah"); const fileOf = {}, numOf = {};
    for (const f of files) { const n = +/href="\/#\/surah\/(\d+)"/.exec(fs.readFileSync(REPO + "/public/surah/" + f, "utf8"))[1]; fileOf[n] = f; numOf[f] = n; }
    for (const w of [320, 390, 1440]) for (const style of ["glass", "shade"]) {
      const mk = async (srv) => { const ctx = await br.newContext({ viewport: { width: w, height: 900 } });
        await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); }, { style, mode: "light", pal: "def", gl: 3, gv: 2, snd: false, cm: true });
        const p = await ctx.newPage(); await p.goto(srv.base + "/", { waitUntil: "load" }); await p.waitForSelector("#app h1"); await p.evaluate(() => document.fonts.ready); return { ctx, p }; };
      const A = await mk(cur), R = ref ? await mk(ref) : null;
      for (const view of ["app", "static"]) {
        const tag = `${w}/${style}/${view}`; const hs = new Set();
        const go = async (p, n) => { if (view === "app") { await p.evaluate((h) => { location.hash = h; }, "#/surah/" + n); await p.waitForFunction((n) => location.hash === "#/surah/" + n && document.querySelector("#app .cw.snav .list .row[href^='#/word/" + n + "-']"), n); } else { await p.goto(p.__base + "/surah/" + fileOf[n], { waitUntil: "load" }); await p.evaluate(() => document.fonts.ready); } };
        A.p.__base = cur.base; if (R) R.p.__base = ref.base;
        for (let k = 0; k < S.length; k++) {
          const s = S[k], prev = S[k - 1], next = S[k + 1];
          await go(A.p, s.num); const d = await A.p.evaluate(grab);
          const href = (o) => view === "app" ? "#/surah/" + o.num : "/surah/" + fileOf[o.num];
          for (const [b, o, lbl, dir] of [[d.pv, prev, PV, "pv"], [d.nx, next, NX, "nx"]]) {
            const t = `${tag} ${s.num} ${dir}`;
            ok(b.label === lbl, t + " label " + b.label);
            ok(b.chev === (dir === "pv" ? "M9 5l7 7-7 7" : "M15 5l-7 7 7 7"), t + " chevron direction");
            ok(b.pill && b.beside, t + ` pill ${b.pill} chevron beside ${b.beside}`);
            ok(Math.abs(b.h - 58) < 0.5, t + " height 58 (" + b.h + ")");
            ok(b.inside && b.padIn && !b.overflow && b.lines === 1, t + ` no truncation (inside ${b.inside} padIn ${b.padIn} lines ${b.lines})`);
            ok(b.top >= d.listBottom - 0.5, t + " below the words list");
            ok(d.allTop !== null && b.bottom <= d.allTop, t + " above the all-surahs button");
            if (!o) { ok(b.tag === "SPAN" && b.dis === "true" && b.op === "0.5" && !b.aria, t + " disabled at the end"); continue; }
            ok(b.tag === "A" && b.href === href(o) && b.dis === null, t + ` target ${b.href} want ${href(o)}`);
            ok(b.ps === o.name && b.psIcon, t + ` second line ${b.ps} want ${o.name}`);
            ok(b.aria === lbl + "، " + o.name, t + " aria-label " + b.aria);
            ok(b.psSize === 12.5 && +b.psOp === 0.75 && b.psColor === b.ac, t + ` second line style ${b.psSize} ${b.psOp} ${b.psColor}/${b.ac}`);
          }
          for (const b of [d.pv, d.nx]) ok(b.anchor.ok, `${tag} ${s.num}` + " content anchored to the outer edge " + JSON.stringify(b.anchor));
          ok(Math.abs(d.pv.w - d.nx.w) < 0.5 && Math.abs(d.pv.top - d.nx.top) < 0.5, `${tag} ${s.num} pills share the row equally`);
          ok(d.pv.left >= d.nx.right - 0.5, `${tag} ${s.num} previous on the right, next on the left`);
          ok(Math.abs(d.listCx - d.wrapCx) < 1, `${tag} ${s.num} words list centered`);
          ok(!d.docOverflow, `${tag} ${s.num} no horizontal overflow`);
          hs.add(d.pv.h); hs.add(d.nx.h);
          if (R) { await go(R.p, s.num); const rr = await R.p.evaluate(() => [...(document.querySelector("#app") || document.querySelector("main")).querySelectorAll(".cw.snav .list .row")].map((x) => { const q = x.getBoundingClientRect(); return Math.round(q.width) + "x" + Math.round(q.height); })); ok(JSON.stringify(rr) === JSON.stringify(d.rows), `${tag} ${s.num} word rows keep their size (${rr[0]} -> ${d.rows[0]})`); }
        }
        ok(hs.size === 1, `${tag} constant height (${[...hs]})`);
      }
      await A.ctx.close(); if (R) await R.ctx.close();
    }
  } finally { await br.close(); cur.server.close(); if (ref) ref.server.close(); }
  console.log("checks", checks, fails.length ? "FAIL (" + fails.length + ")\n" + fails.slice(0, 30).join("\n") : "ALL PASS");
})();
