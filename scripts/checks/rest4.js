// At-rest diff, previous commit (scratchpad/base) vs working tree: every element whose box changed, matched by
// tag+class+text (+occurrence), on app routes and static pages, glass+shade, 390 and 1440.
const { chromium } = require("playwright");
const fs = require("fs"); const { serve } = require("./lib.js");
const snap = () => {
  const out = {}, seen = {};
  for (const e of document.body.querySelectorAll("*")) {
    if (e.closest("svg") || e.closest("#ld") || e.tagName === "SCRIPT" || e.closest(".toast")) continue;
    const r = e.getBoundingClientRect(); const cls = e.className && e.className.baseVal === undefined ? e.className : "";
    const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim().slice(0, 18);
    let k = e.tagName + "." + cls + "|" + own; seen[k] = (seen[k] || 0) + 1; k += "#" + seen[k];
    const cs = getComputedStyle(e);
    out[k] = [r.x, r.y + scrollY, r.width, r.height].map((v) => Math.round(v)).join(",") + (cs.display === "none" ? " none" : "");
  }
  out.__docH = String(document.documentElement.scrollHeight); return out;
};
(async () => {
  const A = await serve(__dirname + "/base2/public"), B = await serve(); const br = await chromium.launch();
  const statics = ["/word/abasa-28.html", "/word/al-falaq-4.html", "/word/an-naba-14.html", "/surah/abasa.html", "/surah/an-nas.html", "/about/", "/404.html"];
  const routes = ["#/", "#/surahs", "#/challenge", "#/quiz", "#/day/1", "#/surah/80", "#/surah/114", "#/word/80-0", "#/word/79-3", "#/word/114-0", "#/about", "#/nope"];
  const agg = {};
  for (const w of [390, 1440]) for (const style of ["glass", "shade"]) {
    const pages = {};
    for (const [k, srv] of [["base", A], ["new", B]]) {
      const ctx = await br.newContext({ viewport: { width: w, height: 900 }, hasTouch: w < 800, isMobile: w < 800 });
      await ctx.addInitScript(() => { let x = 7; Math.random = () => (x = (x * 16807) % 2147483647) / 2147483647; });
      await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); }, { style, mode: "light", pal: "def", gl: 3, gv: 2, snd: false, cm: true });
      const p = await ctx.newPage(); await p.goto(srv.base + "/", { waitUntil: "load" }); await p.waitForSelector("#app h1"); await p.evaluate(() => document.fonts.ready);
      for (const r of routes) { await p.evaluate((h) => { location.hash = h; }, r); await p.waitForTimeout(r === "#/quiz" ? 400 : 150); await p.evaluate(() => { scrollTo(0, 0); if (document.activeElement) document.activeElement.blur(); }); pages[r] = pages[r] || {}; pages[r][k] = await p.evaluate(snap); }
      for (const f of statics) { await p.goto(srv.base + f, { waitUntil: "load" }); await p.evaluate(() => document.fonts.ready); pages[f] = pages[f] || {}; pages[f][k] = await p.evaluate(snap); }
      await ctx.close();
    }
    for (const [r, v] of Object.entries(pages)) {
      const a = v.base, b = v.new, lines = [];
      for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (a[key] === b[key]) continue;
        lines.push(a[key] === undefined ? "ADDED " + key : b[key] === undefined ? "REMOVED " + key : "MOVED " + key + "  " + a[key] + " -> " + b[key]);
      }
      (agg[r] = agg[r] || {})[w + "/" + style] = lines;
    }
  }
  fs.writeFileSync(__dirname + "/rest4.json", JSON.stringify(agg, null, 1));
  for (const [r, m] of Object.entries(agg)) { const tot = Object.values(m).reduce((s, l) => s + l.length, 0); console.log(r.padEnd(24), tot === 0 ? "identical" : Object.entries(m).map(([k, l]) => k + ":" + l.length).join(" ")); }
  await br.close(); A.server.close(); B.server.close();
})();
