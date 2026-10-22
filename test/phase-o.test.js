"use strict";
/*
 * phase-o.test.js - Phase O acceptance: the challenge day-complete button
 * plays two new theme-aware cues and nothing else does.
 *   O1a  done/undo cues: length, peak, A-weighted loudness vs the existing
 *        correct cue, and pitch (done = three ascending notes >= 500 Hz,
 *        undo = one note gliding down, fundamental >= 300 Hz).
 *   O1b  one tap on the complete button calls the done sound exactly once and
 *        the next tap calls the undo sound exactly once, per theme.
 *   O1c  opening an already completed day, reloading, and sound-off never
 *        create an AudioContext.
 *
 * Loads the real public/ files in Chromium. ASCII only (no Arabic here).
 * Each browser test skips cleanly when Chromium is unavailable.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

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
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "no-preference" });
      let content = "window.__WORDS__=" + words + ";window.__CH__=" + JSON.stringify(chObj) + ";" +
        "try{localStorage.setItem('gq-set',JSON.stringify(" + JSON.stringify(set) + "))}catch(e){}";
      if (prog) content += "try{localStorage.setItem('gq-prog',JSON.stringify(" + JSON.stringify(prog) + "))}catch(e){}";
      await page.addInitScript({ content });
      if (opts.init) await page.addInitScript({ content: opts.init });
      await page.goto(base + "/index.html", { waitUntil: "load" });
      return page;
    },
    async close() { await browser.close(); await new Promise((r) => server.close(r)); },
  };
  return api;
}

function nav(page, hash) { return page.evaluate((h) => { location.hash = h; }, hash); }

// counts every AudioContext the page ever creates (installed before page scripts)
const ACOUNT =
  "(function(){var n=0;var O=window.AudioContext||window.webkitAudioContext;" +
  "if(O){function W(){n++;return new O()}window.AudioContext=W;window.webkitAudioContext=W;}" +
  "window.__acn=function(){return n};})();";

const BTN = '[data-a="done"][data-d]';
const CUE_ANALYSE = { sr: 44100, N: 32768 };

// ---------------------------------------------------------------------------
// O1a: the rendered cues themselves
// ---------------------------------------------------------------------------
test("O1a: done/undo cues are short, soft, loudness-matched and the right pitch", { timeout: 180000 }, async (t) => {
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
        for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let a = re[i]; re[i] = re[j]; re[j] = a; a = im[i]; im[i] = im[j]; im[j] = a; } }
        for (let len = 2; len <= n; len <<= 1) {
          const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
          for (let i = 0; i < n; i += len) {
            let cr = 1, ci = 0;
            for (let k = 0; k < len / 2; k++) {
              const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
              re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
              const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
            }
          }
        }
      };
      const render = async (name, theme) => {
        const oc = new OfflineAudioContext(1, Math.round(sr * 0.5), sr);
        SND.cue(name, theme, oc);
        const b = await oc.startRendering();
        return Array.from(b.getChannelData(0));
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
        const thr = pk * 0.25;
        let low = 0;
        for (let k = 2; k <= half - 1; k++) if (mag[k] > mag[k - 1] && mag[k] >= mag[k + 1] && mag[k] >= thr) { low = k * sr / N; break; }
        let peak = 0, last = 0;
        for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; if (v > 0.0005) last = i / sr; }
        return { db: 20 * Math.log10(rmsA), peak, low, last, peakHz: pkBin * sr / N };
      };
      const winHz = (d, t0, t1, lo, hi) => {
        const s = Math.round(t0 * sr), e = Math.min(d.length, Math.round(t1 * sr));
        const n = 8192;
        const re = new Float64Array(n), im = new Float64Array(n);
        for (let i = s; i < e; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i - s) / (e - s - 1)); re[i - s] = d[i] * w; }
        fft(re, im);
        let pk = 0, b = 0;
        for (let k = Math.floor(lo * n / sr); k <= Math.ceil(hi * n / sr); k++) { const m = re[k] * re[k] + im[k] * im[k]; if (m > pk) { pk = m; b = k; } }
        return b * sr / n;
      };
      const res = {};
      for (const theme of ["glass", "shade"]) {
        const ok = analyse(await render("ok", theme));
        const doneBuf = await render("done", theme);
        const undoBuf = await render("undo", theme);
        const done = analyse(doneBuf), undo = analyse(undoBuf);
        res[theme] = {
          okDb: ok.db, doneDb: done.db, undoDb: undo.db,
          okPeak: ok.peak, donePeak: done.peak, undoPeak: undo.peak,
          doneLast: done.last, undoLast: undo.last, undoLow: undo.low,
          doneF: [winHz(doneBuf, 0, 0.11, 400, 2000), winHz(doneBuf, 0.11, 0.22, 400, 2000), winHz(doneBuf, 0.23, 0.35, 400, 2000)],
          undoF0: winHz(undoBuf, 0, 0.05, 300, 600), undoF1: winHz(undoBuf, 0.1, 0.14, 300, 600),
        };
      }
      return res;
    }, CUE_ANALYSE);

    for (const theme of ["glass", "shade"]) {
      const v = d[theme];
      t.diagnostic(theme + ": ok " + v.okDb.toFixed(2) + " dB, done " + v.doneDb.toFixed(2) +
        " dB (" + (v.doneDb - v.okDb).toFixed(2) + "), undo " + v.undoDb.toFixed(2) +
        " dB (" + (v.undoDb - v.doneDb).toFixed(2) + "), peaks " + v.donePeak.toFixed(4) + "/" + v.undoPeak.toFixed(4) +
        ", lengths " + v.doneLast.toFixed(3) + "s/" + v.undoLast.toFixed(3) + "s, doneF " +
        v.doneF.map((f) => f.toFixed(0)).join(",") + ", undoF " + v.undoF0.toFixed(0) + "->" + v.undoF1.toFixed(0));
      assert.ok(v.doneLast > 0 && v.doneLast < 0.4, theme + ": done cue stays under 400 ms (" + v.doneLast.toFixed(3) + " s)");
      assert.ok(v.undoLast > 0 && v.undoLast < 0.2, theme + ": undo cue stays under 200 ms (" + v.undoLast.toFixed(3) + " s)");
      assert.ok(v.donePeak <= 0.14, theme + ": done peak <= 0.14 (" + v.donePeak.toFixed(4) + ")");
      assert.ok(v.undoPeak <= 0.14, theme + ": undo peak <= 0.14 (" + v.undoPeak.toFixed(4) + ")");
      assert.ok(v.okPeak <= 0.14, theme + ": the existing correct cue is untouched (peak " + v.okPeak.toFixed(4) + ")");
      const doneOk = Math.abs(v.doneDb - v.okDb);
      assert.ok(doneOk <= 1.5, theme + ": done within 1.5 dB of the correct cue (" + doneOk.toFixed(2) + " dB)");
      const below = v.doneDb - v.undoDb;
      assert.ok(below >= 1.5 && below <= 4, theme + ": undo sits 1.5-4 dB below done (" + below.toFixed(2) + " dB)");
      const f = v.doneF;
      assert.ok(f[0] >= 500 && f[1] >= 500 && f[2] >= 500, theme + ": done notes are all >= 500 Hz (" + f.map((x) => x.toFixed(0)) + ")");
      assert.ok(f[0] < f[1] && f[1] < f[2], theme + ": done notes ascend (" + f.map((x) => x.toFixed(0)) + ")");
      assert.ok(f[1] - f[0] > 50 && f[2] - f[1] > 50, theme + ": the three done notes are distinct");
      assert.ok(Math.abs(f[0] - 523) <= 8 && Math.abs(f[1] - 659) <= 8 && Math.abs(f[2] - 784) <= 8,
        theme + ": done notes are 523/659/784 Hz (" + f.map((x) => x.toFixed(0)).join(",") + ")");
      assert.ok(v.undoLow >= 300, theme + ": undo fundamental >= 300 Hz (" + v.undoLow.toFixed(1) + ")");
      assert.ok(v.undoF0 >= 400 && v.undoF0 <= 460, theme + ": undo starts near 440 Hz (" + v.undoF0.toFixed(0) + ")");
      assert.ok(v.undoF1 >= 310 && v.undoF1 <= 380, theme + ": undo falls to near 330 Hz (" + v.undoF1.toFixed(0) + ")");
      assert.ok(v.undoF1 < v.undoF0 - 50, theme + ": the undo note really falls");
    }
  } finally { await env.close(); }
});

// ---------------------------------------------------------------------------
// O1b: taps on the complete button - done once, then undo once, per theme
// ---------------------------------------------------------------------------
test("O1b: one tap plays done once and the next tap plays undo once, per theme", { timeout: 300000 }, async (t) => {
  for (const style of ["glass", "shade"]) {
    const env = await setup(t, { set: { snd: true, style } });
    if (!env) return;
    try {
      const page = await env.page(400, 900);
      await page.waitForFunction(() => typeof SND !== "undefined");
      await nav(page, "#/day/1");
      await page.waitForFunction(() => document.querySelectorAll("#dw .dcard").length > 0, null, { timeout: 20000 });
      // stub the sound entry points before any interaction
      await page.evaluate(() => {
        window.__calls = [];
        SND.done = function () { window.__calls.push("done"); };
        SND.undo = function () { window.__calls.push("undo"); };
        document.querySelectorAll("#dw .dcard").forEach((c) => c.click());
      });
      await page.waitForFunction((b) => { const e = document.querySelector(b); return e && !e.disabled; }, BTN, { timeout: 15000 });

      await page.click(BTN);
      await page.waitForFunction(() => window.__calls.length >= 1, null, { timeout: 5000 });
      let calls = await page.evaluate(() => window.__calls);
      assert.deepEqual(calls, ["done"], style + ": the completing tap plays the done sound exactly once");

      await page.click(BTN);
      await page.waitForFunction(() => window.__calls.length >= 2, null, { timeout: 5000 });
      calls = await page.evaluate(() => window.__calls);
      assert.deepEqual(calls, ["done", "undo"], style + ": the cancelling tap plays the undo sound exactly once");
      await page.close();
    } finally { await env.close(); }
  }
});

// ---------------------------------------------------------------------------
// O1c: silent on open of a completed day, on reload, and with sound off
// ---------------------------------------------------------------------------
test("O1c: a completed day on open, a reload, and sound-off never create an AudioContext", { timeout: 300000 }, async (t) => {
  const on = await setup(t, { set: { snd: true }, init: ACOUNT, prog: { done: [1] } });
  if (!on) return;
  try {
    const page = await on.page(400, 900);
    await page.waitForFunction(() => typeof SND !== "undefined");
    await nav(page, "#/day/1");
    await page.waitForFunction((b) => !!document.querySelector(b), BTN, { timeout: 20000 });
    await page.waitForTimeout(600);
    const opened = await page.evaluate(() => window.__acn());
    assert.equal(opened, 0, "opening an already completed day plays nothing (no AudioContext)");

    await page.reload({ waitUntil: "load" });
    await page.evaluate(() => { location.hash = "#/day/1"; });
    await page.waitForFunction((b) => !!document.querySelector(b), BTN, { timeout: 20000 });
    await page.waitForTimeout(400);
    const reloaded = await page.evaluate(() => window.__acn());
    assert.equal(reloaded, 0, "reloading plays nothing (no AudioContext)");
    await page.close();
  } finally { await on.close(); }

  const off = await setup(t, { set: { snd: false }, init: ACOUNT });
  if (!off) return;
  try {
    const page = await off.page(400, 900);
    await page.waitForFunction(() => typeof SND !== "undefined");
    await nav(page, "#/day/1");
    await page.waitForFunction(() => document.querySelectorAll("#dw .dcard").length > 0, null, { timeout: 20000 });
    await page.evaluate(() => { document.querySelectorAll("#dw .dcard").forEach((c) => c.click()); });
    await page.waitForFunction((b) => { const e = document.querySelector(b); return e && !e.disabled; }, BTN, { timeout: 15000 });
    await page.click(BTN);
    await page.waitForTimeout(300);
    const n = await page.evaluate(() => window.__acn());
    assert.equal(n, 0, "sound off: the tap changes the state but creates no AudioContext");
    const state = await page.evaluate(() => JSON.parse(localStorage.getItem("gq-prog") || '{"done":[]}'));
    assert.ok(Array.isArray(state.done) && state.done.indexOf(1) >= 0, "sound off still completes the day");
    await page.close();
  } finally { await off.close(); }
});
