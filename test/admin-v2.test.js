"use strict";
/*
 * admin-v2.test.js - the admin's accessibility, phone and small-UX fixes (audit findings A11Y-1 to 5, UI-2, UI-3, UI-6,
 * UX-1, 3, 4, 5, 6, 8, SEC-13) and the full add-surah list. Runs the admin in its demo mode (no Firebase config, data in
 * localStorage), owner view. SEC-7 and SEC-9 need real sign-in, so they are in scripts/checks/admin-history-emulator.mjs.
 * ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PUBLIC = path.resolve(__dirname, "..", "public");
const WORDS = JSON.parse(fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8"));
const CHALLENGE = JSON.parse(fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8"));
const JUZ = fs.readFileSync(path.join(PUBLIC, "admin", "index.html"), "utf8").match(/const JUZ="([^"]+)"/)[1].split(",");
const SURAHS = WORDS.map((s) => Object.assign({ no: 78 + JUZ.indexOf(s.surah.replace(/^\S+\s*/, "")) }, s));
const ADDED = "(مضافة)";

function staticServer(root) {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".png": "image/png" };
  return http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/firebase-config.js") { res.writeHead(200, { "content-type": types[".js"] }); res.end("window.FIREBASE_CONFIG=null;"); return; }
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

let chromium, br, server, base;
test.before(async () => {
  try { ({ chromium } = require("playwright")); br = await chromium.launch(); } catch (e) { br = null; return; }
  server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + server.address().port;
});
test.after(async () => { if (br) await br.close(); if (server) await new Promise((r) => server.close(r)); });

