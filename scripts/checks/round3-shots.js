// Screenshots for the K review (ornate parentheses never alone at a line end/start), from any public/ tree.
//   node round3-shots.js <publicRoot> <tag> [outDir]
// Into outDir/<tag>/: the word card of 81-3 and of every word whose ayah takes more than one line, at 360 and 400px,
// in glass-dark-gold and shade-light-gold; and the save-image cards (regular, story) of 81-3. Lists the words shot.
const { serve } = require("./lib.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const ROOT = process.argv[2], TAG = process.argv[3] || "after";
const OUT = path.join(process.argv[4] || path.join(__dirname, "out/round3"), TAG);
const THEMES = [{ style: "glass", mode: "dark", pal: "gold" }, { style: "shade", mode: "light", pal: "gold" }];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, base } = await serve(ROOT);
  const br = await chromium.launch();
  const shot = {};
  for (const w of [360, 400]) for (const t of THEMES) {
    const tt = `${t.style}-${t.mode}-${t.pal}`;
    const ctx = await br.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
    await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); }, Object.assign({ gl: 50, gv: 3, snd: false, cm: true }, t));
    const p = await ctx.newPage();
    await p.goto(base + "/#/"); await p.waitForTimeout(1000);
    const ids = await p.evaluate(() => W.map((x) => x.id));
    for (const id of ids) {
      await p.evaluate((i) => { location.hash = "#/word/" + i; }, id);
      await p.waitForFunction((i) => location.hash === "#/word/" + i && document.querySelector(".cols .card .ay"), id);
      await p.evaluate(() => document.fonts.ready);
      const lines = await p.evaluate(() => { const ay = document.querySelector(".cols .card .ay"); return Math.round(ay.getBoundingClientRect().height / parseFloat(getComputedStyle(ay).lineHeight)); });
      if (id !== "81-3" && lines < 2) continue;
      (shot[id] = shot[id] || []).push(w + "px " + tt + " (" + lines + " lines)");
      await p.waitForTimeout(400);
      await (await p.$(".cols .card")).screenshot({ path: path.join(OUT, `word-${id}-${w}-${tt}.png`) });
    }
    await ctx.close();
  }
  const ctx = await br.newContext({ viewport: { width: 400, height: 900 } });
  await ctx.addInitScript(() => { localStorage.setItem("gq-set", JSON.stringify({ style: "glass", mode: "light", pal: "gold", gl: 50, gv: 3, cm: true })); localStorage.setItem("gq-ld", "1"); });
  const p = await ctx.newPage();
  await p.goto(base + "/#/"); await p.waitForTimeout(1200); await p.evaluate(() => cardFonts());
  for (const size of ["n", "s"]) {
    const data = await p.evaluate((size) => renderCard(byId("81-3"), size).toDataURL("image/png"), size);
    fs.writeFileSync(path.join(OUT, `card-81-3-${size === "s" ? "story" : "regular"}.png`), Buffer.from(data.split(",")[1], "base64"));
  }
  await br.close(); server.close();
  for (const [id, l] of Object.entries(shot)) console.log(id + ": " + l.join("; "));
  console.log("written to " + OUT + ": " + fs.readdirSync(OUT).length + " files");
})();
