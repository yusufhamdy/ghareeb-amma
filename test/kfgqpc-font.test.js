"use strict";
/*
 * kfgqpc-font.test.js - the Quran face, KFGQPC Uthmanic Hafs v22.
 *
 *   - the font file is the Complex's official v22 file, byte for byte, with its terms next to it;
 *   - fonts.css declares it with font-display: block and the metric descriptors; every page that shows Quran text
 *     preloads it and loads the qfont.js guard; the service worker precaches it;
 *   - glyph coverage: every code point used in .q content (ayah segments, headwords, surah names, the ornate
 *     parentheses, anything inside .q on the static pages and in the app's rendered views) is in the font's cmap,
 *     except (a) U+FD3E / U+FD3F, which the font does not have and Amiri Quran (the next face in the .q stack) draws,
 *     and (b) precomposed letters whose canonical decomposition the font has (the text is stored in NFC, so
 *     alef + maddah is U+0622): those must draw exactly like the decomposed sequence;
 *   - with the font blocked, <html> gets "qf", .q text shows the standard open-tanween code points, Amiri Quran has
 *     a glyph for every code point then shown, and the data is unchanged.
 *
 * ASCII only (code points are \u escapes). Skips the browser parts when Chromium is unavailable.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const FONT = path.join(PUBLIC, "fonts", "kfgqpc-uthmanic-hafs-v22.ttf");
const FONT_SHA256 = "a6e59510dcaf3ec99db49427321a035ed94af555ffc7d27e7f430b5fd5e179f8";
const FONT_URL = "https://qurancomplex.gov.sa/wp-content/uploads/kfgqpc-assets/fonts/uthmanic_hafs_v22.ttf";
const FAMILY = "KFGQPC Uthmanic Hafs";
const AMIRI_WOFF = path.join(ROOT, "node_modules", "@fontsource", "amiri-quran", "files", "amiri-quran-arabic-400-normal.woff");
const AMIRI_WOFF2_PKG = path.join(ROOT, "node_modules", "@fontsource", "amiri-quran", "files", "amiri-quran-arabic-400-normal.woff2");
const AMIRI_WOFF2 = path.join(PUBLIC, "fonts", "amiri-quran-arabic-400-normal.woff2");
// drawn by Amiri Quran (the font has no glyph for them): ornate left / right parenthesis
const BRACKETS = [0xfd3e, 0xfd3f];
const OPEN_TANWEEN = { 0x0657: 0x08f0, 0x065e: 0x08f1, 0x0656: 0x08f2 };

// --- font tables (TTF, or WOFF 1.0 as shipped by @fontsource) -------------------------------------------
function tables(buf) {
  const t = {};
  if (buf.readUInt32BE(0) === 0x774f4646) { // 'wOFF'
    const n = buf.readUInt16BE(12);
    for (let i = 0; i < n; i++) {
      const o = 44 + i * 20, tag = buf.toString("latin1", o, o + 4), off = buf.readUInt32BE(o + 4), cl = buf.readUInt32BE(o + 8), ol = buf.readUInt32BE(o + 12);
      t[tag] = cl < ol ? zlib.inflateSync(buf.slice(off, off + cl)) : buf.slice(off, off + ol);
    }
  } else {
    const n = buf.readUInt16BE(4);
    for (let i = 0; i < n; i++) { const o = 12 + i * 16, off = buf.readUInt32BE(o + 8); t[buf.toString("latin1", o, o + 4)] = buf.slice(off, off + buf.readUInt32BE(o + 12)); }
  }
  return t;
}
function cmap(buf) {
  const c = tables(buf).cmap, set = new Set(), nt = c.readUInt16BE(2);
  for (let i = 0; i < nt; i++) {
    const so = c.readUInt32BE(4 + i * 8 + 4), fmt = c.readUInt16BE(so);
    if (fmt === 4) {
      const segX2 = c.readUInt16BE(so + 6), ends = so + 14, starts = ends + segX2 + 2, deltas = starts + segX2, ros = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const e = c.readUInt16BE(ends + s * 2), st = c.readUInt16BE(starts + s * 2), d = c.readInt16BE(deltas + s * 2), ro = c.readUInt16BE(ros + s * 2);
        for (let cp = st; cp <= e && cp !== 0xffff; cp++) {
          let g;
          if (ro === 0) g = (cp + d) & 0xffff;
          else { g = c.readUInt16BE(ros + s * 2 + ro + (cp - st) * 2); if (g) g = (g + d) & 0xffff; }
          if (g) set.add(cp);
        }
      }
    } else if (fmt === 12) {
      const ng = c.readUInt32BE(so + 12);
      for (let k = 0; k < ng; k++) { const b = so + 16 + k * 12, s = c.readUInt32BE(b), e = c.readUInt32BE(b + 4), g = c.readUInt32BE(b + 8); for (let cp = s; cp <= e; cp++) if (g + cp - s) set.add(cp); }
    }
  }
  return set;
}

const KF = cmap(fs.readFileSync(FONT));
const AMIRI = cmap(fs.readFileSync(AMIRI_WOFF));
const hex = (cp) => "U+" + cp.toString(16).toUpperCase().padStart(4, "0");

// .q content from the data, as the app and the static pages show it
function dataQText() {
  const W = JSON.parse(fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8"));
  const out = [];
  for (const e of W) {
    out.push(String(e.surah).replace(/^\u0633\u0648\u0631\u0629\s*/, ""));
    (e.words || []).forEach((w) => out.push(w));
    (e.ayahs || []).forEach((a) => (a.segments || []).forEach((g) => out.push("\ufd3f" + g.before + g.hl + g.after + "\ufd3e")));
  }
  return out;
}

