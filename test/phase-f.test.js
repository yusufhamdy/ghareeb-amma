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

// ---------------------------------------------------------------------------
// F2: the day page previous arrow mirroring the next control
// ---------------------------------------------------------------------------
const DAYREAD = () => ({
  ctl: (s) => {
    const e = document.querySelector(s);
    if (!e) return null;
    const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
    return {
      tag: e.tagName, href: e.getAttribute("href"), dis: e.getAttribute("aria-disabled"),
      text: (e.textContent || "").trim(), svg: !!e.querySelector("svg"),
      top: r.top, left: r.left, width: r.width, height: r.height,
      pe: cs.pointerEvents, op: cs.opacity,
      last: e.lastElementChild ? e.lastElementChild.tagName : null,
      path: e.querySelector("svg path") ? e.querySelector("svg path").getAttribute("d") : null,
    };
  },
  h1: (() => { const e = document.querySelector(".dh h1"); const r = e && e.getBoundingClientRect(); return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null; })(),
  pv: null, nx: null,
});

test("F2: day 5 previous goes to day 4; day 1 previous and the last day next are disabled", { timeout: 180000 }, async (t) => {
  const env = await setup(t);
  if (!env) return;
  try {
    const page = await env.page(1440, 900);
    const read = () => page.evaluate(`(() => {
      const ctl = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
        return { tag: e.tagName, href: e.getAttribute("href"), dis: e.getAttribute("aria-disabled"), text: (e.textContent||"").trim(), svg: !!e.querySelector("svg"),
          top: r.top, left: r.left, right: r.right, width: r.width, height: r.height, pe: cs.pointerEvents, op: cs.opacity,
          last: e.lastElementChild ? e.lastElementChild.tagName : null, path: e.querySelector("svg path") ? e.querySelector("svg path").getAttribute("d") : null }; };
      const h = document.querySelector(".dh h1"), hr = h && h.getBoundingClientRect();
      return { pv: ctl(".dh .pv"), nx: ctl(".dh .nx"), h1: hr ? { top: hr.top, bottom: hr.bottom, left: hr.left, right: hr.right } : null };
    })()`);

    await nav(page, "#/day/5");
    await page.waitForSelector(".dh .pv", { timeout: 20000 });
    const d5 = await read();
    assert.ok(d5.pv && d5.nx, "the day page shows both arrows next to the title");
    assert.equal(d5.pv.tag, "A", "day 5 previous is a link");
    assert.equal(d5.pv.href, "#/day/4", "day 5 previous goes to day 4");
    assert.equal(d5.nx.tag, "A", "day 5 next is a link");
    assert.equal(d5.nx.href, "#/day/6", "day 5 next goes to day 6");
    assert.ok(d5.pv.text.includes(LB.prevDay), "previous carries the new day label");
    assert.ok(d5.nx.text.includes(LB.nextDay), "next keeps the existing day label");
    assert.ok(d5.pv.svg && d5.nx.svg, "both arrows carry a chevron");
    assert.ok(d5.pv.pe !== "none", "an enabled control is clickable");
    assert.ok(d5.h1 && d5.pv.left >= d5.h1.right - 1 && d5.nx.right <= d5.h1.left + 1, "the arrows flank the title");

    await nav(page, "#/day/1");
    await page.waitForSelector(".dh .pv", { timeout: 20000 });
    const d1 = await read();
    assert.equal(d1.pv.tag, "SPAN", "day 1 previous is not a link");
    assert.equal(d1.pv.dis, "true", "day 1 previous is aria-disabled");
    assert.equal(d1.pv.href, null, "day 1 previous has no target");
    assert.equal(d1.pv.pe, "none", "day 1 previous ignores the pointer");
    assert.ok(Number(d1.pv.op) < 1, "day 1 previous is dimmed");
    assert.equal(d1.nx.tag, "A", "day 1 next stays a link");
    assert.equal(d1.nx.href, "#/day/2", "day 1 next goes to day 2");

    await nav(page, "#/day/" + (await page.evaluate(() => CH.length)));
    await page.waitForSelector(".dh .pv", { timeout: 20000 });
    const dN = await read();
    const lastDay = await page.evaluate(() => CH.length);
    assert.equal(dN.nx.tag, "SPAN", "the last day next is not a link");
    assert.equal(dN.nx.dis, "true", "the last day next is aria-disabled");
    assert.equal(dN.nx.href, null, "the last day next has no target");
    assert.equal(dN.pv.tag, "A", "the last day previous stays a link");
    assert.equal(dN.pv.href, "#/day/" + (lastDay - 1), "the last day previous goes to the day before");

    // positions of both controls are identical across days (disabled never hidden)
    for (const k of ["pv", "nx"]) {
      for (const [name, v] of [["day1", d1], ["day5", d5], ["last", dN]]) {
        assert.ok(Math.abs(v[k].left - d5[k].left) <= 1, name + " " + k + " left is stable (" + v[k].left + " vs " + d5[k].left + ")");
        assert.ok(Math.abs(v[k].top - d5[k].top) <= 1, name + " " + k + " top is stable");
        assert.ok(Math.abs(v[k].width - d5[k].width) <= 1, name + " " + k + " width is stable");
        assert.ok(Math.abs(v[k].height - d5[k].height) <= 1, name + " " + k + " height is stable");
      }
    }
    // the existing next keeps its look: .btn with the forward arrow last
    assert.equal(d5.nx.last, "svg", "the existing next arrow is the last child of the button");
    assert.ok((d5.nx.path || "").includes("M19 12H5"), "the existing next arrow still points left");
  } finally { await env.close(); }
});

test("F2: a locked next day is still handled exactly as before", { timeout: 180000 }, async (t) => {
  const raw = JSON.parse(fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8"));
  const env = await setup(t, { ch: Object.assign({}, raw, { releasedUpTo: null }), prog: { done: [] } });
  if (!env) return;
  try {
    const page = await env.page(1440, 900);
    await nav(page, "#/day/1");
    await page.waitForSelector(".dh .nx", { timeout: 20000 });
    const r = await page.evaluate(`(() => {
      const e = document.querySelector(".dh .nx");
      return { tag: e.tagName, href: e.getAttribute("href"), dis: e.getAttribute("aria-disabled") };
    })()`);
    assert.equal(r.tag, "A", "the next control is still a link even when the next day is locked");
    assert.equal(r.href, "#/day/2", "it still points at the next day");
    assert.equal(r.dis, null, "it is not marked disabled");
    await nav(page, "#/day/2");
    await page.waitForSelector("#app .card", { timeout: 20000 });
    const locked = await page.evaluate(() => ({
      dw: !!document.querySelector("#dw"),
      done: !!document.querySelector('[data-a="done"]'),
      txt: document.querySelector("#app").textContent.length,
    }));
    assert.equal(locked.dw, false, "a locked day shows no word deck");
    assert.equal(locked.done, false, "a locked day shows no done button");
    assert.ok(locked.txt > 0, "a locked day still explains the lock");
  } finally { await env.close(); }
});
