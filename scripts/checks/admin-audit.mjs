// Admin audit: public/admin/index.html against the Auth and Firestore EMULATORS only, checking the admin fixes
// (safe saves, honest messages, windows, MSA text). The page gets a demo Firebase config; the Firebase SDK is served from
// a local cache with getAuth/getFirestore wrapped to connect to the emulators; every request to a Google host is blocked
// and recorded. Seed first with the existing seed script; this script replaces the private notes with placeholder notes
// so no screenshot shows real note text. Screenshots and results.json go to AUDIT_OUT (default ./admin-audit).
// The Auth emulator needs an emulators.auth entry: pass a config that has one (firebase.json has only Firestore).
// Run from the repo root:
//   npx firebase emulators:exec --config <config with auth> --project demo-ghareeb --only auth,firestore "node scripts/seed-emulator.js && node scripts/checks/admin-audit.mjs"
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const { serve } = require("./lib.js");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const FSH = process.env.FIRESTORE_EMULATOR_HOST, AUH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!FSH || !AUH) { console.error("run inside emulators:exec with auth and firestore (see the header)"); process.exit(1); }
const OUT = process.env.AUDIT_OUT || path.join(path.dirname(fileURLToPath(import.meta.url)), "admin-audit");
fs.mkdirSync(OUT, { recursive: true });
const OWNER = "yusufhamdy20@gmail.com", HELPER = "helper@gmail.com", STRANGER = "stranger@gmail.com";
const DISCARD = "لديك تعديلات غير محفوظة. هل تريد تجاهلها؟";

// ---- emulator data
initializeApp({ projectId: "demo-ghareeb" });
const db = getFirestore();
const NOTES = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [String(i + 1), "ملاحظة تجريبية لليوم " + (i + 1)]));
await db.doc("admin/challengeNotes").set(NOTES);
const SEED = { data: (await db.doc("public/data").get()).data(), ch: (await db.doc("public/challenge").get()).data() };
if (!SEED.data || !SEED.ch) { console.error("not seeded: run scripts/seed-emulator.js first"); process.exit(1); }
async function reset() {
  for (const d of ["public/data", "public/challenge", "public/prev", "admin/challengeNotes", "config/admins"]) await db.doc(d).delete();
  await db.doc("public/data").set(SEED.data); await db.doc("public/challenge").set(SEED.ch);
  await db.doc("admin/challengeNotes").set(NOTES); await db.doc("config/admins").set({ emails: [HELPER] });
}
const readCh = async () => (await db.doc("public/challenge").get()).data();
const readData = async () => (await db.doc("public/data").get()).data();
const wordOf = (data, w) => { for (const s of data.surahs) { const i = s.words.indexOf(w); if (i >= 0) return { m: s.meanings[i], ay: s.ayahs[i], surah: s.surah }; } return null; };

// ---- Firebase SDK from a local cache, wrapped to use the emulators
const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
const CACHE = path.join(os.tmpdir(), "ghareeb-fb-sdk-10.14.1"); fs.mkdirSync(CACHE, { recursive: true });
const sdk = async (n) => { const f = path.join(CACHE, n); if (!fs.existsSync(f)) { const r = await fetch(SDK + n); if (!r.ok) throw new Error(n + " " + r.status); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); } return fs.readFileSync(f); };
const WRAP = {
  "firebase-auth.js": `export * from "${SDK}firebase-auth.real.js";import {getAuth as g,connectAuthEmulator as c} from "${SDK}firebase-auth.real.js";export function getAuth(a){const x=g(a);if(!x.__emu){c(x,"http://${AUH}",{disableWarnings:true});x.__emu=1}return x}`,
  "firebase-firestore.js": `export * from "${SDK}firebase-firestore.real.js";import {getFirestore as g,connectFirestoreEmulator as c} from "${SDK}firebase-firestore.real.js";export function getFirestore(a){const x=g(a);if(!x.__emu){const [h,p]="${FSH}".split(":");c(x,h,+p);x.__emu=1}return x}`,
};
const CONFIG = 'window.FIREBASE_CONFIG={apiKey:"demo-key",authDomain:"demo-ghareeb.firebaseapp.com",projectId:"demo-ghareeb",appId:"1:1:web:1"};';

