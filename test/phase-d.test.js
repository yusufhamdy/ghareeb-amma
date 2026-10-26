"use strict";
/*
 * phase-d.test.js - Phase D acceptance (glass draw hover, no button jump,
 * collapsible day cards, navigation flash, admin dialog/icons, favicon, share).
 *
 * Loads the real public/ files in Chromium and checks real behaviour from the
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
    async page(width, height, extra) {
      const page = await browser.newPage({ viewport: { width: width || 390, height: height || 844 } });
      await page.emulateMedia({ colorScheme: opts.colorScheme || "light", reducedMotion: opts.reducedMotion || "no-preference" });
      let content =
        "window.__WORDS__=" + words + ";window.__CH__=" + JSON.stringify(chObj) + ";" +
        "try{localStorage.setItem('gq-set',JSON.stringify(" + JSON.stringify(set) + "))}catch(e){}";
      if (prog) content += "try{localStorage.setItem('gq-prog',JSON.stringify(" + JSON.stringify(prog) + "))}catch(e){}";
      if (opts.init) content += opts.init;
      await page.addInitScript({ content });
      if (opts.route) await opts.route(page);
      await page.goto(base + "/" + (opts.html || "index.html"), { waitUntil: "load" });
      return page;
    },
    async close() { await browser.close(); await new Promise((r) => server.close(r)); },
  };
  return api;
}

function nav(page, hash) { return page.evaluate((h) => { location.hash = h; }, hash); }

// Read the computed style of one element matched by a selector.
function cs(page, sel, props) {
  return page.evaluate(([s, ps]) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const c = getComputedStyle(el);
    const o = {}; ps.forEach((p) => { o[p] = c.getPropertyValue(p); }); return o;
  }, [sel, props]);
}

// ---------------------------------------------------------------------------
// D1: glass draw button keeps its fill and gains a rim/glow on hover
// ---------------------------------------------------------------------------
test("D1: glass filled draw button keeps its background and changes its shadow; shade still inverts", { timeout: 120000 }, async (t) => {
  const env = await setup(t, { set: { style: "glass", mode: "light" } });
  if (!env) return;
  try {
    const page = await env.page(390, 844);
    await nav(page, "#/");
    await page.waitForSelector('#app .acts [data-a="rnd"]', { timeout: 20000 });
    const sel = '#app .acts [data-a="rnd"]';
    const before = await cs(page, sel, ["background-color", "box-shadow"]);
    await page.hover(sel);
    await page.waitForTimeout(400);
    const after = await cs(page, sel, ["background-color", "box-shadow"]);
    assert.equal(after["background-color"], before["background-color"], "glass filled button keeps its background on hover");
    assert.notEqual(after["box-shadow"], before["box-shadow"], "glass filled button gains a hover box-shadow");
    assert.ok(/inset/.test(after["box-shadow"]), "the hover shadow is an inner rim + glow");
  } finally { await env.close(); }

  const envS = await setup(t, { set: { style: "shade", mode: "light" } });
  if (!envS) return;
  try {
    const page = await envS.page(390, 844);
    await nav(page, "#/");
    await page.waitForSelector('#app .acts [data-a="rnd"]', { timeout: 20000 });
    const sel = '#app .acts [data-a="rnd"]';
    const before = await cs(page, sel, ["background-color"]);
    await page.hover(sel);
    await page.waitForTimeout(400);
    const after = await cs(page, sel, ["background-color"]);
    assert.notEqual(after["background-color"], before["background-color"], "shade filled button still inverts (background changes) on hover");
  } finally { await envS.close(); }
});

// ---------------------------------------------------------------------------
// D2: buttons never move on hover; cards keep their very light lift
// ---------------------------------------------------------------------------
test("D2: buttons keep transform none on hover in both themes; a result card still lifts", { timeout: 120000 }, async (t) => {
  for (const style of ["glass", "shade"]) {
    const env = await setup(t, { set: { style, mode: "light" } });
    if (!env) return;
    try {
      const page = await env.page(390, 844);
      await nav(page, "#/");
      await page.waitForSelector('#app .acts .btn[data-a="rnd"]', { timeout: 20000 });
      await page.hover('.acts .btn[data-a="rnd"]');
      await page.waitForTimeout(400);
      const filled = await cs(page, '.acts .btn[data-a="rnd"]', ["transform"]);
      assert.equal(filled.transform, "none", style + ": filled .btn does not move on hover");
      await page.hover(".acts .btn.o");
      await page.waitForTimeout(400);
      const outlined = await cs(page, ".acts .btn.o", ["transform"]);
      assert.equal(outlined.transform, "none", style + ": .btn.o does not move on hover");

      await nav(page, "#/surah/78");
      await page.waitForSelector("#app .list.rs a.row", { timeout: 20000 });
      const c1 = await cs(page, "#app .list.rs a.row", ["transform"]);
      await page.hover("#app .list.rs a.row");
      await page.waitForTimeout(400);
      const c2 = await cs(page, "#app .list.rs a.row", ["transform"]);
      assert.notEqual(c2.transform, c1.transform, style + ": a result card still changes transform on hover");
    } finally { await env.close(); }
  }
});

// ---------------------------------------------------------------------------
// D3: challenge day cards - stacked, collapsible, progress by opened cards
// ---------------------------------------------------------------------------
const cnt = (page) => page.locator("#dw .dcard").count();
const kOf = (page) => page.getAttribute(".dcount", "data-k");
const isOpen = (page, i) => page.locator("#dw .dcard").nth(i).evaluate((el) => el.classList.contains("open"));

test("D3: day cards - one-word open, three collapsed, tap opens, counter, completion, persistence", { timeout: 120000 }, async (t) => {
  const env = await setup(t, {});
  if (!env) return;
  try {
    const page = await env.page(390, 844);

    // 3-word day (day 1): three collapsed cards, no overlay, no next button.
    await nav(page, "#/day/1");
    await page.waitForSelector("#dw .dcard", { timeout: 20000 });
    assert.equal(await cnt(page), 3, "3-word day shows 3 cards");
    for (let i = 0; i < 3; i++) {
      assert.equal(await isOpen(page, i), false, "card " + i + " is collapsed by default");
      assert.equal(await page.locator("#dw .dcard").nth(i).getAttribute("aria-expanded"), "false", "card " + i + " aria-expanded false");
    }
    await page.waitForTimeout(700);
    assert.equal(await page.locator("#rou").count(), 0, "no roulette overlay on the day screen");
    assert.equal(await page.locator('[data-a="dnext"]').count(), 0, "no next button on the day screen");
    assert.equal(await kOf(page), "0", "counter starts at 0");

    // Tap opens the verse + meaning; two can be open together.
    await page.locator("#dw .dcard").nth(0).click();
    assert.equal(await isOpen(page, 0), true, "first tap opens the card");
    assert.equal(await page.locator("#dw .dcard").nth(0).getAttribute("aria-expanded"), "true", "aria-expanded true when open");
    assert.equal(await page.locator("#dw .dcard").nth(0).locator(".dbody").isVisible(), true, "the meaning body is visible when open");
    assert.ok((await page.locator("#dw .dcard").nth(0).locator(".dbody").innerText()).trim().length > 0, "the open card shows content");
    assert.equal(await kOf(page), "1", "counter counts the opened card");

    await page.locator("#dw .dcard").nth(1).click();
    assert.equal(await isOpen(page, 0), true, "card 0 still open");
    assert.equal(await isOpen(page, 1), true, "card 1 open too (two open together)");
    assert.equal(await kOf(page), "2", "counter counts distinct opened cards");

    // Closing keeps the count (a word counts once opened).
    await page.locator("#dw .dcard").nth(0).click();
    assert.equal(await isOpen(page, 0), false, "tapping again closes the card");
    assert.equal(await kOf(page), "2", "counter keeps the once-opened count after closing");

    // Completion only after all are opened.
    assert.equal(await page.locator('[data-a="done"]').isDisabled(), true, "day cannot be completed before all cards are opened");
    await page.locator("#dw .dcard").nth(2).click();
    assert.equal(await kOf(page), "3", "all three counted once opened");
    assert.equal(await page.locator('[data-a="done"]').isDisabled(), false, "day can be completed once all cards are opened");
    await page.locator('[data-a="done"]').click();
    const doneList = await page.evaluate(() => (JSON.parse(localStorage.getItem("gq-prog")) || {}).done || []);
    assert.ok(doneList.includes(1), "day 1 is recorded as done");

    // State survives a reload: progress persists, cards are collapsed again.
    await page.reload({ waitUntil: "load" });
    await nav(page, "#/day/1");
    await page.waitForSelector("#dw .dcard", { timeout: 20000 });
    assert.equal(await kOf(page), "3", "opened count survives reload");
    assert.equal(await isOpen(page, 0), false, "cards are collapsed again after reload");

    // One-word day (day 2): one card already open, no overlay, no next.
    await nav(page, "#/day/2");
    await page.waitForSelector("#dw .dcard", { timeout: 20000 });
    assert.equal(await cnt(page), 1, "one-word day shows a single card");
    assert.equal(await isOpen(page, 0), true, "the single card is already open");
    assert.equal(await kOf(page), "1", "a one-word day counts as opened on view");
    await page.waitForTimeout(400);
    assert.equal(await page.locator("#rou").count(), 0, "no roulette overlay on a one-word day");
    assert.equal(await page.locator('[data-a="dnext"]').count(), 0, "no next button on a one-word day");
  } finally { await env.close(); }
});

// ---------------------------------------------------------------------------
// D4: no washed-out flash on navigation (page entrance must not fade)
// ---------------------------------------------------------------------------
async function sampleNav(page, hash, sel) {
  await page.evaluate(({ hash, sel }) => {
    const eff = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { o *= parseFloat(getComputedStyle(n).opacity) || 0; } return o; };
    window.__s = []; const t0 = performance.now();
    const raf = () => {
      const el = document.querySelector(sel); const c = el ? getComputedStyle(el) : null;
      const ac = getComputedStyle(document.querySelector("#app")); const bc = getComputedStyle(document.body);
      window.__s.push({ t: performance.now() - t0, eo: el ? eff(el) : null, ao: +ac.opacity, bo: +bc.opacity, cb: c ? c.backgroundColor : null, cbd: c ? c.backdropFilter : null });
      if (performance.now() - t0 < 520) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf); location.hash = hash;
  }, { hash, sel });
  await page.waitForTimeout(570);
  return page.evaluate(() => window.__s);
}
function near(samples, tt) { return samples.reduce((a, b) => (Math.abs(b.t - tt) < Math.abs(a.t - tt) ? b : a), samples[0]); }

test("D4: navigating between routes never fades the new page (all themes)", { timeout: 180000 }, async (t) => {
  const combos = [["glass", "light", 390], ["glass", "dark", 390], ["shade", "light", 1440], ["shade", "dark", 1440]];
  for (const [style, mode, w] of combos) {
    const env = await setup(t, { set: { style, mode } });
    if (!env) return;
    try {
      const page = await env.page(w, 900);
      const routes = [
        { hash: "#/surah/78", sel: "#app .list.rs a.row" },
        { hash: "#/word/78-0", sel: "#app .acts.v3" },
        { hash: "#/challenge", sel: "#app .cg .dy" },
      ];
      // First load on home: the first card must already be at final look.
      const load = await cs(page, "#app .sb", ["opacity"]);
      assert.ok(load && parseFloat(load.opacity) >= 0.98, style + "/" + mode + ": first load is not faded");

      for (const r of routes) {
        const samples = await sampleNav(page, r.hash, r.sel);
        const last = samples[samples.length - 1];
        const seen = samples.filter((s) => s.eo != null);
        assert.ok(seen.length > 0, style + "/" + mode + " " + r.hash + ": the new view was measured");
        for (const s of samples) {
          assert.ok(s.ao >= 0.98, style + "/" + mode + " " + r.hash + " t=" + Math.round(s.t) + ": #app opacity " + s.ao);
          assert.ok(s.bo >= 0.98, style + "/" + mode + " " + r.hash + " t=" + Math.round(s.t) + ": body opacity " + s.bo);
        }
        for (const s of seen) {
          assert.ok(s.eo >= 0.98, style + "/" + mode + " " + r.hash + " t=" + Math.round(s.t) + ": effective card opacity " + s.eo);
          assert.equal(s.cb, last.cb, style + "/" + mode + " " + r.hash + " t=" + Math.round(s.t) + ": card background is final");
          assert.equal(s.cbd, last.cbd, style + "/" + mode + " " + r.hash + " t=" + Math.round(s.t) + ": card backdrop-filter is final");
        }
        // spot-check the requested offsets
        for (const tt of [0, 50, 100, 200, 400]) {
          const s = near(seen, tt);
          assert.ok(s.eo >= 0.98, style + "/" + mode + " " + r.hash + " t~" + tt + ": effective card opacity " + s.eo);
        }
      }
    } finally { await env.close(); }
  }
});

// ---------------------------------------------------------------------------
// D5: admin polish - custom delete dialog, icons, no native confirm
// ---------------------------------------------------------------------------
const FB_STUB = [
  "export function initializeApp(cfg){return {cfg}}",
  "export function getAuth(app){return {app}}",
  "export function onAuthStateChanged(auth,cb){setTimeout(function(){cb(window.__TEST_USER__||null)},0)}",
  "export class GoogleAuthProvider{constructor(){this.kind='google'}}",
  "export function signInWithPopup(){return Promise.resolve()}",
  "export function signInWithRedirect(){return Promise.resolve()}",
  "export function signOut(){return Promise.resolve()}",
  "export function getFirestore(app){return {app}}",
  "export function serverTimestamp(){return 0}",
  "export function setDoc(){return Promise.resolve()}",
  "export function doc(db){var p=[];for(var i=1;i<arguments.length;i++)p.push(arguments[i]);return {path:p.join('/')}}",
  "export function getDoc(ref){var p=(ref&&ref.path)||'';if(p==='public/data')return Promise.resolve({exists:function(){return true},data:function(){return {rev:(window.__REV__||1),surahs:window.__TEST_SURAHS__||[]}}});return Promise.resolve({exists:function(){return false},data:function(){return {}}})}",
  "export function runTransaction(db,fn){var tx={get:function(){return Promise.resolve({exists:function(){return true},data:function(){return {rev:(window.__REV__||1),surahs:window.__TEST_SURAHS__||[]}}})},set:function(ref,val){window.__REV__=(val&&val.rev)||((window.__REV__||1)+1)}};return Promise.resolve(fn(tx)).then(function(){return 1})}",
].join("\n");
const stubRoute = async (page) => {
  await page.route("https://www.gstatic.com/firebasejs/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body: FB_STUB }));
};
const SR = "[{surah:'Surah',no:78,words:['w0','w1'],meanings:['w0: m','w1: m'],ayahs:[{label:'1',segments:[]},{label:'2',segments:[]}],source:'s'}]";
const T_WORD = "\u062d\u0630\u0641 \u0627\u0644\u0643\u0644\u0645\u0629 \u00abw0\u00bb\u061f";
const T_OTHER = "\u062d\u0630\u0641 \u0633\u0648\u0631\u0629 \u00abSurah\u00bb \u0648\u0643\u0644 \u0643\u0644\u0645\u0627\u062a\u0647\u0627\u061f";
const T_BODY = "\u062a\u064f\u062d\u0630\u0641 \u0627\u0644\u0643\u0644\u0645\u0629 \u0648\u0645\u0639\u0646\u0627\u0647\u0627 \u0648\u0622\u064a\u062a\u0647\u0627 \u0645\u0646 \u0633\u0648\u0631\u0629 Surah. \u064a\u0645\u0643\u0646\u0643 \u0627\u0644\u062a\u0631\u0627\u062c\u0639 \u0645\u0646 \u062a\u0628\u0648\u064a\u0628 \u00ab\u0623\u062f\u0648\u0627\u062a\u00bb \u0645\u0627 \u0644\u0645 \u062a\u062d\u0641\u0638 \u062a\u0639\u062f\u064a\u0644\u064b\u0627 \u0622\u062e\u0631 \u0628\u0639\u062f\u0647\u060c \u0648\u064a\u0638\u0647\u0631 \u0627\u0644\u062d\u0630\u0641 \u0639\u0644\u0649 \u0627\u0644\u0645\u0648\u0642\u0639 \u0628\u0639\u062f \u0627\u0644\u0646\u0634\u0631 \u0627\u0644\u062a\u0627\u0644\u064a.";
const mirrored = (tf) => /^matrix\(-1[, ]/.test(tf.replace(/\s+/g, " ").replace(/\(\s*/g, "("));

