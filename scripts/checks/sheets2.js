// Contact sheets from cards/*.png, a long-phrase comparison, 390px site shots, and a
// glass-vs-shade pixel diff. Read-only against public/.
const { chromium } = require("playwright");
const { serve, PALS } = require("./lib.js");
const fs = require("fs"), path = require("path");
const DIR = __dirname, OUT = path.join(DIR, "sheets2"); fs.mkdirSync(OUT, { recursive: true });
const PN = { gold: "gold (ذهبي)", def: "def (زمردي)", lav: "lav (بنفسجي)", sun: "sun (غروب)", neo: "neo (فيروزي)" };
const ROWS = [["glass", "light"], ["glass", "dark"], ["shade", "light"], ["shade", "dark"]];
const css = `body{margin:0;background:#fff;font:600 22px system-ui,sans-serif;color:#111}.g{display:grid;gap:18px;padding:24px}
.c{display:flex;flex-direction:column;gap:6px}.c img{width:100%;display:block;border:1px solid #ccc}.h{font-size:28px;padding:24px 24px 0}.r{writing-mode:vertical-rl;transform:rotate(180deg);text-align:center}`;

(async () => {
  const site = await serve();
  const imgs = await serve(DIR);
  const br = await chromium.launch();
  const shot = async (html, file, width) => {
    const p = await br.newPage({ viewport: { width, height: 800 } });
    await p.setContent(`<style>${css}</style>${html}`.replace(/src="cards2\//g, `src="${imgs.base}/cards2/`));
    await p.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth));
    await p.screenshot({ path: file, fullPage: true }); await p.close(); return file;
  };
  const files = [];
  for (const [size, label, dims] of [["regular", "Regular (1080x1350)", "1080×1350"], ["story", "Story (1080x1920)", "1080×1920"]]) {
    let h = `<div class="h">Short word «سَجَى» (الضحى 2), ${label}: rows = style/mode, columns = palette</div><div class="g" style="grid-template-columns:40px repeat(5,300px)"><div></div>`;
    h += PALS.map((p) => `<div class="c">${PN[p]}</div>`).join("");
    for (const [st, md] of ROWS) {
      h += `<div class="r">${st} · ${md}</div>`;
      h += PALS.map((p) => `<div class="c"><img src="cards2/short-${size}-${st}-${p}-${md}.png"><span style="font-size:16px">${st}/${p}/${md}</span></div>`).join("");
    }
    files.push(await shot(h + "</div>", path.join(OUT, `contact-short-${size}.png`), 1700));
  }
  {
    let h = `<div class="h">Long phrase «الْخُنَّسِ الْجَوَارِ الْكُنَّسِ» (التكوير 15-16), default palette</div><div class="g" style="grid-template-columns:repeat(4,400px)">`;
    for (const size of ["regular", "story"]) h += ROWS.map(([st, md]) => `<div class="c"><span>${size} · ${st} · ${md}</span><img src="cards2/long-${size}-${st}-def-${md}.png"></div>`).join("");
    files.push(await shot(h + "</div>", path.join(OUT, "long-def-4combos.png"), 1720));
  }
  await br.close(); site.server.close(); imgs.server.close();
  console.log(files.join("\n"));
})();