async function open(t, opts = {}) {
  if (!br) { t.skip("chromium unavailable"); return null; }
  const ctx = await br.newContext({ viewport: opts.viewport || { width: 1280, height: 900 }, colorScheme: opts.scheme || "light" });
  await ctx.addInitScript(([d, c, gq]) => {
    try { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("gqad", JSON.stringify({ rev: 6, surahs: d })); localStorage.setItem("gqch", JSON.stringify(c)); localStorage.setItem("gqaa", JSON.stringify(["helper@example.test"])); if (gq) localStorage.setItem("gq", JSON.stringify(gq)); } } catch (e) {}
  }, [SURAHS, CHALLENGE, opts.gq || null]);
  const page = await ctx.newPage();
  // Playwright intercepts file choosers only once a "filechooser" listener exists, and it switches that on
  // asynchronously. Added together with the key press (waitForEvent inside Promise.all) it can lose the race, and the
  // chooser then opens unseen. A listener added here, before any key press, keeps interception on for the whole page.
  page.on("filechooser", () => {});
  await page.goto(base + "/admin/", { waitUntil: "load" });
  await page.waitForSelector("#app .tabs", { timeout: 25000 });
  t.after(() => ctx.close());
  return page;
}
const tab = (p, v) => p.click(`[data-a="tab"][data-v="${v}"]`);
// Opening the Tools tab starts loading the version history. The load repaints only the history list (tested below); it
// used to re-render the whole tab, replacing the import button and file input under a test. Tests still use the tab in
// its settled state, with the history loaded for the current revision.
const toolsTab = async (p) => { await tab(p, "t"); await p.waitForFunction(() => TAB === "t" && HIST && HIST.forRev === D.rev && !HIST.loading); };
const lum = (rgb) => { const [r, g, b] = rgb.match(/[\d.]+/g).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test("A11Y-1, A11Y-2: field edges read at 3:1 on the page's own background, placeholders use the muted text colour", async (t) => {
  // with no saved theme the admin is light (day) on any device (theme.js, since 2026-11-11); its night colours follow
  // the painted mode (.dk), so a saved night mode, or a saved auto on a dark device, is checked too
  for (const o of [{ scheme: "light" }, { scheme: "dark" }, { scheme: "light", gq: { mode: "dark" }, night: true }, { scheme: "dark", gq: { mode: "auto" }, night: true }]) {
    const scheme = o.scheme + (o.gq ? " device, saved " + o.gq.mode : " device");
    const p = await open(t, o); if (!p) return;
    assert.strictEqual(await p.evaluate(() => document.documentElement.classList.contains("dk")), !!o.night, scheme + ": night as painted");
    const m = await p.evaluate(() => { const i = document.querySelector("#ns"), c = getComputedStyle(i), s = getComputedStyle(document.body); const q = document.createElement("input"); q.className = "in"; q.placeholder = "x"; document.body.append(q); const ph = getComputedStyle(q, "::placeholder"); const r = { border: c.borderTopColor, bg: s.backgroundColor, ph: ph.color, op: ph.opacity, tx: getComputedStyle(document.documentElement).getPropertyValue("--mu").trim() }; q.remove(); return r; });
    assert.ok(ratio(m.border, m.bg) >= 3, scheme + " border " + ratio(m.border, m.bg).toFixed(2));
    assert.strictEqual(m.op, "1", scheme + " placeholder at full opacity");
    assert.notStrictEqual(m.ph, "rgb(117, 117, 117)", scheme + " not the browser's default placeholder");
    assert.ok(ratio(m.ph, m.bg) >= 4.5, scheme + " placeholder " + ratio(m.ph, m.bg).toFixed(2));
  }
});

test("A11Y-3: focus stays on the active tab after a switch, and moves to the next row after a delete", async (t) => {
  const p = await open(t); if (!p) return;
  await p.focus('[data-a="tab"][data-v="w"]'); await p.keyboard.press("Enter");
  assert.strictEqual(await p.evaluate(() => document.activeElement.dataset.v), "w");
  await p.focus('[data-a="delW"][data-v="0.0"]'); await p.keyboard.press("Enter"); await p.click('[data-cd="yes"]');
  await p.waitForFunction(() => !SAVING && !document.querySelector("#cd.open") && document.activeElement && document.activeElement.dataset.a === "delW");
  assert.strictEqual(await p.evaluate(() => [...document.querySelectorAll('[data-a="delW"]')].indexOf(document.activeElement)), 0);
  await tab(p, "s"); const n = await p.locator('[data-a="delS"]').count();
  await p.locator('[data-a="delS"]').last().focus(); await p.keyboard.press("Enter"); await p.click('[data-cd="yes"]');
  await p.waitForFunction((k) => !SAVING && document.querySelectorAll('[data-a="delS"]').length === k - 1 && document.activeElement.dataset.a === "delS", n);
  assert.strictEqual(await p.evaluate(() => [...document.querySelectorAll('[data-a="delS"]')].indexOf(document.activeElement)), n - 2, "the last row's delete moves to the new last row");
});

test("A11Y-4: import is a real button that opens the file picker from the keyboard", async (t) => {
  const p = await open(t); if (!p) return;
  await toolsTab(p); await p.focus('[data-a="impPick"]');
  assert.strictEqual(await p.evaluate(() => document.activeElement.tagName), "BUTTON");
  // The chooser is awaited together with the key press, and before each press the focus must still be on the import
  // button itself, so the key press really comes from the keyboard on that button.
  for (const key of ["Enter", "Space"]) {
    assert.strictEqual(await p.evaluate(() => document.activeElement.dataset.a), "impPick", key + ": focus on the import button");
    await Promise.all([p.waitForEvent("filechooser", { timeout: 10000 }), p.keyboard.press(key)]);
  }
});

test("the history load repaints only the history list: the import button, its focus and the file input stay the same", async (t) => {
  const p = await open(t); if (!p) return;
  // hold the history page until the button is focused and the elements are marked, then let it arrive
  await p.evaluate(() => { const o = store.histPage; window.__go = null; store.histPage = (...a) => new Promise((r) => { window.__go = r; }).then(() => o.apply(store, a)); });
  await tab(p, "t");
  await p.waitForFunction(() => TAB === "t" && HIST && HIST.loading && typeof window.__go === "function");
  await p.focus('[data-a="impPick"]');
  await p.evaluate(() => { window.__btn = document.querySelector('[data-a="impPick"]'); window.__inp = document.querySelector('[data-f="imp"]'); window.__list = document.querySelector(".hl"); window.__go(); });
  await p.waitForFunction(() => HIST && HIST.forRev === D.rev && !HIST.loading);
  const s = await p.evaluate(() => ({ btn: window.__btn.isConnected && window.__btn === document.querySelector('[data-a="impPick"]'), inp: window.__inp.isConnected && window.__inp === document.querySelector('[data-f="imp"]'), focus: document.activeElement === window.__btn, list: window.__list.isConnected, loading: !!document.querySelector('.hl [role="status"]') }));
  assert.deepStrictEqual(s, { btn: true, inp: true, focus: true, list: true, loading: false });
  await Promise.all([p.waitForEvent("filechooser", { timeout: 10000 }), p.keyboard.press("Enter")]);
});

test("A11Y-5: one active tab marked aria-current, and one heading on each screen", async (t) => {
  const p = await open(t); if (!p) return;
  for (const v of ["s", "w", "c", "a", "t"]) {
    await tab(p, v);
    const s = await p.evaluate(() => ({ h1: document.querySelectorAll("#app h1").length, cur: [...document.querySelectorAll('[aria-current="page"]')].map((e) => e.dataset.v), w: document.querySelector("#app h1").getBoundingClientRect().width }));
    assert.deepStrictEqual([s.h1, s.cur], [1, [v]], v); assert.ok(s.w <= 1, "the heading is visually hidden");
  }
});

test("UI-2: the active tab is in view at 390 px, after a click and after a resize", async (t) => {
  const p = await open(t, { viewport: { width: 390, height: 844 } }); if (!p) return;
  const inView = () => p.evaluate(() => { const a = document.querySelector(".tabs").getBoundingClientRect(), b = document.querySelector(".tabs .on").getBoundingClientRect(); return b.left >= a.left - 1 && b.right <= a.right + 1; });
  for (const v of ["t", "a", "s", "t"]) { await tab(p, v); assert.ok(await inView(), v); }
  await p.setViewportSize({ width: 1280, height: 800 }); await tab(p, "t"); await p.setViewportSize({ width: 320, height: 800 }); await p.waitForTimeout(100);
  assert.ok(await inView(), "after a resize");
});

test("UI-3: ayah parts have visible labels, in a row on a wide screen and stacked under 600 px", async (t) => {
  for (const [width, cols] of [[1280, 4], [390, 1]]) {
    const p = await open(t, { viewport: { width, height: 844 } }); if (!p) return;
    await tab(p, "w"); await p.click('[data-a="editW"][data-v="0.0"]'); await p.waitForSelector(".sg");
    const s = await p.evaluate(() => { const g = document.querySelector(".sg"), labels = [...g.querySelectorAll("label span")]; return { cols: getComputedStyle(g).gridTemplateColumns.split(" ").length, labels: labels.length, seen: labels.every((l) => l.getBoundingClientRect().height > 8 && l.textContent.trim()), named: [...g.querySelectorAll("input")].every((i) => i.getAttribute("aria-label")), wide: Math.min(...[...g.querySelectorAll("input")].map((i) => i.getBoundingClientRect().width)) }; });
    assert.strictEqual(s.cols, cols, width + " columns"); assert.strictEqual(s.labels, 4); assert.ok(s.seen && s.named);
    if (width === 390) assert.ok(s.wide > 250, "each field takes the full width: " + s.wide);
  }
});

test("UI-6: Quran words are in the Quran face in challenge rows, status rows, the day editor and dialog titles; a file name is not", async (t) => {
  const p = await open(t); if (!p) return;
  const face = (sel) => p.evaluate((s) => { const e = document.querySelector(s); return e ? getComputedStyle(e).fontFamily : ""; }, sel);
  await tab(p, "c"); assert.match(await face("#app .card .row .t .q"), /KFGQPC/, "challenge row");
  await p.click('[data-a="chStatus"]'); assert.match(await face("#md .row .t .q"), /KFGQPC/, "status row"); await p.click('#md [data-a="close"]');
  await p.click('[data-a="chDay"][data-v="1"]'); await p.waitForSelector("#c-note"); assert.match(await face("#md .rw"), /KFGQPC/, "day editor"); await p.click('#md [data-a="close"]');
  await tab(p, "w"); await p.click('[data-a="delW"][data-v="0.0"]'); assert.match(await face("#cdt .q"), /KFGQPC/, "dialog title"); await p.click('[data-cd="no"]');
  await toolsTab(p); await p.setInputFiles('[data-f="imp"]', { name: "words.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(SURAHS)) });
  await p.waitForSelector("#cd.open"); assert.strictEqual(await p.locator("#cdt .q").count(), 0, "the file name stays in the UI face");
  assert.ok((await p.locator("#cdt").textContent()).includes("words.json"));
});

test("UX-1: unsaved challenge settings count as unsaved, and typing the saved value back clears that", async (t) => {
  const p = await open(t); if (!p) return;
  await tab(p, "c"); const was = await p.inputValue("#m-ru");
  assert.strictEqual(await p.evaluate(() => dirty()), false);
  await p.fill("#m-ru", "3"); assert.strictEqual(await p.evaluate(() => dirty()), true);
  const warned = await p.evaluate(() => { const e = new Event("beforeunload", { cancelable: true }); dispatchEvent(e); return e.defaultPrevented; }); assert.ok(warned, "leaving the page warns");
  await p.fill("#m-ru", was); assert.strictEqual(await p.evaluate(() => dirty()), false);
});

test("UX-3: the newer-version banner shows on the editor, and not on the conflict picker", async (t) => {
  const p = await open(t); if (!p) return;
  await tab(p, "w"); await p.click('[data-a="editW"][data-v="0.0"]'); await p.waitForSelector("#e-m");
  await p.evaluate(() => { NEWER = true; repaint(); }); assert.strictEqual(await p.locator(".wnew").count(), 1);
  await p.evaluate(() => { ED.conf = { fields: [{ field: "meaning", mine: "a", theirs: "b" }], picks: {}, err: {} }; repaint(); });
  assert.strictEqual(await p.locator(".cf").count(), 1); assert.strictEqual(await p.locator(".wnew").count(), 0);
  await p.evaluate(() => { NEWER = false; ED.conf = null; MD.base0 = winState(); });
});

test("UX-4: a long meaning shows two lines in the list, and the textarea grows to its content", async (t) => {
  const p = await open(t, { viewport: { width: 390, height: 844 } }); if (!p) return;
  await p.evaluate((s) => { D.surahs[0].meanings[0] = s; }, "m ".repeat(400)); await tab(p, "w");
  const l = await p.evaluate(() => { const e = document.querySelector(".wl .t > div"), c = getComputedStyle(e); return { clamp: c.webkitLineClamp, h: e.getBoundingClientRect().height, lh: parseFloat(c.lineHeight) || 24 }; });
  assert.strictEqual(l.clamp, "2"); assert.ok(l.h > l.lh * 1.5 && l.h < l.lh * 2.5, JSON.stringify(l));
  await p.click('[data-a="editW"][data-v="0.0"]'); await p.waitForSelector("#e-m");
  const a = await p.evaluate(() => { const e = document.querySelector("#e-m"); return { client: e.clientHeight, scroll: e.scrollHeight, h: e.getBoundingClientRect().height, max: parseFloat(getComputedStyle(e).maxHeight) }; });
  assert.ok(a.h > 84, "it grew past its minimum: " + a.h);
  assert.ok(a.scroll <= a.client + 1 || a.h >= a.max - 1, "the content fits, or it reached its cap: " + JSON.stringify(a));
  const small = await p.evaluate(() => { const e = document.querySelector("#e-m"); e.value = "x"; e.dispatchEvent(new Event("input", { bubbles: true })); return e.getBoundingClientRect().height; });
  assert.ok(small < a.h, "it shrinks with its content");
});

test("UX-5: an error the window shows is not repeated in a toast; with no window it is", async (t) => {
  const p = await open(t); if (!p) return;
  await tab(p, "w"); await p.click('[data-a="editW"][data-v="0.0"]'); await p.waitForSelector("#e-m");
  await p.evaluate(() => { $("#toast").style.display = "none"; winFail(errOf("offline"), "x"); });
  assert.strictEqual(await p.locator("#md .werr").count(), 1);
  assert.strictEqual(await p.evaluate(() => $("#toast").style.display), "none");
  await p.evaluate(() => { MD.err = ""; closeWin(false); winFail(errOf("offline"), "x"); });
  assert.strictEqual(await p.evaluate(() => $("#toast").style.display), "block");
});

test("UX-6: the search waits for a pause, and never re-renders during IME composition", async (t) => {
  const p = await open(t); if (!p) return;
  await tab(p, "w");
  await p.evaluate(() => { window.__renders = 0; const r = render; render = function () { window.__renders++; return r(); }; });
  const box = '[data-f="fq"]', type = (v, composing) => p.evaluate(([b, x, c]) => { const i = document.querySelector(b); i.value = x; i.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: c })); }, [box, v, composing]);
  await p.focus(box); const node = await p.evaluateHandle((b) => document.querySelector(b), box);
  for (const v of ["a", "ab", "abc"]) await type(v, true);
  await p.waitForTimeout(350);
  assert.strictEqual(await p.evaluate(() => window.__renders), 0, "no render while composing");
  assert.ok(await node.evaluate((n) => n.isConnected), "the field the IME is using stays in place");
  await p.evaluate((b) => document.querySelector(b).dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })), box);
  await p.waitForFunction(() => window.__renders === 1, null, { timeout: 3000 });
  for (const v of ["x", "xy", "xyz", "xyzw"]) await type(v, false);
  await p.waitForTimeout(350);
  assert.strictEqual(await p.evaluate(() => window.__renders), 2, "four keystrokes, one render");
  assert.strictEqual(await p.evaluate(() => document.activeElement.dataset.f), "fq", "the box keeps focus");
  assert.strictEqual(await p.inputValue(box), "xyzw");
});

