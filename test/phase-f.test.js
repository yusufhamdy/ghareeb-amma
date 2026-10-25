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

test("F1: the arrows are a row of two 58px pills below the list (sharing the row at 400px, 250px each at 1440px)", { timeout: 180000 }, async (t) => {
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
      return { pv: r("#app .cw .pnb.pv"), nx: r("#app .cw .pnb.nx"), list: r("#app .cw .list") };
    });
    assert.ok(g.pv && g.nx && g.list, "controls and list render");
    assert.ok(g.pv.top >= g.list.bottom - 1, "at 400px the previous control sits below the words list");
    assert.ok(g.nx.top >= g.list.bottom - 1, "at 400px the next control sits below the words list");
    assert.ok(Math.abs(g.pv.width - g.nx.width) <= 1 && Math.abs(g.pv.top - g.nx.top) <= 1, "at 400px the two pills share one row equally");
    assert.ok(Math.abs(g.pv.height - 58) <= 1 && Math.abs(g.nx.height - 58) <= 1, "at 400px both pills are 58px tall");
    assert.ok(g.pv.height >= 44 && g.nx.height >= 44, "at 400px both controls keep a 44px target");
    assert.ok(g.pv.left >= g.nx.right - 1, "in RTL the previous control is the inline-start (right) one");
    await mob.close();

    // desktop placement + the pill size (the same pills as the word page)
    const desk = await env.page(1440, 900);
    await nav(desk, "#/surah/" + mid);
    await desk.waitForSelector("#app .cw .pnb.pv", { timeout: 20000 });
    const sg = await desk.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
      return { pv: r("#app .cw .pnb.pv"), nx: r("#app .cw .pnb.nx"), list: r("#app .cw .list") };
    });
    assert.ok(sg.pv.top >= sg.list.bottom - 1 && sg.nx.top >= sg.list.bottom - 1, "at 1440px both controls sit below the list");
    assert.ok(sg.pv.left >= sg.nx.right - 1, "at 1440px the previous control is the inline-start (right) one");
    assert.ok(Math.abs((sg.pv.right + sg.nx.left) / 2 - (sg.list.left + sg.list.right) / 2) <= 1, "at 1440px the pill row is centered under the list");
    assert.ok(Math.abs(sg.pv.width - 230) <= 1, "surah previous pill width is 230 (" + sg.pv.width + ")");
    assert.ok(Math.abs(sg.pv.height - 58) <= 1, "surah previous pill height is 58");
    assert.ok(Math.abs(sg.nx.width - 230) <= 1, "surah next pill width is 230");
    assert.ok(Math.abs(sg.nx.height - 58) <= 1, "surah next pill height is 58");
    await desk.close();
  } finally { await env.close(); }
});

// ---------------------------------------------------------------------------
// F3: the wrong-answer cue
// ---------------------------------------------------------------------------
const CUE_ANALYSE = { sr: 44100, N: 32768 };

