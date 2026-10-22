"use strict";
/* Phase N - the home action row (the shuffle / browse buttons under the
 * search box) is balanced against the full-width search box and social card.
 *
 * ASCII only: no Arabic literals; the typed query is a \uXXXX escape.
 *
 * Checked on the home route only, for glass and shade at night plus one day
 * case, at 360 / 390 / 430 px:
 *   - the row's left and right edges equal the search box's (within 1px)
 *   - the two buttons have equal width (within 1px) and a 10px gap (+-1)
 *   - no wrapping, heights >= 44px, font size >= 14px, text not clipped
 * At 820 / 1440 px:
 *   - the row is centered (left gap == right gap within 1px), in the content
 *     column and in the viewport, and the buttons keep their natural widths
 *     measured in phase N1 (138.33 / 152.47 px) and the same 10px gap.
 * Collapse safety at 390 and 1440:
 *   - the row does not clip at rest (overflow visible)
 *   - typing one letter and clearing it restores the exact resting rect
 *     (within 0.5px), and the collapsed row's buttons are not focusable.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

// Phase N1 natural button widths on the >=601px row (border box, CSS px).
const NATURAL_W = [138.33, 152.47];

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

const THEMES = [
  { name: "glass-night", set: { mode: "dark", pal: "def", gl: 3, cm: false, gv: 2, snd: false, style: "glass" }, scheme: "dark" },
  { name: "shade-night", set: { mode: "dark", pal: "def", gl: 3, cm: false, gv: 2, snd: false, style: "shade" }, scheme: "dark" },
  { name: "glass-day", set: { mode: "light", pal: "def", gl: 3, cm: false, gv: 2, snd: false, style: "glass" }, scheme: "light" },
];
const PHONE_WIDTHS = [360, 390, 430];
const DESKTOP_WIDTHS = [820, 1440];

const PROBE = function () {
  const rect = (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.x, right: b.right, y: b.y, w: b.width, h: b.height };
  };
  const sb = document.querySelector("#app label.sb");
  const row = document.querySelector("#app .acts");
  const kids = row ? Array.from(row.children) : [];
  const r0 = kids[0] ? rect(kids[0]) : null;
  const r1 = kids[1] ? rect(kids[1]) : null;
  let gap = 0;
  if (r0 && r1) gap = r0.x >= r1.right ? r0.x - r1.right : r1.x >= r0.right ? r1.x - r0.right : 0;
  return {
    vw: innerWidth,
    sb: rect(sb),
    row: rect(row),
    overflow: getComputedStyle(row).overflow,
    wrap: kids.length ? getComputedStyle(kids[0].parentNode).flexWrap : "",
    gap: gap,
    kids: kids.map((b) => {
      const c = getComputedStyle(b);
      const r = rect(b);
      return { w: r.w, h: r.h, y: r.y, x: r.x, right: r.right, fs: parseFloat(c.fontSize), sw: b.scrollWidth, cw: b.clientWidth, vis: c.visibility, ptr: c.pointerEvents };
    }),
  };
};

async function openHome(browser, base, theme, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme.scheme });
  const page = await ctx.newPage();
  await page.goto(base + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate((s) => localStorage.setItem("gq-set", JSON.stringify(s)), theme.set);
  await page.goto(base + "/index.html", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#app .acts", { timeout: 20000 });
  await page.evaluate(() => (document.fonts ? document.fonts.ready.then(() => true) : true));
  await page.waitForTimeout(250);
  return { ctx, page };
}

const measure = (page) => page.evaluate(PROBE);
const near = (a, b, tol) => Math.abs(a - b) <= tol;

test("phase N: the home action row is balanced and centered", { timeout: 300000 }, async (t) => {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let browser;
  try { browser = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return; }
  const server = await startServer();
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    for (const theme of THEMES) {
      for (const width of PHONE_WIDTHS) {
        const { ctx, page } = await openHome(browser, base, theme, width);
        const r = await measure(page);
        const tag = theme.name + "@" + width;
        const a = r.kids[0], b = r.kids[1];

        assert.equal(r.kids.length, 2, tag + ": the row still has its two buttons");
        assert.ok(near(r.row.x, r.sb.x, 1), tag + ": row left " + r.row.x + " vs search box " + r.sb.x);
        assert.ok(near(r.row.right, r.sb.right, 1), tag + ": row right " + r.row.right + " vs search box " + r.sb.right);
        assert.ok(near(a.w, b.w, 1), tag + ": button widths " + a.w + " vs " + b.w);
        assert.ok(near(r.gap, 10, 1), tag + ": button gap " + r.gap);
        assert.ok(near(a.y, b.y, 0.5), tag + ": the buttons must not wrap (" + a.y + " vs " + b.y + ")");
        assert.ok(r.row.h <= 47, tag + ": the row must stay one line (height " + r.row.h + ")");
        assert.ok(a.h >= 44 && b.h >= 44, tag + ": touch target heights " + a.h + "/" + b.h);
        assert.ok(a.sw <= a.cw, tag + ": first button text is clipped (" + a.sw + "/" + a.cw + ")");
        assert.ok(b.sw <= b.cw, tag + ": second button text is clipped (" + b.sw + "/" + b.cw + ")");
        assert.ok(a.fs >= 14 && b.fs >= 14, tag + ": font size " + a.fs + "/" + b.fs);
        await ctx.close();
      }

      for (const width of DESKTOP_WIDTHS) {
        const { ctx, page } = await openHome(browser, base, theme, width);
        const r = await measure(page);
        const tag = theme.name + "@" + width;
        const a = r.kids[0], b = r.kids[1];

        assert.ok(near(r.row.x, r.vw - r.row.right, 1), tag + ": row not centered in the viewport (" + r.row.x + " vs " + (r.vw - r.row.right) + ")");
        const left = Math.min(a.x, b.x);
        const right = Math.max(a.right, b.right);
        assert.ok(near(left - r.row.x, r.row.right - right, 1), tag + ": buttons not centered in the row");
        assert.ok(near(r.gap, 10, 1), tag + ": button gap " + r.gap);
        assert.ok(near(a.w, NATURAL_W[0], 2), tag + ": first button width " + a.w + " (N1 " + NATURAL_W[0] + ")");
        assert.ok(near(b.w, NATURAL_W[1], 2), tag + ": second button width " + b.w + " (N1 " + NATURAL_W[1] + ")");
        assert.ok(a.h >= 44 && b.h >= 44, tag + ": touch target heights " + a.h + "/" + b.h);
        await ctx.close();
      }
    }

    // --- collapse safety -------------------------------------------------
    const glassNight = THEMES[0];
    for (const width of [390, 1440]) {
      const { ctx, page } = await openHome(browser, base, glassNight, width);
      const rest = await measure(page);
      assert.strictEqual(rest.overflow, "visible", width + ": the row must not clip at rest (got " + rest.overflow + ")");

      await page.fill("#q", "\u0627");
      await page.waitForFunction(() => document.body.classList.contains("searching"), null, { timeout: 10000 });
      await page.waitForFunction(() => {
        const e = document.querySelector("#app .acts");
        return e && e.getBoundingClientRect().height <= 1;
      }, null, { timeout: 10000 });
      await page.waitForTimeout(320);
      const busy = await measure(page);
      assert.strictEqual(busy.kids[0].vis, "hidden", width + ": the collapsed row's buttons are hidden");
      assert.strictEqual(busy.kids[0].ptr, "none", width + ": the collapsed row's buttons ignore pointers");
      const focusable = await page.evaluate(() => {
        const b = document.querySelector("#app .acts .btn");
        b.focus();
        return document.activeElement === b;
      });
      assert.strictEqual(focusable, false, width + ": a collapsed button must not take focus");

      await page.fill("#q", "");
      await page.waitForFunction(() => !document.body.classList.contains("searching"), null, { timeout: 10000 });
      await page.waitForTimeout(450);
      const back = await measure(page);
      const diffs = ["x", "right", "y", "w", "h"].map((k) => Math.abs(back.row[k] - rest.row[k]));
      assert.ok(Math.max.apply(null, diffs) <= 0.5, width + ": the row did not return to its resting rect (" + JSON.stringify(diffs) + ")");
      assert.strictEqual(back.overflow, "visible", width + ": the row does not clip after the search clears");
      await ctx.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
});
