// The admin's version history against the real rules, in the EMULATORS only: the real admin page and real transactions,
// signed in as an emulator user, on the real words. Every save path makes exactly one row with the right summary; the
// baseline on the first save; pagination; both comparisons of the changes window; restore; 390 px; the drop-down.
// Run by test/admin-history-emulator.test.js, inside emulators:exec with auth and firestore. ASCII only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { chromium } = require("playwright");
const { serve } = require("./lib.js");

const FSH = process.env.FIRESTORE_EMULATOR_HOST, AUH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const local = (h) => /^(127\.0\.0\.1|localhost):/.test(h || "");
if (!local(FSH) || !local(AUH)) { console.error("emulators only"); process.exit(1); }
const PROJECT = "demo-ghareeb";
const rules = fs.readFileSync(path.join(REPO, "firestore.rules"), "utf8");
const OWNER = (rules.match(/[\w.+-]+@[\w.-]+/) || [])[0], ADMIN = "admin2@example.test";
const [host, port] = FSH.split(":");
const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules, host, port: Number(port) } });
let fail = 0, passed = 0;
const check = (id, ok, extra) => { console.log((ok ? "PASS  " : "FAIL  ") + id + (extra !== undefined && !ok ? "  " + (typeof extra === "string" ? extra : JSON.stringify(extra)) : "")); if (ok) passed++; else fail++; };
const raw = async (k) => { let o; await env.withSecurityRulesDisabled(async (c) => { const s = await c.firestore().doc(k).get(); o = s.exists ? s.data() : null; }); return o; };
const write = (k, v) => env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc(k).set(v); });
const revs = async (coll) => { let o; await env.withSecurityRulesDisabled(async (c) => { o = (await c.firestore().collection(coll).get()).docs.map((d) => +d.id).sort((a, b) => a - b); }); return o; };

const JUZ = (fs.readFileSync(path.join(REPO, "public/admin/index.html"), "utf8").match(/const JUZ="([^"]+)"/) || [])[1].split(",");
const official = JSON.parse(fs.readFileSync(path.join(REPO, "public/words.json"), "utf8")).map((s) => Object.assign({ no: 78 + JUZ.indexOf(s.surah.replace(/^\S+\s*/, "")) }, s));
const SI = official.findIndex((s) => s.words.length >= 3), Q = (w) => "«" + w + "»";
const EDIT_M = "تعديل معنى ", ADD = "إضافة ", DEL = "حذف ", SEP = " · ";
const A_SURAH = "إضافة سورة ", E_SURAH = "تعديل سورة ", D_SURAH = "حذف سورة ";
const IMPORT = "استيراد من ملف", RESTORE = "استرجاع النسخة ", BASE = "النسخة الأساسية قبل بدء السجل";
const CURRENT = "الحالية", ADDED = "أُضيفت", CHANGED = "تعدّلت", GONE = "حُذفت";
const BEFORE = "قبل", AFTER = "بعد", NEW = "جديد";

const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
const CACHE = path.join(os.tmpdir(), "ghareeb-fb-sdk-10.14.1"); fs.mkdirSync(CACHE, { recursive: true });
const sdk = async (n) => { const f = path.join(CACHE, n); if (!fs.existsSync(f)) { const r = await fetch(SDK + n); if (!r.ok) throw new Error(n + " " + r.status); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); } return fs.readFileSync(f); };
const WRAP = {
  "firebase-auth.js": `export * from "${SDK}firebase-auth.real.js";import {getAuth as g,connectAuthEmulator as c} from "${SDK}firebase-auth.real.js";export function getAuth(a){const x=g(a);if(!x.__emu){c(x,"http://${AUH}",{disableWarnings:true});x.__emu=1}return x}`,
  "firebase-firestore.js": `export * from "${SDK}firebase-firestore.real.js";import {getFirestore as g,connectFirestoreEmulator as c} from "${SDK}firebase-firestore.real.js";export function getFirestore(a){const x=g(a);if(!x.__emu){c(x,"${host}",${port});x.__emu=1}return x}`,
};
const CONFIG = `window.FIREBASE_CONFIG={apiKey:"demo-key",authDomain:"${PROJECT}.firebaseapp.com",projectId:"${PROJECT}",appId:"1:1:web:1"};`;
const { server, base } = await serve(undefined, { liveFirebase: true });
const br = await chromium.launch(), leaks = [], pageErrors = [];