test("D5: admin uses a custom delete dialog and mirrored icons, never a native confirm", { timeout: 180000 }, async (t) => {
  const ownerInit = "window.__TEST_USER__={email:'yusufhamdy20@gmail.com',emailVerified:true};window.__TEST_SURAHS__=" + SR + ";";
  const env = await setup(t, { html: "admin/index.html", route: stubRoute, init: ownerInit });
  if (!env) return;
  try {
    const page = await env.page(1200, 900);
    let dialogs = 0;
    page.on("dialog", async (d) => { dialogs++; try { await d.dismiss(); } catch (e) {} });
    await page.waitForSelector("#app .top", { timeout: 25000 });

    // Logout icon: mirrored, first child of the header logout button.
    const outTag = await page.locator('[data-a="out"]').first().evaluate((el) => el.firstElementChild && el.firstElementChild.tagName);
    assert.equal(outTag, "svg", "logout icon sits at the start of the button");
    const outTf = await page.locator('[data-a="out"]').first().locator("svg").evaluate((el) => getComputedStyle(el).transform);
    assert.ok(mirrored(outTf), "logout icon carries scaleX(-1): " + outTf);

    // Row action buttons have icons and are at least 44px tall.
    await page.locator('[data-a="tab"][data-v="w"]').click();
    await page.waitForSelector('[data-a="delW"]', { timeout: 20000 });
    const h = await page.locator('[data-a="delW"]').first().evaluate((el) => el.getBoundingClientRect().height);
    assert.ok(h >= 44, "delete button is at least 44px tall: " + h);
    assert.equal(await page.locator('[data-a="delW"]').first().locator("svg").count(), 1, "delete button has an icon");
    assert.equal(await page.locator('[data-a="editW"]').first().locator("svg").count(), 1, "edit button has an icon");
    const rowsBefore = await page.locator("#app .card .row").count();

    // Open the custom dialog for a WORD delete.
    await page.locator('[data-a="delW"]').first().click();
    await page.waitForSelector("#cd.open", { timeout: 5000 });
    assert.equal(dialogs, 0, "no native dialog fired");
    assert.equal(await page.locator("#cd .cdt").innerText(), T_WORD, "word delete title");
    assert.equal(await page.locator("#cd .cdb").innerText(), T_BODY, "dialog body");
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(() => { const a = document.activeElement; return a && a.closest("[data-cd]") ? a.getAttribute("data-cd") : null; }), "no", "cancel is focused first");
    // Tab trap keeps focus inside.
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => { const a = document.activeElement; return a && a.closest("[data-cd]") ? a.getAttribute("data-cd") : null; }), "yes", "Tab moves to the destructive button");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => { const a = document.activeElement; return a && a.closest("[data-cd]") ? a.getAttribute("data-cd") : null; }), "no", "Tab wraps inside the dialog");
    // Cancel keeps the item and returns focus to the delete button.
    await page.locator('[data-cd="no"]').click();
    assert.equal(await page.locator("#cd").evaluate((el) => el.classList.contains("open")), false, "cancel closes the dialog");
    assert.equal(await page.locator("#app .card .row").count(), rowsBefore, "cancel keeps the word");
    assert.equal(await page.evaluate(() => { const a = document.activeElement; return a && a.getAttribute ? a.getAttribute("data-a") : null; }), "delW", "focus returns to the delete button");
    // Esc cancels too.
    await page.locator('[data-a="delW"]').first().click();
    await page.waitForSelector("#cd.open", { timeout: 5000 });
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("#cd").evaluate((el) => el.classList.contains("open")), false, "Esc closes the dialog");
    assert.equal(await page.locator("#app .card .row").count(), rowsBefore, "Esc keeps the word");
    // Confirm runs the existing handler exactly once.
    await page.locator('[data-a="delW"]').first().click();
    await page.waitForSelector("#cd.open", { timeout: 5000 });
    await page.locator('[data-cd="yes"]').click();
    await page.waitForTimeout(150);
    assert.equal(await page.locator("#app .card .row").count(), rowsBefore - 1, "confirm deletes the word");
    assert.equal(await page.locator("#cd").evaluate((el) => el.classList.contains("open")), false, "confirm closes the dialog");
    assert.equal(dialogs, 0, "still no native dialog");

    // Other item type title (surah delete), then confirm.
    await page.locator('[data-a="tab"][data-v="s"]').click();
    await page.waitForSelector('[data-a="delS"]', { timeout: 20000 });
    const sRows = await page.locator("#app .card .row").count();
    await page.locator('[data-a="delS"]').first().click();
    await page.waitForSelector("#cd.open", { timeout: 5000 });
    assert.equal(await page.locator("#cd .cdt").innerText(), T_OTHER, "other item delete title");
    await page.locator('[data-cd="yes"]').click();
    await page.waitForTimeout(150);
    assert.equal(await page.locator("#app .card .row").count(), sRows - 1, "confirm deletes the surah");
    assert.equal(dialogs, 0, "still no native dialog");

    // Wrapping layouts: no horizontal overflow at 400/820/1440.
    for (const w of [400, 820, 1440]) {
      await page.setViewportSize({ width: w, height: 900 });
      await page.waitForTimeout(50);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 1, "no horizontal overflow at " + w + "px (overflow " + over + ")");
    }
  } finally { await env.close(); }

  // Unauthorized screen: "open in site" link icon mirrored, at the END.
  const otherInit = "window.__TEST_USER__={email:'other@example.com',emailVerified:true};window.__TEST_SURAHS__=" + SR + ";";
  const envU = await setup(t, { html: "admin/index.html", route: stubRoute, init: otherInit });
  if (!envU) return;
  try {
    const page = await envU.page(390, 844);
    await page.waitForSelector('#app a[href="/"]', { timeout: 25000 });
    const link = page.locator('#app a[href="/"]');
    const lastTag = await link.evaluate((el) => el.lastElementChild && el.lastElementChild.tagName);
    assert.equal(lastTag, "svg", "open icon sits at the end of the link");
    const tf = await link.locator("svg").evaluate((el) => getComputedStyle(el).transform);
    assert.ok(mirrored(tf), "open icon carries scaleX(-1): " + tf);
    const outTag = await page.locator('[data-a="out"]').evaluate((el) => el.firstElementChild && el.firstElementChild.tagName);
    assert.equal(outTag, "svg", "unauthorized logout icon at start");
  } finally { await envU.close(); }
});

