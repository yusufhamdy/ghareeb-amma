// Word ink -> dashed divider gap on the word page (app #/word/<id> and static /word/<slug>.html),
// measured from rendered pixels: screenshot with the word visible vs. transparent, lowest differing row.
// Usage: node divgap.js <label> [baseUrl]   (default: local server on public/)
const REPO = require("path").resolve(__dirname, "../..").split(require("path").sep).join("/");
const { chromium } = require("playwright");
const { serve } = require("./lib.js");
const fs = require("fs"), path = require("path");
const label = process.argv[2] || "run", remote = process.argv[3];
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;

(async () => {
  const srv = remote ? null : await serve();
  const base = remote || srv.base;
  const br = await chromium.launch();
  const an = await br.newPage();
  await an.setContent("<canvas id=c></canvas>");
  const lowest = (a, b) => an.evaluate(async ([a, b]) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + s; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const c = document.getElementById("c"); c.width = ia.width; c.height = ia.height; const x = c.getContext("2d");
    x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, c.width, c.height).data;
    x.clearRect(0, 0, c.width, c.height); x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, c.width, c.height).data;
    let low = -1;
    for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 24) low = Math.max(low, Math.floor(i / 4 / c.width));
    return low;
  }, [a.toString("base64"), b.toString("base64")]);

  const words = JSON.parse(fs.readFileSync(REPO + "/public/words.json", "utf8"));
  const slugs = require(REPO + "/shared/seo").buildSlugs(words);
  const results = [];
  for (const style of ["glass", "shade"]) for (const width of [390, 768, 1440]) {
    const ctx = await br.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); },
      { style, mode: "light", pal: "def", gl: 3, gv: 2, snd: false, cm: true });
    const page = await ctx.newPage();
    await page.goto(base + "/", { waitUntil: "load" });
    await page.waitForFunction(() => typeof W !== "undefined" && W.length > 0, null, { timeout: 20000 });
    const ids = await page.evaluate(() => W.map((w) => w.id));
    const targets = [];
    ids.forEach((id, i) => targets.push({ kind: "app", id, url: "#/word/" + id }));
    slugs.forEach((s) => targets.push({ kind: "static", id: s, url: "/word/" + s + ".html" }));
    for (const t of targets) {
      if (only && !only.test(t.id)) continue;
      if (t.kind === "app") { if (!page.url().startsWith(base + "/") || page.url().includes("/word/")) await page.goto(base + "/", { waitUntil: "load" }); await page.evaluate((h) => { location.hash = h }, t.url); }
      else await page.goto(base + t.url, { waitUntil: "load" });
      await page.waitForSelector(".cols .wd", { timeout: 20000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(60);
      const g = await page.evaluate(() => {
        const wd = document.querySelector(".cols .wd"), vr = wd.parentElement.querySelector(".vr"), card = wd.parentElement;
        const a = wd.getBoundingClientRect(), v = vr.getBoundingClientRect(), c = card.getBoundingClientRect();
        return { top: a.top + scrollY, div: v.top + scrollY, x: c.left, w: c.width, fs: parseFloat(getComputedStyle(wd).fontSize), word: wd.textContent };
      });
      const clip = { x: Math.max(0, Math.floor(g.x)), y: Math.max(0, Math.floor(g.top) - 10), width: Math.floor(g.w), height: Math.ceil(g.div - g.top) + 40 };
      // wait until the area is visually stable (late font/layout settling) before diffing
      let A = await page.screenshot({ clip, fullPage: true });
      for (let k = 0; k < 20; k++) { await page.waitForTimeout(100); const A2 = await page.screenshot({ clip, fullPage: true }); if (A2.equals(A)) break; A = A2; }
      await page.addStyleTag({ content: ".cols .wd{color:transparent!important}" });
      const B = await page.screenshot({ clip, fullPage: true });
      await page.evaluate(() => { const s = [...document.querySelectorAll("style")].pop(); s.remove(); });
      const low = await lowest(A, B);
      const inkBottom = clip.y + low + 1;
      results.push({ style, width, kind: t.kind, id: t.id, fs: g.fs, gap: +(g.div - inkBottom).toFixed(1), lines: null });
    }
    await ctx.close();
    process.stdout.write(style + "/" + width + " ");
  }
  await br.close(); if (srv) srv.server.close();
  fs.writeFileSync(path.join(__dirname, "divgap-" + label + ".json"), JSON.stringify(results, null, 1));
  results.sort((a, b) => a.gap - b.gap);
  console.log("\n" + label + ": n=" + results.length + " worst:", JSON.stringify(results.slice(0, 5)));
  for (const k of ["app", "static"]) for (const s of ["glass", "shade"]) for (const w of [390, 768, 1440]) {
    const r = results.filter((x) => x.kind === k && x.style === s && x.width === w); if (!r.length) continue;
    console.log(k, s, w, "min", Math.min(...r.map((x) => x.gap)), "max", Math.max(...r.map((x) => x.gap)));
  }
})();