async function login(email, sub, opts) {
  const ctx = await br.newContext(Object.assign({ viewport: { width: 1280, height: 900 } }, opts));
  await ctx.route("**/firebase-config.js", (r) => r.fulfill({ contentType: "text/javascript", body: CONFIG }));
  await ctx.route(SDK + "*", async (r) => { const n = r.request().url().slice(SDK.length); if (WRAP[n]) return r.fulfill({ contentType: "text/javascript", body: WRAP[n] }); r.fulfill({ contentType: "text/javascript", body: await sdk(n.replace(".real.js", ".js")) }); });
  await ctx.route((u) => /googleapis\.com|firebaseio|firebaseapp\.com|google\.com|googleusercontent/.test(u.hostname), (r) => { leaks.push(r.request().url()); return r.abort(); });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 160)));
  await p.goto(base + "/admin/index.html");
  await p.waitForFunction(() => typeof FB !== "undefined" && FB.auth && READY, null, { timeout: 30000 });
  await p.evaluate(async ([e, s]) => { const { GoogleAuthProvider, signInWithCredential } = FB.au; await signInWithCredential(FB.auth, GoogleAuthProvider.credential(JSON.stringify({ sub: s, email: e, email_verified: true }))); }, [email, sub]);
  await p.waitForFunction(() => U && READY && D && document.querySelector('[data-a="tab"]'), null, { timeout: 20000 });
  return { ctx, p };
}
const tab = (p, v) => p.click(`[data-a="tab"][data-v="${v}"]`);
const revIs = (p, r) => p.waitForFunction((x) => D.rev === x && !SAVING, r, { timeout: 25000 });
const closed = (p) => p.waitForFunction(() => !document.querySelector("#md .mb"), null, { timeout: 25000 });
const seed = async (surahs, rev) => {
  await env.clearFirestore();
  await write("config/admins", { emails: [ADMIN] });
  await write("public/data", { rev, surahs, by: "someone" });
  await write("public/prev", { rev: rev - 1, surahs: [], savedAt: new Date(0) });
  await write("public/challenge", { startDate: null, releasedUpTo: null, days: [] });
};
const words = (ss, si) => ss[si].words;
const summaryOf = async (rev) => (await raw("history/" + rev)).summary;
// each save: exactly one new row (rev), with the summary, and the three documents agree
async function saved(id, rev, want, kind, extra) {
  const d = await raw("public/data"), h = await raw("history/" + rev), s = await raw("snapshots/" + rev), all = await revs("history");
  check(id + ": rev " + rev, d.rev === rev);
  check(id + ": exactly one new row", all.filter((r) => r >= rev).length === 1 && all[all.length - 1] === rev, all);
  check(id + ": the summary", h && h.summary === want, h && h.summary);
  check(id + ": kind " + (kind || "edit"), h && h.kind === (kind || "edit"), h && h.kind);
  check(id + ": the snapshot is the saved words", s && JSON.stringify(s.surahs) === JSON.stringify(d.surahs));
  check(id + ": author, address and one server time", h && h.by === d.by && typeof h.byEmail === "string" && h.at.toMillis() === d.updatedAt.toMillis());
  if (extra) await extra(h, d);
}

console.log("== the first save records the baseline, then every save path ==");
await seed(official, 4);
const prev0 = await raw("public/prev");
const { ctx, p } = await login(OWNER, "owner-sub");
await tab(p, "t");
await p.waitForSelector(".hl");
await p.waitForFunction(() => HIST && !HIST.loading);
check("before the first save the list says it starts with the first save", (await p.locator(".hl .row").count()) === 0 && (await p.locator(".hl").textContent()).length > 5);
check("the undo button is gone", (await p.locator('[data-a="undo"]').count()) === 0);

