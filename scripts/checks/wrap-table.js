// Which headwords wrap on the word page (and on the save-image card), per width.
//   node wrap-table.js [out.md]
// For every word: the number of lines of h1.wd at 360, 400, 768 and 1440px (glass light gold), each line's words,
// and the card's headword lines (regular and story). Lists only the headwords that take more than one line.
const { serve } = require("./lib.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const OUT = process.argv[2] || path.join(__dirname, "out/round2/wrap-table.md");
const WIDTHS = [360, 400, 768, 1440];
(async () => {
  const { server, base } = await serve();
  const br = await chromium.launch();
  const rows = {};
  for (const w of WIDTHS) {
    const p = await br.newPage({ viewport: { width: w, height: 900 } });
    await p.addInitScript(() => { localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-set", JSON.stringify({ cm: true, snd: false })); });
    await p.goto(base + "/#/"); await p.waitForTimeout(800);
    const ids = await p.evaluate(() => W.map((x) => [x.id, x.dw]));
    for (const [id, dw] of ids) {
      await p.evaluate((i) => { location.hash = "#/word/" + i; }, id);
      await p.waitForFunction((i) => location.hash === "#/word/" + i && document.querySelector(".cols .card .wd"), id);
      await p.evaluate(() => document.fonts.ready);
      const lines = await p.evaluate(() => {
        const el = document.querySelector(".cols .card .wd"), tn = el.firstChild, r = document.createRange(), out = {};
        let i = 0;
        for (const word of tn.data.split(" ")) { r.setStart(tn, i); r.setEnd(tn, i + word.length); const k = Math.round(r.getBoundingClientRect().top); (out[k] = out[k] || []).push(word); i += word.length + 1; }
        return Object.keys(out).sort((a, b) => a - b).map((k) => out[k].join(" "));
      });
      (rows[id] = rows[id] || { dw, page: {} }).page[w] = lines;
    }
    if (w === 400) {
      await p.evaluate(() => cardFonts());
      const cards = await p.evaluate(() => W.map((x) => [x.id, ["n", "s"].map((s) => renderCard(x, s).__card.ops.filter((o) => o.role === "word").map((o) => o.t))]));
      for (const [id, c] of cards) rows[id].card = c;
    }
    await p.close();
  }
  await br.close(); server.close();
  const lines = ["# Headword wrapping after F (display headword) and H (balanced)", "", "Lines of the headword on the word page (h1.wd) and on the save-image card. Only headwords that wrap somewhere are listed; every other headword is one line at every width.", "", "| word | headword | 360 | 400 | 768 | 1440 | card (regular / story) |", "| --- | --- | --- | --- | --- | --- | --- |"];
  for (const [id, r] of Object.entries(rows)) {
    const wraps = WIDTHS.some((w) => r.page[w].length > 1) || r.card.some((c) => c.length > 1);
    if (!wraps) continue;
    const cell = (ls) => (ls.length > 1 ? ls.length + ": " + ls.map((l) => l).join(" / ") : "1");
    lines.push("| " + id + " | " + r.dw + " | " + WIDTHS.map((w) => cell(r.page[w])).join(" | ") + " | " + r.card.map(cell).join(" ; ") + " |");
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
})();
