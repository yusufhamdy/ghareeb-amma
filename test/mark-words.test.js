"use strict";
/*
 * mark-words.test.js - the ayah highlight never starts or ends inside a written word.
 *
 * In every rendered ayah (the app's word pages, day cards and quiz; the static word pages; the save-image card's
 * layout pieces) the character before each <mark> is a space, the ornate parenthesis or the line start, and the
 * character after it is a space, the ornate parenthesis or the line end; and the rendered text with the marks
 * removed is exactly before + hl + after. Stored segments are untouched (qtext.js markParts is display only).
 *
 * ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PUBLIC = path.resolve(__dirname, "..", "public");
const QText = require("../public/qtext.js");
const WORDS = JSON.parse(fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8"));
const OL = "﴿", OR = "﴾";
const okBefore = (c) => c === undefined || c === " " || c === OL;
const okAfter = (c) => c === undefined || c === " " || c === OR;

// one rendered ayah as [{ text, mark }] runs -> boundary problems and the plain text
function checkRuns(runs, where) {
  const bad = [];
  runs.forEach((r, i) => {
    if (!r.mark) return;
    const prev = (runs[i - 1] || { text: "" }).text, next = (runs[i + 1] || { text: "" }).text;
    if (!okBefore([...prev].pop())) bad.push(where + ": mark starts inside a word");
    if (!okAfter([...next][0])) bad.push(where + ": mark ends inside a word");
  });
  return bad;
}
const segsOf = (a) => (a.segments || []).map((g) => OL + g.before + g.hl + g.after + OR).join(" ");
const all = [];
WORDS.forEach((e) => e.ayahs.forEach((a) => all.push(a)));

test("markParts: whole written words, same text, the 9 split segments widened", () => {
  let widened = 0;
  for (const a of all) for (const g of a.segments) {
    const k = QText.markParts(g);
    assert.strictEqual(k.pre + k.mark + k.post, g.before + g.hl + g.after, "same text");
    assert.ok(k.mark.includes(g.hl), "the mark holds hl");
    assert.ok(okBefore([...k.pre].pop()) && okAfter([...k.post][0]), "word boundaries");
    if (k.mark !== g.hl) widened++;
  }
  assert.strictEqual(widened, 9, "exactly the nine segments whose hl starts or ends inside a word");
});

test("static word pages: no mark inside a word, text unchanged", () => {
  const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const bad = [];
  let n = 0;
  const texts = new Set(all.map(segsOf));
  for (const f of fs.readdirSync(path.join(PUBLIC, "word")).filter((x) => x.endsWith(".html"))) {
    const ay = (fs.readFileSync(path.join(PUBLIC, "word", f), "utf8").match(/<div class="ay q">([\s\S]*?)<\/div>/) || [])[1];
    const runs = ay.split(/(<mark>[\s\S]*?<\/mark>)/).filter((x) => x !== "").map((x) => (x.startsWith("<mark>") ? { mark: true, text: unesc(x.slice(6, -7)) } : { mark: false, text: unesc(x) }));
    bad.push(...checkRuns(runs, f));
    assert.ok(texts.has(runs.map((r) => r.text).join("")), f + ": the ayah text is before + hl + after");
    n++;
  }
  assert.deepStrictEqual(bad, []);
  assert.strictEqual(n, 73);
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

test("the app (word pages, day cards, quiz) and the save-image layout: no mark inside a word", async (t) => {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let br;
  try { br = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return; }
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    const page = await br.newPage({ viewport: { width: 400, height: 900 } });
    await page.addInitScript(() => { try { localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-set", JSON.stringify({ cm: true, snd: false })); } catch (e) {} });
    await page.goto("http://127.0.0.1:" + server.address().port + "/#/", { waitUntil: "load" });
    await page.waitForFunction(() => typeof W !== "undefined" && W.length > 0, null, { timeout: 20000 });
    const got = await page.evaluate(async () => {
      const wait = () => new Promise((r) => setTimeout(r, 40));
      const ayahs = [];
      const grab = (where) => document.querySelectorAll("#app .ay, #sh .av").forEach((el) => ayahs.push({ where, runs: [...el.childNodes].map((n) => ({ mark: n.nodeName === "MARK", text: n.textContent })) }));
      for (const w of W) { location.hash = "#/word/" + w.id; await wait(); grab("word " + w.id); }
      for (let d = 1; d <= 30; d++) {
        location.hash = "#/day/" + d; await wait();
        document.querySelectorAll(".dcard:not(.open)").forEach((c) => c.click()); await wait(); grab("day " + d);
      }
      location.hash = "#/quiz"; await wait(); grab("quiz");
      // the save-image card: each mark is one piece, and the pieces read as the ayah
      const cards = W.map((w) => { const k = renderCard(w, "n").__card, pieces = k.ops.filter((o) => o.role === "ayah").map((o) => o.t); return { id: w.id, ok: w.ay.segments.every((g) => pieces.includes(QText.markParts(g).mark)) && k.marks.length === w.ay.segments.length }; });
      return { ayahs, cards };
    });
    const bad = [];
    for (const a of got.ayahs) bad.push(...checkRuns(a.runs, a.where));
    assert.deepStrictEqual(bad, []);
    assert.ok(got.ayahs.filter((a) => a.where.startsWith("word ")).length >= 73 && got.ayahs.some((a) => a.where.startsWith("day ")) && got.ayahs.some((a) => a.where === "quiz"), "word pages, day cards and the quiz were checked (" + got.ayahs.length + ")");
    const texts = new Set(all.map(segsOf));
    for (const a of got.ayahs) assert.ok(texts.has(a.runs.map((r) => r.text).join("")), a.where + ": the ayah text is before + hl + after");
    assert.deepStrictEqual(got.cards.filter((c) => !c.ok).map((c) => c.id), [], "each card mark is the whole-word mark, drawn as one piece");
    await page.close();
  } finally {
    await br.close();
    await new Promise((r) => server.close(r));
  }
});