// ---------------------------------------------------------------------------
// D6: favicon + generated icons
// ---------------------------------------------------------------------------
const FAV_TAGS = ['href="/favicon.svg"', 'href="/favicon-32.png"', 'href="/apple-touch-icon.png"'];

test("D6: favicon and icons exist and every head links the svg, 32px png and apple-touch-icon", { timeout: 120000 }, async (t) => {
  // Files on disk.
  const svg = fs.readFileSync(path.join(PUBLIC, "favicon.svg"), "utf8");
  assert.ok(/rx="225"/.test(svg), "rounded square uses a ~22% corner radius: " + (svg.match(/rx="\d+"/) || ["none"])[0]);
  assert.ok(svg.includes('fill="#1E6B50"'), "tile uses the default palette accent");
  assert.ok(svg.includes('fill-rule="evenodd"'), "glyph path uses the even-odd rule for its counters");
  for (const [f, size] of Object.entries({ "favicon-32.png": 32, "apple-touch-icon.png": 180, "icon-192.png": 192, "icon-512.png": 512 })) {
    const b = fs.readFileSync(path.join(PUBLIC, f));
    assert.equal(b.readUInt32BE(16), size, f + " is " + size + "px wide");
    assert.equal(b.readUInt32BE(20), size, f + " is " + size + "px high");
  }

  // Static heads.
  for (const f of ["index.html", "404.html", "admin/index.html"]) {
    const html = fs.readFileSync(path.join(PUBLIC, f), "utf8");
    for (const tag of FAV_TAGS) assert.ok(html.includes(tag), f + " head links " + tag);
  }

  // The publisher emits the same head for the generated word and legal pages.
  const { pathToFileURL } = require("url");
  const mod = await import(pathToFileURL(path.join(ROOT, "scripts/publish-build.mjs")).href);
  const { files, wordCount } = mod.buildSite(
    JSON.parse(fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8")),
    JSON.parse(fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8"))
  );
  assert.ok(wordCount >= 73, "publisher generated the word pages (" + wordCount + ")");
  const wordKey = Object.keys(files).find((k) => k.startsWith("word/"));
  const legalKeys = Object.keys(files).filter((k) => /^(about|privacy|terms|rights)\/index\.html$/.test(k));
  assert.equal(legalKeys.length, 4, "publisher generated the four legal pages");
  for (const k of [wordKey, ...legalKeys]) {
    for (const tag of FAV_TAGS) assert.ok(files[k].includes(tag), k + " links " + tag);
  }

  // The glyph must survive the 16px favicon size.
  const env = await setup(t, {});
  if (!env) return;
  try {
    const page = await env.page(200, 200);
    const px = await page.evaluate(async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = 16; c.height = 16;
      const x = c.getContext("2d");
      x.drawImage(img, 0, 0, 16, 16);
      const d = x.getImageData(0, 0, 16, 16).data;
      let tile = 0, glyph = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 40) tile++;
        if (d[i] > 120 && d[i + 3] > 120) glyph++;
      }
      return { tile, glyph };
    }, env.base + "/favicon.svg");
    assert.ok(px.tile >= 256 * 0.9, "the tile fills the icon at 16px (tile px " + px.tile + ")");
    assert.ok(px.glyph >= 15, "the glyph stays legible at 16px (glyph px " + px.glyph + ")");
  } finally { await env.close(); }
});