// word edit
await tab(p, "w");
const w0 = words(official, SI)[0], w1 = words(official, SI)[1];
await p.click(`[data-a="editW"][data-v="${SI}.0"]`); await p.waitForSelector("#e-m");
await p.fill("#e-m", "meaning-one"); await p.click('[data-a="saveW"]'); await closed(p);
const s5 = await raw("snapshots/5");
await saved("word edit", 5, EDIT_M + Q(w0));
const b4 = await raw("snapshots/4"), hb = await raw("history/4");
check("baseline: snapshots/4 is the data as it was, byte for byte", JSON.stringify(b4.surahs) === JSON.stringify(official) && b4.rev === 4);
check("baseline: history/4 is kind baseline, with its summary and no restoredFrom", hb.kind === "baseline" && hb.summary === BASE && !("restoredFrom" in hb));
check("the first save writes the baseline and its own row, nothing else", JSON.stringify(await revs("history")) === "[4,5]" && JSON.stringify(await revs("snapshots")) === "[4,5]");
check("public/prev is not written any more", JSON.stringify(await raw("public/prev")) === JSON.stringify(prev0));
check("only the meaning changed", JSON.stringify(s5.surahs.map((s, i) => i === SI ? { ...s, meanings: official[i].meanings } : s)) === JSON.stringify(official));

// a second save: no second baseline
await p.click(`[data-a="editW"][data-v="${SI}.1"]`); await p.waitForSelector("#e-m");
await p.fill("#e-m", "meaning-two"); await p.click('[data-a="saveW"]'); await closed(p);
await saved("second edit", 6, EDIT_M + Q(w1));

// word delete
const delName = words(official, SI)[2], delAyah = official[SI].ayahs[2], delMeaning = official[SI].meanings[2];
await p.click(`[data-a="delW"][data-v="${SI}.2"]`); await p.click('[data-cd="yes"]'); await revIs(p, 7);
await saved("word delete", 7, DEL + Q(delName));

// word add: the same word back, through the form, with the official ayah text
await p.selectOption('[data-f="fs"]', String(SI));
await p.click('[data-a="addW"]'); await p.waitForSelector("#e-w");
await p.fill("#e-w", delName); await p.fill("#e-m", delMeaning); await p.fill("#e-l", String(delAyah.label));
const g0 = delAyah.segments[0];
await p.fill('[data-f="g.0.num"]', String(g0.num)); await p.fill('[data-f="g.0.before"]', g0.before); await p.fill('[data-f="g.0.hl"]', g0.hl); await p.fill('[data-f="g.0.after"]', g0.after);
await p.click('[data-a="saveW"]'); await closed(p);
await saved("word add", 8, ADD + Q(delName));
await p.selectOption('[data-f="fs"]', "all");

// surah add, edit, delete
await tab(p, "s");
const free = await p.$$eval("#ns option", (o) => o.map((x) => x.value).filter((v) => v && v !== "*"));
const newS = free[0];
await p.selectOption("#ns", newS); await p.click('[data-a="addS"]'); await p.waitForSelector("#e-name");
await p.click('[data-a="saveS"]'); await closed(p);
await saved("surah add", 9, A_SURAH + Q(newS));
const iNew = await p.evaluate((n) => D.surahs.findIndex((e) => nm(e) === n), newS);
await p.click(`[data-a="editS"][data-v="${iNew}"]`); await p.waitForSelector("#e-src");
await p.fill("#e-src", "another source"); await p.click('[data-a="saveS"]'); await closed(p);
await saved("surah edit", 10, E_SURAH + Q(newS));
await p.click(`[data-a="delS"][data-v="${iNew}"]`); await p.click('[data-cd="yes"]'); await revIs(p, 11);
await saved("surah delete", 11, D_SURAH + Q(newS));