// text inside elements with class "q" in a static HTML file (nested tags removed, entities decoded)
function staticQText(html) {
  const out = [], re = /<(\w+)\s[^>]*class="(?:[^"]*\s)?q(?:\s[^"]*)?"[^>]*>/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] === "svg") continue;
    const close = "</" + m[1] + ">", end = html.indexOf(close, re.lastIndex);
    out.push(html.slice(re.lastIndex, end).replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
  }
  return out;
}

// every code point used, grouped by how it is drawn
function classify(texts) {
  const cps = new Set();
  texts.forEach((t) => { for (const ch of String(t)) cps.add(ch.codePointAt(0)); });
  const r = { font: [], brackets: [], decomposed: [], missing: [] };
  for (const cp of [...cps].sort((a, b) => a - b)) {
    if (cp === 0x20 || KF.has(cp)) r.font.push(cp);
    else if (BRACKETS.includes(cp)) r.brackets.push(cp);
    else {
      const nfd = [...String.fromCodePoint(cp).normalize("NFD")].map((c) => c.codePointAt(0));
      if (nfd.length > 1 && nfd.every((c) => KF.has(c))) r.decomposed.push(cp); else r.missing.push(cp);
    }
  }
  return r;
}

test("the font is the Complex's official v22 file, unmodified, with its terms", () => {
  const buf = fs.readFileSync(FONT);
  assert.strictEqual(crypto.createHash("sha256").update(buf).digest("hex"), FONT_SHA256, "the font file must be byte-identical to the official file");
  const lic = fs.readFileSync(path.join(PUBLIC, "fonts", "LICENSE-KFGQPC.txt"), "utf8");
  assert.ok(lic.includes(FONT_URL) && lic.includes(FONT_SHA256), "LICENSE-KFGQPC.txt names the source URL and the hash");
  assert.ok(lic.includes("ELECTRONIC END-USER LICENSE AGREEMENT"), "LICENSE-KFGQPC.txt carries the Complex's license text");
  assert.ok(fs.readFileSync(AMIRI_WOFF2).equals(fs.readFileSync(AMIRI_WOFF2_PKG)), "the served Amiri Quran is the @fontsource file whose cmap this test reads");
});

