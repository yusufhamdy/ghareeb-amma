"use strict";
/*
 * headword.test.js - the headword is shown in the mushaf's (Uthmani) spelling, taken from the ayah itself.
 *
 *   - dw for all 73 words follows the rule: the segments' hl in NFC, joined with one space, with an attached
 *     article (alef wasla + lam, with or without the sukun) from `before` put back in front, and no other attached
 *     particle; every mark in dw is the same code point as in its hl (so 83-0 keeps U+0656, never U+064D);
 *   - no visible headword in the static pages or in the app is in the stored modern spelling (unless the stored
 *     word already is the mushaf text, as in al-Adiyat);
 *   - the stored word still drives the page titles, descriptions and JSON-LD;
 *   - search finds every word from both spellings; the challenge days resolve to exactly the words the previous
 *     normalization resolved; meanings still show without their "word:" prefix.
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
const CH = JSON.parse(fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8"));
const ALIF_WASLA = "\u0671", LAM = "\u0644", SUKUN = "\u06e1";

// the rule, written out independently of qtext.js
function expected(ayah) {
  return (ayah.segments || []).map((g) => {
    const hl = g.hl.normalize("NFC").trim(), b = g.before.normalize("NFC");
    let pre = "";
    if (b.endsWith(ALIF_WASLA + LAM + SUKUN)) pre = ALIF_WASLA + LAM + SUKUN;
    else if (b.endsWith(ALIF_WASLA + LAM)) pre = ALIF_WASLA + LAM;
    return pre + hl;
  }).join(" ");
}
const all = [];
WORDS.forEach((e) => e.words.forEach((w, i) => all.push({ surah: e.surah, word: w, ayah: e.ayahs[i], dw: QText.displayWord(e.ayahs[i]) })));
const isMark = (c) => /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u08f0-\u08ff]/.test(c);

test("dw follows the rule for all 73 words, marks included", () => {
  assert.strictEqual(all.length, 73);
  let articles = 0;
  for (const x of all) {
    assert.strictEqual(x.dw, expected(x.ayah), x.word);
    const hls = x.ayah.segments.map((g) => g.hl.normalize("NFC").trim()).join(" ");
    // marks: the same code points, in the same order, as in hl (plus the article's sukun when it was put back)
    const marks = (s) => [...s].filter(isMark).join("");
    const extra = x.dw.length - hls.length;
    assert.ok(extra === 0 || extra === 2 || extra === 3, x.word + ": only an article may be added");
    if (extra) articles++;
    assert.strictEqual(x.dw.slice(extra), hls, x.word + ": dw ends with the highlighted text itself");
    assert.strictEqual(marks(x.dw.slice(extra)), marks(hls));
    // no other attached particle is put in front
    assert.ok(!/^[\u0648\u0641\u0628\u0643\u0644][\u064e\u0650]/.test(x.dw) || /^[\u0648\u0641\u0628\u0643\u0644][\u064e\u0650]/.test(hls), x.word + ": no particle added");
  }
  assert.strictEqual(articles, 1, "only al-Fajr 19 has an attached article");
  // the open-tanween form of the mushaf survives: sijjin (al-Mutaffifin 7) shows U+0656, not U+064D
  const sijjin = all.find((x) => x.surah.endsWith("\u0627\u0644\u0645\u0637\u0641\u0641\u064a\u0646") && x.ayah.label === "7");
  assert.ok(sijjin.dw.includes("\u0656") && !sijjin.dw.includes("\u064d"), "83-0 keeps U+0656");
  assert.ok(sijjin.word.includes("\u064d"), "the stored word keeps its own spelling");
});

test("static pages: visible headwords in the mushaf spelling, the stored word in titles and data", () => {
  const dws = new Set(all.map((x) => x.dw));
  const modern = new Set(all.filter((x) => x.word !== x.dw).map((x) => x.word));
  const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  let n = 0;
  for (const d of ["word", "surah"]) for (const f of fs.readdirSync(path.join(PUBLIC, d)).filter((x) => x.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(PUBLIC, d, f), "utf8");
    const shown = [...html.matchAll(/<(h1 class="wd q"|a class="g chip q"[^>]*|span class="q w"[^>]*)>([^<]*)</g)].map((m) => unesc(m[2]));
    for (const s of shown) { n++; assert.ok(dws.has(s), d + "/" + f + ": shows a headword that is not dw: " + s); assert.ok(!modern.has(s), d + "/" + f + ": modern spelling shown: " + s); }
    if (d === "word") {
      const title = unesc((html.match(/<title>([^<]*)<\/title>/) || [])[1] || "");
      assert.ok(!/[\u064b-\u065f\u0670\u06d6-\u06ed]/.test(title), f + ": the title stays the plain stored word");
    }
  }
  assert.ok(n > 200, "headwords checked: " + n);
});

// --- browser: the app --------------------------------------------------------------------------------------
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

// the normalization the app used before (and still uses for the challenge), copied verbatim
const oldNorm = (s) => String(s).replace(/[\u0640\u064b-\u065f\u0670\u06d6-\u06ed]/g, "").replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627").replace(/\u0649/g, "\u064a").replace(/\u0629/g, "\u0647").replace(/\u0624/g, "\u0648").replace(/\u0626/g, "\u064a").replace(/\s+/g, " ").trim();

test("the app: visible headwords, search from both spellings, the challenge, meanings", async (t) => {
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
    const r = await page.evaluate(async () => {
      const wait = () => new Promise((res) => setTimeout(res, 40));
      const shown = [];
      const grab = () => document.querySelectorAll("#app .wd, #app .w.q, #app .dword, #sh .aw").forEach((e) => shown.push(e.textContent));
      for (const w of W) { location.hash = "#/word/" + w.id; await wait(); grab(); }
      for (const s of S) { location.hash = "#/surah/" + s.num; await wait(); grab(); }
      for (let d = 1; d <= 30; d++) { location.hash = "#/day/" + d; await wait(); grab(); }
      // search rows (the home search box)
      location.hash = "#/"; await wait();
      const q = document.getElementById("q"); q.value = W[5].word; q.dispatchEvent(new Event("input", { bubbles: true })); await new Promise((res) => setTimeout(res, 400)); grab();
      // the drawn word in the random reel (motion off: one row)
      const reel = []; rouOpen(W, () => {}); document.querySelectorAll(".reelrow").forEach((e) => reel.push(e.textContent)); if (rouAbort) rouAbort();
      const search = W.map((w) => ({ id: w.id, byWord: rank(w.word).includes(w), byDw: rank(w.dw).includes(w), byBare: rank(QText.searchNorm(w.word)).includes(w) }));
      const days = CH.map((c) => ({ d: c.d, ids: dayWords(c).map((w) => w.id) }));
      const means = W.map((w) => ({ id: w.id, word: w.word, mean: w.mean }));
      return { shown, reel, search, days, means, dws: W.map((w) => w.dw), words: W.map((w) => [w.id, w.word, w.s.num]) };
    });
    const dws = new Set(r.dws), modern = new Set(all.filter((x) => x.word !== x.dw).map((x) => x.word));
    assert.ok(r.shown.length >= 140, "headwords seen: " + r.shown.length);
    for (const s of r.shown.concat(r.reel)) { assert.ok(dws.has(s), "not dw: " + s); assert.ok(!modern.has(s), "modern spelling shown: " + s); }
    for (const s of r.search) assert.ok(s.byWord && s.byDw && s.byBare, "search finds " + s.id + " " + JSON.stringify(s));
    // the challenge: what the previous normalization resolved, computed here from the data
    const byKey = new Map(r.words.map(([id, word, num]) => [num + "|" + oldNorm(word), id]));
    for (const day of CH.days) {
      const want = day.w.map((x) => byKey.get((Array.isArray(x) ? x[0] : x.no) + "|" + (Array.isArray(x) ? x[1] : x.word))).filter(Boolean);
      const got = (r.days.find((d) => d.d === day.d) || { ids: [] }).ids;
      assert.deepStrictEqual(got, want, "day " + day.d);
      assert.strictEqual(want.length, day.w.length, "day " + day.d + ": every reference resolves");
    }
    // meanings without the "word:" prefix
    for (const m of r.means) {
      const k = m.mean.indexOf(":");
      assert.ok(!(k > 0 && k < 60 && oldNorm(m.mean.slice(0, k)) === oldNorm(m.word)), m.id + ": the prefix is stripped");
    }
    await page.close();
  } finally {
    await br.close();
    await new Promise((res) => server.close(res));
  }
});
