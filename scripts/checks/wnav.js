// Word prev/next verification: all 73 words on the app view and static pages, at 320/390/1440 x glass/shade.
// Checks targets, labels, the cross-surah second line + accessible name, disabled ends, constant row height,
// no truncation/overflow. Usage: node wnav.js [shots]
const REPO = require("path").resolve(__dirname, "../..").split(require("path").sep).join("/");
const { chromium } = require("playwright");
const fs = require("fs");
const { serve } = require("./lib.js");
const SHOTS = process.argv[2] === "shots";
const fails = []; let checks = 0;
const ok = (c, m) => { checks++; if (!c) fails.push(m); };
const PV = "الكلمة السابقة", NX = "الكلمة التالية";

function grab() {
  const one = (sel) => {
    const e = document.querySelector(sel); if (!e) return null;
    const r = e.getBoundingClientRect();
    const label = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
    const ps = e.querySelector(".ps");
    const pr = ps && ps.getBoundingClientRect();
    const inside = [...e.querySelectorAll("*")].every((c) => { const q = c.getBoundingClientRect(); return q.width === 0 || (q.left >= r.left - 0.5 && q.right <= r.right + 0.5 && q.top >= r.top - 0.5 && q.bottom <= r.bottom + 0.5); });
    // label text on a single line (Range rects collapse to one line box)
    const tn = [...e.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    let lines = 0; if (tn) { const rg = document.createRange(); rg.selectNodeContents(tn); lines = new Set([...rg.getClientRects()].filter((x) => x.width > 1).map((x) => Math.round(x.top))).size; }
    return {
      tag: e.tagName, href: e.getAttribute("href"), dis: e.getAttribute("aria-disabled"), op: e.style.opacity, aria: e.getAttribute("aria-label"),
      label, ps: ps ? ps.textContent.trim() : null, psIcon: ps ? !!ps.querySelector("svg path[d^='M2 4h7a3']") : null,
      psSize: ps ? parseFloat(getComputedStyle(ps).fontSize) : null, psColor: ps ? getComputedStyle(ps).color : null, psOp: ps ? getComputedStyle(ps).opacity : null,
      ac: getComputedStyle(e).color,
      chev: (e.querySelector(":scope>svg path") || {}).getAttribute ? e.querySelector(":scope>svg path").getAttribute("d") : null,
      h: Math.round(r.height * 100) / 100, w: r.width, inside, lines,
      anchor: (() => { const cs = getComputedStyle(e), r = e.getBoundingClientRect(), pv = e.classList.contains("pv");
        const sv = e.querySelector(":scope>svg").getBoundingClientRect(); const tnn = [...e.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
        const rg = document.createRange(); rg.selectNodeContents(tnn); const t = rg.getBoundingClientRect(); const ps = e.querySelector(".ps"); const pr = ps && ps.getBoundingClientRect();
        const pad = parseFloat(pv ? cs.paddingRight : cs.paddingLeft) + parseFloat(pv ? cs.borderRightWidth : cs.borderLeftWidth), gap = parseFloat(cs.columnGap);
        const edge = pv ? r.right - sv.right : sv.left - r.left, g = pv ? sv.left - t.right : t.left - sv.right;
        const psAl = !ps || (pv ? Math.abs(pr.right - t.right) < 1 : Math.abs(pr.left - t.left) < 1);
        return { ok: Math.abs(edge - pad) < 1 && Math.abs(g - gap) < 1.5 && psAl && Math.abs(sv.width - 20) < 0.5, edge: +edge.toFixed(1), pad, g: +g.toFixed(1), gap, psAl, sw: sv.width }; })(),
      pill: parseFloat(getComputedStyle(e).borderTopLeftRadius) >= r.height / 2 - 0.5,
      beside: (() => { const sv = e.querySelector(":scope>svg").getBoundingClientRect(); if (!tn) return false; const rg = document.createRange(); rg.selectNodeContents(tn); const t = rg.getBoundingClientRect(); return sv.top < t.bottom && sv.bottom > t.top && (e.classList.contains("pv") ? sv.left >= t.right - 2 : sv.right <= t.left + 2); })(),
      psOverflow: ps ? ps.scrollWidth > ps.clientWidth + 0.5 : false, overflow: e.scrollWidth > e.clientWidth + 0.5,
    };
  };
  return { pv: one(".cw .pnb.pv"), nx: one(".cw .pnb.nx"), vw: innerWidth, docOverflow: document.documentElement.scrollWidth > innerWidth };
}

(async () => {
  const { server, base } = await serve();
  const br = await chromium.launch();
  const shotDir = __dirname + "/wnav"; if (SHOTS) fs.mkdirSync(shotDir, { recursive: true });
  try {
    // order + names from the app itself
    const p0 = await br.newPage(); await p0.goto(base + "/", { waitUntil: "load" }); await p0.waitForSelector("#app h1");
    const W = await p0.evaluate(() => W.map((w) => ({ id: w.id, s: w.s.num, name: w.s.name })));
    await p0.close();
    ok(W.length === 73, "73 words in W (" + W.length + ")");
    // static slug <-> app id (from each static page's "open on the site" link)
    const files = fs.readdirSync(REPO + "/public/word").filter((f) => f.endsWith(".html"));
    const slugOf = {}, idOf = {};
    for (const f of files) { const h = fs.readFileSync(REPO + "/public/word/" + f, "utf8"); const id = /href="\/#\/word\/([\d-]+)"/.exec(h)[1]; slugOf[id] = f.replace(/\.html$/, ""); idOf[slugOf[id]] = id; }
    ok(Object.keys(slugOf).length === 73, "73 static word pages map to app ids");
    const heights = {};
    for (const w of [320, 390, 1440]) for (const style of ["glass", "shade"]) {
      const ctx = await br.newContext({ viewport: { width: w, height: 900 } });
      await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); }, { style, mode: "light", pal: "def", gl: 3, gv: 2, snd: false, cm: true });
      const p = await ctx.newPage();
      await p.goto(base + "/", { waitUntil: "load" }); await p.waitForSelector("#app h1"); await p.evaluate(() => document.fonts.ready);
      for (const view of ["app", "static"]) {
        const tag = `${w}/${style}/${view}`; const hs = new Set();
        for (let k = 0; k < W.length; k++) {
          const cur = W[k], prev = W[k - 1], next = W[k + 1];
          if (view === "app") { await p.evaluate((h) => { location.hash = h; }, "#/word/" + cur.id); await p.waitForFunction((id) => { const b = document.querySelector('[data-a="card"]'); return b && b.dataset.id === id; }, cur.id); }
          else { await p.goto(base + "/word/" + slugOf[cur.id] + ".html", { waitUntil: "load" }); await p.evaluate(() => document.fonts.ready); }
          const d = await p.evaluate(grab);
          const href = (o) => o ? (view === "app" ? "#/word/" + o.id : "/word/" + slugOf[o.id] + ".html") : null;
          for (const [b, o, lbl, dir] of [[d.pv, prev, PV, "pv"], [d.nx, next, NX, "nx"]]) {
            const t = `${tag} ${cur.id} ${dir}`;
            ok(b.label === lbl, t + " label " + b.label);
            ok(b.chev === (dir === "pv" ? "M9 5l7 7-7 7" : "M15 5l-7 7 7 7"), t + " chevron");
            if (!o) { ok(b.tag === "SPAN" && b.dis === "true" && b.op === "0.5" && b.ps === null && !b.aria, t + " disabled at the end of the set"); continue; }
            ok(b.tag === "A" && b.href === href(o) && b.dis === null, t + " href " + b.href + " want " + href(o));
            const cross = o.s !== cur.s;
            if (cross) {
              ok(b.ps === o.name && b.psIcon, t + " second line = book icon + " + o.name + " (got " + b.ps + ")");
              ok(b.aria === lbl + "، من سورة " + o.name, t + " aria-label " + b.aria);
              ok(b.psSize >= 12 && b.psSize <= 13 && b.psColor === b.ac && +b.psOp < 1 && +b.psOp >= 0.6, t + ` second line style ${b.psSize}px ${b.psColor} vs ${b.ac} op ${b.psOp}`);
            } else ok(b.ps === null && !b.aria, t + " no second line inside the surah");
            ok(b.inside && !b.overflow && !b.psOverflow && b.lines === 1, t + ` nothing truncated/overflowing (inside ${b.inside} lines ${b.lines})`);
          }
          ok(d.pv.pill && d.nx.pill, `${tag} ${cur.id} pill shape`);
          ok(d.pv.beside && d.nx.beside, `${tag} ${cur.id} chevron beside the text`);
          ok(Math.abs(d.pv.w - d.nx.w) < 0.5 && Math.abs(d.pv.h - 58) < 0.5, `${tag} ${cur.id} equal widths, 58px (${d.pv.w}/${d.nx.w} h ${d.pv.h})`);
          for (const b of [d.pv, d.nx]) ok(b.anchor.ok, `${tag} ${cur.id}` + " content anchored to the outer edge " + JSON.stringify(b.anchor));
          ok(Math.abs(d.pv.h - d.nx.h) < 0.5, `${tag} ${cur.id} both buttons same height (${d.pv.h}/${d.nx.h})`);
          ok(!d.docOverflow, `${tag} ${cur.id} no horizontal page overflow`);
          hs.add(d.pv.h); hs.add(d.nx.h);
          if (SHOTS && style === "glass" && (w === 390 || w === 1440)) {
            const name = k === 0 ? null : (next && next.s !== cur.s && prev && prev.s === cur.s) ? "last-of-surah" : (prev && prev.s !== cur.s && next && next.s === cur.s) ? "first-of-surah" : (prev && next && prev.s === cur.s && next.s === cur.s) ? "middle" : null;
            const key = `${view}-${name}-${w}`;
            if (name && !fs.existsSync(`${shotDir}/${key}.png`)) { await p.evaluate(() => scrollTo(0, 0)); await p.screenshot({ path: `${shotDir}/${key}.png`, fullPage: true }); console.log("shot", key, cur.id); }
          }
        }
        heights[tag] = [...hs];
        ok(hs.size === 1, `${tag} row height constant on every word (${[...hs].join(",")})`);
      }
      await ctx.close();
    }
    console.log("heights", JSON.stringify(heights));
  } finally { await br.close(); server.close(); }
  console.log("checks", checks, fails.length ? "FAIL (" + fails.length + ")\n" + fails.slice(0, 40).join("\n") : "ALL PASS");
})();
