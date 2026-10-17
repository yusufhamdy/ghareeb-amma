"use strict";
/*
 * phase-f.test.js - Phase F acceptance:
 *   F1 surah page prev/next arrows (reuse the word-page .cw/.pnb controls).
 *   F2 day page previous arrow mirrored next to the title.
 *   F3 wrong-answer sound: two descending notes, A-weighted loudness matched.
 *   F4 smarter wrong options (real meanings of other words).
 *   F5 the audit tool runs and reports a count (read-only, no repo output).
 *   F6 npm test finishes by itself.
 *
 * Loads the real public/ files in Chromium and checks real behaviour from the
 * DOM, computed styles and real pixels. ASCII only (Arabic via \uXXXX escapes).
 * Each browser test skips cleanly when Chromium is unavailable.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

// Arabic UI strings under test, written as escapes so this file stays ASCII.
const LB = {
  prevSurah: "\u0627\u0644\u0633\u0648\u0631\u0629 \u0627\u0644\u0633\u0627\u0628\u0642\u0629",
  nextSurah: "\u0627\u0644\u0633\u0648\u0631\u0629 \u0627\u0644\u062a\u0627\u0644\u064a\u0629",
  prevDay: "\u0627\u0644\u064a\u0648\u0645 \u0627\u0644\u0633\u0627\u0628\u0642",
  nextDay: "\u0627\u0644\u064a\u0648\u0645 \u0627\u0644\u062a\u0627\u0644\u064a",
};

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

async function setup(t, opts = {}) {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return null; }
  let browser;
  try { browser = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return null; }

  const words = fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8");
  const chRaw = fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8");
  const chObj = opts.ch || Object.assign(JSON.parse(chRaw), { releasedUpTo: 30 });
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const set = Object.assign({ mode: "light", pal: "def", gl: 3, style: "glass", gv: 2, snd: false }, opts.set || {});
  const prog = opts.prog || null;

  const api = {
    base,
    async page(width, height) {
      const page = await browser.newPage({ viewport: { width: width || 390, height: height || 844 } });
      await page.emulateMedia({ colorScheme: opts.colorScheme || "light", reducedMotion: opts.reducedMotion || "no-preference" });
      let content = "window.__WORDS__=" + words + ";window.__CH__=" + JSON.stringify(chObj) + ";" +
        "try{localStorage.setItem('gq-set',JSON.stringify(" + JSON.stringify(set) + "))}catch(e){}";
      if (prog) content += "try{localStorage.setItem('gq-prog',JSON.stringify(" + JSON.stringify(prog) + "))}catch(e){}";
      await page.addInitScript({ content });
      await page.goto(base + "/index.html", { waitUntil: "load" });
      return page;
    },
    async close() { await browser.close(); await new Promise((r) => server.close(r)); },
  };
  return api;
}

function nav(page, hash) { return page.evaluate((h) => { location.hash = h; }, hash); }
const rects = (sel, keys) => (page) => page.evaluate(([s, ks]) => {
  const e = document.querySelector(s);
  if (!e) return null;
  const r = e.getBoundingClientRect(), o = { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  if (ks) { const cs = getComputedStyle(e); ks.forEach((k) => { o[k] = cs[k]; }); }
  return o;
}, [sel, keys]);

// ---------------------------------------------------------------------------
// F1: surah page prev/next arrows
// ---------------------------------------------------------------------------
test("F1: every surah links to its neighbours and the boundaries are disabled", { timeout: 180000 }, async (t) => {
  const env = await setup(t);
  if (!env) return;
  try {
    const page = await env.page(1440, 900);
    await page.waitForFunction(() => typeof S !== "undefined" && S.length > 1);
    const data = await page.evaluate((labels) => {
      const info = (el) => el ? {
        tag: el.tagName, href: el.getAttribute("href"), dis: el.getAttribute("aria-disabled"),
        op: el.style.opacity, pe: el.style.pointerEvents, text: (el.textContent || "").trim(), svg: !!el.querySelector("svg"),
      } : null;
      const out = [];
      for (let i = 0; i < S.length; i++) {
        const s = S[i], host = document.createElement("div");
        host.innerHTML = view(["surah", s.num]);
        out.push({ num: s.num, pv: info(host.querySelector(".cw .pnb.pv")), nx: info(host.querySelector(".cw .pnb.nx")) });
      }
      return { n: S.length, nums: S.map((x) => x.num), out, labels };
    }, [LB.prevSurah, LB.nextSurah]);

    assert.ok(data.n > 1, "the data has more than one surah");
    for (let i = 0; i < data.out.length; i++) {
      const r = data.out[i], pv = r.pv, nx = r.nx;
      assert.ok(pv && nx, "surah " + r.num + " shows both controls");
      assert.ok(pv.svg && nx.svg, "surah " + r.num + " controls carry a chevron");
      if (i === 0) {
        assert.equal(pv.tag, "SPAN", "the first surah previous is disabled");
        assert.equal(pv.dis, "true", "the first surah previous is aria-disabled");
        assert.equal(pv.href, null, "the first surah previous has no link");
        assert.equal(pv.pe, "none", "the first surah previous ignores the pointer");
      } else {
        assert.equal(pv.tag, "A", "surah " + r.num + " previous is a link");
        assert.equal(pv.href, "#/surah/" + data.nums[i - 1], "surah " + r.num + " previous points at the previous surah");
      }
      if (i === data.out.length - 1) {
        assert.equal(nx.tag, "SPAN", "the last surah next is disabled");
        assert.equal(nx.dis, "true", "the last surah next is aria-disabled");
        assert.equal(nx.href, null, "the last surah next has no link");
      } else {
        assert.equal(nx.tag, "A", "surah " + r.num + " next is a link");
        assert.equal(nx.href, "#/surah/" + data.nums[i + 1], "surah " + r.num + " next points at the next surah");
      }
      assert.ok(pv.text.includes(data.labels[0]), "previous uses the existing label");
      assert.ok(nx.text.includes(data.labels[1]), "next uses the existing label");
    }
  } finally { await env.close(); }
});

test("F1: at 400px the arrows sit above the list; at 1440px they flank it at the word-page size", { timeout: 180000 }, async (t) => {
  const env = await setup(t);
  if (!env) return;
  try {
    const nums = await (async () => {
      const p = await env.page(400, 900);
      await p.waitForFunction(() => typeof S !== "undefined" && S.length > 1);
      return p.evaluate(() => S.map((s) => s.num));
    })();

    // mobile placement
    const mob = await env.page(400, 900);
    const mid = nums[Math.floor(nums.length / 2)];
    await nav(mob, "#/surah/" + mid);
    await mob.waitForSelector("#app .cw .pnb.pv", { timeout: 20000 });
    const g = await mob.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
      return { pv: r("#app .cw .pnb.pv"), nx: r("#app .cw .pnb.nx"), list: r("#app .cw .one") };
    });
    assert.ok(g.pv && g.nx && g.list, "controls and list render");
    assert.ok(g.pv.bottom <= g.list.top + 1, "at 400px the previous control sits above the words list");
    assert.ok(g.nx.bottom <= g.list.top + 1, "at 400px the next control sits above the words list");
    assert.ok(g.pv.height >= 44 && g.nx.height >= 44, "at 400px both controls keep a 44px target");
    assert.ok(g.pv.left >= g.nx.right - 1, "in RTL the previous control is the inline-start (right) one");
    await mob.close();

    // desktop placement + size parity with the word page
    const desk = await env.page(1440, 900);
    await nav(desk, "#/surah/" + mid);
    await desk.waitForSelector("#app .cw .pnb.pv", { timeout: 20000 });
    const sg = await desk.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
      return { pv: r("#app .cw .pnb.pv"), nx: r("#app .cw .pnb.nx"), list: r("#app .cw .one") };
    });
    assert.ok(sg.pv.left >= sg.list.right - 1, "at 1440px the previous control is to the inline-start of the list");
    assert.ok(sg.nx.right <= sg.list.left + 1, "at 1440px the next control is to the inline-end of the list");

    await nav(desk, "#/word/" + (await desk.evaluate(() => W[0].id)));
    await desk.waitForSelector("#app .cw .pnb.pv", { timeout: 20000 });
    const wg = await desk.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
      return { pv: r("#app .cw .pnb.pv"), nx: r("#app .cw .pnb.nx") };
    });
    assert.ok(Math.abs(sg.pv.width - wg.pv.width) <= 1, "surah previous width matches the word page (" + sg.pv.width + " vs " + wg.pv.width + ")");
    assert.ok(Math.abs(sg.pv.height - wg.pv.height) <= 1, "surah previous height matches the word page");
    assert.ok(Math.abs(sg.nx.width - wg.nx.width) <= 1, "surah next width matches the word page");
    assert.ok(Math.abs(sg.nx.height - wg.nx.height) <= 1, "surah next height matches the word page");
    await desk.close();
  } finally { await env.close(); }
});

module.exports = { setup, nav, rects, LB };
