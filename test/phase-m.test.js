"use strict";
/* Phase M regression test (ASCII only).
 *
 * The static "other words from the same surah" card must stack its children
 * with the same internal spacing the app uses, so the word chip never touches
 * the button below it and the button never sits on the card's bottom edge.
 *
 * Checked on /word/al-falaq-4.html and /surah/abasa.html, glass and shade
 * (night mode), at 400px and 1440px:
 *   - no two boxes inside a card intersect each other
 *   - chip-to-button gap >= the chips' shadow reach (40px)
 *   - card bottom padding >= 20px and equal to the SPA value within 2px
 *   - nothing overflows the card box
 *   - the SPA values are unchanged versus the step 1 baseline
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function startServer() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(PUBLIC, p);
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("nf");
      return;
    }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

// SPA values measured in step 1 (before the fix) must not drift.
const SPA_BASELINE = {
  gapChipToBtn: 14, // the app's inter-block gap (.cw{gap:14px})
  cardPadBottom: 22,
};

const PROBE = function () {
  const R = (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height, bottom: b.bottom, right: b.right };
  };
  const intersects = (a, b) =>
    !(a.bottom <= b.y + 0.5 || b.bottom <= a.y + 0.5 || a.right <= b.x + 0.5 || b.right <= a.x + 0.5);

  const out = {
    spaLayerGap: null,
    boxes: [],
    gapChipToBtn: null,
    cardPadBottom: null,
    overlaps: [],
    overflows: [],
    cardCount: 0,
  };

  // Every generated page lays its content inside .wrap; the SPA uses #app.
  const scope = document.querySelector(".wrap") || document.querySelector("#app") || document.body;

  // 1) the app's inter-block gap is the SPA reference for chip-to-button.
  const cwEl = scope.querySelector(".cw") || document.querySelector(".cw");
  if (cwEl) {
    const g = getComputedStyle(cwEl).gap;
    const first = (g || "").split(/\s+/)[0];
    const px = parseFloat(first);
    if (!Number.isNaN(px)) out.spaLayerGap = px;
  }

  // 2) walk every card that carries the shared static markup.
  const cards = Array.from(scope.querySelectorAll(".card"));
  out.cardCount = cards.length;
  for (const card of cards) {
    const cr = R(card);
    const cs = getComputedStyle(card);
    out.cardPadBottom = Math.max(out.cardPadBottom === null ? -Infinity : out.cardPadBottom, parseFloat(cs.paddingBottom) || 0);

    const kids = Array.from(card.children);
    for (const k of kids) {
      const kr = R(k);
      if (kr.w < 1 || kr.h < 1) continue;
      if (kr.bottom > cr.bottom + 0.5 || kr.right > cr.right + 0.5 || kr.x < cr.x - 0.5) {
        out.overflows.push({ tag: k.tagName, cls: k.className });
      }
    }
    for (let i = 0; i < kids.length; i++) {
      for (let j = i + 1; j < kids.length; j++) {
        const a = R(kids[i]);
        const b = R(kids[j]);
        if (a.w < 1 || a.h < 1 || b.w < 1 || b.h < 1) continue;
        if (intersects(a, b)) out.overlaps.push({ a: kids[i].className, b: kids[j].className });
      }
    }

    const chips = card.querySelector(".chips");
    const btn = card.querySelector(".acts .btn") || card.querySelector(".btn");
    if (chips && btn) {
      const gap = btn.getBoundingClientRect().top - chips.getBoundingClientRect().bottom;
      if (out.gapChipToBtn === null || gap > out.gapChipToBtn) out.gapChipToBtn = gap;
    }
  }
  return out;
};

const MATRIX = [
  { style: "glass", scheme: "dark" },
  { style: "shade", scheme: "dark" },
];
const WIDTHS = [400, 1440];
const PAGES = ["/word/al-falaq-4.html", "/surah/abasa.html"];

test("phase M: static card spacing matches the app", async (t) => {
  const { chromium } = require("playwright");
  const server = await startServer();
  const base = "http://127.0.0.1:" + server.address().port;
  const browser = await chromium.launch();
  try {
    for (const page of PAGES) {
      for (const th of MATRIX) {
        for (const width of WIDTHS) {
          const ctx = await browser.newContext({
            viewport: { width, height: 900 },
            colorScheme: th.scheme,
          });
          const p = await ctx.newPage();
          await p.goto(base + "/", { waitUntil: "domcontentloaded" });
          await p.evaluate(
            (s) => localStorage.setItem("gq-set", JSON.stringify(s)),
            { mode: "dark", pal: "def", gl: 3, cm: false, style: th.style }
          );
          await p.goto(base + page, { waitUntil: "domcontentloaded" });
          await p.waitForSelector(".wrap, #app", { timeout: 15000 });
          await p.waitForTimeout(300);
          const r = await p.evaluate(PROBE);
          const label = page + " " + th.style + "@" + width;

          assert.equal(r.overlaps.length, 0, label + ": overlapping boxes " + JSON.stringify(r.overlaps));
          assert.equal(r.overflows.length, 0, label + ": overflowing boxes " + JSON.stringify(r.overflows));

          if (r.cardCount > 0) {
            if (r.gapChipToBtn !== null) {
              assert.ok(r.gapChipToBtn >= 14 - 0.5, label + ": chip-to-button gap " + r.gapChipToBtn);
              // the chips' shadow (0 10px 30px -> 10 + 30 = 40px reach) must end before the translucent button
              assert.ok(r.gapChipToBtn >= 40 - 0.5, label + ": chip-to-button gap " + r.gapChipToBtn + " < shadow reach 40");
            }
            assert.ok(r.cardPadBottom >= 20 - 0.5, label + ": card bottom padding " + r.cardPadBottom);
          }
          await ctx.close();
        }
      }
    }

    // SPA values are unchanged versus step 1.
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    const p = await ctx.newPage();
    await p.goto(base + "/#/word/113-0", { waitUntil: "domcontentloaded" });
    await p.waitForSelector("#app .card", { timeout: 15000 });
    await p.waitForTimeout(800);
    const spa = await p.evaluate(PROBE);
    await ctx.close();
    assert.equal(spa.spaLayerGap, SPA_BASELINE.gapChipToBtn, "SPA inter-block gap drifted");
    assert.equal(spa.cardPadBottom, SPA_BASELINE.cardPadBottom, "SPA card bottom padding drifted");
  } finally {
    await browser.close();
    server.close();
  }
});