const R = {}, fails = [], leaks = [], pageErrors = [], natives = [];
const check = (id, ok, detail) => { R[id] = { ok: !!ok, detail }; if (!ok) fails.push(id + ": " + JSON.stringify(detail).slice(0, 500)); console.log((ok ? "  ok   " : "  FAIL ") + id + (ok ? "" : " " + JSON.stringify(detail).slice(0, 300))); };
const { server, base } = await serve(undefined, { liveFirebase: true });
const br = await chromium.launch();
async function ctxFor(w, h) {
  const mob = w < 600;
  const ctx = await br.newContext({ viewport: { width: w, height: h || (mob ? 844 : 900) }, ...(mob ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  await ctx.route("**/firebase-config.js", (r) => r.fulfill({ contentType: "text/javascript", body: CONFIG }));
  await ctx.route(SDK + "*", async (r) => {
    const n = r.request().url().slice(SDK.length);
    if (WRAP[n]) return r.fulfill({ contentType: "text/javascript", body: WRAP[n] });
    r.fulfill({ contentType: "text/javascript", body: await sdk(n.replace(".real.js", ".js")) });
  });
  // by host: the Auth emulator puts identitytoolkit.googleapis.com in its URL paths
  await ctx.route((u) => /googleapis\.com|firebaseio|firebaseapp\.com|google\.com|googleusercontent/.test(u.hostname), (r) => { leaks.push(r.request().url()); return r.abort(); });
  return ctx;
}
const shot = async (p, name) => { const f = path.join(OUT, name + ".png"); await p.screenshot({ path: f }); return f; };
async function page(ctx, tag, signInAs) {
  const p = await ctx.newPage();
  p.on("pageerror", (e) => pageErrors.push(tag + ": " + e.message));
  p.on("dialog", (d) => { natives.push(tag + " " + d.type() + ": " + d.message()); d.dismiss().catch(() => {}); });
  await p.goto(base + "/admin/index.html");
  await p.waitForFunction(() => typeof FB !== "undefined" && FB.auth && READY, null, { timeout: 30000 });
  if (signInAs) await signIn(p, signInAs);
  return p;
}
async function signIn(p, email) {
  await p.evaluate(async (e) => { const { GoogleAuthProvider, signInWithCredential } = FB.au; await signInWithCredential(FB.auth, GoogleAuthProvider.credential(JSON.stringify({ sub: "u-" + e.replace(/\W/g, ""), email: e, email_verified: true }))); }, email);
  await p.waitForFunction(() => U && READY && (document.querySelector('[data-a="tab"]') || document.querySelector('[data-a="out"]')), null, { timeout: 20000 });
  await p.waitForTimeout(200);
}
const tab = async (p, k) => { await p.click(`[data-a="tab"][data-v="${k}"]`); await p.waitForTimeout(120); };
const winOpen = (p) => p.evaluate(() => !!document.querySelector("#md .mb"));
const dlg = (p) => p.evaluate(() => document.getElementById("cd").classList.contains("open") ? { title: document.getElementById("cdt").textContent, body: document.getElementById("cdb").textContent, yes: document.querySelector('[data-cd="yes"]').textContent.trim(), no: document.querySelector('[data-cd="no"]').textContent.trim() } : null);
const toastText = (p) => p.evaluate(() => { const t = document.getElementById("toast"); return getComputedStyle(t).display !== "none" ? t.textContent : ""; });
const countTx = (p) => p.evaluate(() => { window.__tx = 0; window.__sets = 0; const o = FB.fs.runTransaction, s = FB.fs.setDoc; FB.fs = { ...FB.fs, runTransaction: (...a) => { window.__tx++; return o(...a); }, setDoc: (...a) => { window.__sets++; return s(...a); } }; });

// ---- one window: opens with focus inside, keeps it inside, the page behind does not scroll, Esc and outside click
// close it (no edits), the × is at the top, and focus returns to the opener
async function windowProbe(p, id, open, opener) {
  await p.evaluate(() => scrollTo(0, 200));
  await open(); await p.waitForSelector("#md .mb"); await p.waitForTimeout(120);
  const s = await p.evaluate(() => { const m = document.querySelector("#md .mb"), a = document.activeElement, x = m.querySelector('.mh [data-a="close"]'); return { ariaModal: m.getAttribute("aria-modal"), named: !!document.getElementById(m.getAttribute("aria-labelledby") || "-"), focusInside: m.contains(a), xTop: !!x && x.getBoundingClientRect().top - m.getBoundingClientRect().top < 70, xLabel: x && x.getAttribute("aria-label"), locked: document.documentElement.classList.contains("lock") }; });
  const tabs = []; for (let i = 0; i < 25; i++) { await p.keyboard.press("Tab"); tabs.push(await p.evaluate(() => document.querySelector("#md .mb").contains(document.activeElement))); }
  const y0 = await p.evaluate(() => scrollY); await p.mouse.move(4, 4); await p.mouse.wheel(0, 600); await p.waitForTimeout(200);
  const scrolled = (await p.evaluate(() => scrollY)) !== y0;
  await p.keyboard.press("Escape"); await p.waitForTimeout(120);
  const escCloses = !(await winOpen(p));
  const focusBack = await p.evaluate((sel) => document.activeElement === document.querySelector("#app " + sel), opener);
  await open(); await p.waitForSelector("#md .mb"); await p.waitForTimeout(100);
  await p.mouse.click(4, 4); await p.waitForTimeout(120);
  const outsideCloses = !(await winOpen(p));
  const ok = s.ariaModal === "true" && s.named && s.focusInside && s.xTop && s.xLabel === "إغلاق" && s.locked && tabs.every(Boolean) && !scrolled && escCloses && outsideCloses && focusBack;
  check(id, ok, { ...s, tabStaysInside: tabs.every(Boolean), backgroundScrolled: scrolled, escCloses, outsideCloses, focusBack });
  if (await winOpen(p)) await p.evaluate(() => closeWin(false));
}

// ---- unsaved edits: every close path asks first; "متابعة التعديل" keeps the window and the edit, "تجاهل" closes
async function closePaths(p, id, open, edit, field) {
  const paths = {
    cancel: () => p.click('#md .mft [data-a="close"]'),
    x: () => p.click('#md .mh [data-a="close"]'),
    esc: async () => { await p.focus(field); await p.keyboard.press("Escape"); },
    outside: () => p.mouse.click(4, 4),
    back: () => p.evaluate(() => history.back()),
  };
  const res = {};
  for (const [k, run] of Object.entries(paths)) {
    await open(); await p.waitForSelector("#md .mb"); await edit();
    const val = await p.inputValue(field);
    await run(); await p.waitForTimeout(250);
    const d1 = await dlg(p);
    if (d1) await p.click('#cd [data-cd="no"]'); await p.waitForTimeout(150);
    const kept = (await winOpen(p)) && (await p.inputValue(field)) === val;
    await run(); await p.waitForTimeout(250);
    const d2 = await dlg(p);
    if (d2) await p.click('#cd [data-cd="yes"]'); await p.waitForTimeout(250);
    const closed = !(await winOpen(p)), onAdmin = p.url().includes("/admin/");
    res[k] = { asked: !!d1 && d1.title === DISCARD && d1.yes === "تجاهل" && d1.no === "متابعة التعديل", kept, askedAgain: !!d2, closed, onAdmin };
    if (await winOpen(p)) await p.evaluate(() => closeWin(false));
  }
  check(id, Object.values(res).every((r) => r.asked && r.kept && r.askedAgain && r.closed && r.onAdmin), res);
}

try {
  for (const W of [390, 1440]) {
    const t = "w" + W;
    console.log("== " + W + "px");
    await reset();
    const ctx = await ctxFor(W);
    const p = await page(ctx, t, OWNER);
    await p.goto(base + "/"); await p.goto(base + "/admin/index.html"); await p.waitForSelector('[data-a="tab"]', { timeout: 20000 });
    // windows (no edits)
    await tab(p, "w");
    await windowProbe(p, t + " S1 word window", () => p.click('[data-a="editW"][data-v="0.0"]'), '[data-a="editW"][data-v="0.0"]');
    await windowProbe(p, t + " S1 add-word window", () => p.click('[data-a="addW"]'), '[data-a="addW"]');
    await tab(p, "s");
    const s0 = await p.getAttribute('[data-a="editS"]', "data-v");
    await windowProbe(p, t + " S1 surah window", () => p.click(`[data-a="editS"][data-v="${s0}"]`), `[data-a="editS"][data-v="${s0}"]`);
    await tab(p, "c");
    await windowProbe(p, t + " S1 day window", () => p.click('[data-a="chDay"][data-v="1"]'), '[data-a="chDay"][data-v="1"]');
    await windowProbe(p, t + " S1 status window", () => p.click('[data-a="chStatus"]'), '[data-a="chStatus"]');
    // unsaved edits on every close path
    await closePaths(p, t + " M6 day window close paths", () => p.click('[data-a="chDay"][data-v="1"]'), () => p.fill('[data-f="c.note"]', "نص لم يُحفظ"), '[data-f="c.note"]');
    await tab(p, "w");
    await closePaths(p, t + " M6 word window close paths", () => p.click('[data-a="editW"][data-v="0.0"]'), () => p.fill('[data-f="e.m"]', "معنى لم يُحفظ"), '[data-f="e.m"]');
    // screenshots: word window, day window, unsaved prompt, a confirm dialog
    await p.click('[data-a="editW"][data-v="0.0"]'); await p.waitForSelector("#md .mb"); await p.waitForTimeout(150);
    await shot(p, t + "-word-window");
    await p.fill('[data-f="e.m"]', "معنى لم يُحفظ"); await p.click('#md .mh [data-a="close"]'); await p.waitForSelector("#cd.open"); await p.waitForTimeout(150);
    await shot(p, t + "-unsaved-prompt");
    await p.click('#cd [data-cd="yes"]'); await p.waitForTimeout(150);
    await tab(p, "c"); await p.click('[data-a="chDay"][data-v="1"]'); await p.waitForSelector("#md .mb"); await p.waitForTimeout(150);
    await shot(p, t + "-day-window");
    // S4: add and remove a word deep in the day window: scroll position and focus stay
    await p.evaluate(() => { document.querySelector("#md .mbd").scrollTop = 160; });
    await p.selectOption('[data-f="c.addS"]', { index: 2 }); await p.selectOption('[data-f="c.addW"]', { index: 1 });
    const st0 = await p.evaluate(() => document.querySelector("#md .mbd").scrollTop);
    await p.click('[data-a="chAddW"]'); await p.waitForTimeout(150);
    const afterAdd = await p.evaluate(() => ({ st: document.querySelector("#md .mbd").scrollTop, focus: document.activeElement.dataset.a }));
    await p.click('[data-a="chDelW"][data-v="1"]'); await p.waitForSelector("#cd.open");
    const pr = await dlg(p);
    await shot(p, t + "-confirm-dialog");
    await p.click('#cd [data-cd="yes"]'); await p.waitForTimeout(150);
    const afterDel = await p.evaluate(() => ({ st: document.querySelector("#md .mbd").scrollTop, focus: document.activeElement.dataset.a }));
    check(t + " S4 day window keeps scroll and focus", Math.abs(afterAdd.st - st0) < 2 && afterAdd.focus === "chAddW" && afterDel.focus === "chDelW", { st0, afterAdd, afterDel });
    check(t + " S5 remove-from-day prompt is accurate", /^إزالة «.+» من اليوم 1؟$/.test(pr.title) && pr.body.includes("لا يُحفظ شيء حتى تضغط «حفظ اليوم»"), pr);
    await p.evaluate(() => closeWin(false));
    // L5: the phone keyboard shrinks the visible area; the save button stays visible
    if (W < 600) {
      await p.click('[data-a="chDay"][data-v="2"]'); await p.waitForSelector("#md .mb");
      await p.focus('[data-f="c.note"]'); await p.setViewportSize({ width: 390, height: 430 }); await p.waitForTimeout(400);
      const k = await p.evaluate(() => { const s = document.querySelector('[data-a="chSaveDay"]').getBoundingClientRect(), n = document.querySelector('[data-f="c.note"]').getBoundingClientRect(); return { saveVisible: s.top >= 0 && s.bottom <= innerHeight, noteVisible: n.top >= 0 && n.bottom <= innerHeight, vh: innerHeight }; });
      await shot(p, t + "-keyboard-up");
      check(t + " L5 save button visible with the keyboard up", k.saveVisible && k.noteVisible, k);
      await p.setViewportSize({ width: 390, height: 844 }); await p.evaluate(() => closeWin(false));
      // S8 / S9 layouts
      await tab(p, "w");
      const wl = await p.evaluate(() => [...document.querySelectorAll(".wl .row")].slice(0, 6).map((r) => { const w = r.querySelector(".rw").getBoundingClientRect(), m = r.querySelector(".t").getBoundingClientRect(); return { below: m.top >= w.bottom - 2, wide: m.width / r.getBoundingClientRect().width }; }));
      await shot(p, t + "-words-list");
      check(t + " S8 meaning stacks under the word", wl.every((x) => x.below && x.wide > 0.8), wl);
      await tab(p, "s");
      const sl = await p.evaluate(() => [...document.querySelectorAll(".sl .row")].slice(0, 8).map((r) => { const n = r.querySelector(".t").getBoundingClientRect(), c = r.querySelector(".cnt").getBoundingClientRect(); return { ownLine: c.top >= n.bottom - 4, overlap: !(c.right <= n.left || c.left >= n.right || c.bottom <= n.top || c.top >= n.bottom) }; }));
      await shot(p, t + "-surahs-list");
      check(t + " S9 surah count on its own line", sl.every((x) => x.ownLine && !x.overlap), sl);
      // overflow
      const ov = await p.evaluate(() => document.scrollingElement.scrollWidth - innerWidth);
      check(t + " no horizontal overflow", ov <= 1, ov);
    }
    await ctx.close();
  }

  // ---------- messages, search, MSA text, removed import, field errors, toasts, native dialogs (390)
  {
    await reset();
    const ctx = await ctxFor(390);
    const p = await page(ctx, "text", OWNER);
    const texts = [];
    for (const k of ["s", "w", "c", "a", "t"]) { await tab(p, k); texts.push(await p.textContent("#app")); }
    await tab(p, "t");
    check("M5 no import from the published words.json", !(await p.$('[data-a="pub"]')) && !texts.join(" ").includes("المنشور"), await p.textContent("#app .c2"));
    await tab(p, "c");
    const banner = await p.textContent("#app .demo");
    check("M3 challenge notice is true", banner.includes("بعد النشر التالي") && !/دقيقة|فورًا|فورا/.test(banner), banner);
    // S10 search
    await tab(p, "w"); await p.fill('[data-f="fq"]', "شانيك"); await p.waitForTimeout(150);
    const ya = await p.evaluate(() => document.querySelectorAll(".wl .row").length);
    await p.fill('[data-f="fq"]', "شانئك"); await p.waitForTimeout(150);
    const hamza = await p.evaluate(() => document.querySelectorAll(".wl .row").length);
    await shot(p, "s10-search");
    check("S10 search matches ي and ئ", ya === 1 && hamza === 1, { ya, hamza });
    await p.fill('[data-f="fq"]', "");
    // S13 + S11 inside windows
    await p.click('[data-a="addW"]'); await p.waitForSelector("#md .mb");
    await p.click('[data-a="saveW"]'); await p.waitForTimeout(200);
    const marks = await p.evaluate(() => [...document.querySelectorAll('#md [aria-invalid="true"]')].map((i) => { const e = document.getElementById(i.getAttribute("aria-describedby")); return { f: i.dataset.f, near: !!e && (i.nextElementSibling === e || (i.parentElement.classList.contains("sg") && i.parentElement.nextElementSibling === e)), text: e && e.textContent }; }));
    await shot(p, "s13-word-errors");
    check("S13 word window marks each invalid field", marks.length >= 4 && marks.every((m) => m.near && /[؀-ۿ]/.test(m.text)), marks);
    texts.push(await p.textContent("#md"));
    await p.evaluate(() => closeWin(false));
    await tab(p, "c"); await p.fill('[data-f="m.releasedUpTo"]', "99"); await p.click('[data-a="chSaveMeta"]'); await p.waitForTimeout(500);
    const meta = await p.evaluate(() => { const i = document.querySelector('[data-f="m.releasedUpTo"]'), e = document.getElementById(i.getAttribute("aria-describedby") || "-"); return { invalid: i.getAttribute("aria-invalid"), near: !!e && i.nextElementSibling === e, text: e && e.textContent }; });
    check("S13 settings value marked next to the field", meta.invalid === "true" && meta.near, meta);
    check("M1 settings button refuses 99", (await readCh()).releasedUpTo == null, (await readCh()).releasedUpTo);
    await tab(p, "a"); await p.fill("#ae", "not-an-email"); await p.click('[data-a="addA"]'); await p.waitForTimeout(200);
    const ae = await p.evaluate(() => { const i = document.getElementById("ae"); return { invalid: i.getAttribute("aria-invalid"), near: i.parentElement.nextElementSibling && i.parentElement.nextElementSibling.classList.contains("ferr") }; });
    check("S13 admin email marked next to the field", ae.invalid === "true" && ae.near, ae);
    texts.push(await p.textContent("#app"));
    // S12 toast: role, above an open window, at the top while a window is open
    await tab(p, "c"); await p.click('[data-a="chDay"][data-v="1"]'); await p.fill('[data-f="c.reelIg"]', "http://bad"); await p.click('[data-a="chSaveDay"]'); await p.waitForTimeout(250);
    const ts = await p.evaluate(() => { const t = document.getElementById("toast"), r = t.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { role: t.getAttribute("role"), live: t.getAttribute("aria-live"), onTop: !!hit && t.contains(hit), top: r.top < innerHeight / 3, text: t.textContent }; });
    await shot(p, "s12-toast-over-window");
    check("S12 toast role=status and above the window", ts.role === "status" && ts.onTop && ts.top, ts);
    texts.push(await p.textContent("#md"));
    await p.evaluate(() => closeWin(false));
    // S11: no colloquial phrase in the page source (all UI text lives there; rendered lists also hold Quran data), and
    // no English word in the rendered UI apart from addresses, links and platform hosts
    const src = fs.readFileSync(path.join(REPO, "public/admin/index.html"), "utf8");
    const BAD = ["releasedUpTo (", "مطلوبين", "لازم", "اتعدلت", "تاني", "بيتحفظ", "تقدر ترجع", "فيه كلمات", "اربط Firebase", "إيميل", "جاري", "ظاهر على الموقع", "ظاهر أول", "إنستغرام", "challenge.json المنشور"];
    const shown = texts.join("\n");
    const TECH = /[\w.+-]+@[\w.-]+|https?:\/\/\S*|tiktok\.com|youtube\.com|youtu\.be|instagram\.com|vm\.tiktok\.com/g;
    const english = shown.replace(TECH, "").match(/[A-Za-z]{4,}/g) || [];
    check("S11 no colloquial or English UI text", BAD.every((b) => !src.includes(b)) && !english.length, BAD.filter((b) => src.includes(b)).concat(english));
    check("rename: admin link label", shown.includes("رابط إنستجرام"), "");
    // S14: undo and import ask in the app's dialog
    await tab(p, "t"); await p.click('[data-a="undo"]'); await p.waitForTimeout(150);
    const u = await dlg(p); if (u) await p.click('#cd [data-cd="no"]');
    const tmp = path.join(OUT, "import.json"); fs.writeFileSync(tmp, JSON.stringify(SEED.data.surahs));
    await p.setInputFiles('[data-f="imp"]', tmp); await p.waitForTimeout(300);
    const im = await dlg(p); if (im) await p.click('#cd [data-cd="no"]');
    check("S14 undo and import use the app dialog", !!u && !!im && natives.length === 0, { undo: u, import: im, natives });
    await ctx.close();
  }

  // ---------- M3 messages and untouched fields (a word saved without changes keeps its stored meaning verbatim)
  {
    await reset();
    const ctx = await ctxFor(1440);
    const p = await page(ctx, "save", OWNER);
    await tab(p, "w"); await p.fill('[data-f="fq"]', "ثجاجا"); await p.waitForTimeout(150);
    const before = wordOf(await readData(), "ثَجَّاجًا");
    await p.click('[data-a="editW"]'); await p.waitForSelector("#md .mb"); await p.click('[data-a="saveW"]'); await p.waitForTimeout(1500);
    const msg = await toastText(p); await shot(p, "m3-save-message");
    const after = wordOf(await readData(), "ثَجَّاجًا");
    check("M3 word save message is true", msg === "تم الحفظ، وسيظهر على الموقع بعد النشر التالي.", msg);
    check("saving a word without changes keeps its stored meaning and ayah", JSON.stringify(before) === JSON.stringify(after), { before: before.m, after: after.m });
    await ctx.close();
  }

  // ---------- M1 + M2 + S7: two tabs, settings never saved by a day save
  {
    await reset();
    const ctx = await ctxFor(1440);
    const a = await page(ctx, "tabA", OWNER);
    const b = await page(ctx, "tabB"); await b.waitForSelector('[data-a="tab"]', { timeout: 20000 });
    for (const q of [a, b]) await tab(q, "c");
    // B has typed settings it never saved
    await b.fill('[data-f="m.releasedUpTo"]', "99"); await b.fill('[data-f="m.startDate"]', "2027-01-01");
    await a.click('[data-a="chDay"][data-v="1"]'); await a.fill('[data-f="c.reelIg"]', "https://www.instagram.com/reel/tabA/"); await a.click('[data-a="chSaveDay"]'); await a.waitForTimeout(1500);
    await b.click('[data-a="chDay"][data-v="2"]'); await b.fill('[data-f="c.reelTt"]', "https://www.tiktok.com/@b/video/2"); await b.click('[data-a="chSaveDay"]'); await b.waitForTimeout(1500);
    const st = await readCh();
    check("M2 two tabs: both day edits survive", st.days[0].reelIg === "https://www.instagram.com/reel/tabA/" && st.days[1].reelTt === "https://www.tiktok.com/@b/video/2", { day1: st.days[0].reelIg, day2: st.days[1].reelTt });
    check("M1 a day save never writes the settings", st.releasedUpTo == null && st.startDate == null, { releasedUpTo: st.releasedUpTo, startDate: st.startDate });
    check("M1 typed settings stay in the fields after a day save", (await b.inputValue('[data-f="m.releasedUpTo"]')) === "99", await b.inputValue('[data-f="m.releasedUpTo"]'));
    check("M3 day save message is true", (await toastText(b)) === "تم حفظ اليوم، وسيظهر على الموقع بعد النشر التالي.", await toastText(b));
    // the same day in both tabs: a conflict keeps the window and the edit, and retry saves it
    await a.reload(); await b.reload(); for (const q of [a, b]) { await q.waitForSelector('[data-a="tab"]', { timeout: 20000 }); await tab(q, "c"); }
    await a.click('[data-a="chDay"][data-v="3"]'); await b.click('[data-a="chDay"][data-v="3"]');
    await a.fill('[data-f="c.reelYt"]', "https://youtu.be/A"); await a.click('[data-a="chSaveDay"]'); await a.waitForTimeout(1500);
    await b.fill('[data-f="c.reelYt"]', "https://youtu.be/B"); await b.click('[data-a="chSaveDay"]'); await b.waitForTimeout(1500);
    const c1 = await b.evaluate(() => ({ open: !!document.querySelector("#md .mb"), err: (document.querySelector("#md .werr") || {}).textContent || "", retry: !!document.querySelector('#md [data-a="retry"]'), val: (document.querySelector('[data-f="c.reelYt"]') || {}).value }));
    await shot(b, "s7-day-conflict");
    await b.click('#md [data-a="retry"]'); await b.waitForTimeout(1500);
    check("S7 day conflict keeps the edit and retry saves it", c1.open && c1.retry && c1.val === "https://youtu.be/B" && (await readCh()).days[2].reelYt === "https://youtu.be/B" && !(await winOpen(b)), c1);
    // words: different words in two tabs both survive; the same word gives a conflict with retry
    for (const q of [a, b]) { await q.reload(); await q.waitForSelector('[data-a="tab"]', { timeout: 20000 }); await tab(q, "w"); }
    await a.click('[data-a="editW"][data-v="0.0"]'); await a.fill('[data-f="e.m"]', "معنى من التبويب الأول"); await a.click('[data-a="saveW"]'); await a.waitForTimeout(1500);
    await b.click('[data-a="editW"][data-v="0.1"]'); await b.fill('[data-f="e.m"]', "معنى من التبويب الثاني"); await b.click('[data-a="saveW"]'); await b.waitForTimeout(1500);
    let d = await readData();
    check("M2 two tabs: edits to different words both survive", d.surahs[0].meanings[0] === "معنى من التبويب الأول" && d.surahs[0].meanings[1] === "معنى من التبويب الثاني", d.surahs[0].meanings.slice(0, 2));
    // B opens the word, then A saves a change to it, then B saves
    await b.click('[data-a="editW"][data-v="0.0"]'); await b.waitForSelector("#md .mb");
    await a.click('[data-a="editW"][data-v="0.0"]'); await a.fill('[data-f="e.m"]', "معنى ثالث من التبويب الأول"); await a.click('[data-a="saveW"]'); await a.waitForTimeout(1500);
    await b.fill('[data-f="e.m"]', "معنى يتعارض"); await b.click('[data-a="saveW"]'); await b.waitForTimeout(1500);
    const c2 = await b.evaluate(() => ({ open: !!document.querySelector("#md .mb"), err: (document.querySelector("#md .werr") || {}).textContent || "", retry: !!document.querySelector('#md [data-a="retry"]'), val: (document.querySelector('[data-f="e.m"]') || {}).value }));
    await shot(b, "s7-word-conflict");
    await b.click('#md [data-a="retry"]'); await b.waitForTimeout(1500);
    d = await readData();
    check("S7 word conflict keeps the edit and retry saves it", c2.open && c2.retry && c2.val === "معنى يتعارض" && d.surahs[0].meanings[0] === "معنى يتعارض", c2);
    // L3: sign-out in another tab closes a clean window; a window with edits asks first
    await tab(b, "c"); await b.click('[data-a="chDay"][data-v="5"]'); await b.waitForSelector("#md .mb");
    await a.click('[data-a="out"]'); await b.waitForTimeout(1500);
    const clean = { window: await winOpen(b), login: !!(await b.$('[data-a="login"]')) };
    await signIn(a, OWNER); await b.waitForSelector('[data-a="tab"]', { timeout: 20000 });
    await tab(b, "c"); await b.click('[data-a="chDay"][data-v="5"]'); await b.fill('[data-f="c.note"]', "لم تُحفظ");
    await a.click('[data-a="out"]'); await b.waitForTimeout(1500);
    const asked = await dlg(b); await shot(b, "l3-signout-prompt");
    if (asked) await b.click('#cd [data-cd="yes"]'); await b.waitForTimeout(200);
    const dirtyRes = { asked: asked && asked.title, window: await winOpen(b), login: !!(await b.$('[data-a="login"]')) };
    check("L3 sign-out elsewhere closes windows (asking when edited) and shows sign-in", !clean.window && clean.login && dirtyRes.asked === DISCARD && !dirtyRes.window && dirtyRes.login, { clean, dirtyRes });
    await ctx.close();
  }

  // ---------- S3: busy state, one write per double click, offline and failed saves keep the window and the edits
  {
    await reset();
    const ctx = await ctxFor(390);
    const p = await page(ctx, "net", OWNER);
    await tab(p, "c"); await countTx(p);
    await p.evaluate(() => { const o = FB.fs.runTransaction; FB.fs = { ...FB.fs, runTransaction: async (...a) => { await new Promise((r) => setTimeout(r, 1500)); return o(...a); } }; });
    await p.click('[data-a="chDay"][data-v="3"]'); await p.fill('[data-f="c.reelIg"]', "https://www.instagram.com/reel/abc/");
    await p.dblclick('[data-a="chSaveDay"]'); await p.waitForTimeout(300);
    const busy = await p.evaluate(() => { const b = document.querySelector('[data-a="chSaveDay"]'); return { disabled: b.disabled, ariaBusy: b.getAttribute("aria-busy"), label: b.textContent }; });
    await shot(p, "s3-saving");
    await p.click('[data-a="chSaveDay"]', { force: true }).catch(() => {}); await p.waitForTimeout(3000);
    const n = await p.evaluate(() => ({ tx: window.__tx, sets: window.__sets }));
    check("S3 busy state while saving", busy.disabled && busy.ariaBusy === "true" && busy.label.includes("جارٍ الحفظ"), busy);
    check("S3 a double click saves once", n.tx === 1, n);
    await p.reload(); await p.waitForSelector('[data-a="tab"]', { timeout: 20000 }); await tab(p, "c");
    await p.click('[data-a="chDay"][data-v="4"]'); await p.fill('[data-f="c.reelIg"]', "https://www.instagram.com/reel/off/"); await p.fill('[data-f="c.note"]', "ملاحظة دون اتصال");
    await ctx.setOffline(true);
    await p.click('[data-a="chSaveDay"]'); await p.waitForTimeout(800);
    const off = await p.evaluate(() => ({ open: !!document.querySelector("#md .mb"), err: (document.querySelector("#md .werr") || {}).textContent || "", ig: document.querySelector('[data-f="c.reelIg"]').value, note: document.querySelector('[data-f="c.note"]').value, enabled: !document.querySelector('[data-a="chSaveDay"]').disabled }));
    await shot(p, "s3-offline-day");
    check("S3 offline day save: error shown, window and edits kept", off.open && off.err.includes("لا يوجد اتصال") && off.ig === "https://www.instagram.com/reel/off/" && off.note === "ملاحظة دون اتصال" && off.enabled, off);
    await ctx.setOffline(false); await p.waitForTimeout(1500);
    await p.click('#md [data-a="retry"]'); await p.waitForFunction(() => !document.querySelector("#md .mb"), null, { timeout: 20000 }).catch(() => {});
    check("S3 retry after reconnecting saves", (await readCh()).days[3].reelIg === "https://www.instagram.com/reel/off/" && !(await winOpen(p)), (await readCh()).days[3]);
    await tab(p, "w"); await p.click('[data-a="editW"][data-v="0.0"]'); await p.fill('[data-f="e.m"]', "معنى دون اتصال");
    await ctx.setOffline(true); await p.click('[data-a="saveW"]'); await p.waitForTimeout(800);
    const offW = await p.evaluate(() => ({ open: !!document.querySelector("#md .mb"), err: (document.querySelector("#md .werr") || {}).textContent || "", m: document.querySelector('[data-f="e.m"]').value }));
    await shot(p, "s3-offline-word");
    check("S3 offline word save: error shown, window and edits kept", offW.open && offW.err.includes("لا يوجد اتصال") && offW.m === "معنى دون اتصال", offW);
    await ctx.setOffline(false);
    await ctx.close();
    // M4: a failed load shows a load error with a retry, and the retry loads the admin
    const c2 = await ctxFor(390); const q = await page(c2, "loadfail");
    await q.evaluate(() => { window.__realGet = FB.fs.getDoc; FB.fs = { ...FB.fs, getDoc: async () => { const e = new Error("offline"); e.code = "unavailable"; throw e; } }; });
    await signIn(q, OWNER);
    const scr = (await q.textContent("#app")).replace(/\s+/g, " ").trim();
    await shot(q, "m4-load-error");
    await q.evaluate(() => { FB.fs = { ...FB.fs, getDoc: window.__realGet }; });
    await q.click('[data-a="reload"]'); await q.waitForSelector('[data-a="tab"]', { timeout: 20000 }).catch(() => {});
    check("M4 load failure shows a load error with retry, never 'not authorized'", scr.includes("تعذّر تحميل بيانات لوحة التحكم") && scr.includes("إعادة المحاولة") && !scr.includes("غير مصرّح") && !!(await q.$('[data-a="tab"]')), scr.slice(0, 140));
    await c2.close();
  }

  // ---------- S5 / S6: delete and rename prompts name the item, the consequence, and the challenge days that use it
  {
    await reset();
    const ctx = await ctxFor(1440);
    const p = await page(ctx, "refs", OWNER);
    await tab(p, "w"); await p.fill('[data-f="fq"]', "الصمد"); await p.waitForTimeout(150);
    await p.click('[data-a="delW"]'); await p.waitForSelector("#cd.open");
    const dw = await dlg(p); await p.click('#cd [data-cd="no"]');
    check("S5/S6 delete word prompt: names it, says what happens, lists the days", dw.title === "حذف الكلمة «الصَّمَدُ»؟" && dw.body.includes("اليوم 2") && dw.body.includes("التراجع"), dw);
    await p.click('[data-a="editW"]'); await p.fill('[data-f="e.w"]', "الصمد2"); await p.click('[data-a="saveW"]'); await p.waitForTimeout(300);
    const rn = await dlg(p); await shot(p, "s6-rename-warning"); if (rn) await p.click('#cd [data-cd="no"]');
    check("S6 renaming a word used by a day warns and lists the days", !!rn && rn.body.includes("اليوم 2") && (await readData()).surahs.some((s) => s.words.includes("الصَّمَدُ")), rn);
    await p.evaluate(() => closeWin(false));
    await tab(p, "s"); await p.click('[data-a="delS"]'); await p.waitForSelector("#cd.open");
    const ds = await dlg(p); await p.click('#cd [data-cd="no"]');
    check("S5 delete surah prompt names it and its words", /^حذف سورة «.+» وكل كلماتها؟$/.test(ds.title) && /كلم/.test(ds.body), ds);
    await tab(p, "a"); await p.click('[data-a="delA"]'); await p.waitForSelector("#cd.open");
    const da = await dlg(p); await p.click('#cd [data-cd="no"]');
    check("S5 remove admin prompt names the address", da.title === "إزالة المشرف " + HELPER + "؟", da);
    await ctx.close();
  }

  // ---------- L7: the publish build keeps only allow-listed fields in word references
  {
    const { publicChallenge } = await import(pathToFileURL(path.join(REPO, "scripts/publish-build.mjs")).href);
    const s = JSON.parse(JSON.stringify(SEED.ch)); s.notes = { 1: "SECRET-TOP" }; s.days[0].note = "SECRET-DAY"; s.days[0].w[0] = { ...s.days[0].w[0], note: "SECRET-REF" }; s.days[1].w = [[112, "الصمد", "SECRET-TUPLE"]];
    const out = JSON.stringify(publicChallenge(s));
    check("L7 no extra field reaches the public challenge", !/SECRET/.test(out) && /"no":114,"word":"الخناس"/.test(out), out.slice(0, 200));
  }
} finally {
  await br.close(); server.close();
}
check("no request reached a Google host", leaks.filter((u) => !/apis\.google\.com\/js\/api\.js|google\.com\/images\/cleardot/.test(u)).length === 0, leaks.slice(0, 5));
check("no native browser dialog", natives.length === 0, natives);
check("no page errors", pageErrors.length === 0, pageErrors);
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(R, null, 1));
console.log((fails.length ? "FAILURES (" + fails.length + "):\n" + fails.join("\n") : "ALL ADMIN CHECKS PASSED") + "\nresults -> " + path.join(OUT, "results.json"));
process.exit(fails.length ? 1 : 0);
