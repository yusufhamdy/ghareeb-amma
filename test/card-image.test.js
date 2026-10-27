"use strict";
/*
 * card-image.test.js - measured verse-card layout + save behaviour.
 *
 * Renders the verse card in real Chromium with the real self-hosted fonts and
 * checks:
 *   - the blocks keep their order (header, word, divider, ayah, meaning card,
 *     footer), the word ink clears the divider by >= 24px, nothing overlaps and
 *     no text leaves its card or the canvas (no clipping);
 *   - the canvas is exactly 1080x1350 or 1080x1920 and long content auto-fits;
 *     story keeps the top 250px and bottom 360px free;
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
// Every check works on the renderer's own measured ink boxes (__card).
function checkLayout(box, size, why, hasAyah) {
  const H = size === "s" ? 1920 : 1350;
  assert.ok(box, why + ": rendered layout boxes");
  assert.strictEqual(box.W, CARD_W, why + ": canvas width is exactly " + CARD_W);
  assert.strictEqual(box.H, H, why + ": canvas height is exactly " + H);
  const canvas = { x: 0, y: 0, w: box.W, h: box.H };
  const inside = (b, r) => b.l >= r.x && b.r <= r.x + r.w && b.t >= r.y && b.b <= r.y + r.h;
  const rect = (r) => ({ l: r.x, r: r.x + r.w, t: r.y, b: r.y + r.h });
  const { cards, boxes: bx } = box;

  // nothing clipped: every card and every text run stays on the canvas and inside its own card
  for (const k of ["word", "mean", "pill"]) assert.ok(inside(rect(cards[k]), canvas), why + ": " + k + " card is inside the canvas");
  for (const op of box.ops) {
    const r = op.card ? cards[op.card] : canvas;
    assert.ok(inside(op.box, r), why + ": " + op.role + " text stays inside " + (op.card || "the canvas"));
  }
  for (const m of box.marks) assert.ok(inside(rect(m), cards.word), why + ": ayah highlight stays inside the word card");

  // order: header, word, divider, ayah, meaning card, footer - with no overlaps
  const headBottom = Math.max(bx.logo.b, cards.pill.y + cards.pill.h);
  assert.ok(cards.pill.x + cards.pill.w < bx.logo.l, why + ": the pill and the logo do not overlap");
  assert.ok(headBottom + MIN_GAP <= cards.word.y, why + ": the header sits above the word card");
  assert.ok(cards.word.y + cards.word.h + MIN_GAP <= cards.mean.y, why + ": the word card sits above the meaning card");
  assert.ok(cards.mean.y + cards.mean.h + MIN_GAP <= bx.footer.t, why + ": the footer sits below the meaning card");
  assert.ok(bx.label.b <= bx.meaning.t && bx.meaning.b <= bx.source.t, why + ": label, meaning and source do not overlap");
  if (hasAyah) {
    assert.ok(bx.ayah && box.divider != null, why + ": the ayah and divider are drawn");
    assert.ok(bx.word.b + MIN_GAP <= box.divider,
      why + ": word ink/divider gap >= " + MIN_GAP + " (got " + (box.divider - bx.word.b).toFixed(1) + ")");
    assert.ok(box.divider + 1 < bx.ayah.t, why + ": the divider does not touch the ayah");
  } else {
    assert.strictEqual(box.divider, null, why + ": no divider without an ayah");
    assert.strictEqual(bx.ayah, null, why + ": no ayah drawn");
  }

  // story: keep the Instagram UI areas free (top 250px, bottom 360px)
  if (size === "s") {
    const all = box.ops.map((o) => o.box).concat([cards.word, cards.mean, cards.pill].map(rect));
    for (const b of all) assert.ok(b.t >= 250 && b.b <= H - 360, why + ": story content stays out of the top 250px and bottom 360px");
  }
}

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
      quran: document.fonts.check('120px "KFGQPC Uthmanic Hafs"'),
      logo: document.fonts.check('120px "Amiri Quran"'),
      ui: document.fonts.check('28px "IBM Plex Sans Arabic"'),
      ui500: document.fonts.check('500 28px "IBM Plex Sans Arabic"'),
      ui600: document.fonts.check('600 28px "IBM Plex Sans Arabic"'),
    }));
    assert.ok(fontsReady.quran, "the Quran face (KFGQPC Uthmanic Hafs) is loaded before measuring");
    assert.ok(fontsReady.logo, "the logo face (Amiri Quran) is loaded before measuring");
    assert.ok(fontsReady.ui && fontsReady.ui500 && fontsReady.ui600, "the UI font (400/500/600) is loaded before measuring");

    for (const c of CASES) {
      const box = await page.evaluate((a) => renderCard(byId(a.id), a.size).__card, c);
      checkLayout(box, c.size, c.why, true);
    }

    // A word with no ayah segments: no divider and no ayah, and the layout is still valid.
    for (const size of ["n", "s"]) {
      const empty = await page.evaluate((sz) => {
        const w = Object.assign({}, byId("78-0"), { ay: { label: "", segments: [] } });
        return renderCard(w, sz).__card;
      }, size);
      checkLayout(empty, size, "no-ayah word (" + size + ")", false);
    }
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
