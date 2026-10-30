"use strict";
/*
 * save-card.test.js - Phase A STEP 5 acceptance (save as image).
 *
 * Loads the real public/index.html in Chromium, opens a word page, taps the
 * "save as image" action and verifies the sheet matches the design-spec-final
 * `savecard` frame:
 *   - two size options rendered as live previews (.arts > .opt2), each with an
 *     .art preview: regular = .rg (4/5) labelled 1080x1350, story = .st (9/16)
 *     labelled 1080x1920
 *   - STORY is the default selection (the `on` option and the save target)
 *   - choosing an option moves the selection and retargets the save button
 *   - "save on my device" produces a real PNG whose pixels match the chosen
 *     size (1080x1350 / 1080x1920) and whose filename reflects the size
 *
 * Only ASCII + the multiplication sign are used here, so this file adds no
 * Arabic runs to the arabic-guard baseline. The DOM test skips cleanly when
 * Chromium is unavailable.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const TIMES = "\u00d7"; // multiplication sign, kept out of the source as a literal

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

test("STEP 5: save-as-image previews, story default, PNG sizes", { timeout: 180000 }, async (t) => {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let browser;
  try { browser = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return; }

  const words = fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8");
  const entries = JSON.parse(words);
  assert.ok(entries.length >= 1 && entries[0].words.length >= 1, "first surah has at least one word");
  const ID = "78-0"; // first word id in data order (surah 78, first word)

  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;

  try {
    const page = await browser.newPage();
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript({
      content:
        "window.__WORDS__=" + words + ";window.__CH__=[];" +
        "try{if(!localStorage.getItem('gq-set'))localStorage.setItem('gq-set',JSON.stringify({mode:'light',pal:'def',gl:3,style:'glass',gv:2}))}catch(e){}",
    });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForSelector("#app .acts", { timeout: 20000 });
    await page.evaluate((h) => { location.hash = h; }, "#/word/" + ID);
    await page.waitForFunction(
      (id) => { const b = document.querySelector('[data-a="card"]'); return location.hash === "#/word/" + id && b && b.dataset.id === id; },
      ID,
      { timeout: 20000 }
    );

    const readSheet = () => page.evaluate(() => {
      const opts = Array.from(document.querySelectorAll("#sh .opt2"));
      const save = document.querySelector('#sh [data-a="savepng"]');
      const ar = (el) => el ? getComputedStyle(el).aspectRatio.replace(/\s+/g, "") : null;
      return {
        hasArts: !!document.querySelector("#sh .arts"),
        opts: opts.map((o) => ({
          sc: o.dataset.sc,
          on: o.classList.contains("on"),
          pressed: o.getAttribute("aria-pressed"),
          label: (o.querySelector(":scope > span") || {}).textContent || "", // the option's own label, not a span inside its preview
          st: !!o.querySelector(".art.st"),
          rg: !!o.querySelector(".art.rg"),
        })),
        saveSize: save ? save.dataset.size : null,
        saveTag: save ? save.tagName : null,
        stAR: ar(document.querySelector("#sh .art.st")),
        rgAR: ar(document.querySelector("#sh .art.rg")),
      };
    });

    // ---- open the save sheet ----
    await page.click('[data-a="card"]');
    await page.waitForSelector("#sh .arts", { timeout: 20000 });
    const s = await readSheet();

    assert.ok(s.hasArts, "sheet uses the .arts preview chooser");
    assert.equal(s.opts.length, 2, "two size options");
    assert.deepEqual(s.opts.map((o) => o.sc), ["n", "s"], "regular then story");
    assert.ok(s.opts[0].rg && !s.opts[0].st, "option 1 previews the regular 4/5 card");
    assert.ok(s.opts[1].st && !s.opts[1].rg, "option 2 previews the story 9/16 card");
    assert.equal(s.rgAR, "4/5", "regular preview aspect ratio 4/5");
    assert.equal(s.stAR, "9/16", "story preview aspect ratio 9/16");
    assert.ok(s.opts[0].label.includes("1080" + TIMES + "1350"), "option 1 labelled 1080x1350");
    assert.ok(s.opts[1].label.includes("1080" + TIMES + "1920"), "option 2 labelled 1080x1920");

    // story is the default
    assert.equal(s.opts[0].on, false, "regular is not selected by default");
    assert.equal(s.opts[1].on, true, "story is selected by default");
    assert.equal(s.opts[1].pressed, "true", "story exposes aria-pressed=true");
    assert.equal(s.saveSize, "s", "save button defaults to story");

    // ---- switching the option retargets the save button ----
    await page.click('#sh .opt2[data-sc="n"]');
    const s2 = await readSheet();
    assert.equal(s2.opts[0].on, true, "regular becomes selected");
    assert.equal(s2.opts[1].on, false, "story is deselected");
    assert.equal(s2.opts[0].pressed, "true", "regular exposes aria-pressed=true");
    assert.equal(s2.saveSize, "n", "save button retargets to regular");

    // ---- regular download is a 1080x1350 PNG ----
    const [d1] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }),
      page.click('#sh [data-a="savepng"]'),
    ]);
    assert.equal(d1.suggestedFilename(), "ghareeb-" + ID + "-card.png", "regular filename");
    const size1 = pngSize(fs.readFileSync(await d1.path()));
    assert.deepEqual(size1, { w: 1080, h: 1350 }, "regular PNG is 1080x1350");

    // ---- story default download is a 1080x1920 PNG ----
    await page.waitForSelector('[data-a="card"]', { timeout: 20000 });
    await page.click('[data-a="card"]');
    await page.waitForSelector("#sh .arts", { timeout: 20000 });
    const s3 = await readSheet();
    assert.equal(s3.saveSize, "s", "reopened sheet defaults to story again");
    const [d2] = await Promise.all([
      page.waitForEvent("download", { timeout: 30000 }),
      page.click('#sh [data-a="savepng"]'),
    ]);
    assert.equal(d2.suggestedFilename(), "ghareeb-" + ID + "-story.png", "story filename");
    const size2 = pngSize(fs.readFileSync(await d2.path()));
    assert.deepEqual(size2, { w: 1080, h: 1920 }, "story PNG is 1080x1920");
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
