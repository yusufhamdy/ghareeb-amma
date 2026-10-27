"use strict";
/*
 * headword-wrap.test.js - a headword that needs two lines is balanced, never one word left alone.
 *
 *   - the page: h1.wd carries text-wrap: balance in the app's style block and in the static pages' stylesheet;
 *     81-3 (three words) on the word page at 400 and 1440 splits two and one word with the lines as close in width
 *     as the browser's balancing gives (the shorter line is at least 40% of the longer);
 *   - the save-image card: every two-line headword is split at the space that makes the two lines closest in width.
 *
 * ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PUBLIC = path.resolve(__dirname, "..", "public");

test("text-wrap: balance on the headword, in the app and the static pages", () => {
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(PUBLIC, "css", "app.css"), "utf8");
  for (const [name, src] of [["index.html", html], ["css/app.css", css]]) assert.ok(/h1\.wd\{[^}]*text-wrap:balance/.test(src), name + ": h1.wd is balanced");
});

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

test("the page and the card balance two-line headwords", async (t) => {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let br;
  try { br = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return; }
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    for (const w of [400, 1440]) {
      for (const url of ["/#/word/81-3", "/word/at-takwir-15.html"]) {
        const page = await br.newPage({ viewport: { width: w, height: 900 } });
        await page.addInitScript(() => { try { localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-set", JSON.stringify({ cm: true, snd: false })); } catch (e) {} });
        await page.goto(base + url, { waitUntil: "load" });
        await page.waitForSelector(".cols .card .wd");
        await page.evaluate(() => document.fonts.ready);
        const lines = await page.evaluate(() => {
          const el = document.querySelector(".cols .card .wd"), tn = el.firstChild, r = document.createRange(), out = {};
          let i = 0;
          for (const word of tn.data.split(" ")) { r.setStart(tn, i); r.setEnd(tn, i + word.length); const b = r.getBoundingClientRect(); const k = Math.round(b.top); (out[k] = out[k] || { words: [], w: 0 }).words.push(word); out[k].w += b.width; i += word.length + 1; }
          return Object.values(out).map((l) => ({ n: l.words.length, w: Math.round(l.w) }));
        });
        if (lines.length === 2) {
          assert.ok(Math.min(lines[0].w, lines[1].w) >= 0.4 * Math.max(lines[0].w, lines[1].w), url + " at " + w + ": balanced lines " + JSON.stringify(lines));
          assert.deepStrictEqual(lines.map((l) => l.n).sort(), [1, 2], url + " at " + w + ": two words and one");
        }
        await page.close();
      }
    }
    // the card: every two-line headword is split where the two lines are closest in width
    const page = await br.newPage({ viewport: { width: 400, height: 900 } });
    await page.addInitScript(() => { try { localStorage.setItem("gq-ld", "1"); } catch (e) {} });
    await page.goto(base + "/#/", { waitUntil: "load" });
    await page.waitForFunction(() => typeof W !== "undefined" && W.length > 0, null, { timeout: 20000 });
    await page.evaluate(() => cardFonts());
    const bad = await page.evaluate(() => {
      const out = [];
      for (const w of W) for (const size of ["n", "s"]) {
        const k = renderCard(w, size).__card, ops = k.ops.filter((o) => o.role === "word");
        if (ops.length !== 2) continue;
        const c = document.createElement("canvas").getContext("2d"); c.font = ops[0].font;
        const words = (window.qText ? qText(w.dw) : w.dw).split(" "), widths = [];
        for (let i = 1; i < words.length; i++) widths.push(Math.abs(c.measureText(words.slice(0, i).join(" ")).width - c.measureText(words.slice(i).join(" ")).width));
        const got = Math.abs(c.measureText(ops[0].t).width - c.measureText(ops[1].t).width);
        if (got > Math.min(...widths) + 0.5) out.push(w.id + "/" + size);
      }
      return out;
    });
    assert.deepStrictEqual(bad, [], "card headwords not balanced");
    await page.close();
  } finally {
    await br.close();
    await new Promise((r) => server.close(r));
  }
});
