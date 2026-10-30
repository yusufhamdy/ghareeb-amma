// Screenshots for the F-H review (headword spelling, whole-word highlight, balanced lines), from any public/ tree.
//   node round2-shots.js <publicRoot> <tag> [outDir]
// Into outDir/<tag>/, in glass-dark-gold and shade-light-gold at 400px: the word card of 79-0, 81-3, 83-0, 89-1,
// 80-0, 105-1, 106-0, 91-0 and 100-0; a surah page list (al-Fajr), an open day card (day 1) and a quiz question
// (seeded); and save-image PNGs (glass light gold) for 81-3, 83-0 and 89-1.
const { serve } = require("./lib.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const ROOT = process.argv[2], TAG = process.argv[3] || "after";
const OUT = path.join(process.argv[4] || path.join(__dirname, "out/round2"), TAG);
const WORDS = ["79-0", "81-3", "83-0", "89-1", "80-0", "105-1", "106-0", "91-0", "100-0"];
const THEMES = [{ style: "glass", mode: "dark", pal: "gold" }, { style: "shade", mode: "light", pal: "gold" }];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, base } = await serve(ROOT);
  const br = await chromium.launch();
  for (const t of THEMES) {
    const tt = `${t.style}-${t.mode}-${t.pal}`;
    const ctx = await br.newContext({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
    await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); }, Object.assign({ gl: 50, gv: 3, snd: false, cm: true }, t));
    await ctx.addInitScript(() => { let s = 12345; Math.random = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); });
    const p = await ctx.newPage();
    for (const id of WORDS) {
      await p.goto(base + "/#/word/" + id); await p.waitForTimeout(1300);
      await (await p.$(".cols .card")).screenshot({ path: path.join(OUT, `word-${id}-${tt}.png`) });
    }
    for (const [name, h, fn] of [["surah-89", "#/surah/89"], ["day-open", "#/day/1", async () => { const c = await p.$(".dcard"); if (c) { await c.click(); await p.waitForTimeout(700); } }], ["quiz", "#/quiz"]]) {
      await p.goto(base + "/" + h); await p.waitForTimeout(1300); if (fn) await fn();
      await p.screenshot({ path: path.join(OUT, `${name}-${tt}.png`), fullPage: true });
    }
    await ctx.close();
  }
  const ctx = await br.newContext({ viewport: { width: 400, height: 900 } });
  await ctx.addInitScript(() => { localStorage.setItem("gq-set", JSON.stringify({ style: "glass", mode: "light", pal: "gold", gl: 50, gv: 3, cm: true })); localStorage.setItem("gq-ld", "1"); });
  const p = await ctx.newPage();
  await p.goto(base + "/#/"); await p.waitForTimeout(1200); await p.evaluate(() => cardFonts());
  for (const id of ["81-3", "83-0", "89-1"]) for (const size of ["n", "s"]) {
    const data = await p.evaluate(([id, size]) => renderCard(byId(id), size).toDataURL("image/png"), [id, size]);
    fs.writeFileSync(path.join(OUT, `card-${id}-${size === "s" ? "story" : "regular"}.png`), Buffer.from(data.split(",")[1], "base64"));
  }
  await br.close(); server.close();
  console.log("written to " + OUT + ": " + fs.readdirSync(OUT).length + " files");
})();
