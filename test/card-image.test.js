"use strict";
/*
 * card-image.test.js - measured verse-card layout + save behaviour.
 *
 * Renders the verse card in real Chromium with the real self-hosted fonts and
 * checks:
 *   - the reference line and the word never overlap (>= 24px ink gap) and no
 *     block leaves the glass card or the canvas (no clipping);
 *   - a long word, a long meaning and a long verse still fit (the canvas height
 *     is computed from the measured blocks);
 *   - a desktop tap saves a PNG file directly and never calls navigator.share;
 *   - a mobile (touch) tap goes through navigator.share with the PNG file, and
 *     cancelling the sheet does nothing (no download, no toast).
 *
 * ASCII only (no Arabic literals), so this file adds no Arabic runs to the
 * arabic-guard baseline. Skips cleanly when Chromium is unavailable.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const CARD_W = 1080;
const MIN_GAP = 24;
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// id: "<surah number>-<index>" in build() order; every word is real public data.
const CASES = [
  { id: "83-1", size: "s", why: "short word, reference-line overlap case (المطففين ayah 14)" },
  { id: "83-1", size: "n", why: "same short word in the regular frame" },
  { id: "113-1", size: "s", why: "long phrase" },
  { id: "89-2", size: "s", why: "long meaning" },
  { id: "81-3", size: "s", why: "long word with two verse segments" },
  { id: "78-0", size: "n", why: "first word, regular" },
  { id: "78-0", size: "s", why: "first word, story" },
];

function staticServer(root) {
  const types = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  };
  return http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

// PNG IHDR: width = bytes 16..19, height = bytes 20..23 (big-endian).
function pngSize(buf) {
  assert.ok(buf.length > 24, "png is too short");
  assert.equal(buf.readUInt32BE(12), 0x49484452, "png starts with an IHDR chunk");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function launchBrowser(t) {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return null; }
  try { return await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return null; }
}

async function serve(root) {
  const server = staticServer(root);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, base: "http://127.0.0.1:" + server.address().port, close: () => new Promise((r) => server.close(r)) };
}

function dataScript(words, set) {
  return "window.__WORDS__=" + words + ";window.__CH__=[];" +
    "try{if(!localStorage.getItem('gq-set'))localStorage.setItem('gq-set',JSON.stringify(" +
    JSON.stringify(set) + "))}catch(e){}";
}

const WORDS_SET = { mode: "light", pal: "def", gl: 3, style: "glass", gv: 2, snd: false, cm: false };

// Records Web Share calls and lets a test force canShare()/share() responses.
const SHARE_PROBE =
  "window.__shared=0;window.__last=null;" +
  "try{Object.defineProperty(navigator,'canShare',{configurable:true,value:function(){return true}})}catch(e){}" +
  "try{Object.defineProperty(navigator,'share',{configurable:true,value:function(d){window.__shared++;window.__last=d;return Promise.resolve()}})}catch(e){}";

// ---------------------------------------------------------------------------
// Layout: measured blocks, >= 24px ink gaps, nothing clipped.
// ---------------------------------------------------------------------------
test("card image: the measured layout never overlaps and never clips", { timeout: 180000 }, async (t) => {
  const browser = await launchBrowser(t);
  if (!browser) return;
  const srv = await serve(PUBLIC);
  try {
    const page = await browser.newPage();
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript({ content: dataScript(fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8"), WORDS_SET) });
    await page.goto(srv.base + "/index.html", { waitUntil: "load" });
    await page.waitForSelector("#app", { timeout: 20000 });

    // step 1.4: the renderer must measure with the real fonts, not a fallback.
    await page.evaluate(() => cardFonts());
    const fontsReady = await page.evaluate(() => ({
      quran: document.fonts.check('120px "Amiri Quran"'),
      ui: document.fonts.check('28px "IBM Plex Sans Arabic"'),
    }));
    assert.ok(fontsReady.quran, "the Quranic font is loaded before measuring");
    assert.ok(fontsReady.ui, "the UI font is loaded before measuring");

    for (const c of CASES) {
      const box = await page.evaluate((a) => renderCard(byId(a.id), a.size).__card, c);
      assert.ok(box, c.why + ": rendered layout boxes");
      assert.ok(box.ref.bottom + MIN_GAP <= box.word.top,
        c.why + ": reference/word ink gap >= " + MIN_GAP + " (got " + (box.word.top - box.ref.bottom).toFixed(1) + ")");
      assert.ok(box.word.bottom + MIN_GAP <= box.mean.top,
        c.why + ": word/meaning ink gap >= " + MIN_GAP + " (got " + (box.mean.top - box.word.bottom).toFixed(1) + ")");
      assert.ok(box.mean.bottom <= box.verse.top, c.why + ": meaning does not run into the verse");
      assert.ok(box.title.bottom <= box.card.top, c.why + ": the title sits above the glass card");
      assert.ok(box.ref.top >= box.card.top && box.verse.bottom <= box.card.bottom,
        c.why + ": all card content stays inside the glass card");
      assert.ok(box.card.bottom < box.h && box.verse.bottom < box.h, c.why + ": nothing is clipped at the bottom");
      assert.ok(box.h >= (c.size === "s" ? 1920 : 1350), c.why + ": canvas is at least the frame height");
      for (const k of ["title", "ref", "word", "mean", "verse"]) {
        assert.ok(box[k].w <= CARD_W, c.why + ": " + k + " width " + box[k].w.toFixed(1) + " <= " + CARD_W);
      }
    }

    // A word with no verse text must still lay out without overlap.
    const empty = await page.evaluate(() => {
      const w = Object.assign({}, byId("78-0"), { ay: { label: "", segments: [] } });
      return renderCard(w, "n").__card;
    });
    assert.ok(empty.ref.bottom + MIN_GAP <= empty.word.top, "no-verse word: reference/word gap >= 24");
    assert.ok(empty.word.bottom + MIN_GAP <= empty.mean.top, "no-verse word: word/meaning gap >= 24");
    assert.ok(empty.verse.bottom < empty.h, "no-verse word: stays inside the canvas");
    await page.close();
  } finally { await browser.close(); await srv.close(); }
});

// ---------------------------------------------------------------------------
// Desktop: direct PNG download, never navigator.share.
// ---------------------------------------------------------------------------
test("card image: a desktop tap saves a PNG file directly", { timeout: 180000 }, async (t) => {
  const browser = await launchBrowser(t);
  if (!browser) return;
  const srv = await serve(PUBLIC);
  const ID = "83-1";
  try {
    const page = await browser.newPage();
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript({ content: dataScript(fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8"), WORDS_SET) });
    await page.addInitScript({ content: SHARE_PROBE });
    await page.goto(srv.base + "/index.html", { waitUntil: "load" });
    await page.waitForSelector("#app", { timeout: 20000 });
    assert.equal(await page.evaluate(() => matchMedia("(hover: none) and (pointer: coarse)").matches), false,
      "the desktop harness is not a touch device");

    await page.evaluate((h) => { location.hash = h; }, "#/word/" + ID);
    await page.waitForSelector('[data-a="card"]', { timeout: 20000 });
    await page.click('[data-a="card"]');
    await page.waitForSelector("#sh .arts", { timeout: 20000 });

    const [dl] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }),
      page.click('#sh [data-a="savepng"]'),
    ]);
    assert.equal(dl.suggestedFilename(), "ghareeb-" + ID + "-story.png", "desktop download keeps the file name");
    const size = pngSize(fs.readFileSync(await dl.path()));
    assert.deepEqual(size, { w: 1080, h: 1920 }, "desktop download is the chosen-size PNG");
    assert.equal(await page.evaluate(() => window.__shared), 0, "desktop never calls navigator.share");
    await page.close();
  } finally { await browser.close(); await srv.close(); }
});

// ---------------------------------------------------------------------------
// Mobile: share sheet with the PNG file; cancelling does nothing.
// ---------------------------------------------------------------------------
test("card image: a mobile tap shares the PNG and cancelling does nothing", { timeout: 180000 }, async (t) => {
  const browser = await launchBrowser(t);
  if (!browser) return;
  const srv = await serve(PUBLIC);
  const ID = "83-1";
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: IPHONE_UA,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript({ content: dataScript(fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8"), WORDS_SET) });
    await page.addInitScript({ content: SHARE_PROBE });
    await page.goto(srv.base + "/index.html", { waitUntil: "load" });
    await page.waitForSelector("#app", { timeout: 20000 });
    assert.equal(await page.evaluate(() => cardMobile()), true, "the mobile harness is a touch device");

    const open = async () => {
      await page.evaluate((h) => { location.hash = h; }, "#/word/" + ID);
      await page.waitForSelector('[data-a="card"]', { timeout: 20000 });
      await page.click('[data-a="card"]');
      await page.waitForSelector("#sh .arts", { timeout: 20000 });
      await page.evaluate(() => { window.__shared = 0; window.__last = null; });
    };

    let downloads = 0;
    page.on("download", () => { downloads++; });

    // share path: a PNG File is handed to navigator.share, no download
    await open();
    await page.click('#sh [data-a="savepng"]');
    await page.waitForTimeout(400);
    const shared = await page.evaluate(() => {
      const f = window.__last && window.__last.files && window.__last.files[0];
      return { count: window.__shared, file: f ? { name: f.name, type: f.type } : null };
    });
    assert.equal(shared.count, 1, "the mobile tap calls navigator.share once");
    assert.ok(shared.file, "navigator.share receives a file");
    assert.equal(shared.file.type, "image/png", "the shared file is a PNG");
    assert.equal(shared.file.name, "ghareeb-" + ID + "-story.png", "the shared file keeps the file name");
    assert.equal(downloads, 0, "the mobile share path does not also download");

    // cancel path (AbortError): nothing happens, no download, no error, no toast
    await open();
    await page.evaluate(() => {
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: () => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      });
    });
    await page.click('#sh [data-a="savepng"]');
    await page.waitForTimeout(400);
    assert.equal(downloads, 0, "cancelling the share sheet does not download a file");
    assert.equal(await page.evaluate(() => !!document.querySelector(".toast")), false, "cancelling shows no error toast");
    assert.deepEqual(errors, [], "cancelling raises no unhandled error");
    await page.close();
    await context.close();
  } finally { await browser.close(); await srv.close(); }
});