test("F3: the wrong cue is a short descending pair, A-weighted loudness matched per theme", { timeout: 180000 }, async (t) => {
  const env = await setup(t);
  if (!env) return;
  try {
    const page = await env.page(400, 900);
    await page.waitForFunction(() => typeof SND !== "undefined" && typeof SND.cue === "function");
    const d = await page.evaluate(async (cfg) => {
      const sr = cfg.sr, N = cfg.N;
      const aw = (f) => {
        const f2 = f * f;
        const num = 148693636 * f2 * f2;
        const den = (f2 + 424.36) * Math.sqrt((f2 + 11599.29) * (f2 + 544496.41)) * (f2 + 148693636);
        return (num / den) * 1.2589;
      };
      const fft = (re, im) => {
        const n = re.length;
        for (let i = 1, j = 0; i < n; i++) {
          let bit = n >> 1;
          for (; j & bit; bit >>= 1) j ^= bit;
          j ^= bit;
          if (i < j) { let a = re[i]; re[i] = re[j]; re[j] = a; a = im[i]; im[i] = im[j]; im[j] = a; }
        }
        for (let len = 2; len <= n; len <<= 1) {
          const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
          for (let i = 0; i < n; i += len) {
            let cr = 1, ci = 0;
            for (let k = 0; k < len / 2; k++) {
              const ur = re[i + k], ui = im[i + k];
              const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
              const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
              re[i + k] = ur + vr; im[i + k] = ui + vi;
              re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
              const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
            }
          }
        }
      };
      const render = async (name, theme) => {
        const oc = new OfflineAudioContext(1, Math.round(sr * 0.5), sr);
        SND.cue(name, theme, oc);
        const b = await oc.startRendering();
        return b.getChannelData(0);
      };
      const analyse = (d) => {
        const re = new Float64Array(N), im = new Float64Array(N);
        const n = Math.min(d.length, N);
        for (let i = 0; i < n; i++) re[i] = d[i];
        fft(re, im);
        const half = N / 2;
        const mag = new Float64Array(half + 1);
        let pk = 0, pkBin = 0;
        for (let k = 0; k <= half; k++) { const m = re[k] * re[k] + im[k] * im[k]; mag[k] = m; if (m > pk) { pk = m; pkBin = k; } }
        let sum = 0;
        for (let k = 0; k <= half; k++) { const f = k * sr / N; const a = aw(f); sum += (k === 0 || k === half ? 1 : 2) * mag[k] * a * a; }
        const rmsA = Math.sqrt(sum / (N * N));
        // lowest strong partial: the first spectral peak (local maximum) carrying at
        // least half of the loudest partial's amplitude.
        const thr = pk * 0.25;
        let low = 0;
        for (let k = 2; k <= half - 1; k++) if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1] && mag[k] >= thr) { low = k * sr / N; break; }
        let peak = 0, last = 0;
        for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; if (v > 0.0005) last = i / sr; }
        return { db: 20 * Math.log10(rmsA), peak, low, last, peakHz: pkBin * sr / N };
      };
      return {
        okG: analyse(await render("ok", "glass")), badG: analyse(await render("bad", "glass")),
        okS: analyse(await render("ok", "shade")), badS: analyse(await render("bad", "shade")),
        tickG: analyse(await render("tick", "glass")), tickS: analyse(await render("tick", "shade")),
      };
    }, CUE_ANALYSE);

    const near = (a, b, tol) => Math.abs(a - b) <= tol;
    const isNote = (hz, list) => list.some((f) => near(hz, f, 4));
    const gDb = Math.abs(d.okG.db - d.badG.db), sDb = Math.abs(d.okS.db - d.badS.db);
    const dbMsg = " [glass " + d.okG.db.toFixed(2) + "/" + d.badG.db.toFixed(2) + " = " + (d.badG.db - d.okG.db).toFixed(2) + " dB, shade " + d.okS.db.toFixed(2) + "/" + d.badS.db.toFixed(2) + " = " + (d.badS.db - d.okS.db).toFixed(2) + " dB]";
    assert.ok(gDb <= 1.5, "glass wrong cue within 1.5 dB of correct (" + gDb.toFixed(2) + " dB)" + dbMsg);
    assert.ok(sDb <= 1.5, "shade wrong cue within 1.5 dB of correct (" + sDb.toFixed(2) + " dB)" + dbMsg);
    for (const [name, v] of [["glass", d.badG], ["shade", d.badS]]) {
      assert.ok(v.peak <= 0.14, name + " wrong cue peak stays <= 0.14 (" + v.peak.toFixed(4) + ")");
      assert.ok(v.last > 0 && v.last < 0.25, name + " wrong cue is shorter than 250 ms (" + v.last.toFixed(3) + " s)");
      assert.ok(v.low >= 300, name + " wrong cue fundamental is >= 300 Hz (" + v.low.toFixed(1) + " Hz)");
      assert.ok(isNote(v.peakHz, [392, 311]), name + " wrong cue is built from 392/311 Hz (" + v.peakHz.toFixed(1) + " Hz)");
    }
    // the correct and tick cues are untouched
    assert.ok(isNote(d.okG.peakHz, [660, 880]), "glass correct cue still uses 660/880 Hz (" + d.okG.peakHz.toFixed(1) + ")");
    assert.ok(isNote(d.okS.peakHz, [440, 587]), "shade correct cue still uses 440/587 Hz (" + d.okS.peakHz.toFixed(1) + ")");
    assert.ok(isNote(d.tickG.peakHz, [1400]), "glass tick cue is untouched (" + d.tickG.peakHz.toFixed(1) + ")");
    assert.ok(isNote(d.tickS.peakHz, [900]), "shade tick cue is untouched (" + d.tickS.peakHz.toFixed(1) + ")");
  } finally { await env.close(); }
});

