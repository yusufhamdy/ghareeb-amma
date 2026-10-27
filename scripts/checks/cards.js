// Generate "حفظ كصورة" PNGs through the real save flow (button -> sheet -> size -> save),
// capturing the browser download. Read-only against public/.
const { chromium, serve, PALS } = (() => { const l = require("./lib.js"); return { chromium: require("playwright").chromium, serve: l.serve, PALS: l.PALS }; })();
const fs = require("fs"), path = require("path");
const OUT = path.join(__dirname, "cards"); fs.mkdirSync(OUT, { recursive: true });
const WORDS = { short: "سَجَى", long: "الْخُنَّسِ الْجَوَارِ الْكُنَّسِ" };

(async () => {
  const { server, base } = await serve();
  const br = await chromium.launch();
  const meta = [];
  try {
    for (const style of ["glass", "shade"]) for (const pal of PALS) for (const mode of ["light", "dark"]) {
      const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
      await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); },
        { style, mode, pal, gl: 3, gv: 2, snd: false, cm: true });
      const page = await ctx.newPage();
      const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
      await page.goto(base + "/", { waitUntil: "load" });
      await page.waitForFunction(() => typeof W !== "undefined" && W.length > 0, null, { timeout: 15000 });
      for (const [kind, word] of Object.entries(WORDS)) {
        const id = await page.evaluate((wd) => W.find((w) => w.word === wd).id, word);
        await page.evaluate((id) => { location.hash = "#/word/" + id }, id);
        for (const size of ["n", "s"]) {
          await page.click('#app [data-a="card"]');
          await page.waitForFunction(() => document.querySelectorAll("#sh .artw img").length === 2, null, { timeout: 20000 });
          await page.click(`#sh [data-sc="${size}"]`);
          const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.click('#sh [data-a="savepng"]')]);
          const file = path.join(OUT, `${kind}-${size === "s" ? "story" : "regular"}-${style}-${pal}-${mode}.png`);
          await dl.saveAs(file);
          // Layout boxes from the same renderer, for the report.
          const info = await page.evaluate(([id, size]) => {
            const w = W.find((x) => x.id === id), c = renderCard(w, size);
            return { w: c.width, h: c.height, box: c.__card, fonts: { quran: document.fonts.check('120px "KFGQPC Uthmanic Hafs"'), logo: document.fonts.check('120px "Amiri Quran"'), plex: document.fonts.check('28px "IBM Plex Sans Arabic"') } };
          }, [id, size]);
          meta.push({ kind, size, style, pal, mode, id, file, suggested: dl.suggestedFilename(), ...info });
          await page.waitForTimeout(150);
        }
      }
      if (errs.length) meta.push({ style, pal, mode, errs });
      await ctx.close();
      process.stdout.write(".");
    }
  } finally { await br.close(); server.close(); }
  fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 1));
  console.log("\n" + meta.length + " entries");
})();
