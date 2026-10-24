"use strict";
/*
 * phase-c.test.js - Phase C acceptance (fixes + roulette + multi-word day + sounds).
 *
 * Loads the real public/index.html in Chromium and checks real behaviour from the
 * DOM / computed styles. ASCII only (no Arabic literals), so no new Arabic runs
 * reach the arabic-guard baseline. Each test skips cleanly when Chromium is
 * unavailable.
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
      await page.emulateMedia({ colorScheme: opts.colorScheme || "light", reducedMotion: opts.reducedMotion || "no-preference" });
      let content =
        "window.__WORDS__=" + words + ";window.__CH__=" + JSON.stringify(chObj) + ";" +
        "try{localStorage.setItem('gq-set',JSON.stringify(" + JSON.stringify(set) + "))}catch(e){}";
      if (prog) content += "try{localStorage.setItem('gq-prog',JSON.stringify(" + JSON.stringify(prog) + "))}catch(e){}";
      if (opts.init) content += opts.init;
      await page.addInitScript({ content });
      await page.goto(base + "/index.html", { waitUntil: "load" });
      await page.waitForSelector("#app .acts, #app .card, #app .list, #app header", { timeout: 20000 });
      return page;
    },
    async close() { await browser.close(); await new Promise((r) => server.close(r)); },
  };
  return api;
}

function nav(page, hash) { return page.evaluate((h) => { location.hash = h; }, hash); }

// ---------------------------------------------------------------------------
// F1: settings gear sits just outside the content column on desktop only
// ---------------------------------------------------------------------------
test("F1: desktop gear is inset outside the content column and unchanged on mobile", { timeout: 120000 }, async (t) => {
  const env = await setup(t);
  if (!env) return;
  try {
    const page = await env.page(1440, 900);
    await page.waitForSelector('#gear', { timeout: 20000 });
    const desk = await page.evaluate(() => {
      const g = document.querySelector('#gear');
      const wrap = document.querySelector('#app');
      const gb = g.getBoundingClientRect(), wb = wrap.getBoundingClientRect();
      const overlap = !(gb.right <= wb.left || gb.left >= wb.right || gb.bottom <= wb.top || gb.top >= wb.bottom);
      return {
        pos: getComputedStyle(g).position,
        gapEnd: wb.left - gb.left,           // RTL: inline-end side is the left
        overlap,
        visTop: gb.top, visBottom: gb.bottom,
      };
    });
    assert.equal(desk.pos, "fixed", "gear stays position:fixed");
    assert.ok(!desk.overlap, "gear does not intersect the content column");
    assert.ok(desk.gapEnd >= 0 && desk.gapEnd <= 72, "inline-end gap to the column is 0..72px (got " + desk.gapEnd.toFixed(1) + ")");

    const mob = await env.page(400, 800);
    await mob.waitForSelector('#gear', { timeout: 20000 });
    const m = await mob.evaluate(() => {
      const g = document.querySelector('#gear');
      const r = g.getBoundingClientRect();
      return { left: r.left, pos: getComputedStyle(g).position };
    });
    assert.equal(m.pos, "fixed", "mobile gear stays fixed");
    assert.ok(Math.abs(m.left - 16) < 1.5, "mobile gear keeps its 16px edge offset (got " + m.left.toFixed(1) + ")");
  } finally { await env.close(); }
});

// ---------------------------------------------------------------------------
// F2: word-page previous/next share one structure (icon above text on desktop)
// ---------------------------------------------------------------------------
test("F2: prev/next stack icon above text on desktop and share a height", { timeout: 120000 }, async (t) => {
  const env = await setup(t);
  if (!env) return;
  try {
    const page = await env.page(1440, 900);
    await nav(page, "#/word/78-0");
    await page.waitForSelector("#app .cw .pnb.pv", { timeout: 20000 });
    const r = await page.evaluate(() => {
      const rect = (b) => ({ top: b.top, bottom: b.bottom, left: b.left, right: b.right, h: b.height });
      const el = (s) => document.querySelector(s);
      const svgR = (e) => { const s = e.querySelector("svg"); return s ? rect(s.getBoundingClientRect()) : null; };
      const textR = (e) => {
        const tn = [...e.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
        if (!tn) return null;
        const s = tn.textContent, a = s.search(/\S/), b = s.replace(/\s+$/, "").length;
        const rng = document.createRange(); rng.setStart(tn, a); rng.setEnd(tn, b);
        return rect(rng.getBoundingClientRect());
      };
      const d = (e) => { const p = e.querySelector("path"); return p ? (p.getAttribute("d") || "") : ""; };
      const out = {};
      for (const k of ["pv", "nx"]) {
        const e = el("#app .cw .pnb." + k);
        const s = svgR(e), tx = textR(e);
        out[k] = {
          h: e.getBoundingClientRect().height,
          flex: getComputedStyle(e).flexDirection,
          svg: s, text: tx,
          iconAbove: !!(s && tx) && s.bottom <= tx.top + 2,
          d: d(e),
        };
      }
      return out;
    });
    assert.ok(r.pv.iconAbove, "previous icon sits above its text");
    assert.ok(r.nx.iconAbove, "next icon sits above its text");
    assert.equal(r.pv.flex, "column", "previous stacks in a column");
    assert.equal(r.nx.flex, "column-reverse", "next stacks in a reversed column (same look)");
    assert.ok(Math.abs(r.pv.h - r.nx.h) < 0.5, "both controls share a height (" + r.pv.h + " vs " + r.nx.h + ")");
    assert.ok(r.pv.h >= 44 && r.nx.h >= 44, "controls keep a >=44px touch target");
    assert.ok(r.pv.d.indexOf("M9 5l7 7") >= 0, "previous chevron points right");
    assert.ok(r.nx.d.indexOf("M15 5l-7 7") >= 0, "next chevron points left");

    const mob = await env.page(400, 800);
    await nav(mob, "#/word/78-0");
    await mob.waitForSelector("#app .cw .pnb.pv", { timeout: 20000 });
    const mf = await mob.evaluate(() => ({
      pv: getComputedStyle(document.querySelector("#app .cw .pnb.pv")).flexDirection,
      nx: getComputedStyle(document.querySelector("#app .cw .pnb.nx")).flexDirection,
    }));
    assert.equal(mf.pv, "row", "mobile previous stays a row");
    assert.equal(mf.nx, "row", "mobile next stays a row");
  } finally { await env.close(); }
});

// ---------------------------------------------------------------------------
// F3: filled draw button inverts with its outlined siblings on hover
// ---------------------------------------------------------------------------
const probeBg = (page, name) => page.evaluate((v) => {
  const d = document.createElement("div");
  d.style.position = "absolute"; d.style.left = "-9999px"; d.style.background = "var(" + v + ")";
  document.body.appendChild(d);
  const c = getComputedStyle(d).backgroundColor; d.remove(); return c;
}, name);

test("F3: glass buttons never change colour on hover (filled swaps its shadow, outlined gets the generic shadow); every shade button inverts", { timeout: 120000 }, async (t) => {
  const env = await setup(t);
  if (!env) return;
  try {
    const page = await env.page(1440, 900);
    await page.waitForSelector('#app [data-a="rnd"]', { timeout: 20000 });
    const accent = await probeBg(page, "--ac");
    const filled0 = await page.$eval('#app [data-a="rnd"]', (e) => ({ bg: getComputedStyle(e).backgroundColor, tr: getComputedStyle(e).transform, sh: getComputedStyle(e).boxShadow }));
    await page.hover('#app [data-a="rnd"]');
    await page.waitForTimeout(340);
    const filled1 = await page.$eval('#app [data-a="rnd"]', (e) => ({ bg: getComputedStyle(e).backgroundColor, tr: getComputedStyle(e).transform, sh: getComputedStyle(e).boxShadow }));
    assert.equal(filled1.bg, filled0.bg, "the glass filled draw button keeps its background");
    assert.equal(filled1.tr, filled0.tr, "the glass filled draw button does not move");
    assert.notEqual(filled1.sh, filled0.sh, "the glass filled draw button swaps only its shadow");

    const olSel = '#app .acts .btn.o';
    const ol0 = await page.$eval(olSel, (e) => ({ bg: getComputedStyle(e).backgroundColor, sh: getComputedStyle(e).boxShadow }));
    await page.hover(olSel);
    await page.waitForTimeout(340);
    const ol1 = await page.$eval(olSel, (e) => ({ bg: getComputedStyle(e).backgroundColor, sh: getComputedStyle(e).boxShadow }));
    assert.equal(ol1.bg, ol0.bg, "hovering the outlined sibling keeps its background (no inversion)");
    assert.notEqual(ol1.bg, accent, "the outlined button does not invert to the accent fill");
    assert.notEqual(ol1.sh, ol0.sh, "hovering the outlined sibling adds the generic hover shadow");
    assert.ok(/inset/.test(ol1.sh), "the outlined hover shadow is the generic rim + glow");
  } finally { await env.close(); }

  const shade = await setup(t, { set: { style: "shade" } });
  if (!shade) return;
  try {
    const page = await shade.page(1440, 900);
    await page.waitForSelector('#app [data-a="rnd"]', { timeout: 20000 });
    const tx = await probeBg(page, "--tx");
    const bg = await probeBg(page, "--bg");
    const f0 = await page.$eval('#app [data-a="rnd"]', (e) => getComputedStyle(e).backgroundColor);
    await page.hover('#app [data-a="rnd"]');
    await page.waitForTimeout(340);
    const f1 = await page.$eval('#app [data-a="rnd"]', (e) => getComputedStyle(e).backgroundColor);
    assert.notEqual(f1, f0, "shade: filled button inverts on hover");
    const oSel = '#app .acts .btn.o';
    const o0 = await page.$eval(oSel, (e) => ({ bg: getComputedStyle(e).backgroundColor, c: getComputedStyle(e).color, sh: getComputedStyle(e).boxShadow }));
    await page.hover(oSel);
    await page.waitForTimeout(340);
    const o1 = await page.$eval(oSel, (e) => ({ bg: getComputedStyle(e).backgroundColor, c: getComputedStyle(e).color, sh: getComputedStyle(e).boxShadow }));
    assert.notEqual(o1.sh, o0.sh, "shade: outlined button gets the generic hover shadow");
    assert.equal(o1.bg, tx, "shade: outlined sibling inverts to the filled surface");
    assert.equal(o1.c, bg, "shade: outlined sibling's text inverts to the page background colour");
  } finally { await shade.close(); }

  const rmv = await setup(t, { reducedMotion: "reduce" });
  if (!rmv) return;
  try {
    const page = await rmv.page(1440, 900);
    await page.waitForSelector('#app [data-a="rnd"]', { timeout: 20000 });
    const b0 = await page.$eval('#app [data-a="rnd"]', (e) => getComputedStyle(e).backgroundColor);
    await page.hover('#app [data-a="rnd"]');
    await page.waitForTimeout(340);
    const r = await page.$eval('#app [data-a="rnd"]', (e) => ({ bg: getComputedStyle(e).backgroundColor, tr: getComputedStyle(e).transform }));
    assert.equal(r.tr, "none", "reduced motion keeps colour, drops the transform");
    assert.equal(r.bg, b0, "the glass filled draw button keeps its colour under reduced motion");
  } finally { await rmv.close(); }
});

// ---------------------------------------------------------------------------
// F4: social card gets a shadow on hover without moving
// ---------------------------------------------------------------------------
test("F4: the social strip container has no hover effect and never moves; the icon glow stays intact", { timeout: 120000 }, async (t) => {
  const env = await setup(t);
  if (!env) return;
  try {
    const page = await env.page(1440, 900);
    await page.waitForSelector("#app .strip", { timeout: 20000 });
    const sh0 = await page.$eval("#app .strip", (e) => getComputedStyle(e).boxShadow);
    await page.hover("#app .strip");
    await page.waitForTimeout(420);
    const s = await page.$eval("#app .strip", (e) => ({ sh: getComputedStyle(e).boxShadow, tr: getComputedStyle(e).transform }));
    assert.equal(s.sh, sh0, "the non-clickable social card has no hover shadow");
    assert.equal(s.tr, "none", "the social card never moves on hover");

    // the icon hover (unchanged) still reveals its disc
    await page.hover("#app .so");
    await page.waitForTimeout(150);
    const op = await page.$eval("#app .so", (e) => getComputedStyle(e, "::before").opacity);
    assert.ok(parseFloat(op) > 0.9, "social icon hover disc is still intact");
  } finally { await env.close(); }

  const shade = await setup(t, { set: { style: "shade" } });
  if (!shade) return;
  try {
    const page = await shade.page(1440, 900);
    await page.waitForSelector("#app .strip", { timeout: 20000 });
    const b0 = await page.$eval("#app .strip", (e) => getComputedStyle(e).boxShadow);
    await page.hover("#app .strip");
    await page.waitForTimeout(420);
    const s = await page.$eval("#app .strip", (e) => ({ sh: getComputedStyle(e).boxShadow, tr: getComputedStyle(e).transform }));
    assert.equal(s.sh, b0, "shade: the non-clickable social card has no hover shadow");
    assert.equal(s.tr, "none", "shade: the card never moves");
  } finally { await shade.close(); }
});

// ---------------------------------------------------------------------------
// F5: shade header tagline and counts line do not overlap
// ---------------------------------------------------------------------------
test("F5: shade header lines get line-height >=1.5 and an 8px gap at 3 widths", { timeout: 120000 }, async (t) => {
  const env = await setup(t, { set: { style: "shade" } });
  if (!env) return;
  try {
    const page = await env.page(390, 844);
    await page.waitForSelector("#app h1", { timeout: 20000 });
    for (const w of [400, 820, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(80);
      const r = await page.evaluate(() => {
        const h1 = document.querySelector("#app h1");
        const sub = h1.nextElementSibling;
        const ch = getComputedStyle(h1), cs = getComputedStyle(sub);
        const hb = h1.getBoundingClientRect(), sb = sub.getBoundingClientRect();
        return {
          h1Bottom: hb.bottom, subTop: sb.top,
          hLine: parseFloat(ch.lineHeight), hFont: parseFloat(ch.fontSize),
          sLine: parseFloat(cs.lineHeight), sFont: parseFloat(cs.fontSize),
          subIsSub: sub.classList.contains("sub"),
        };
      });
      assert.ok(r.subIsSub, "@" + w + ": the tagline is followed by the counts line");
      assert.ok(r.hLine >= 1.5 * r.hFont - 0.5, "@" + w + ": tagline line-height >=1.5");
      assert.ok(r.sLine >= 1.5 * r.sFont - 0.5, "@" + w + ": counts line-height >=1.5");
      assert.ok(r.subTop - r.h1Bottom >= 6, "@" + w + ": lines are separated by ~8px (got " + (r.subTop - r.h1Bottom).toFixed(1) + ")");
      assert.ok(!(r.h1Bottom > r.subTop), "@" + w + ": the two header lines do not intersect");
    }
  } finally { await env.close(); }
});

// ---------------------------------------------------------------------------
// C1: roulette overlay for the draw buttons
// ---------------------------------------------------------------------------
test("C1: draw opens a reel overlay; skip lands on a word route; reduced-motion is quick", { timeout: 120000 }, async (t) => {
  const env = await setup(t, { set: { snd: true } });
  if (!env) return;
  try {
    const page = await env.page(1440, 900);
    await nav(page, "#/word/78-0");
    await page.waitForSelector('#app [data-a="rnd"]', { timeout: 20000 });
    const prev = await page.evaluate(() => location.hash);
    await page.click('#app [data-a="rnd"]');
    await page.waitForSelector("#rou", { timeout: 5000 });
    const ov = await page.evaluate(() => {
      const rows = document.querySelectorAll("#rou .reel .reelrow");
      const skip = document.querySelector("#rou [data-a=\"rskip\"]");
      return {
        rows: rows.length,
        card: !!document.querySelector("#rou .roucard"),
        soundLine: !!document.querySelector("#rou .rousnd"),
        skipLast: skip && skip.lastElementChild ? skip.lastElementChild.tagName.toLowerCase() : null,
        skipMoved: skip ? (skip.lastElementChild.getAttribute("style") || "").indexOf("scaleX(-1)") >= 0 : false,
      };
    });
    assert.ok(ov.card, "roulette shows a card");
    assert.ok(ov.rows >= 8, "the reel has a vertical run of words (" + ov.rows + ")");
    assert.ok(ov.soundLine, "the sound hint shows while sound is on");
    assert.equal(ov.skipLast, "svg", "the skip icon is at the end of the button");
    assert.ok(ov.skipMoved, "the skip icon is mirrored (scaleX(-1))");

    await page.click('#rou [data-a="rskip"]');
    await page.waitForFunction((p) => location.hash !== p && /^#\/word\/.+/.test(location.hash), prev, { timeout: 5000 });
    await page.waitForSelector("#app .wd.q", { timeout: 5000 });
    const hash = await page.evaluate(() => location.hash);
    assert.ok(/^#\/word\/[\w-]+$/.test(hash), "skip lands on a word route (" + hash + ")");
    assert.notEqual(hash, prev, "the chosen word differs from the one we came from");
    assert.equal(await page.$("#rou"), null, "the overlay is dismissed after the pick");
  } finally { await env.close(); }

  const rm = await setup(t, { reducedMotion: "reduce" });
  if (!rm) return;
  try {
    const page = await rm.page(1440, 900);
    await nav(page, "#/word/78-0");
    await page.waitForSelector('#app [data-a="rnd"]', { timeout: 20000 });
    const prev2 = await page.evaluate(() => location.hash);
    const t0 = Date.now();
    await page.click('#app [data-a="rnd"]');
    await page.waitForFunction((p) => location.hash !== p && /^#\/word\/.+/.test(location.hash), prev2, { timeout: 3000 });
    const ms = Date.now() - t0;
    assert.ok(ms <= 500, "reduced motion resolves to the result in <=500ms (got " + ms + "ms)");
    assert.equal(await page.$("#rou"), null, "no lingering overlay under reduced motion");
  } finally { await rm.close(); }
});

// ---------------------------------------------------------------------------
// C2: multi-word day reveals one card at a time; a one-word day shows one card
// ---------------------------------------------------------------------------
const DAYSNAP = `(() => {
  const dw = document.querySelector('#dw');
  const cards = [...document.querySelectorAll('#dw .dcard')];
  const cnt = document.querySelector('#dw .dcount') || document.querySelector('.dcount');
  return {
    dwVisible: !!dw && getComputedStyle(dw).display !== 'none',
    cards: cards.length,
    open: cards.filter((c) => c.classList.contains('open')).length,
    done: cards.filter((c) => c.classList.contains('done')).length,
    lk: cards.filter((c) => c.classList.contains('lk')).length,
    openIdx: cards.findIndex((c) => c.classList.contains('open')),
    k: cnt ? cnt.dataset.k : null,
    m: cnt ? cnt.dataset.mtot : null,
    dnext: !!document.querySelector('#dw [data-a="dnext"]'),
    doneBtn: !!document.querySelector('#dw [data-a="done"]'),
  };
})()`;

test("C2: the day screen stacks rising word cards, and reduced motion keeps them still", { timeout: 120000 }, async (t) => {
  const rm = await setup(t, { reducedMotion: "reduce" });
  if (!rm) return;
  try {
    const page = await rm.page(390, 844);
    await nav(page, "#/day/1");
    await page.waitForSelector("#dw .dcard", { timeout: 20000 });
    const s0 = await page.evaluate(DAYSNAP);
    assert.ok(s0.dwVisible, "the day content is shown (no roulette gate)");
    assert.equal(s0.cards, 3, "a 3-word day renders 3 stacked cards");
    assert.equal(s0.open, 0, "the cards start collapsed");
    assert.equal(s0.k, "0", "the counter starts at 0");
    assert.equal(s0.m, "3", "the counter knows the total");
    assert.ok(!s0.dnext, "there is no next button on the stacked day screen");
    assert.equal(await page.$("#rou"), null, "there is no roulette overlay on the day screen");
    const names = await page.evaluate(() => [...document.querySelectorAll("#dw .dcard")].map((c) => getComputedStyle(c).animationName));
    assert.ok(names.every((n) => n === "none"), "reduced motion drops the rise animation");

    await page.locator("#dw .dcard").nth(0).click();
    const s1 = await page.evaluate(DAYSNAP);
    assert.equal(s1.open, 1, "tapping a card opens it");
    assert.equal(s1.k, "1", "the counter counts the opened card");
    await page.locator("#dw .dcard").nth(1).click();
    const s2 = await page.evaluate(DAYSNAP);
    assert.equal(s2.open, 2, "a second card can be open at the same time");
    assert.equal(s2.k, "2", "the counter counts distinct opened cards");
  } finally { await rm.close(); }

  // rise animation present (and delay staggered) when motion is allowed
  const anim = await setup(t, {});
  if (!anim) return;
  try {
    const page = await anim.page(390, 844);
    await nav(page, "#/day/1");
    await page.waitForSelector("#dw .dcard", { timeout: 20000 });
    const a = await page.evaluate(() => {
      const cs = [...document.querySelectorAll("#dw .dcard")].map((c) => ({
        name: getComputedStyle(c).animationName,
        delay: getComputedStyle(c).animationDelay,
      }));
      return cs;
    });
    assert.ok(a.length >= 2 && a.every((x) => x.name === "rise"), "cards rise into view");
    assert.ok(a.some((x) => parseFloat(x.delay) > 0), "later cards are staggered");
  } finally { await anim.close(); }
});

// ---------------------------------------------------------------------------
// C3: theme-aware audio cues, silent (and no AudioContext) when sound is off
// ---------------------------------------------------------------------------
const AUDIO_STUB =
  "(function(){window.__AU=[];window.__AUC=0;window.__AUR=0;" +
  "function G(){this.gain={value:0,setValueAtTime:function(){},linearRampToValueAtTime:function(){},exponentialRampToValueAtTime:function(){},setTargetAtTime:function(){}};}" +
  "function O(){this.type='sine';this.frequency={value:0};this.startAt=0;this.stopAt=0;window.__AU.push(this);}" +
  "O.prototype.connect=function(){};O.prototype.start=function(t){this.startAt=t||0;};O.prototype.stop=function(t){this.stopAt=t||0;};" +
  "G.prototype.connect=function(){};" +
  "function C(){window.__AUC++;this.currentTime=0;this.state='running';this.destination={};}" +
  "C.prototype.createOscillator=function(){return new O();};" +
  "C.prototype.createGain=function(){return new G();};" +
  "C.prototype.resume=function(){window.__AUR++;this.state='running';return Promise.resolve();};" +
  "window.AudioContext=C;window.webkitAudioContext=C;})();";

async function clickCorrect(page) {
  await nav(page, "#/");
  await nav(page, "#/quiz");
  await page.waitForSelector("#app .opt", { timeout: 5000 });
  await page.evaluate(() => { window.__AU.length = 0; window.__AUC = 0; window.__AUR = 0; });
  const ci = await page.evaluate(() => { try { const q = Q.qs[Q.i]; return q.o.indexOf(q.w); } catch (e) { return -1; } });
  assert.ok(ci >= 0, "resolved the correct option index");
  await page.click('#app .opt[data-o="' + ci + '"]');
  await page.waitForSelector("#app .opt.ok", { timeout: 3000 });
  return page.$eval('#app .opt[data-o="' + ci + '"]', (e) => e.classList.contains("ok"));
}
const OSCS = "window.__AU.map(function(o){return {type:o.type,f:o.frequency.value,len:o.stopAt-o.startAt}})";

test("C3: correct answer plays a theme-aware cue; sound off stays silent", { timeout: 120000 }, async (t) => {
  const on = await setup(t, { set: { snd: true }, init: AUDIO_STUB });
  if (!on) return;
  try {
    const page = await on.page(390, 844);
    assert.ok(await clickCorrect(page), "found a correct quiz answer");
    const g = await page.evaluate(OSCS);
    assert.ok(g.some((o) => o.type === "sine" && o.f === 660) && g.some((o) => o.type === "sine" && o.f === 880),
      "glass correct cue uses two soft sine notes (got " + JSON.stringify(g) + ")");
    assert.ok(g.every((o) => o.len <= 0.3), "each note stays short");

    await nav(page, "#/");
    await page.waitForSelector('#app [data-a="rnd"]', { timeout: 10000 });
    await page.evaluate(() => { window.__AU.length = 0; });
    await page.click('#app [data-a="rnd"]');
    await page.waitForTimeout(220);
    const reel = await page.evaluate(OSCS);
    assert.ok(reel.some((o) => o.f === 1400), "the roulette ticks while it spins");
  } finally { await on.close(); }

  const onS = await setup(t, { set: { snd: true, style: "shade" }, init: AUDIO_STUB });
  if (!onS) return;
  try {
    const page = await onS.page(390, 844);
    assert.ok(await clickCorrect(page), "found a correct quiz answer (shade)");
    const s = await page.evaluate(OSCS);
    assert.ok(s.some((o) => o.type === "triangle" && o.f === 440) && s.some((o) => o.type === "triangle" && o.f === 587),
      "shade correct cue is a different (triangle) pair (got " + JSON.stringify(s) + ")");
  } finally { await onS.close(); }

  const off = await setup(t, { set: { snd: false }, init: AUDIO_STUB });
  if (!off) return;
  try {
    const page = await off.page(390, 844);
    for (let pick = 0; pick < 4; pick++) {
      await nav(page, "#/");
      await nav(page, "#/quiz");
      await page.waitForSelector("#app .opt", { timeout: 5000 });
      await page.click('#app .opt[data-o="' + pick + '"]');
      await page.waitForSelector("#app .opt.ok", { timeout: 3000 });
    }
    const r = await page.evaluate(() => ({ c: window.__AUC, r: window.__AUR, n: window.__AU.length }));
    assert.equal(r.c, 0, "sound off: no AudioContext is ever created");
    assert.equal(r.r, 0, "sound off: nothing is resumed");
    assert.equal(r.n, 0, "sound off: no tone is scheduled");
  } finally { await off.close(); }
});
