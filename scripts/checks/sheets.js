// Contact sheets from cards/*.png, a long-phrase comparison, 390px site shots, and a
// glass-vs-shade pixel diff. Read-only against public/.
const { chromium } = require("playwright");
const { serve, PALS } = require("./lib.js");
const fs = require("fs"), path = require("path");
const DIR = __dirname, OUT = path.join(DIR, "sheets"); fs.mkdirSync(OUT, { recursive: true });
const PN = { def: "def (الافتراضي)", lav: "lav (لافندر)", sun: "sun (غروب)", neo: "neo (نيون)", min: "min (نعناع)" };
const ROWS = [["glass", "light"], ["glass", "dark"], ["shade", "light"], ["shade", "dark"]];
const css = `body{margin:0;background:#fff;font:600 22px system-ui,sans-serif;color:#111}.g{display:grid;gap:18px;padding:24px}
.c{display:flex;flex-direction:column;gap:6px}.c img{width:100%;display:block;border:1px solid #ccc}.h{font-size:28px;padding:24px 24px 0}.r{writing-mode:vertical-rl;transform:rotate(180deg);text-align:center}`;

(async () => {
  const site = await serve();
  const imgs = await serve(DIR);
  const br = await chromium.launch();
  const shot = async (html, file, width) => {
    const p = await br.newPage({ viewport: { width, height: 800 } });
    await p.setContent(`<style>${css}</style>${html}`.replace(/src="cards\//g, `src="${imgs.base}/cards/`));
    await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth));
    await p.screenshot({ path: file, fullPage: true }); await p.close(); return file;
  };
  const files = [];
  for (const [size, label, dims] of [["regular", "Regular (1080x1350)", "1080×1350"], ["story", "Story (1080x1920)", "1080×1920"]]) {
    let h = `<div class="h">Short word «سَجَى» (الضحى 2), ${label}: rows = style/mode, columns = palette</div><div class="g" style="grid-template-columns:40px repeat(5,300px)"><div></div>`;
    h += PALS.map((p) => `<div class="c">${PN[p]}</div>`).join("");
    for (const [st, md] of ROWS) {
      h += `<div class="r">${st} · ${md}</div>`;
      h += PALS.map((p) => `<div class="c"><img src="cards/short-${size}-${st}-${p}-${md}.png"><span style="font-size:16px">${st}/${p}/${md}</span></div>`).join("");
    }
    files.push(await shot(h + "</div>", path.join(OUT, `contact-short-${size}.png`), 1700));
  }
  {
    let h = `<div class="h">Long phrase «الْخُنَّسِ الْجَوَارِ الْكُنَّسِ» (التكوير 15-16), default palette</div><div class="g" style="grid-template-columns:repeat(4,400px)">`;
    for (const size of ["regular", "story"]) h += ROWS.map(([st, md]) => `<div class="c"><span>${size} · ${st} · ${md}</span><img src="cards/long-${size}-${st}-def-${md}.png"></div>`).join("");
    files.push(await shot(h + "</div>", path.join(OUT, "long-def-4combos.png"), 1720));
  }
  // 390px site screenshots of the word page, same four combinations.
  const ctxFor = async (st, md) => {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); }, { style: st, mode: md, pal: "def", gl: 3, gv: 2, snd: false, cm: true });
    return ctx;
  };
  for (const [kind, word] of [["long", "الْخُنَّسِ الْجَوَارِ الْكُنَّسِ"], ["short", "سَجَى"]]) for (const [st, md] of ROWS) {
    const ctx = await ctxFor(st, md), p = await ctx.newPage();
    await p.goto(site.base + "/", { waitUntil: "load" });
    await p.waitForFunction(() => typeof W !== "undefined" && W.length > 0);
    const id = await p.evaluate((wd) => W.find((w) => w.word === wd).id, word);
    await p.evaluate((id) => { location.hash = "#/word/" + id }, id);
    await p.waitForSelector("#app .wd.q"); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
    const f = path.join(OUT, `site390-${kind}-${st}-def-${md}.png`);
    await p.screenshot({ path: f, fullPage: true }); files.push(f); await ctx.close();
  }
  // Glass vs shade: are the saved PNGs identical?
  const a = await br.newPage(); await a.goto(imgs.base + "/cards/meta.json");
  const diffs = await a.evaluate(async (pals) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s; });
    const px = async (s) => { const i = await load(s), c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const x = c.getContext("2d"); x.drawImage(i, 0, 0); return x.getImageData(0, 0, c.width, c.height).data; };
    const out = {};
    for (const k of ["short", "long"]) for (const sz of ["regular", "story"]) for (const p of pals) for (const m of ["light", "dark"]) {
      const g = await px(`cards/${k}-${sz}-glass-${p}-${m}.png`), s = await px(`cards/${k}-${sz}-shade-${p}-${m}.png`);
      let n = 0, mx = 0; for (let i = 0; i < g.length; i++) { const d = Math.abs(g[i] - s[i]); if (d) { n++; if (d > mx) mx = d; } }
      out[`${k}-${sz}-${p}-${m}`] = { changedChannels: n, maxDelta: mx };
    }
    return out;
  }, PALS);
  fs.writeFileSync(path.join(OUT, "glass-vs-shade.json"), JSON.stringify(diffs, null, 1));
  await br.close(); site.server.close(); imgs.server.close();
  console.log(files.join("\n"));
  const v = Object.values(diffs); console.log("glass vs shade: identical", v.filter((d) => !d.changedChannels).length, "of", v.length, "; max delta", Math.max(...v.map((d) => d.maxDelta)));
})();