test("UX-8: the page refuses what the rules refuse", async (t) => {
  const p = await open(t); if (!p) return;
  await tab(p, "a");
  for (const bad of ["a@b@c.d", "no-at-sign.test", "a b@c.d"]) { await p.fill("#ae", bad); await p.click('[data-a="addA"]'); assert.strictEqual(await p.locator("#fe-ae").count(), 1, bad); assert.strictEqual(await p.locator("#cd.open").count(), 0, bad); }
  await p.fill("#ae", "new@example.test"); await p.click('[data-a="addA"]'); assert.strictEqual(await p.locator("#cd.open").count(), 1);
});

test("SEC-13: esc() escapes the single quote", async (t) => {
  const p = await open(t); if (!p) return;
  assert.strictEqual(await p.evaluate(() => esc(`a'b"<>&`)), "a&#39;b&quot;&lt;&gt;&amp;");
});

test("the add-surah list has all 37 surahs of Juz Amma, the added ones disabled and marked", async (t) => {
  const p = await open(t); if (!p) return;
  await tab(p, "s");
  const o = await p.$$eval("#ns option", (l) => l.map((x) => ({ v: x.value, t: x.textContent, d: x.disabled })));
  const juz = o.filter((x) => x.v && x.v !== "*");
  assert.strictEqual(juz.length, 37);
  assert.deepStrictEqual(juz.map((x) => x.v), JUZ, "in Mushaf order");
  const added = new Set(SURAHS.map((s) => s.surah.replace(/^\S+\s*/, "")));
  assert.strictEqual(added.size, WORDS.length);
  for (const x of juz) { assert.strictEqual(x.d, added.has(x.v), x.v); assert.strictEqual(x.t.includes(ADDED), added.has(x.v), x.v); }
  const free = juz.find((x) => !x.d);
  await p.selectOption("#ns", free.v); await p.click('[data-a="addS"]'); await p.waitForSelector("#e-name");
  assert.strictEqual(await p.inputValue("#e-name"), free.v, "a free one still opens the form");
  await p.click('#md [data-a="close"]');
  await assert.rejects(p.selectOption("#ns", juz.find((x) => x.d).v, { timeout: 500 }), "an added one cannot be chosen");
});