// import
await tab(p, "t");
const imp = official.slice(0, 5), impN = imp.reduce((n, s) => n + s.words.length, 0);
await p.setInputFiles('[data-f="imp"]', { name: "words.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imp)) });
await p.click('[data-cd="yes"]'); await revIs(p, 12);
await saved("import", 12, IMPORT + SEP + "5 سورة، " + impN + " كلمة", "import");

console.log("\n== merge save and conflict save: another admin saves while the editor is open ==");
const other = await login(ADMIN, "admin-sub");
await tab(p, "w");
const wm = words(imp, 0)[0];
await p.click('[data-a="editW"][data-v="0.0"]'); await p.waitForSelector("#e-m");
// the other admin changes another word, through the page's own save
await other.p.evaluate(() => store.update((ss) => { ss[1].meanings[0] = "from-the-other-admin"; return ss; }));
const o13 = await raw("history/13");
check("the other admin's row is theirs", o13.byEmail === ADMIN && o13.kind === "edit" && o13.by === (await other.p.evaluate(() => U.uid)));
await p.fill("#e-m", "merged-meaning"); await p.click('[data-a="saveW"]'); await closed(p);
await saved("merge save", 14, EDIT_M + Q(wm));
check("the merge kept the other admin's edit", (await raw("public/data")).surahs[1].meanings[0] === "from-the-other-admin");
await p.click('[data-a="editW"][data-v="0.0"]'); await p.waitForSelector("#e-m");
await other.p.evaluate(() => store.update((ss) => { ss[0].meanings[0] = "theirs"; return ss; }));
await p.fill("#e-m", "mine"); await p.click('[data-a="saveW"]'); await p.waitForSelector(".cf", { timeout: 25000 });
check("a conflict writes nothing until a value is picked", (await raw("public/data")).rev === 15);
await p.check('.cf input[value="mine"]'); await p.click('[data-a="saveC"]'); await closed(p);
await saved("conflict save", 16, EDIT_M + Q(wm));

console.log("\n== the list, and the changes window ==");
await tab(p, "t");
await p.waitForFunction(() => HIST && !HIST.loading && document.querySelector(".hl .row"));
check("opening the list reads no snapshot", (await p.evaluate(() => Object.keys(SNAPS).length)) === 0);
const rows = await p.$$eval(".hl .row", (r) => r.map((x) => ({ n: x.querySelector(".nb").textContent, s: x.querySelector(".hs").textContent, m: x.querySelector(".hm").textContent, cur: !!x.querySelector(".hcur"), diff: !!x.querySelector('[data-a="hDiff"]'), rest: !!x.querySelector('[data-a="hRestore"]'), q: x.querySelectorAll(".hs .q").length })));
check("newest first, one row per version", rows.map((r) => r.n).join() === "16,15,14,13,12,11,10,9,8,7,6,5,4", rows.map((r) => r.n));
check("only the latest row has the tag and has no restore", rows[0].cur && !rows[0].rest && rows[0].diff && rows.slice(1).every((r) => !r.cur && r.rest && r.diff));
check("the word is in the Quran face, without the marks", rows[0].q === 1 && !rows[0].s.includes("«"));
check("the row shows the author's address and a relative time with Western digits", rows[1].m.includes(ADMIN) && rows[0].m.includes(OWNER) && rows[0].m.includes("منذ") && !/[٠-٩]/.test(rows[0].m));
check("the rows are in the page's words, with no raw kind or id", !rows.some((r) => /edit|import|restore|baseline/i.test(r.s)));
await p.click('[data-a="hDiff"][data-v="8"]'); await p.waitForFunction(() => DF && !DF.loading);
const dt = (sel) => p.locator(sel).first().textContent();
check("the window's title and meta line", (await dt("#mdt")).includes("8") && (await dt("#md .mbd p")).includes(OWNER));
check("opening the window reads just the two versions", (await p.evaluate(() => Object.keys(SNAPS).sort().join())) === "7,8");
let cards = await p.$$eval("#md .dc", (c) => c.map((x) => ({ t: x.querySelector(".q").textContent, tag: x.querySelector(".tg").textContent, cls: x.querySelector(".tg").className, labels: [...x.querySelectorAll(".dv b")].map((b) => b.textContent) })));
check("default: compared with the version before; one card for the added word", cards.length === 1 && cards[0].t === delName && cards[0].tag === ADDED && cards[0].cls.includes("add"), cards);
check("an added word shows only the new side", cards[0].labels.every((l) => l === NEW), cards[0].labels);
check("the first toggle is on and names the version", (await p.getAttribute('[data-a="dMode"][data-v="prev"]', "aria-pressed")) === "true" && (await dt('[data-a="dMode"][data-v="prev"]')).includes("7"));
await p.click('[data-a="close"]'); await closed(p);
await p.click('[data-a="hDiff"][data-v="7"]'); await p.waitForFunction(() => DF && !DF.loading);
cards = await p.$$eval("#md .dc", (c) => c.map((x) => ({ tag: x.querySelector(".tg").textContent, labels: [...x.querySelectorAll(".dv b")].map((b) => b.textContent) })));
check("a deleted word shows only the before side", cards.length === 1 && cards[0].tag === GONE && cards[0].labels.every((l) => l === BEFORE), cards);
await p.click('[data-a="close"]'); await closed(p);
await p.click('[data-a="hDiff"][data-v="5"]'); await p.waitForFunction(() => DF && !DF.loading);
cards = await p.$$eval("#md .dc", (c) => c.map((x) => ({ tag: x.querySelector(".tg").textContent, labels: [...x.querySelectorAll(".dv b")].map((b) => b.textContent), del: getComputedStyle(x.querySelector(".dv.del .v")).textDecorationLine, txt: x.textContent })));
check("an edited word shows before (struck through) and after", cards.length === 1 && cards[0].tag === CHANGED && cards[0].labels.join() === BEFORE + "," + AFTER && cards[0].del === "line-through" && cards[0].txt.includes("meaning-one"), cards);
await p.click('[data-a="dMode"][data-v="cur"]'); await p.waitForFunction(() => DF && DF.mode === "cur" && !DF.loading);
check("second toggle: names the current version and is on", (await dt('[data-a="dMode"][data-v="cur"]')).includes("16") && (await p.getAttribute('[data-a="dMode"][data-v="cur"]', "aria-pressed")) === "true");
const curCards = await p.$$eval("#md .dc", (c) => c.map((x) => ({ w: x.querySelector(".q").textContent, tag: x.querySelector(".tg").textContent })));
check("compared with the current version: everything since, including words deleted by the import", curCards.some((c) => c.tag === GONE) && curCards.length > 10, curCards.length);
check("the older version's window offers restore", (await p.locator('#md .mft [data-a="hRestore"]').count()) === 1);
await p.click('[data-a="close"]'); await closed(p);
check("the focus returns to the row's button", (await p.evaluate(() => document.activeElement && document.activeElement.dataset.a)) === "hDiff");
await p.click('[data-a="hDiff"][data-v="16"]'); await p.waitForFunction(() => DF && !DF.loading);
check("the current version's window: no restore, no comparison with itself", (await p.locator('#md [data-a="hRestore"]').count()) === 0 && (await p.locator('[data-a="dMode"][data-v="cur"]').count()) === 0);
await p.click('[data-a="close"]'); await closed(p);
await p.click('[data-a="hDiff"][data-v="4"]'); await p.waitForFunction(() => DF && !DF.loading);
check("the baseline's window says there is nothing before it", (await p.locator("#md .dc").count()) === 0 && (await p.locator("#md .mbd").textContent()).length > 20);
await p.click('[data-a="close"]'); await closed(p);

console.log("\n== restore ==");
const rows0 = await revs("history");
await p.click('[data-a="hRestore"][data-v="5"]'); await p.waitForSelector("#cd.open");
const dlgT = await p.locator("#cdt").textContent(), dlgB = await p.locator("#cdb").textContent();
check("the dialog's title and body name versions 5 and 17", dlgT.includes("5") && dlgB.includes("17") && dlgB.includes("نسخة 5"), dlgT + " / " + dlgB);
check("cancel changes nothing", await (async () => { await p.click('[data-cd="no"]'); return (await raw("public/data")).rev === 16; })());
await p.click('[data-a="hRestore"][data-v="5"]'); await p.click('[data-cd="yes"]'); await revIs(p, 17);
const r17 = await raw("public/data");
await saved("restore", 17, RESTORE + "5", "restore", async (h) => {
  check("restore: restoredFrom", h.restoredFrom === 5);
  check("restore: the words are version 5's, byte for byte", JSON.stringify(r17.surahs) === JSON.stringify(s5.surahs));
});
check("restore: every older version remains", JSON.stringify((await revs("history")).slice(0, -1)) === JSON.stringify(rows0) && JSON.stringify(await revs("snapshots")) === JSON.stringify(rows0.concat(17)));
check("restore: the old versions are unchanged", JSON.stringify((await raw("snapshots/5")).surahs) === JSON.stringify(s5.surahs));
await p.waitForFunction(() => document.querySelector('.hl .row .nb') && document.querySelector('.hl .row .nb').textContent === "17");
check("restore: the new row is the current one", (await p.locator(".hl .row").first().locator(".hcur").count()) === 1);
// restore from the changes window, and back again
await p.click('[data-a="hDiff"][data-v="16"]'); await p.waitForFunction(() => DF && !DF.loading);
await p.click('#md [data-a="hRestore"]'); await p.click('[data-cd="yes"]'); await revIs(p, 18); await closed(p);
await saved("restore from the window", 18, RESTORE + "16", "restore");

console.log("\n== restore: refused when the data moved on, and asks first with unsaved edits ==");
await p.waitForFunction(() => document.querySelector('.hl [data-a="hRestore"][data-v="5"]'));
await p.click('[data-a="hRestore"][data-v="5"]'); await p.waitForSelector("#cd.open");
await other.p.evaluate(() => store.update((ss) => { ss[0].source = "moved-on"; return ss; }));
await p.click('[data-cd="yes"]');
await p.waitForFunction(() => D.rev === 19 && !SAVING);
check("a stale restore writes nothing: the other admin's save stands", (await raw("public/data")).rev === 19 && (await raw("public/data")).surahs[0].source === "moved-on");
check("and says so", (await p.locator("#toast").getAttribute("class")).includes("bad"));
await tab(p, "c"); await p.waitForSelector('[data-f="m.startDate"]');
await p.fill('[data-f="m.startDate"]', "2027-01-01");
await tab(p, "t"); await p.waitForFunction(() => document.querySelector('.hl [data-a="hRestore"][data-v="5"]'));
await p.click('[data-a="hRestore"][data-v="5"]'); await p.waitForSelector("#cd.open");
const askT = await p.locator("#cdt").textContent();
check("unsaved edits elsewhere: it asks first", !askT.includes("5"), askT);
await p.click('[data-cd="no"]');
check("keeping the edits restores nothing", (await raw("public/data")).rev === 19 && (await p.evaluate(() => META && META.startDate)) === "2027-01-01");
await p.evaluate(() => { META = null; });

console.log("\n== a word in a row is inert, whatever it holds ==");
const HOSTILE = '<img src=x onerror="window.__x=1"><svg onload="window.__x=1">';
await write("history/19", { rev: 19, kind: "edit", summary: EDIT_M + Q(HOSTILE), by: "x", byEmail: HOSTILE, at: new Date() });
await write("snapshots/19", { rev: 19, surahs: [{ surah: "سورة " + HOSTILE, no: 78, words: [HOSTILE], meanings: [HOSTILE], ayahs: [{ label: HOSTILE, segments: [{ num: 1, before: HOSTILE, hl: HOSTILE, after: HOSTILE }] }], source: HOSTILE }] });
await p.evaluate(() => { HIST = null; delete SNAPS[19]; render(); });
await p.waitForFunction(() => HIST && !HIST.loading);
await p.click('[data-a="hDiff"][data-v="19"]'); await p.waitForFunction(() => DF && !DF.loading);
await p.waitForTimeout(250);
check("nothing in a row or the window runs", (await p.evaluate(() => window.__x)) === undefined && (await p.locator("#md img, #app .hl img, #md svg[onload]").count()) === 0);
await p.click('[data-a="close"]'); await closed(p);
await write("history/19", { rev: 19, kind: "edit", summary: "x", by: "x", byEmail: "a@b.test", at: new Date() });

console.log("\n== pagination ==");
await seed(official, 45);
for (let r = 1; r <= 45; r++) await write("history/" + r, { rev: r, kind: "edit", summary: "row " + r, by: "x", byEmail: "a@b.test", at: new Date(Date.now() - r * 3600000) });
await p.evaluate(() => store.load().then((n) => { D = n; HIST = null; render(); }));
await p.waitForFunction(() => HIST && !HIST.loading && document.querySelectorAll(".hl .row").length);
const nbs = () => p.$$eval(".hl .row .nb", (n) => n.map((x) => +x.textContent));
let l = await nbs();
check("20 rows first, newest first", l.length === 20 && l[0] === 45 && l[19] === 26, l.length);
await p.click('[data-a="hMore"]'); await p.waitForFunction(() => document.querySelectorAll(".hl .row").length === 40);
l = await nbs();
check("the next 20, in order", l[20] === 25 && l[39] === 6);
check("the focus moves to the first new row", (await p.evaluate(() => document.activeElement && document.activeElement.dataset.v)) === "25");
await p.click('[data-a="hMore"]'); await p.waitForFunction(() => document.querySelectorAll(".hl .row").length === 45);
l = await nbs();
check("all of them, no gaps, and no more button", l[44] === 1 && new Set(l).size === 45 && (await p.locator('[data-a="hMore"]').count()) === 0);
await ctx.close(); await other.ctx.close();

console.log("\n== phones (390 px): nothing is cut, nothing scrolls sideways ==");
await seed(official, 7);
const LONG_MAIL = "a.very.long.address.of.an.admin.for.this.test@a-long-subdomain.example.test";
for (let r = 1; r <= 7; r++) {
  await write("history/" + r, { rev: r, kind: "edit", summary: EDIT_M + Q(official[0].words[0]) + SEP + EDIT_M + Q(official[1].words[0]) + SEP + "و 12 تعديلًا آخر", by: "x", byEmail: LONG_MAIL, at: new Date(Date.now() - r * 3600000) });
  await write("snapshots/" + r, { rev: r, surahs: official });
}
for (const scheme of ["light", "dark"]) {
  const s = await login(OWNER, "owner-sub", { viewport: { width: 390, height: 844 }, colorScheme: scheme, hasTouch: true });
  await tab(s.p, "t");
  await s.p.waitForFunction(() => HIST && !HIST.loading && document.querySelectorAll(".hl .row").length === 7);
  const m = await s.p.evaluate(() => {
    const bad = [];
    document.querySelectorAll(".hl .row, .hl .row *").forEach((e) => { const c = getComputedStyle(e); if (c.textOverflow === "ellipsis" && e.scrollWidth > e.clientWidth) bad.push("ellipsis " + e.className); if (e.scrollWidth > e.clientWidth + 1 && c.overflowX !== "visible") bad.push("clipped " + e.className); });
    const rows = [...document.querySelectorAll(".hl .row")].map((r) => { const t = r.querySelector(".ht").getBoundingClientRect(), a = r.querySelector(".hact").getBoundingClientRect(), R = r.getBoundingClientRect(); return { under: a.top >= t.bottom - 1, inside: t.right <= R.right + 1 && t.left >= R.left - 1 && a.left >= R.left - 1 && a.right <= R.right + 1 }; });
    return { bad, rows, hs: document.documentElement.scrollWidth - innerWidth, tooSmall: [...document.querySelectorAll(".hl button")].filter((b) => { const r = b.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).length };
  });
  check(scheme + " 390: no ellipsis or clipped text in the list", m.bad.length === 0, m.bad);
  check(scheme + " 390: no sideways scroll", m.hs <= 0, m.hs);
  check(scheme + " 390: the buttons wrap under the text", m.rows.every((r) => r.under), m.rows);
  check(scheme + " 390: every row fits the card", m.rows.every((r) => r.inside), m.rows);
  check(scheme + " 390: touch targets at least 44 px", m.tooSmall === 0, m.tooSmall);
  await s.p.click('[data-a="hDiff"][data-v="6"]'); await s.p.waitForFunction(() => DF && !DF.loading);
  await s.p.click('[data-a="dMode"][data-v="cur"]'); await s.p.waitForFunction(() => DF && DF.mode === "cur" && !DF.loading);
  const w = await s.p.evaluate(() => { const b = document.querySelector("#md .mbd"); return { hs: b.scrollWidth - b.clientWidth, page: document.documentElement.scrollWidth - innerWidth, foot: !!document.querySelector("#md .mft") }; });
  check(scheme + " 390: the window does not scroll sideways", w.hs <= 0 && w.page <= 0, w);
  await s.ctx.close();
}

console.log("\n== the drop-down: admin, and the public pages ==");
const LUM = (c) => { const [r, g, b] = c.match(/[\d.]+/g).map(Number).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const CR = (a, b) => { const [x, y] = [LUM(a), LUM(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
for (const scheme of ["light", "dark"]) {
  const s = await login(OWNER, "owner-sub", { colorScheme: scheme });
  await tab(s.p, "w");
  const o = await s.p.evaluate(() => { const se = document.querySelector('[data-f="fs"]'), op = se.querySelector("option"), c = getComputedStyle(op); return { scheme: getComputedStyle(document.documentElement).colorScheme, seScheme: getComputedStyle(se).colorScheme, bg: c.backgroundColor, fg: c.color }; });
  check(scheme + ": the admin page's color-scheme", o.scheme === scheme && o.seScheme === scheme, o);
  check(scheme + ": the option's background is opaque", /^rgb\(/.test(o.bg), o.bg);
  check(scheme + ": the option's text reads at 4.5:1 or better", CR(o.bg, o.fg) >= 4.5, CR(o.bg, o.fg).toFixed(2));
  const t = await s.p.evaluate(() => { const v = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(); return ["g", "a", "r"].map((k) => [v("--h" + k + "b"), v("--h" + k + "t"), v("--hvt")]); });
  const hex = (h) => `rgb(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)})`;
  check(scheme + ": the three tints read at 4.5:1 or better", t.every(([b, c, v]) => CR(hex(b), hex(c)) >= 4.5 && CR(hex(b), hex(v)) >= 4.5), t.map(([b, c, v]) => [CR(hex(b), hex(c)).toFixed(2), CR(hex(b), hex(v)).toFixed(2)]));
  await s.ctx.close();
  // the public pages keep the browser's default
  const pub = await br.newContext({ colorScheme: scheme, serviceWorkers: "block" });
  await pub.route((u) => /googleapis\.com|firebaseio|firebaseapp\.com|google\.com|gstatic\.com|sentry/.test(u.hostname), (r) => r.abort());
  for (const url of ["/index.html", "/about/index.html", "/privacy/index.html", "/terms/index.html", "/rights/index.html"]) {
    const q = await pub.newPage();
    await q.goto(base + url, { waitUntil: "load" });
    const cs = await q.evaluate(() => [getComputedStyle(document.documentElement).colorScheme, getComputedStyle(document.body).colorScheme]);
    check(scheme + " public " + url + ": color-scheme is untouched", cs[0] === "normal" && cs[1] === "normal", cs);
    await q.close();
  }
  await pub.close();
}

check("no error on any page", pageErrors.length === 0, pageErrors.slice(0, 5));
await br.close(); server.close();
check("no request reached a Google host", leaks.length === 0, leaks.slice(0, 3).join(" "));
await env.cleanup();
console.log("\n" + passed + " passed, " + fail + " failed");
console.log(fail ? fail + " CHECKS FAILED" : "ALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