test("F3: with sound off no AudioContext is created, with sound on a cue is played", { timeout: 180000 }, async (t) => {
  const off = await setup(t, { set: { snd: false } });
  if (!off) return;
  try {
    const page = await off.page(400, 900);
    await page.waitForFunction(() => typeof SND !== "undefined");
    const created = await page.evaluate(() => {
      let n = 0;
      const O = window.AudioContext || window.webkitAudioContext;
      window.AudioContext = function () { n++; return new O(); };
      window.webkitAudioContext = window.AudioContext;
      SND.bad(); SND.ok(); SND.tick(); SND.land();
      return n;
    });
    assert.equal(created, 0, "sound off keeps the wrong cue silent (no AudioContext)");
  } finally { await off.close(); }

  const on = await setup(t, { set: { snd: true } });
  if (!on) return;
  try {
    const page = await on.page(400, 900);
    await page.waitForFunction(() => typeof SND !== "undefined");
    const created = await page.evaluate(() => {
      let n = 0;
      const O = window.AudioContext || window.webkitAudioContext;
      window.AudioContext = function () { n++; return new O(); };
      window.webkitAudioContext = window.AudioContext;
      SND.bad();
      return n;
    });
    assert.ok(created >= 1, "sound on creates an AudioContext and plays the wrong cue");
  } finally { await on.close(); }
});

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

