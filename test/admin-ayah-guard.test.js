"use strict";
/*
 * admin-ayah-guard.test.js - the admin refuses to save a word whose ayah text is not the official text.
 *
 * Runs the real admin page against a Firebase stub (no network, no Firestore): signed in as the owner, with the
 * words of public/words.json. Checks that
 *   - the reference text (/admin/quran-hafs.json) is not loaded until the first save, and the public site never
 *     loads it;
 *   - a part whose text is not a contiguous piece of its ayah is blocked with a message naming the surah and the
 *     ayah, and nothing is written;
 *   - a wrong ayah number is blocked the same way;
 *   - the official text saves (one write).
 *
 * ASCII only. Skips when Chromium is unavailable.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PUBLIC = path.resolve(__dirname, "..", "public");
const WORDS = JSON.parse(fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8"));
const NOT_MATCH = "لا يطابق"; // "does not match"
const NO_AYAH = "لا توجد آية"; // "there is no ayah"
const SAVED = "تم الحفظ"; // "saved"

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
  "export function setDoc(){window.__WRITES__=(window.__WRITES__||0)+1;return Promise.resolve()}",
  "export function doc(db){var p=[];for(var i=1;i<arguments.length;i++)p.push(arguments[i]);return {path:p.join('/')}}",
  "export function getDoc(ref){var p=(ref&&ref.path)||'';if(p==='public/data')return Promise.resolve({exists:function(){return true},data:function(){return {rev:(window.__REV__||1),surahs:window.__TEST_SURAHS__||[]}}});return Promise.resolve({exists:function(){return false},data:function(){return {}}})}",
  "export function runTransaction(db,fn){var tx={get:function(){return Promise.resolve({exists:function(){return true},data:function(){return {rev:(window.__REV__||1),surahs:window.__TEST_SURAHS__||[]}}})},set:function(ref,val){if(ref.path==='public/data'){window.__WRITES__=(window.__WRITES__||0)+1;window.__REV__=val.rev;window.__TEST_SURAHS__=val.surahs}}};return Promise.resolve(fn(tx)).then(function(){return 1})}",
].join("\n");

function staticServer(root, log) {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".png": "image/png" };
  return http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    log.push(p);
    if (p === "/firebase-config.js") { res.writeHead(200, { "content-type": types[".js"] }); res.end("window.FIREBASE_CONFIG={apiKey:'x',authDomain:'x',projectId:'demo-x',appId:'x'};"); return; }
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

test("the admin blocks a word whose ayah text is not the official text", async (t) => {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let browser;
  try { browser = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return; }
  const log = [];
  const server = staticServer(PUBLIC, log);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    // the public site never asks for the reference text
    const site = await browser.newPage();
    await site.addInitScript(() => { try { localStorage.setItem("gq-ld", "1"); } catch (e) {} });
    await site.route("https://www.gstatic.com/firebasejs/**", (r) => r.abort());
    for (const h of ["/#/", "/#/word/79-0", "/#/surahs", "/word/an-naziat-1.html"]) { await site.goto(base + h, { waitUntil: "load" }); await site.waitForTimeout(400); }
    await site.close();
    assert.ok(!log.some((p) => p.includes("quran-hafs.json")), "the public site does not load the reference text");

    const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    await page.addInitScript({ content: "window.__TEST_USER__={email:'yusufhamdy20@gmail.com',emailVerified:true};window.__TEST_SURAHS__=" + JSON.stringify(WORDS) + ";" });
    await page.route("https://www.gstatic.com/firebasejs/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body: FB_STUB }));
    await page.goto(base + "/admin/", { waitUntil: "load" });
    // the first word of the first surah (an-Nas, ayah 4)
    const si = 0, e = WORDS[si], g = e.ayahs[0].segments[0], name = e.surah.replace(/^\S+\s+/, "");
    await page.waitForSelector("#app .top", { timeout: 25000 });
    await page.click('[data-a="tab"][data-v="w"]');
    await page.waitForSelector('[data-a="editW"][data-v="' + si + '.0"]', { timeout: 20000 });
    assert.ok(!log.some((p) => p.includes("quran-hafs.json")), "the admin does not load the reference text before a save");
    const openEditor = async () => { await page.click('[data-a="editW"][data-v="' + si + '.0"]'); await page.waitForSelector('[data-f="g.0.hl"]'); };
    const save = async () => { await page.click('[data-a="saveW"]'); await page.waitForTimeout(700); };
    const writes = () => page.evaluate(() => window.__WRITES__ || 0);

    // a tatweel added inside the highlighted text
    await openEditor();
    await page.fill('[data-f="g.0.hl"]', g.hl.slice(0, 2) + "ـ" + g.hl.slice(2));
    await save();
    let md = await page.textContent("#md");
    assert.ok(log.some((p) => p.includes("quran-hafs.json")), "the first save loads the reference text");
    assert.ok(md.includes(NOT_MATCH) && md.includes(name) && md.includes(String(g.num)), "the message names the surah and the ayah: " + md.slice(0, 300));
    assert.strictEqual(await writes(), 0, "nothing is written");

    // a wrong ayah number
    await page.fill('[data-f="g.0.hl"]', g.hl);
    await page.fill('[data-f="g.0.num"]', "99");
    await save();
    md = await page.textContent("#md");
    assert.ok(md.includes(NO_AYAH) && md.includes("99") && md.includes(name), "a missing ayah is named: " + md.slice(0, 300));
    assert.strictEqual(await writes(), 0, "nothing is written");

    // the official text saves
    await page.fill('[data-f="g.0.num"]', String(g.num));
    await page.fill('[data-f="e.m"]', (await page.inputValue('[data-f="e.m"]')) + " ");
    await page.fill('[data-f="e.m"]', (await page.inputValue('[data-f="e.m"]')).trim() + ".");
    await save();
    assert.strictEqual(await writes(), 1, "the corrected word is written once");
    assert.ok((await page.textContent("body")).includes(SAVED), "saved");
    assert.strictEqual(log.filter((p) => p.includes("quran-hafs.json")).length, 1, "the reference text is loaded once");
    await page.close();
  } finally {
    await browser.close();
    await new Promise((r) => server.close(r));
  }
});
