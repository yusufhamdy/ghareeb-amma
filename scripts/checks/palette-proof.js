// N3 proof: the old site's default palette at night (live, read-only) against the new neo at night (a local tree).
//   node palette-proof.js [oldUrl] [newRoot] [outDir]
// oldUrl defaults to https://ghareebalquran.com (main d4405a7, palette "def"), newRoot to the working tree's public/.
// For home, a word page and the surah list at 400px, in glass and shade, dark mode: every theme variable on <html>
// (--bg --ac --b1 --b2 --tx --mu --gb --gbr --bl --sat --ln --btf --tc --sf --sbd), the first card's background,
// border and backdrop-filter, and the main and outline buttons' colours, read with getComputedStyle; prints a table
// of both, and fails on any difference. Writes side-by-side screenshots (old left, new right), plus neo by day.
const { serve } = require("./lib.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");

const OLD = process.argv[2] || "https://ghareebalquran.com";
const NEW = process.argv[3] || path.resolve(__dirname, "../../public");
const OUT = process.argv[4] || path.join(__dirname, "out/n3");
const VARS = ["--bg", "--ac", "--b1", "--b2", "--tx", "--mu", "--gb", "--gbr", "--bl", "--sat", "--ln", "--btf", "--tc", "--sf", "--sbd"];
const PAGES = [["home", "/#/"], ["word 114-0", "/#/word/114-0"], ["surah list", "/#/surahs"]];

function read() {
  const cs = getComputedStyle(document.documentElement), out = {};
  for (const v of ["--bg", "--ac", "--b1", "--b2", "--tx", "--mu", "--gb", "--gbr", "--bl", "--sat", "--ln", "--btf", "--tc", "--sf", "--sbd"]) out[v] = cs.getPropertyValue(v).trim();
  const card = document.querySelector("#app .card, #app .list");
  if (card) { const c = getComputedStyle(card); out["card background"] = c.backgroundColor + " " + c.backgroundImage; out["card border"] = c.borderTopColor + " " + c.borderTopWidth; out["card backdrop-filter"] = c.backdropFilter; }
  const b = document.querySelector("#app .btn:not(.o)"), o = document.querySelector("#app .btn.o");
  if (b) { const c = getComputedStyle(b); out["button background"] = c.backgroundColor + " " + c.backgroundImage; out["button text"] = c.color; out["button border"] = c.borderTopColor; }
  if (o) { const c = getComputedStyle(o); out["outline button background"] = c.backgroundColor; out["outline button text"] = c.color; out["outline button border"] = c.borderTopColor; }
  out["body background"] = getComputedStyle(document.body).backgroundColor;
  out["theme-color"] = (document.querySelector('meta[name="theme-color"]') || {}).content || "";
  return out;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, base } = await serve(NEW);
  const br = await chromium.launch();
  const rows = [], diffs = [];
  const shot = async (url, saved, scheme, file) => {
    const ctx = await br.newContext({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme, reducedMotion: "reduce" });
    await ctx.addInitScript((s) => { try { localStorage.setItem("gq-ld", "1"); if (s) localStorage.setItem("gq-set", JSON.stringify(s)); } catch (e) {} }, saved);
    const p = await ctx.newPage();
    await p.goto(url, { waitUntil: "load" });
    await p.waitForFunction(() => document.querySelector("#app .card, #app .list, #app .row"), null, { timeout: 30000 });
    await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1500);
    const v = await p.evaluate(read);
    if (file) await p.screenshot({ path: file });
    await ctx.close();
    return v;
  };
  for (const style of ["glass", "shade"]) for (const [name, route] of PAGES) {
    // the old site with its default palette: no saved palette (glass), or a record saved for the style only, as the old
    // site writes it (with its default "def"); the new site gets the same record (upgraded to neo on load)
    const saved = style === "glass" ? null : { mode: "auto", pal: "def", gl: 3, cm: false, snd: true, style: "shade" };
    const tag = name + " / " + style;
    const fo = path.join(OUT, "tmp-old.png"), fn = path.join(OUT, "tmp-new.png");
    const o = await shot(OLD + route, saved, "dark", fo), n = await shot(base + route, saved, "dark", fn);
    // side by side
    const page = await br.newPage({ viewport: { width: 1640, height: 1000 } });
    const img = (f) => "data:image/png;base64," + fs.readFileSync(f).toString("base64");
    await page.setContent(`<body style="margin:0;display:flex;gap:40px;background:#888;padding:20px;font:16px sans-serif"><div><div>old site, default (def), night</div><img src="${img(fo)}" width="400"></div><div><div>new neo, night</div><img src="${img(fn)}" width="400"></div></body>`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `night-${style}-${name.replace(/\W+/g, "-")}.png`), fullPage: true });
    await page.close(); fs.unlinkSync(fo); fs.unlinkSync(fn);
    for (const k of Object.keys(Object.assign({}, o, n))) {
      const same = o[k] === n[k];
      rows.push({ page: tag, key: k, old: o[k], neo: n[k], same });
      if (!same && k !== "theme-color") diffs.push(tag + " " + k + ": " + o[k] + " -> " + n[k]);
      if (!same && k === "theme-color" && o[k] && n[k]) diffs.push(tag + " " + k + ": " + o[k] + " -> " + n[k]);
    }
  }
  // neo by day, glass and shade
  for (const style of ["glass", "shade"]) for (const [name, route] of PAGES) await shot(base + route, { mode: "light", style }, "light", path.join(OUT, `day-neo-${style}-${name.replace(/\W+/g, "-")}.png`));
  await br.close(); server.close();
  fs.writeFileSync(path.join(OUT, "proof.json"), JSON.stringify(rows, null, 1));
  let last = "";
  for (const r of rows) { if (r.page !== last) { console.log("\n## " + r.page); last = r.page; } console.log(`${r.same ? "=" : "X"} ${r.key}: ${r.old}${r.same ? "" : "  |  neo: " + r.neo}`); }
  console.log(diffs.length ? "\n" + diffs.length + " DIFFERENCES\n" + diffs.join("\n") : "\nALL IDENTICAL");
  if (diffs.length) process.exitCode = 1;
})();