test("fonts.css, preloads, the guard and the service worker", () => {
  const css = fs.readFileSync(path.join(PUBLIC, "fonts", "fonts.css"), "utf8");
  const face = (css.match(new RegExp("@font-face\\s*\\{[^}]*font-family:\\s*'" + FAMILY + "'[^}]*\\}")) || [])[0] || "";
  assert.ok(face, "fonts.css declares " + FAMILY);
  assert.ok(/src:\s*url\('kfgqpc-uthmanic-hafs-v22\.ttf'\)\s*format\('truetype'\)/.test(face), "the face loads the .ttf as published");
  assert.ok(/font-display:\s*block/.test(face), "font-display: block");
  for (const d of ["size-adjust", "ascent-override", "descent-override", "line-gap-override"]) assert.ok(new RegExp(d + ":\\s*[\\d.]+%").test(face), d + " is set");
  const preload = '<link rel="preload" href="/fonts/kfgqpc-uthmanic-hafs-v22.ttf" as="font" type="font/ttf" crossorigin>';
  const pages = ["index.html", "admin/index.html"]
    .concat(fs.readdirSync(path.join(PUBLIC, "word")).filter((f) => f.endsWith(".html")).map((f) => "word/" + f))
    .concat(fs.readdirSync(path.join(PUBLIC, "surah")).filter((f) => f.endsWith(".html")).map((f) => "surah/" + f));
  for (const p of pages) {
    const html = fs.readFileSync(path.join(PUBLIC, p), "utf8");
    assert.ok(html.includes(preload), p + " preloads the Quran face");
    const iFonts = html.indexOf('href="/fonts/fonts.css"'), iGuard = html.indexOf('<script src="/qfont.js"></script>');
    assert.ok(iGuard > iFonts && iFonts > 0, p + " loads /qfont.js after fonts.css");
  }
  const sw = fs.readFileSync(path.join(PUBLIC, "sw.js"), "utf8");
  for (const f of ["/fonts/kfgqpc-uthmanic-hafs-v22.ttf", "/qfont.js", "/fonts/fonts.css"]) assert.ok(sw.includes("'" + f + "'"), "sw.js precaches " + f);
});

test("glyph coverage: every code point in .q content (data and static pages)", () => {
  const texts = dataQText();
  const dirs = ["word", "surah"];
  for (const d of dirs) for (const f of fs.readdirSync(path.join(PUBLIC, d)).filter((x) => x.endsWith(".html"))) texts.push(...staticQText(fs.readFileSync(path.join(PUBLIC, d, f), "utf8")));
  for (const f of ["404.html", "about/index.html", "privacy/index.html", "terms/index.html", "rights/index.html"]) texts.push(...staticQText(fs.readFileSync(path.join(PUBLIC, f), "utf8")));
  const r = classify(texts);
  assert.deepStrictEqual(r.missing.map(hex), [], "code points with no glyph in KFGQPC Uthmanic Hafs v22");
  assert.deepStrictEqual(r.brackets.map(hex), BRACKETS.map(hex), "only the ornate parentheses fall back");
  for (const cp of r.brackets) assert.ok(AMIRI.has(cp), hex(cp) + " is drawn by Amiri Quran");
  assert.deepStrictEqual(r.decomposed.map(hex), ["U+0622"], "precomposed letters drawn through their decomposition (checked in the browser test)");
  assert.ok(r.font.length > 40, "sanity: " + r.font.length + " code points covered");
});

// --- browser parts ---------------------------------------------------------------------------------------
function staticServer(root) {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf" };
  return http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    // an empty Firebase config: the pages run on the local JSON and never read production
    if (p === "/firebase-config.js") { res.writeHead(200, { "content-type": types[".js"] }); res.end("window.FIREBASE_CONFIG={};"); return; }
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}
async function withBrowser(t, fn) {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let browser;
  try { browser = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return; }
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try { await fn(browser, "http://127.0.0.1:" + server.address().port); } finally { await browser.close(); await new Promise((r) => server.close(r)); }
}
const SET = { mode: "light", pal: "gold", gl: 50, gv: 3, style: "glass", snd: false, cm: true };
async function newPage(browser, opts) {
  const ctx = await browser.newContext({ viewport: { width: 400, height: 900 } });
  await ctx.addInitScript((s) => { try { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); } catch (e) {} }, SET);
  if (opts && opts.blockFont) await ctx.route("**/kfgqpc-uthmanic-hafs-v22.ttf", (r) => r.abort());
  return { ctx, page: await ctx.newPage() };
}
// all .q text the app renders (every word page, the surah list and pages, the released days, the quiz)
async function appQText(page) {
  return page.evaluate(async () => {
    const out = [], wait = () => new Promise((r) => setTimeout(r, 30));
    const grab = () => document.querySelectorAll("#app .q:not(svg)").forEach((e) => out.push(e.textContent));
    const go = async (h) => { location.hash = h; await wait(); grab(); };
    for (const w of W) await go("#/word/" + w.id);
    await go("#/surahs");
    for (const s of S) await go("#/surah/" + s.num);
    for (let d = 1; d <= 30; d++) await go("#/day/" + d);
    await go("#/quiz");
    return out;
  });
}

