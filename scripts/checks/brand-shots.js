// N4 screenshots: the site name (Amiri Bold) in the app header and on the loading screen, in all 5 palettes, light and
// dark, glass and shade, at 400px; one contact sheet per screen (rows: palettes; columns: looks).
//   node brand-shots.js [root] [outDir]
// The loading screen is held on screen by never answering /words.json.
const { serve } = require("./lib.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const ROOT = process.argv[2] || path.resolve(__dirname, "../../public");
const OUT = process.argv[3] || path.join(__dirname, "out/n4");
const PALS = ["neo", "gold", "def", "lav", "sun"];
const LOOKS = [["glass", "light"], ["glass", "dark"], ["shade", "light"], ["shade", "dark"]];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, base } = await serve(ROOT);
  const br = await chromium.launch();
  const grid = { header: [], loading: [] }, fonts = [];
  for (const pal of PALS) for (const [style, mode] of LOOKS) {
    for (const screen of ["header", "loading"]) {
      const ctx = await br.newContext({ viewport: { width: 400, height: screen === "header" ? 260 : 420 }, deviceScaleFactor: 2, reducedMotion: "reduce" });
      await ctx.addInitScript((a) => { try { localStorage.setItem("gq-set", JSON.stringify(a.s)); if (a.ld) localStorage.setItem("gq-ld", "1"); } catch (e) {} }, { s: { style, mode, pal, gl: 50, gv: 3, sv: 2, snd: false, cm: true }, ld: screen === "header" });
      if (screen === "loading") await ctx.route("**/words.json", () => {}); // never answered: the loading screen stays
      const p = await ctx.newPage();
      await p.goto(base + "/#/", { waitUntil: "domcontentloaded" });
      const sel = screen === "header" ? "#app header .logo" : "#ld .logo";
      await p.waitForSelector(sel, { timeout: 20000 });
      await p.evaluate(async () => { await document.fonts.load('700 44px "Amiri"', "\u063a\u0631\u064a\u0628 \u0627\u0644\u0642\u0631\u0622\u0646"); await document.fonts.ready; });
      await p.waitForTimeout(400);
      const f = await p.evaluate((s) => { const e = document.querySelector(s), c = getComputedStyle(e); return { family: c.fontFamily, weight: c.fontWeight, loaded: document.fonts.check('700 28px "Amiri"', e.textContent) }; }, sel);
      fonts.push(`${screen} ${pal} ${style}-${mode}: ${f.family} ${f.weight} loaded=${f.loaded}`);
      const file = path.join(OUT, `${screen}-${pal}-${style}-${mode}.png`);
      await p.screenshot({ path: file });
      grid[screen].push({ pal, look: style + "-" + mode, file });
      await ctx.close();
    }
  }
  // contact sheets
  for (const screen of ["header", "loading"]) {
    const page = await br.newPage({ viewport: { width: 4 * 420 + 140, height: 600 } });
    const img = (f) => "data:image/png;base64," + fs.readFileSync(f).toString("base64");
    const rows = PALS.map((pal) => `<tr><th>${pal}</th>${LOOKS.map(([s, m]) => `<td><img src="${img(grid[screen].find((g) => g.pal === pal && g.look === s + "-" + m).file)}" width="400"></td>`).join("")}</tr>`).join("");
    await page.setContent(`<body style="margin:0;padding:10px;background:#777;font:14px sans-serif;color:#fff"><table cellspacing="10"><tr><th></th>${LOOKS.map(([s, m]) => `<th>${s} ${m}</th>`).join("")}</tr>${rows}</table></body>`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `sheet-${screen}.png`), fullPage: true });
    await page.close();
  }
  await br.close(); server.close();
  fs.writeFileSync(path.join(OUT, "fonts.txt"), fonts.join("\n") + "\n");
  const bad = fonts.filter((l) => !/"?Amiri"?, serif 700 loaded=true$/.test(l));
  console.log(fonts.length + " screens; " + (bad.length ? bad.length + " NOT Amiri Bold:\n" + bad.join("\n") : "the site name is Amiri Bold (loaded) on every one"));
})();