// ---------------------------------------------------------------------------
// D7: social share image + Open Graph / Twitter metadata
// ---------------------------------------------------------------------------
const OG_TAGS = [
  '<meta property="og:title"',
  '<meta property="og:description"',
  '<meta property="og:image" content="https://ghareebalquran.com/og.png">',
  '<meta property="og:image:width" content="1200">',
  '<meta property="og:image:height" content="630">',
  '<meta property="og:locale" content="ar_AR">',
  '<meta name="twitter:card" content="summary_large_image">',
  '<meta name="twitter:title"',
  '<meta name="twitter:description"',
  '<meta name="twitter:image" content="https://ghareebalquran.com/og.png">',
];

test("D7: og.png is a 1200x630 share image and every public head carries og/twitter tags", { timeout: 120000 }, async (t) => {
  // The share image itself.
  const og = path.join(PUBLIC, "og.png");
  const b = fs.readFileSync(og);
  assert.equal(b.readUInt32BE(16), 1200, "og.png is 1200px wide");
  assert.equal(b.readUInt32BE(20), 630, "og.png is 630px high");
  assert.ok(b.length < 300 * 1024, "og.png is under 300 KB (" + b.length + " bytes)");

  // Static heads (home + 404).
  for (const f of ["index.html", "404.html"]) {
    const html = fs.readFileSync(path.join(PUBLIC, f), "utf8");
    assert.ok(html.includes('<meta property="og:type" content="website">'), f + " declares og:type website");
    for (const tag of OG_TAGS) assert.ok(html.includes(tag), f + " carries " + tag);
  }

  // Publisher output for generated word + legal pages.
  const { pathToFileURL } = require("url");
  const mod = await import(pathToFileURL(path.join(ROOT, "scripts/publish-build.mjs")).href);
  const { files } = mod.buildSite(
    JSON.parse(fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8")),
    JSON.parse(fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8"))
  );
  const wordKey = Object.keys(files).find((k) => k.startsWith("word/"));
  assert.ok(files[wordKey].includes('<meta property="og:type" content="article">'), "word page declares og:type article");
  for (const tag of OG_TAGS) assert.ok(files[wordKey].includes(tag), "word page carries " + tag);
  const legalKey = Object.keys(files).find((k) => /^about\/index\.html$/.test(k));
  assert.ok(files[legalKey].includes('<meta property="og:type" content="website">'), "legal page declares og:type website");
  for (const tag of OG_TAGS) assert.ok(files[legalKey].includes(tag), "legal page carries " + tag);

  // The committed pages match the generator (only the head grew; body untouched).
  for (const n of fs.readdirSync(path.join(PUBLIC, "word")).slice(0, 5)) {
    const committed = fs.readFileSync(path.join(PUBLIC, "word", n), "utf8");
    assert.ok(committed.includes('content="https://ghareebalquran.com/og.png"'), "committed word page " + n + " points at og.png");
  }
});