test("browser: the face loads, the app's .q text is covered, and U+0622 draws like alef + maddah", async (t) => {
  await withBrowser(t, async (browser, base) => {
    const { ctx, page } = await newPage(browser);
    await page.goto(base + "/#/", { waitUntil: "load" });
    await page.waitForFunction(() => typeof W !== "undefined" && W.length > 0, null, { timeout: 20000 });
    const st = await page.evaluate(async (fam) => { const f = []; document.fonts.forEach((x) => { if (x.family.replace(/"/g, "") === fam) f.push(x); }); await Promise.all(f.map((x) => x.load())); return { n: f.length, status: f.map((x) => x.status), qf: document.documentElement.classList.contains("qf") }; }, FAMILY);
    assert.deepStrictEqual(st, { n: 1, status: ["loaded"], qf: false }, "the Quran face loads and the fallback stays off");
    const r = classify(await appQText(page));
    assert.deepStrictEqual(r.missing.map(hex), [], "code points in the app's .q text with no glyph");
    assert.ok(r.brackets.every((cp) => BRACKETS.includes(cp)) && r.decomposed.every((cp) => cp === 0x0622), "only the known exceptions");
    // U+0622 and U+0627 U+0653 give the same pixels in the face (HarfBuzz decomposes it), in a word and alone
    const same = await page.evaluate((fam) => {
      const draw = (s) => { const c = document.createElement("canvas"); c.width = 600; c.height = 300; const x = c.getContext("2d"); x.font = '120px "' + fam + '"'; x.direction = "rtl"; x.textAlign = "right"; x.fillText(s, 560, 200); return c.toDataURL(); };
      const pairs = [["\u0622", "\u0627\u0653"], ["\u0645\u064e\u0622", "\u0645\u064e\u0627\u0653"]];
      return pairs.map(([a, b]) => draw(a) === draw(b) && draw(a) !== draw(""));
    }, FAMILY);
    assert.deepStrictEqual(same, [true, true], "U+0622 draws exactly like U+0627 U+0653");
    await ctx.close();
  });
});

test("browser: with the font blocked, .q text falls back to Amiri Quran with the standard open tanween", async (t) => {
  await withBrowser(t, async (browser, base) => {
    const { ctx, page } = await newPage(browser, { blockFont: true });
    await page.goto(base + "/#/", { waitUntil: "load" });
    await page.waitForFunction(() => typeof W !== "undefined" && W.length > 0 && document.documentElement.classList.contains("qf"), null, { timeout: 20000 });
    const before = await page.evaluate(() => JSON.stringify(W.map((w) => [w.word, w.ay])));
    const texts = await appQText(page);
    const after = await page.evaluate(() => JSON.stringify(W.map((w) => [w.word, w.ay])));
    assert.strictEqual(after, before, "the data is unchanged (display only)");
    const all = texts.join("");
    for (const [from, to] of Object.entries(OPEN_TANWEEN)) assert.ok(!all.includes(String.fromCodePoint(+from)), hex(+from) + " is not shown in the fallback");
    assert.ok(/[\u08f0-\u08f2]/.test(all), "the fallback shows the standard open tanween");
    const missing = [...new Set([...all].map((c) => c.codePointAt(0)))].filter((cp) => cp !== 0x20 && !AMIRI.has(cp)).map(hex);
    assert.deepStrictEqual(missing, [], "Amiri Quran has a glyph for every code point shown (no boxes)");
    const logo = await page.evaluate(() => ({ font: getComputedStyle(document.querySelector("#app header .logo")).fontFamily, qf: document.documentElement.classList.contains("qf") }));
    assert.ok(logo.qf && /^"?Amiri Quran"?,/.test(logo.font), "the logo is unaffected");
    // the save-image card draws mapped text too
    const card = await page.evaluate(() => { const c = renderCard(W[0], "n"); return { w: c.width, h: c.height, mapped: window.qText("\u065e") }; });
    assert.deepStrictEqual(card, { w: 1080, h: 1350, mapped: "\u08f1" });
    // a static word page
    await page.goto(base + "/word/al-qariah-9.html", { waitUntil: "load" });
    await page.waitForFunction(() => document.documentElement.classList.contains("qf"), null, { timeout: 20000 });
    const st = await page.evaluate(() => [...document.querySelectorAll(".q")].map((e) => e.textContent).join(""));
    assert.ok(!/[\u0656\u0657\u065e]/.test(st) && /\u08f1/.test(st), "the static page shows the mapped text");
    await ctx.close();
  });
});
