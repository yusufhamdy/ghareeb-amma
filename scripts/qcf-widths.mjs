#!/usr/bin/env node
/*
 * qcf-widths.mjs - measures the advance width of every glyph code of public/qcf-v2.json in its own page font
 * (public/fonts/qcf-v2/, unmodified) and stores it in the table as the entry's fourth field, in em of the glyph word's
 * own font size: [page, code_v2, text, width]. The text and the codes are never changed.
 *
 * Why: public/qcf.js gives every glyph word that width (style="width:...em", display:inline-block in qcf.css), so an
 * ayah is laid out at its final size before its page font has loaded. qcf-dom.js keeps it invisible until then
 * (never the Hafs rendering first, never empty boxes, no layout jump when the glyphs appear).
 *
 * Measured in headless Chromium (Playwright), the browser's own text layout at 1000px: a span's width / 1000,
 * rounded to 5 decimals (at the site's sizes, under 0.001px per word).
 *
 *   node scripts/qcf-widths.mjs           write the widths into public/qcf-v2.json
 *   node scripts/qcf-widths.mjs --check   exit 1 if any stored width differs from a new measurement by > 0.0002 em
 *
 * scripts/build-qcf-table.mjs keeps these widths when it rebuilds the table (same page and code).
 * ASCII-ONLY (see test/arabic-guard.test.js).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "qcf-v2.json");
const { serve } = require("./checks/lib.js");
const { launch } = await import(new URL("./gen-icons.mjs", import.meta.url).href);

export const SIZE = 1000;
export const round = (x) => Math.round(x * 1e5) / 1e5;

// the table's JSON layout, as scripts/build-qcf-table.mjs writes it
export const format = (table) => JSON.stringify(table, null, 0).replace(/\],"(\d+:\d+)"/g, '],\n"$1"') + "\n";

const args = process.argv.slice(2);
const raw = fs.readFileSync(OUT, "utf8");
const table = JSON.parse(raw);
const items = [];
for (const [k, list] of Object.entries(table.ayat)) list.forEach((e, i) => items.push({ k, i, page: e[0], code: e[1] }));

const { server, base } = await serve();
const { br, renderer } = await launch();
let widths;
try {
  const page = await br.newPage();
  await page.goto(base + "/404.html");
  widths = await page.evaluate(async ({ items, first, last, SIZE }) => {
    for (let p = first; p <= last; p++) {
      const f = new FontFace("QCF2 " + p, "url(/fonts/qcf-v2/QCF2" + p + ".ttf)");
      document.fonts.add(await f.load());
    }
    const box = document.createElement("div");
    box.style.cssText = "position:absolute;top:0;left:0;white-space:nowrap;direction:rtl";
    document.body.appendChild(box);
    return items.map((it) => {
      const s = document.createElement("span");
      s.style.cssText = "font:400 " + SIZE + "px 'QCF2 " + it.page + "';letter-spacing:0;word-spacing:0;font-feature-settings:normal;font-variant-ligatures:normal";
      s.textContent = it.code;
      box.appendChild(s);
      const w = s.getBoundingClientRect().width / SIZE;
      s.remove();
      return w;
    });
  }, { items, first: table.first, last: table.last, SIZE });
} finally {
  await br.close();
  server.close();
}

let bad = 0, maxd = 0;
items.forEach((it, n) => {
  const w = round(widths[n]);
  if (!(w > 0)) { bad++; console.error("no width for " + it.k + " #" + (it.i + 1)); }
  const e = table.ayat[it.k][it.i];
  if (args.includes("--check")) {
    const d = Math.abs((e[3] || 0) - w);
    maxd = Math.max(maxd, d);
    if (d > 0.0002) bad++;
  } else e[3] = w;
});
console.log("renderer: " + renderer + "; " + items.length + " glyph words measured");
if (args.includes("--check")) {
  console.log(bad ? bad + " width(s) differ (max " + maxd + " em)" : "every stored width matches (max difference " + maxd + " em)");
  process.exit(bad ? 1 : 0);
}
if (bad) process.exit(1);
table.about = table.about.replace("one [page, code_v2, text] per word", "one [page, code_v2, text, width] per word").replace(/ Built by scripts\/build-qcf-table\.mjs;/, " width: the glyph's advance in em, measured by scripts/qcf-widths.mjs. Built by scripts/build-qcf-table.mjs;");
fs.writeFileSync(OUT, format(table));
console.log("wrote the widths into public/qcf-v2.json");
