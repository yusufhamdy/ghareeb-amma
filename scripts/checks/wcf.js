// word-card-fit probes: meaning/ayah sizes per width, CLS, and #/word/83-1 screenshots.
// Usage: node wcf.js <label> [baseUrl]
const { chromium } = require("playwright");
const { serve } = require("./lib.js");
const fs = require("fs"), path = require("path");
const label = process.argv[2], remote = process.argv[3];
const OUT = path.join(__dirname, "wcf"); fs.mkdirSync(OUT, { recursive: true });
const ctxFor = async (br, width, style, mode, height = 900) => {
  const ctx = await br.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); }, { style, mode, pal: "def", gl: 3, gv: 2, snd: false, cm: true });
  return ctx;
};
(async () => {
  const srv = remote ? null : await serve();
  const base = remote || srv.base;
  const br = await chromium.launch();
  const out = { sizes: [], cls: [], shots: [] };
  for (const width of [390, 600, 768, 1024, 1440]) for (const kind of ["app", "static"]) {
    const ctx = await ctxFor(br, width, "glass", "light"), p = await ctx.newPage();
    await p.goto(base + (kind === "app" ? "/#/word/83-1" : "/word/al-mutaffifin-14.html"), { waitUntil: "load" });
    await p.waitForSelector(".cols .mn"); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(300);
    out.sizes.push({ width, kind, ...(await p.evaluate(() => {
      const mn = document.querySelector(".cols .mn"), ay = document.querySelector(".cols .ay"), cs = getComputedStyle(mn);
      return { mn: parseFloat(cs.fontSize), mnLH: parseFloat(cs.lineHeight) / parseFloat(cs.fontSize), ay: parseFloat(getComputedStyle(ay).fontSize), card: Math.round(mn.parentElement.getBoundingClientRect().width), wdPad: getComputedStyle(document.querySelector(".cols .wd")).paddingBottom };
    })) });
    await ctx.close();
  }
  for (const width of [390, 1440]) for (const kind of ["app", "static"]) {
    const ctx = await ctxFor(br, width, "glass", "light"), p = await ctx.newPage();
    await p.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); });
    await p.goto(base + (kind === "app" ? "/#/word/83-1" : "/word/al-mutaffifin-14.html"), { waitUntil: "load" });
    await p.waitForTimeout(3000);
    out.cls.push({ width, kind, cls: +(await p.evaluate(() => window.__cls)).toFixed(4) });
    await ctx.close();
  }
  for (const [style, mode] of [["glass", "light"], ["shade", "dark"]]) {
    const ctx = await ctxFor(br, 1440, style, mode), p = await ctx.newPage();
    await p.goto(base + "/#/word/83-1", { waitUntil: "load" });
    await p.waitForSelector(".cols .mn"); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(600);
    const f = path.join(OUT, `${label}-83-1-1440-${style}-${mode}.png`);
    await p.screenshot({ path: f, fullPage: true }); out.shots.push(f); await ctx.close();
  }
  await br.close(); if (srv) srv.server.close();
  fs.writeFileSync(path.join(OUT, label + ".json"), JSON.stringify(out, null, 1));
  console.table(out.sizes); console.table(out.cls); console.log(out.shots.join("\n"));
})();
