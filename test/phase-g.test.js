"use strict";
/*
 * phase-g.test.js - Phase G acceptance:
 *   G1 the SHADE theme must render the challenge line (the home ring-card
 *     subtitle) exactly like GLASS: equal computed word-spacing, letter-spacing
 *     and font-family, a rendered text width within 2%, and no overlap with the
 *     neighbouring lines. The same font-family equality is checked for the other
 *     multi-word ".m" lines that the fixed rule touched (surah picker row label,
 *     challenge progress line).
 *
 * Loads the real public/ files in Chromium and measures computed styles plus the
 * real rendered text width (Range.getBoundingClientRect). ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

// the home ring-card line under test (the "N <words>" subtitle)
const TARGET = '#app a.card[href="#/challenge"] .m';

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

test("G1: the shade challenge line equals glass (word-spacing, letter-spacing, font-family, width)", { timeout: 300000 }, async (t) => {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let browser;
  try { browser = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return; }

  const words = fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8");
  const chObj = Object.assign(JSON.parse(fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8")), { releasedUpTo: 30 });
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;

  const PROPS = ["word-spacing", "letter-spacing", "font-family", "font-size", "font-weight", "line-height", "text-align"];

  const shot = async (style, mode, width, hash, sel) => {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.emulateMedia({ colorScheme: mode });
    await page.addInitScript({
      content: "window.__WORDS__=" + words + ";window.__CH__=" + JSON.stringify(chObj) +
        ";try{localStorage.setItem('gq-set',JSON.stringify({mode:'" + mode + "',pal:'def',gl:3,style:'" + style + "'}))}catch(e){}",
    });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    if (hash) await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForFunction((s) => !!document.querySelector(s), sel, { timeout: 20000 });
    await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => undefined) : null));
    const out = await page.evaluate((args) => {
      const el = document.querySelector(args.sel);
      const cs = getComputedStyle(el);
      const range = document.createRange();
      range.selectNodeContents(el);
      const er = el.getBoundingClientRect();
      const props = {};
      args.props.forEach((p) => { props[p] = cs.getPropertyValue(p); });
      // real 2D overlap with every other visible text line inside #app
      const overlaps = [];
      document.querySelectorAll("#app *").forEach((n) => {
        if (n === el || el.contains(n) || n.contains(el)) return;
        if (n.children.length) return;
        if (!(n.textContent || "").trim()) return;
        const r = n.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const hit = !(r.right <= er.left || r.left >= er.right || r.bottom <= er.top || r.top >= er.bottom);
        if (hit) overlaps.push(n.tagName + "." + n.className);
      });
      const txt = el.textContent.trim();
      return {
        props, rangeW: +range.getBoundingClientRect().width.toFixed(2), overlaps,
        bodyShade: document.body.classList.contains("shade"),
        len: txt.length, startsWithN: /^[\d]{1,2} /.test(txt),
        inCard: !!el.closest('a[href="#/challenge"]'),
      };
    }, { sel, props: PROPS });
    await page.close();
    return out;
  };

  try {
    // --- the element named in the step, at 400 and 1440, night and day ---
    for (const mode of ["light", "dark"]) {
      for (const width of [400, 1440]) {
        const id = mode + "@" + width;
        const g = await shot("glass", mode, width, "", TARGET);
        const s = await shot("shade", mode, width, "", TARGET);
        const tag = " (" + id + ")";

        assert.ok(g.inCard && s.inCard, "the selector targets the challenge ring-card line" + tag);
        assert.ok(g.startsWithN && s.startsWithN && g.len === s.len && g.len > 5, "the line holds the challenge subtitle" + tag);
        assert.equal(g.bodyShade, false, "glass really is glass" + tag);
        assert.equal(s.bodyShade, true, "shade really is shade" + tag);

        assert.equal(s.props["word-spacing"], g.props["word-spacing"], "word-spacing equal" + tag);
        assert.equal(s.props["letter-spacing"], g.props["letter-spacing"], "letter-spacing equal" + tag);
        assert.equal(s.props["font-family"], g.props["font-family"], "font-family equal" + tag);

        const delta = Math.abs(s.rangeW - g.rangeW) / g.rangeW;
        assert.ok(delta <= 0.02, "rendered width within 2% (" + id + "): glass=" + g.rangeW + "px shade=" + s.rangeW + "px delta=" + (delta * 100).toFixed(2) + "%");

        assert.deepEqual(g.overlaps, [], "glass: no line overlaps its neighbours" + tag);
        assert.deepEqual(s.overlaps, [], "shade: no line overlaps its neighbours" + tag);
      }
    }

    // --- the other multi-word ".m" lines the fixed rule also touched ---
    const others = [
      { name: "surah picker row label", sel: "#app .list.sl .row .m", hash: "#/surahs" },
      { name: "challenge progress line", sel: "#app .g.card .m", hash: "#/challenge" },
    ];
    for (const o of others) {
      const g = await shot("glass", "dark", 1440, o.hash, o.sel);
      const s = await shot("shade", "dark", 1440, o.hash, o.sel);
      assert.ok(g.len > 2 && s.len === g.len, o.name + ": renders in both themes");
      assert.equal(s.props["font-family"], g.props["font-family"], o.name + ": font-family equal");
    }
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
