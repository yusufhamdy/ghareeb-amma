"use strict";
/*
 * ayah-brackets.test.js - an ornate parenthesis is never alone at a line end or start.
 *
 * For every word page (the app and the static page) at 320, 360, 400, 768 and 1440px: the ayah's characters are
 * grouped into lines by their Range client rects; no line starts with the closing parenthesis U+FD3E and no line
 * ends with the opening one U+FD3F. The same on the save-image card (regular and story), whose layout pieces are
 * grouped by their baseline.
 *
 * ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PUBLIC = path.resolve(__dirname, "..", "public");
const WIDTHS = [320, 360, 400, 768, 1440];

function staticServer(root) {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".png": "image/png" };
  return http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/firebase-config.js") { res.writeHead(200, { "content-type": types[".js"] }); res.end("window.FIREBASE_CONFIG={};"); return; }
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("nf"); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

// in the page: the ayah block's lines, as strings of visible characters in logical order
const LINES = `(() => {
  const ay = document.querySelector(".cols .card .ay");
  const fs = parseFloat(getComputedStyle(ay).fontSize), lines = [], r = document.createRange();
  let cur = null;
  const walk = (n) => n.childNodes.forEach((c) => {
    if (c.nodeType !== 3) return walk(c);
    for (let i = 0; i < c.data.length; i++) {
      const ch = c.data[i];
      if (ch === " ") continue;
      r.setStart(c, i); r.setEnd(c, i + 1);
      const b = r.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      const mid = b.top + b.height / 2;
      if (!cur || Math.abs(mid - cur.mid) > fs * 0.6) { cur = { mid, text: "" }; lines.push(cur); }
      cur.text += ch;
    }
  });
  walk(ay);
  return lines.map((l) => l.text);
})()`;
const badLines = (lines) => lines.filter((l) => l.startsWith("﴾") || l.endsWith("﴿"));

test("no ornate parenthesis alone at a line end or start, in the page and on the card", { timeout: 900000 }, async (t) => {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let br;
  try { br = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return; }
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const bad = [];
  let multi = 0;
  try {
    for (const w of WIDTHS) {
      const page = await br.newPage({ viewport: { width: w, height: 900 } });
      await page.addInitScript(() => { try { localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-set", JSON.stringify({ cm: true, snd: false })); } catch (e) {} });
      await page.goto(base + "/#/", { waitUntil: "load" });
      await page.waitForFunction(() => typeof W !== "undefined" && W.length > 0, null, { timeout: 20000 });
      await page.evaluate(() => document.fonts.ready);
      const words = await page.evaluate(() => W.map((x) => [x.id, x.slug]));
      for (const [id] of words) {
        await page.evaluate((i) => { location.hash = "#/word/" + i; }, id);
        await page.waitForFunction((i) => location.hash === "#/word/" + i && document.querySelector(".cols .card .ay"), id);
        const lines = await page.evaluate(LINES);
        if (lines.length > 1) multi++;
        badLines(lines).forEach((l) => bad.push("app " + id + " @" + w + ": " + JSON.stringify(lines)));
      }
      if (w === 400) {
        await page.evaluate(() => cardFonts());
        const cards = await page.evaluate(() => {
          const out = [];
          for (const x of W) for (const size of ["n", "s"]) {
            const ops = renderCard(x, size).__card.ops.filter((o) => o.role === "ayah"), byY = new Map();
            ops.forEach((o) => { const k = Math.round(o.y); if (!byY.has(k)) byY.set(k, []); byY.get(k).push(o.t); });
            out.push({ id: x.id + "/" + size, lines: [...byY.values()].map((l) => l.join("").replace(/ /g, "")) });
          }
          return out;
        });
        for (const c of cards) badLines(c.lines).forEach(() => bad.push("card " + c.id + ": " + JSON.stringify(c.lines)));
      }
      for (const [, slug] of words) {
        await page.goto(base + "/word/" + slug + ".html", { waitUntil: "load" });
        await page.evaluate(() => document.fonts.ready);
        const lines = await page.evaluate(LINES);
        badLines(lines).forEach((l) => bad.push("static " + slug + " @" + w + ": " + JSON.stringify(lines)));
      }
      await page.close();
    }
  } finally {
    await br.close();
    await new Promise((r) => server.close(r));
  }
  assert.deepStrictEqual(bad, []);
  assert.ok(multi > 0, "some ayahs wrap, so the check has lines to look at (" + multi + ")");
});
