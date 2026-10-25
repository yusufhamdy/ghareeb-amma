"use strict";
/*
 * word-nav.test.js - Phase A STEP 4 acceptance.
 *
 * Loads the real public/index.html in Chromium and, for EVERY word page in the
 * data (a superset of the required "all words of two surahs"), verifies:
 *   - the surah+verse pill links to that word's surah and matches the row text
 *   - the card split: card 1 = word + highlighted verse, card 2 = meaning
 *     (>= 20px, "enlarged") + source, and card 2 has no verse
 *   - prev/next: always word links; at a surah boundary -> the neighbouring
 *     surah's last/first word, with that surah's name on a second line; at the
 *     very first/last word -> disabled (aria-disabled, reduced opacity, still
 *     rendered), never hidden
 *   - RTL chevrons: previous points right, next points left
 *   - the three actions in spec order: other-words link -> draw -> save
 *   - layout: the nav is a row of two pills under the cards at every width
 *     (previous on the right, next on the left); touch targets >= 44px
 * It reports the surah count + data order to a UTF-8 JSON file (Arabic names are
 * never printed to the console).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const REPORT = path.join(os.tmpdir(), "step4-walk-report.json");

const AR = {
  prevWord: "\u0627\u0644\u0643\u0644\u0645\u0629 \u0627\u0644\u0633\u0627\u0628\u0642\u0629",           // الكلمة السابقة
  prevSurah: "\u0627\u0644\u0633\u0648\u0631\u0629 \u0627\u0644\u0633\u0627\u0628\u0642\u0629",      // السورة السابقة
  nextWord: "\u0627\u0644\u0643\u0644\u0645\u0629 \u0627\u0644\u062a\u0627\u0644\u064a\u0629",        // الكلمة التالية
  nextSurah: "\u0627\u0644\u0633\u0648\u0631\u0629 \u0627\u0644\u062a\u0627\u0644\u064a\u0629",       // السورة التالية
};
const CHEV_RIGHT = "M9 5l7 7-7 7"; // previous (RTL: start side points right)
const CHEV_LEFT = "M15 5l-7 7 7 7"; // next (RTL: end side points left)
const GRID_MOBILE = '"c c" "p n"';
const GRID_DESKTOP = '"c c" "p n"';

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

test("STEP 4: word-page navigation, pill, split cards, button order", { timeout: 300000 }, async (t) => {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let browser;
  try { browser = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return; }

  const words = fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8");
  const entries = JSON.parse(words);
  const dataCounts = entries.map((e) => e.words.length).sort((a, b) => a - b);
  const dataTotal = entries.reduce((a, e) => a + e.words.length, 0);
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;

  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.addInitScript({ content: "window.__WORDS__=" + words + ";window.__CH__=[];" });
    await page.goto(base + "/index.html", { waitUntil: "load" });
    await page.waitForSelector("#app .acts", { timeout: 20000 });

    const nav = async (hash, fn, arg) => {
      await page.evaluate((h) => { location.hash = h; }, hash);
      await page.waitForFunction(fn, arg, { timeout: 20000 });
    };
    // runs in the page: id is passed through waitForFunction's arg channel
    function wordReady(id) {
      const b = document.querySelector('[data-a="card"]');
      return location.hash === "#/word/" + id && b && b.dataset.id === id;
    }

    // ---- surah list: count + data order (app's own ordering) ----
    await nav("#/surahs", () => {
      const r = document.querySelector("#app .list .row");
      return location.hash === "#/surahs" && r && r.getAttribute("href").indexOf("#/surah/") === 0;
    });
    const surahs = await page.$$eval("#app .list .row", (rows) => rows.map((r) => {
      const sp = r.querySelectorAll("span");
      return { num: +r.getAttribute("href").split("/").pop(), name: sp[1] ? sp[1].textContent.trim() : "" };
    }));
    assert.equal(surahs.length, entries.length, "surah count matches words.json entries");
    assert.ok(surahs.every((s, i) => i === 0 || s.num > surahs[i - 1].num), "surahs are in ascending data order");

    // ---- every surah page: ordered word ids + row texts ----
    const bySurah = {};
    for (const s of surahs) {
      // word ids are "<surahNum>-0..." so the first row href uniquely identifies
      // this surah's page (avoids matching a stale list from the previous route)
      await nav("#/surah/" + s.num, (n) => {
        const r = document.querySelector("#app .list .row");
        return location.hash === "#/surah/" + n && r && r.getAttribute("href") === "#/word/" + n + "-0";
      }, s.num);
      bySurah[s.num] = await page.$$eval("#app .list .row", (rows) => rows.map((r) => ({
        id: r.getAttribute("href").split("/").pop(),
        word: r.querySelector(".w").textContent.trim(),
        meaning: r.querySelector(".t div").textContent.trim(),
        pill: r.querySelector(".t .m").textContent.trim(),
      })));
    }
    const allCounts = surahs.map((s) => bySurah[s.num].length).sort((a, b) => a - b);
    assert.deepEqual(allCounts, dataCounts, "every surah page lists its data words");
    assert.equal(surahs.reduce((a, s) => a + bySurah[s.num].length, 0), dataTotal, "all data words reachable");

    // ---- walk every word page ----
    let walked = 0;
    let mobileGrid = null;
    const boundary = { first: null, last: null };
    for (let si = 0; si < surahs.length; si++) {
      const s = surahs[si];
      const list = bySurah[s.num];
      const prevSurah = surahs[si - 1] || null;
      const nextSurah = surahs[si + 1] || null;
      for (let i = 0; i < list.length; i++) {
        const cur = list[i];
        await nav("#/word/" + cur.id, wordReady, cur.id);
        const d = await page.evaluate(() => {
          const q = (sel) => document.querySelector(sel);
          const qa = (sel) => Array.from(document.querySelectorAll(sel));
          const pv = q("#app .cw .pnb.pv"), nx = q("#app .cw .pnb.nx");
          const pill = q("#app .pill");
          const cards = qa("#app .cw .cols .card");
          const cols = q("#app .cw .cols");
          const chev = (el) => el && el.querySelector("path") ? (el.querySelector("path").getAttribute("d") || "") : "";
          const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
          return {
            pill: { href: pill && pill.getAttribute("href"), text: pill ? pill.textContent.trim() : null, chev: chev(pill) },
            cards: cards.map((c) => {
              const mn = c.querySelector(".mn");
              return {
                wd: (c.querySelector(".wd") || {}).textContent ? c.querySelector(".wd").textContent.trim() : null,
                verse: !!c.querySelector(".vr .ay"),
                mark: !!c.querySelector(".vr .ay mark"),
                mn: mn ? mn.textContent.trim() : null,
                mnSize: mn ? parseFloat(getComputedStyle(mn).fontSize) : null,
                m: (c.querySelector(".m") || {}).textContent ? c.querySelector(".m").textContent.trim() : null,
              };
            }),
            pv: pv ? { tag: pv.tagName, href: pv.getAttribute("href"), text: pv.textContent.trim(), ad: pv.getAttribute("aria-disabled"), op: pv.style.opacity, chev: chev(pv), r: rect(pv), vis: pv.offsetWidth > 0 && pv.offsetHeight > 0 } : null,
            nx: nx ? { tag: nx.tagName, href: nx.getAttribute("href"), text: nx.textContent.trim(), ad: nx.getAttribute("aria-disabled"), op: nx.style.opacity, chev: chev(nx), r: rect(nx), vis: nx.offsetWidth > 0 && nx.offsetHeight > 0 } : null,
            acts: qa("#app .acts.v3 > *").map((a) => ({ tag: a.tagName, href: a.getAttribute("href"), da: a.getAttribute("data-a"), did: a.getAttribute("data-id") })),
            colsR: rect(cols),
            grid: getComputedStyle(q("#app .cw")).gridTemplateAreas.replace(/\s+/g, " ").trim(),
          };
        });

        // pill -> its own surah
        assert.equal(d.pill.href, "#/surah/" + s.num, "pill links to surah (word " + cur.id + ")");
        assert.equal(d.pill.text, cur.pill, "pill text matches surah + ayah label");
        assert.ok(d.pill.chev.indexOf(CHEV_LEFT) >= 0, "pill chevron points left");

        // card split
        assert.equal(d.cards.length, 2, "two cards");
        assert.equal(d.cards[0].wd, cur.word, "card 1 = word");
        assert.ok(d.cards[0].verse && d.cards[0].mark, "card 1 contains highlighted verse");
        assert.equal(d.cards[1].verse, false, "card 2 has no verse");
        assert.equal(d.cards[1].mn, cur.meaning, "card 2 = meaning");
        assert.ok(d.cards[1].mnSize >= 20, "meaning enlarged (" + d.cards[1].mnSize + "px)");
        assert.ok(d.cards[1].m, "card 2 keeps the source line");

        // previous
        if (i > 0) {
          assert.equal(d.pv.tag, "A");
          assert.equal(d.pv.href, "#/word/" + list[i - 1].id, "prev word in same surah");
          assert.equal(d.pv.text, AR.prevWord);
          assert.equal(d.pv.ad, null);
          assert.ok(d.pv.chev.indexOf(CHEV_RIGHT) >= 0, "prev chevron points right");
        } else if (prevSurah) {
          assert.equal(d.pv.tag, "A");
          const pl = bySurah[prevSurah.num];
          assert.equal(d.pv.href, "#/word/" + pl[pl.length - 1].id, "boundary: prev = last word of the neighbouring surah");
          assert.equal(d.pv.text, AR.prevWord + prevSurah.name);
          assert.ok(d.pv.chev.indexOf(CHEV_RIGHT) >= 0);
        } else {
          assert.equal(d.pv.tag, "SPAN", "no previous word -> disabled, never hidden");
          assert.equal(d.pv.ad, "true");
          assert.equal(d.pv.op, "0.5");
          assert.equal(d.pv.text, AR.prevWord);
          assert.ok(d.pv.vis && d.pv.r.h >= 44 && d.pv.r.w > 0, "disabled control still visible, >=44px");
        }

        // next
        if (i < list.length - 1) {
          assert.equal(d.nx.tag, "A");
          assert.equal(d.nx.href, "#/word/" + list[i + 1].id, "next word in same surah");
          assert.equal(d.nx.text, AR.nextWord);
          assert.equal(d.nx.ad, null);
          assert.ok(d.nx.chev.indexOf(CHEV_LEFT) >= 0, "next chevron points left");
        } else if (nextSurah) {
          assert.equal(d.nx.tag, "A");
          assert.equal(d.nx.href, "#/word/" + bySurah[nextSurah.num][0].id, "boundary: next = first word of the neighbouring surah");
          assert.equal(d.nx.text, AR.nextWord + " " + nextSurah.name);
          assert.ok(d.nx.chev.indexOf(CHEV_LEFT) >= 0);
        } else {
          assert.equal(d.nx.tag, "SPAN", "no next word -> disabled, never hidden");
          assert.equal(d.nx.ad, "true");
          assert.equal(d.nx.op, "0.5");
          assert.equal(d.nx.text, AR.nextWord);
          assert.ok(d.nx.vis && d.nx.r.h >= 44 && d.nx.r.w > 0, "disabled control still visible, >=44px");
        }

        // three actions in spec order: other-words -> draw -> save
        assert.equal(d.acts.length, 3, "three action buttons");
        assert.equal(d.acts[0].tag, "A");
        assert.equal(d.acts[0].href, "#/surah/" + s.num, "1st = other words from this surah");
        assert.equal(d.acts[1].tag, "BUTTON");
        assert.equal(d.acts[1].da, "rnd", "2nd = draw a word");
        assert.equal(d.acts[2].tag, "BUTTON");
        assert.equal(d.acts[2].da, "card", "3rd = save as image");
        assert.equal(d.acts[2].did, cur.id);

        // enabled nav targets are >=44px too
        if (d.pv.tag === "A") assert.ok(d.pv.r.h >= 44, "prev touch target >=44px");
        if (d.nx.tag === "A") assert.ok(d.nx.r.h >= 44, "next touch target >=44px");

        // mobile layout: nav row sits below the cards
        assert.ok(d.grid === GRID_MOBILE, "mobile grid is rows under the cards (got " + d.grid + ")");
        mobileGrid = mobileGrid || d.grid;
        assert.ok(d.pv.r.y >= d.colsR.y + d.colsR.h - 2, "prev sits below the cards on mobile");
        assert.ok(d.nx.r.y >= d.colsR.y + d.colsR.h - 2, "next sits below the cards on mobile");
        assert.ok(Math.abs(d.pv.r.y - d.nx.r.y) < 8, "prev/next share one row on mobile");

        if (si === 0 && i === 0) boundary.first = { id: cur.id, prev: d.pv.text, prevDisabled: d.pv.tag === "SPAN", next: d.nx.text };
        if (si === surahs.length - 1 && i === list.length - 1) boundary.last = { id: cur.id, prev: d.pv.text, next: d.nx.text, nextDisabled: d.nx.tag === "SPAN" };
        walked++;
      }
    }
    assert.equal(walked, dataTotal, "walked every word page");
    assert.equal(boundary.first.prevDisabled, true, "very first word has a disabled previous");
    assert.equal(boundary.last.nextDisabled, true, "very last word has a disabled next");

    // ---- desktop layout: the pill row under the cards ----
    await page.setViewportSize({ width: 1000, height: 900 });
    await nav("#/word/" + boundary.first.id, wordReady, boundary.first.id);
    const desk = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const R = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right), bottom: Math.round(r.bottom), h: Math.round(r.height) }; };
      const cols = q("#app .cw .cols");
      return {
        grid: getComputedStyle(q("#app .cw")).gridTemplateAreas.replace(/\s+/g, " ").trim(),
        pv: R(q("#app .cw .pnb.pv")), nx: R(q("#app .cw .pnb.nx")), cols: R(cols),
      };
    });
    assert.ok(desk.grid === GRID_DESKTOP, "desktop grid is cards over a p|n row (got " + desk.grid + ")");
    assert.ok(desk.pv.y >= desk.cols.bottom - 2 && desk.nx.y >= desk.cols.bottom - 2, "desktop pills sit below the cards");
    assert.ok(Math.abs(desk.pv.y - desk.nx.y) < 2, "desktop pills share one row");
    assert.ok(desk.pv.x >= desk.nx.right, "previous control is on the right side, next on the left");
    assert.ok(desk.pv.h >= 44 && desk.nx.h >= 44, "desktop nav targets >=44px");

    // ---- report ----
    fs.writeFileSync(REPORT, JSON.stringify({
      surahCount: surahs.length,
      dataOrder: surahs.map((s, i) => ({ i: i + 1, num: s.num, name: s.name, words: bySurah[s.num].length })),
      totalWords: dataTotal,
      walkedWordPages: walked,
      boundaries: boundary,
      layout: { mobile: mobileGrid, desktop: desk.grid },
    }, null, 1), "utf8");
    console.log("STEP 4: walked " + walked + " word pages across " + surahs.length + " surahs; report -> step4-walk-report.json");
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