// ---------------------------------------------------------------------------
// F4: smarter wrong options
// ---------------------------------------------------------------------------
function coreAndPool() {
  const QCORE = require(path.join(PUBLIC, "quiz-core.js"));
  const seo = require(path.join(ROOT, "functions", "seo.js"));
  const data = JSON.parse(fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8"));
  const numOf = (s) => QCORE.SURAH_NO[seo.SURAH_SLUG[String(s).split(/\s+/).pop()]] || 0;
  return { QCORE: QCORE, pool: QCORE.buildPool(data, numOf) };
}

test("F4: wrong options are real other meanings, never equal/containing, length-matched", { timeout: 60000 }, () => {
  const c = coreAndPool();
  const QCORE = c.QCORE, pool = c.pool;
  assert.equal(pool.length, 73, "the pool holds every word of the data");
  assert.equal(new Set(pool.map((x) => x.id)).size, pool.length, "pool ids are unique");
  assert.ok(pool.every((x) => x.sn > 0), "every pool entry knows its surah number");
  const known = new Set(pool.map((x) => x.id));
  let widened = 0;
  for (const t of pool) {
    const tk = QCORE.nrm(t.mean), tl = tk.length;
    const cand = pool.filter((x) => x.id !== t.id && x.km && x.km !== tk && !x.km.includes(tk) && !tk.includes(x.km));
    const uniq = [];
    const seen = new Set();
    for (const x of cand) if (!seen.has(x.km)) { seen.add(x.km); uniq.push(x); }
    const d = QCORE.pickDistractors(t, pool, 3);
    assert.equal(d.length, 3, "three wrong options for " + t.id);
    assert.equal(new Set(d.map((x) => x.km)).size, 3, "wrong options are distinct for " + t.id);
    for (const x of d) {
      assert.notEqual(x.id, t.id, "the word itself is never an option (" + t.id + ")");
      assert.ok(known.has(x.id), "options are real words (" + t.id + " -> " + x.id + ")");
      assert.ok(x.km !== tk && !x.km.includes(tk) && !tk.includes(x.km), "options never leak the answer (" + t.id + " -> " + x.id + ")");
    }
    const w25 = uniq.filter((x) => Math.abs(x.km.length - tl) <= 0.25 * tl);
    if (w25.length >= 3) {
      for (const x of d) assert.ok(Math.abs(x.km.length - tl) <= 0.25 * tl, "preferred +-25% length window for " + t.id);
    } else {
      widened++;
    }
  }
  assert.ok(widened > 0 && widened < 10, "the window widens only for the few means with too few peers (" + widened + ")");
});

test("F4: the option order is a uniform shuffle and does not mutate its input", { timeout: 30000 }, () => {
  const QCORE = coreAndPool().QCORE;
  let seed = 7;
  const rand = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const N = 8000, cnt = [0, 0, 0, 0];
  for (let i = 0; i < N; i++) cnt[QCORE.shuffle([0, 1, 2, 3], rand).indexOf(0)]++;
  for (let i = 0; i < 4; i++) {
    assert.ok(Math.abs(cnt[i] - N / 4) < 200, "slot " + i + " is equally likely (" + cnt[i] + " of " + N + ")");
  }
  const src = [1, 2, 3, 4];
  QCORE.shuffle(src);
  assert.deepEqual(src, [1, 2, 3, 4], "shuffle returns a copy");
});

test("F4: the quiz drives the core - four real, distinct options per question", { timeout: 180000 }, async (t) => {
  const env = await setup(t);
  if (!env) return;
  try {
    const page = await env.page(390, 844);
    await page.waitForFunction(() => typeof QCORE !== "undefined" && typeof W !== "undefined" && W.length > 0);
    const app = await page.evaluate(() => W.map((w) => ({ id: w.id, km: w.km, mean: w.mean })));
    const nums = await page.evaluate(() => S.map((s) => s.num));

    const c = coreAndPool();
    const QCORE = c.QCORE, pool = c.pool;
    assert.equal(pool.length, app.length, "the core pool covers every word the app built");
    const byId = new Map(pool.map((x) => [x.id, x]));
    for (const w of app) {
      const p = byId.get(w.id);
      assert.ok(p, "core pool has " + w.id);
      assert.equal(p.km, w.km, "normalised meaning matches the app for " + w.id);
      assert.equal(p.mean, w.mean, "displayed meaning matches the app for " + w.id);
    }
    const have = new Set(Object.keys(QCORE.SURAH_NO).map((k) => QCORE.SURAH_NO[k]));
    for (const n of nums) assert.ok(have.has(n), "SURAH_NO covers surah " + n);

    const wired = await page.evaluate(() => {
      let pd = 0, sh = 0;
      const op = QCORE.pickDistractors, os = QCORE.shuffle;
      QCORE.pickDistractors = function () { pd++; return op.apply(this, arguments); };
      QCORE.shuffle = function () { sh++; return os.apply(this, arguments); };
      qStart();
      QCORE.pickDistractors = op;
      QCORE.shuffle = os;
      return {
        pd: pd, sh: sh,
        opts: Q.qs.map((q) => q.o.length),
        ci: Q.qs.map((q) => q.o.indexOf(q.w)),
        distinct: Q.qs.every((q) => new Set(q.o.map((x) => x.km)).size === q.o.length),
        firstMean: Q.qs[0].w.mean,
        firstOpts: Q.qs[0].o.map((x) => x.mean),
      };
    });
    assert.equal(wired.opts.length, Math.min(10, app.length), "a quiz is ten questions");
    assert.equal(wired.pd, wired.opts.length, "every question draws its wrong options from the core");
    assert.ok(wired.sh >= wired.opts.length, "every question's options are shuffled by the core");
    for (const n of wired.opts) assert.equal(n, 4, "four options per question");
    for (const i of wired.ci) assert.ok(i >= 0, "the correct option is always present");
    assert.ok(wired.distinct, "options within a question are distinct");
    assert.ok(wired.firstOpts.includes(wired.firstMean), "the first question offers its own meaning");

    await nav(page, "#/quiz");
    await page.waitForFunction(() => document.querySelectorAll("#app .opts .opt").length > 0);
    assert.equal(await page.evaluate(() => document.querySelectorAll("#app .opts .opt").length), 4, "the quiz page renders four options");
  } finally { await env.close(); }
});

// ---------------------------------------------------------------------------
// F5: weak-question audit tool
// ---------------------------------------------------------------------------
test("F5: the audit tool reports weak questions to a file outside the repo", { timeout: 180000 }, () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, "tools", "quiz-audit.mjs")], { encoding: "utf8" });
  assert.equal(r.status, 0, "the audit exits cleanly: " + (r.stderr || ""));
  const lines = String(r.stdout).trim().split(/\r?\n/);
  assert.equal(lines.length, 2, "the tool prints only the count and the path: " + JSON.stringify(r.stdout));
  const w = lines[0].match(/^WEAK=(\d+)$/);
  const p = lines[1].match(/^REPORT=(.+)$/);
  assert.ok(w, "first line is the weak count (" + lines[0] + ")");
  assert.ok(p, "second line is the report path (" + lines[1] + ")");
  assert.ok(+w[1] > 0 && +w[1] < 73, "the weak count is sensible (" + w[1] + ")");
  const out = p[1];
  assert.ok(!path.resolve(out).startsWith(ROOT + path.sep), "the report is written outside the repo (" + out + ")");
  assert.ok(fs.existsSync(out), "the report exists at " + out);
  const txt = fs.readFileSync(out, "utf8");
  assert.ok(txt.indexOf("# Quiz weak questions") === 0, "the report has the expected heading");
  assert.ok(txt.indexOf("weak words: " + w[1]) >= 0, "the report states the same count");
  assert.ok(txt.split("\n").filter((l) => l.indexOf("## ") === 0).length === +w[1], "the report lists every weak word");
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
      const d = document.querySelector("#dw"), dr = d && d.getBoundingClientRect();
      return { pv: ctl("#app .cw.dnav .pv"), nx: ctl("#app .cw.dnav .nx"), dw: dr ? { top: dr.top, bottom: dr.bottom } : null };
    })()`);

    await nav(page, "#/day/5");
    await page.waitForSelector("#app .cw.dnav .pv", { timeout: 20000 });
    const d5 = await read();
    assert.ok(d5.pv && d5.nx, "the day page shows both pills");
    assert.equal(d5.pv.tag, "A", "day 5 previous is a link");
    assert.equal(d5.pv.href, "#/day/4", "day 5 previous goes to day 4");
    assert.equal(d5.nx.tag, "A", "day 5 next is a link");
    assert.equal(d5.nx.href, "#/day/6", "day 5 next goes to day 6");
    assert.ok(d5.pv.text.includes(LB.prevDay), "previous carries the new day label");
    assert.ok(d5.nx.text.includes(LB.nextDay), "next keeps the existing day label");
    assert.ok(d5.pv.svg && d5.nx.svg, "both arrows carry a chevron");
    assert.ok(d5.pv.pe !== "none", "an enabled control is clickable");
    assert.ok(d5.dw && d5.pv.top >= d5.dw.bottom && d5.nx.top >= d5.dw.bottom, "the pills sit below the word cards");

    await nav(page, "#/day/1");
    await page.waitForSelector("#app .cw.dnav .pv", { timeout: 20000 });
    const d1 = await read();
    assert.equal(d1.pv.tag, "SPAN", "day 1 previous is not a link");
    assert.equal(d1.pv.dis, "true", "day 1 previous is aria-disabled");
    assert.equal(d1.pv.href, null, "day 1 previous has no target");
    assert.equal(d1.pv.pe, "none", "day 1 previous ignores the pointer");
    assert.ok(Number(d1.pv.op) < 1, "day 1 previous is dimmed");
    assert.equal(d1.nx.tag, "A", "day 1 next stays a link");
    assert.equal(d1.nx.href, "#/day/2", "day 1 next goes to day 2");

    await nav(page, "#/day/" + (await page.evaluate(() => CH.length)));
    await page.waitForSelector("#app .cw.dnav .pv", { timeout: 20000 });
    const dN = await read();
    const lastDay = await page.evaluate(() => CH.length);
    assert.equal(dN.nx.tag, "SPAN", "the last day next is not a link");
    assert.equal(dN.nx.dis, "true", "the last day next is aria-disabled");
    assert.equal(dN.nx.href, null, "the last day next has no target");
    assert.equal(dN.pv.tag, "A", "the last day previous stays a link");
    assert.equal(dN.pv.href, "#/day/" + (lastDay - 1), "the last day previous goes to the day before");

    // both controls keep their place across days (disabled never hidden); vertically they follow the word cards
    for (const k of ["pv", "nx"]) {
      for (const [name, v] of [["day1", d1], ["day5", d5], ["last", dN]]) {
        assert.ok(Math.abs(v[k].left - d5[k].left) <= 1, name + " " + k + " left is stable (" + v[k].left + " vs " + d5[k].left + ")");
        assert.ok(v[k].top >= v.dw.bottom, name + " " + k + " sits below the word cards");
        assert.ok(Math.abs(v[k].width - d5[k].width) <= 1, name + " " + k + " width is stable");
        assert.ok(Math.abs(v[k].height - d5[k].height) <= 1, name + " " + k + " height is stable");
      }
    }
    // the next pill carries the shared chevron at its outer edge, pointing left
    assert.equal(d5.nx.last, "svg", "the next chevron is the last child of the pill");
    assert.ok((d5.nx.path || "").includes("M15 5l-7 7 7 7"), "the next chevron points left");
  } finally { await env.close(); }
});

test("F2: a locked next day shows a disabled next pill with a lock line", { timeout: 180000 }, async (t) => {
  const raw = JSON.parse(fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8"));
  const env = await setup(t, { ch: Object.assign({}, raw, { releasedUpTo: null }), prog: { done: [] } });
  if (!env) return;
  try {
    const page = await env.page(1440, 900);
    await nav(page, "#/day/1");
    await page.waitForSelector("#app .cw.dnav .nx", { timeout: 20000 });
    const r = await page.evaluate(`(() => {
      const e = document.querySelector("#app .cw.dnav .nx"), ps = e.querySelector(".ps");
      return { tag: e.tagName, href: e.getAttribute("href"), dis: e.getAttribute("aria-disabled"), ps: ps ? ps.textContent.trim() : null, lock: !!(ps && ps.querySelector("svg rect")) };
    })()`);
    assert.equal(r.tag, "SPAN", "the next control is not a link while the next day is locked");
    assert.equal(r.href, null, "it has no target");
    assert.equal(r.dis, "true", "it is marked disabled");
    assert.equal(r.ps, "\u0628\u0639\u062f \u0625\u062a\u0645\u0627\u0645 \u0627\u0644\u064a\u0648\u0645", "its second line explains when it opens");
    assert.ok(r.lock, "the second line carries a lock icon");
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
