// The admin when every read returns map keys in another order, as production does, in the EMULATORS only (the emulator
// itself keeps the stored order, which is how this bug stayed hidden). The real admin page, real rules and real clicks;
// the page's getDoc and its transaction reads are wrapped so each read reorders the keys at every level, values untouched.
// Every save path, the conflict picker and the changes window. Prints counts and booleans, never Quran text or meanings.
// Words: public/words.json, or KEYORDER_EXPORT=<a Firestore export folder> for that export's public-data.json.
// Run by test/admin-keyorder-emulator.test.js, inside emulators:exec with auth and firestore. ASCII only.
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
const check = (id, ok, extra) => { console.log((ok ? "PASS  " : "FAIL  ") + id + (extra !== undefined && !ok ? "  " + JSON.stringify(extra) : "")); if (ok) passed++; else fail++; };
const raw = async (k) => { let o; await env.withSecurityRulesDisabled(async (c) => { const s = await c.firestore().doc(k).get(); o = s.exists ? s.data() : null; }); return o; };
const write = (k, v) => env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc(k).set(v); });
const revs = async (coll) => { let o; await env.withSecurityRulesDisabled(async (c) => { o = (await c.firestore().collection(coll).get()).docs.map((d) => +d.id).sort((a, b) => a - b); }); return o; };
const sortK = (v) => Array.isArray(v) ? v.map(sortK) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortK(v[k])])) : v;
const eq = (a, b) => JSON.stringify(sortK(a)) === JSON.stringify(sortK(b));

const JUZ = (fs.readFileSync(path.join(REPO, "public/admin/index.html"), "utf8").match(/const JUZ="([^"]+)"/) || [])[1].split(",");
const EXP = process.env.KEYORDER_EXPORT;
const WORDS = EXP ? JSON.parse(fs.readFileSync(path.join(EXP, "public-data.json"), "utf8")).surahs : JSON.parse(fs.readFileSync(path.join(REPO, "public/words.json"), "utf8")).map((s) => Object.assign({ no: 78 + JUZ.indexOf(s.surah.replace(/^\S+\s*/, "")) }, s));
const ALL = WORDS.flatMap((s, si) => s.words.map((_, wi) => [si, wi]));
const SI = WORDS.findIndex((s) => s.words.length >= 2);

const NOTHING_SAVED = "لم يُحفظ شيء", MERGED = "دمج";
const NO_CHANGE_TEXT = "لم يتغيّر شيء", NO_CHANGE_ROW = "دون تغيير";
const ENCODING_HINT = "ترميز الحروف";

const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
const CACHE = path.join(os.tmpdir(), "ghareeb-fb-sdk-10.14.1"); fs.mkdirSync(CACHE, { recursive: true });
const sdk = async (n) => { const f = path.join(CACHE, n); if (!fs.existsSync(f)) { const r = await fetch(SDK + n); if (!r.ok) throw new Error(n + " " + r.status); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); } return fs.readFileSync(f); };
// each read gets its own order: the keys rotated by the read's number and, on odd reads, reversed
const WRAP = {
  "firebase-auth.js": `export * from "${SDK}firebase-auth.real.js";import {getAuth as g,connectAuthEmulator as c} from "${SDK}firebase-auth.real.js";export function getAuth(a){const x=g(a);if(!x.__emu){c(x,"http://${AUH}",{disableWarnings:true});x.__emu=1}return x}`,
  "firebase-firestore.js": `export * from "${SDK}firebase-firestore.real.js";import * as R from "${SDK}firebase-firestore.real.js";
export function getFirestore(a){const x=R.getFirestore(a);if(!x.__emu){R.connectFirestoreEmulator(x,"${host}",${port});x.__emu=1}return x}
let READS=0;
const order=(v,n)=>{if(Array.isArray(v))return v.map(x=>order(x,n));if(!v||typeof v!=="object"||Object.getPrototypeOf(v)!==Object.prototype)return v;const k=Object.keys(v),r=n%(k.length||1),l=k.slice(r).concat(k.slice(0,r));if(n%2)l.reverse();const o={};for(const q of l)o[q]=order(v[q],n);return o};
const wrap=s=>{const n=++READS;return{exists:()=>s.exists(),data:()=>s.exists()?order(s.data(),n):undefined,id:s.id,ref:s.ref,metadata:s.metadata}};
export async function getDoc(r){return wrap(await R.getDoc(r))}
export function runTransaction(db,fn,o){return R.runTransaction(db,tx=>fn({get:async r=>wrap(await tx.get(r)),set:(...a)=>tx.set(...a),update:(...a)=>tx.update(...a),delete:(...a)=>tx.delete(...a)}),o)}`,
};
const CONFIG = `window.FIREBASE_CONFIG={apiKey:"demo-key",authDomain:"${PROJECT}.firebaseapp.com",projectId:"${PROJECT}",appId:"1:1:web:1"};`;
const { server, base } = await serve(undefined, { liveFirebase: true });
const br = await chromium.launch(), leaks = [], pageErrors = [], consoleErrors = [];

async function login(email, sub) {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.route("**/firebase-config.js", (r) => r.fulfill({ contentType: "text/javascript", body: CONFIG }));
  await ctx.route(SDK + "*", async (r) => { const n = r.request().url().slice(SDK.length); if (WRAP[n]) return r.fulfill({ contentType: "text/javascript", body: WRAP[n] }); r.fulfill({ contentType: "text/javascript", body: await sdk(n.replace(".real.js", ".js")) }); });
  await ctx.route((u) => /googleapis\.com|firebaseio|firebaseapp\.com|google\.com|googleusercontent/.test(u.hostname), (r) => { leaks.push(r.request().url()); return r.abort(); });
  const p = await ctx.newPage(), net = { commit: 0 };
  p.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 160)));
  p.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED/.test(m.text())) consoleErrors.push(m.text().slice(0, 120)); });
  p.on("request", (q) => { if (/documents:commit/.test(q.url())) net.commit++; });
  await p.goto(base + "/admin/index.html");
  await p.waitForFunction(() => typeof FB !== "undefined" && FB.auth && READY, null, { timeout: 30000 });
  await p.evaluate(async ([e, s]) => { const { GoogleAuthProvider, signInWithCredential } = FB.au; await signInWithCredential(FB.auth, GoogleAuthProvider.credential(JSON.stringify({ sub: s, email: e, email_verified: true }))); }, [email, sub]);
  await p.waitForFunction(() => U && READY && D && CH && document.querySelector('[data-a="tab"]'), null, { timeout: 25000 });
  return { ctx, p, net };
}
const seed = async () => {
  await env.clearFirestore();
  await write("config/admins", { emails: [ADMIN] });
  await write("public/data", { rev: 6, surahs: WORDS, by: "someone" });
  await write("public/prev", { rev: 5, surahs: [], savedAt: new Date(0) });
  await write("public/challenge", { startDate: null, releasedUpTo: null, days: [] });
};
const fresh = async () => { await seed(); return login(OWNER, "owner-sub"); };
const tab = (p, v) => p.click(`[data-a="tab"][data-v="${v}"]`);
const openWord = async (p, si, wi) => { await tab(p, "w"); await p.waitForSelector(`[data-a="editW"][data-v="${si}.${wi}"]`); await p.click(`[data-a="editW"][data-v="${si}.${wi}"]`); await p.waitForSelector("#e-m"); };
// the save has ended: the window closed, or it shows a conflict, a window error or a field error
const ended = (p) => p.waitForFunction(() => !SAVING && (!document.querySelector("#e-m") || document.querySelector(".cf") || document.querySelector("#md .werr") || document.querySelector("#md [aria-invalid='true']")), null, { timeout: 25000 });
const pressSave = async (p) => { await p.click('[data-a="saveW"]'); await ended(p); await p.waitForTimeout(150); };
const seen = (p) => p.evaluate(([a, b]) => { const t = document.querySelector("#toast"), s = t.style.display !== "none" ? t.textContent : ""; return { nothingSaved: s.includes(a), merged: s.includes(b), bad: t.className.includes("bad"), conflicts: document.querySelectorAll(".cf").length, windowOpen: !!document.querySelector("#e-m"), windowError: !!document.querySelector("#md .werr"), fieldError: !!document.querySelector("#md [aria-invalid='true']") }; }, [NOTHING_SAVED, MERGED]);
const plainSave = (s) => !s.nothingSaved && !s.merged && !s.bad && !s.conflicts && !s.windowOpen && !s.windowError && !s.fieldError;
const openChanges = async (p, rev, mode) => {
  await tab(p, "t");
  await p.waitForFunction((r) => HIST && !HIST.loading && document.querySelector(`[data-a="hDiff"][data-v="${r}"]`), rev, { timeout: 15000 });
  await p.click(`[data-a="hDiff"][data-v="${rev}"]`);
  await p.waitForFunction(() => DF && !DF.loading, null, { timeout: 15000 });
  if (mode === "cur") { await p.click('[data-a="dMode"][data-v="cur"]'); await p.waitForFunction(() => DF && DF.mode === "cur" && !DF.loading, null, { timeout: 15000 }); }
  const out = await p.evaluate((txt) => {
    const b = document.querySelector("#md .mbd"), cards = [...b.querySelectorAll(".dc")];
    return { cards: cards.length, noChangeText: b.textContent.includes(txt), fieldsPerCard: cards.map((c) => c.querySelectorAll(".lb").length), kinds: DF ? HL.diff(fix({ surahs: clone(DF.mode === "prev" ? SNAPS[DF.k - 1] : SNAPS[DF.k]) }).surahs, fix({ surahs: clone(DF.mode === "prev" ? SNAPS[DF.k] : D.surahs) }).surahs, nm).words.map((w) => w.fields.map((f) => f.field).join(",")) : [] };
  }, NO_CHANGE_TEXT);
  await p.click('#md [data-a="close"]');
  await p.waitForFunction(() => !document.querySelector("#md .mb"), null, { timeout: 10000 });
  return out;
};
const noChange = (c) => c.cards === 0 && c.noChangeText;
const onlyField = (c, f) => c.cards === 1 && c.kinds.length === 1 && c.kinds[0] === f;

console.log("== the wrapper really reorders ==");
{
  const { ctx, p } = await fresh();
  const r = await p.evaluate(async () => {
    const R = () => FB.fs.getDoc(FB.fs.doc(FB.db, "public", "data")), a = (await R()).data().surahs, b = (await R()).data().surahs;
    let t; await FB.fs.runTransaction(FB.db, async (tx) => { t = (await tx.get(FB.fs.doc(FB.db, "public", "data"))).data().surahs; });
    const sort = (v) => Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])])) : v;
    const S = JSON.stringify;
    return { twoReadsDiffer: S(a) !== S(b), txDiffers: S(a) !== S(t) && S(b) !== S(t), sameValues: S(sort(a)) === S(sort(b)) && S(sort(a)) === S(sort(t)) };
  });
  check("two reads differ, and the transaction's read differs from both", r.twoReadsDiffer && r.txDiffers, r);
  check("the values are the same", r.sameValues);
  await ctx.close();
}

console.log("\n== a word saved with no edit ==");
{
  const { ctx, p, net } = await fresh();
  await openWord(p, SI, 0);
  const c0 = net.commit; await pressSave(p); const s = await seen(p), d = await raw("public/data"), h = await raw("history/7"), s6 = await raw("snapshots/6"), s7 = await raw("snapshots/7");
  check("no false 'already included' message, no conflict, no merge message", plainSave(s), s);
  check("one commit", net.commit - c0 === 1, net.commit - c0);
  check("rev 7, words identical", d.rev === 7 && eq(d.surahs, WORDS));
  check("history and snapshots are 6 and 7", JSON.stringify(await revs("history")) === "[6,7]" && JSON.stringify(await revs("snapshots")) === "[6,7]");
  check("baseline and snapshot hold the same words", s6 && s7 && eq(s6.surahs, WORDS) && eq(s7.surahs, WORDS));
  check("the row says no change", h.kind === "edit" && h.summary.includes(NO_CHANGE_ROW));
  const c = await openChanges(p, 7);
  check("changes window for 7: no word cards, and the no-change text", noChange(c), c);
  const b = await openChanges(p, 6, "cur");
  check("changes window, 6 against the current: no word cards, and the no-change text", noChange(b), b);
  await openWord(p, SI, 1); await pressSave(p);
  check("a second one: exactly one more version", plainSave(await seen(p)) && JSON.stringify(await revs("history")) === "[6,7,8]" && eq((await raw("public/data")).surahs, WORDS));
  await ctx.close();
}
{
  const { ctx, p } = await fresh(); let plain = 0, other = 0, rev = 6;
  for (const [si, wi] of ALL) { await openWord(p, si, wi); await pressSave(p); const s = await seen(p), d = await raw("public/data"); if (plainSave(s) && d.rev === rev + 1) plain++; else { other++; if (s.windowOpen || s.conflicts) await p.evaluate(() => closeWin(false)); } rev = d.rev; await p.evaluate(() => { const t = document.querySelector("#toast"); t.style.display = "none"; }); }
  const d = await raw("public/data");
  check(`every word (${ALL.length}): each makes one version, with no false message`, plain === ALL.length && other === 0, { plain, other });
  check("every word: the words are identical at the end, and there is one row per save plus the baseline", eq(d.surahs, WORDS) && (await revs("history")).length === ALL.length + 1);
  await ctx.close();
}
{
  const { ctx, p } = await fresh();
  await openWord(p, SI, 0);
  await p.click('#md [data-a="close"]');
  check("an untouched window closes without asking to discard", await p.waitForFunction(() => !document.querySelector("#md .mb") && !dlgOpen(), null, { timeout: 5000 }).then(() => true, () => false));
  await ctx.close();
}

console.log("\n== a real word edit ==");
{
  const { ctx, p, net } = await fresh();
  await openWord(p, SI, 0); await p.fill("#e-m", "edited-meaning");
  const c0 = net.commit; await pressSave(p); const s = await seen(p), d = await raw("public/data"), h = await raw("history/7");
  const want = JSON.parse(JSON.stringify(WORDS)); want[SI].meanings[0] = "edited-meaning";
  check("meaning only: plain save, one commit", plainSave(s) && net.commit - c0 === 1, s);
  check("meaning only: only that meaning changed", d.rev === 7 && eq(d.surahs, want));
  check("meaning only: one word in the row, no others counted", h.kind === "edit" && !h.summary.includes(" · ") && !h.summary.includes(NO_CHANGE_ROW));
  const c = await openChanges(p, 7);
  check("meaning only: the changes window lists one card, the meaning", onlyField(c, "meaning"), c);
  await ctx.close();
}
{
  // the first word whose highlight can grow by the next word of its ayah: the ayah's text stays the official text
  const [si, wi, gi] = (() => { for (const [a, b] of ALL) { const g = WORDS[a].ayahs[b].segments; for (let i = 0; i < g.length; i++) if (/^\s*\S+\s+\S/.test(g[i].after)) return [a, b, i]; } return [-1, -1, -1]; })();
  check("a word with text after its highlight exists", si >= 0);
  const { ctx, p, net } = await fresh();
  await openWord(p, si, wi);
  const g = WORDS[si].ayahs[wi].segments[gi], m = g.after.match(/^\s*\S+/)[0];
  await p.fill(`[data-f="g.${gi}.hl"]`, g.hl + m); await p.fill(`[data-f="g.${gi}.after"]`, g.after.slice(m.length));
  const c0 = net.commit; await pressSave(p); const s = await seen(p), d = await raw("public/data");
  const want = JSON.parse(JSON.stringify(WORDS)); want[si].ayahs[wi].segments[gi] = { num: g.num, before: g.before, hl: (g.hl + m).trim(), after: g.after.slice(m.length) };
  check("segments: plain save, no false conflict, one commit", plainSave(s) && net.commit - c0 === 1, s);
  check("segments: only that ayah part changed", d.rev === 7 && eq(d.surahs, want));
  const c = await openChanges(p, 7);
  check("segments: the changes window lists one card, the ayah text", onlyField(c, "segments"), c);
  await ctx.close();
}

console.log("\n== real conflicts and merges still work ==");
{
  const { ctx, p, net } = await fresh(), o = await login(ADMIN, "admin-sub");
  await openWord(p, SI, 0);
  await o.p.evaluate((si) => store.update((ss) => { ss[si].meanings[0] = "theirs"; return ss; }), SI);
  await p.fill("#e-m", "mine"); const c0 = net.commit; await pressSave(p); const s = await seen(p);
  check("both changed the meaning: a conflict on the meaning only, nothing written", s.conflicts === 1 && net.commit === c0 && (await raw("public/data")).rev === 7, s);
  await p.check('.cf input[value="mine"]'); await p.click('[data-a="saveC"]'); await ended(p);
  const d = await raw("public/data");
  check("picking mine saves mine, as one version", d.rev === 8 && d.surahs[SI].meanings[0] === "mine" && JSON.stringify(await revs("history")) === "[6,7,8]");
  await ctx.close(); await o.ctx.close();
}
{
  const { ctx, p } = await fresh(), o = await login(ADMIN, "admin-sub");
  await openWord(p, SI, 0);
  await o.p.evaluate((si) => store.update((ss) => { ss[si].meanings[1] = "other-word"; return ss; }), SI);
  await p.fill("#e-m", "mine"); await pressSave(p); const s = await seen(p), d = await raw("public/data");
  check("another word changed: a plain save that keeps both", plainSave(s) && d.surahs[SI].meanings[0] === "mine" && d.surahs[SI].meanings[1] === "other-word", s);
  await ctx.close(); await o.ctx.close();
}
{
  const { ctx, p } = await fresh(), o = await login(ADMIN, "admin-sub");
  await openWord(p, SI, 0);
  await o.p.evaluate((si) => store.update((ss) => { ss[si].meanings[0] = "theirs"; return ss; }), SI);
  await p.fill("#e-l", String(parseInt(WORDS[SI].ayahs[0].label, 10))); // unchanged value: no edit of the ayah
  await p.fill("#e-m", "theirs"); await pressSave(p); const s = await seen(p);
  check("the same edit made elsewhere: the true 'already included' message, nothing written", s.nothingSaved && !s.bad && (await raw("public/data")).rev === 7, s);
  await ctx.close(); await o.ctx.close();
}
{
  const { ctx, p } = await fresh(), o = await login(ADMIN, "admin-sub");
  await openWord(p, SI, 0);
  await o.p.evaluate((si) => store.update((ss) => { ss[si].meanings[0] = "theirs"; return ss; }), SI);
  await pressSave(p); const s = await seen(p);
  check("no edit, while the word really changed elsewhere: the true 'already included' message", s.nothingSaved && !s.conflicts && (await raw("public/data")).surahs[SI].meanings[0] === "theirs", s);
  await ctx.close(); await o.ctx.close();
}
{
  const { ctx, p } = await fresh();
  const shows = await p.evaluate((h) => { const f = (mine, theirs) => conflictHtml({ conf: { fields: [{ field: "segments", mine, theirs }], picks: {}, err: {} } }).includes(h); const a = { num: 1, before: "a", hl: "é", after: "" }; return { encodingOnly: f([a], [{ after: "", hl: "é", before: "a", num: 1 }]), realDifference: f([a], [{ after: "", hl: "x", before: "a", num: 1 }]) }; }, ENCODING_HINT);
  check("the encoding hint shows for an encoding difference under another key order, and not for a real one", shows.encodingOnly && !shows.realDifference, shows);
  await ctx.close();
}

console.log("\n== a word added through the form ==");
{
  const { ctx, p } = await fresh();
  const a = WORDS[SI].ayahs[0], w = WORDS[SI].words[0], m = WORDS[SI].meanings[0];
  const form = async (mean) => {
    await tab(p, "w"); await p.selectOption('[data-f="fs"]', String(SI)); await p.click('[data-a="addW"]'); await p.waitForSelector("#e-w");
    await p.evaluate(([w0, m0, a0]) => { ED.w = w0; ED.m = m0; ED.label = a0.label; ED.segs = a0.segments.map((g) => ({ num: g.num, before: g.before, hl: g.hl, after: g.after })); }, [w, mean, a]);
    await pressSave(p); return seen(p);
  };
  const s = await form(m), d = await raw("public/data");
  check("the same word, meaning and ayah: not refused as a duplicate, and the words stay identical", !s.fieldError && !s.windowOpen && d.rev === 7 && eq(d.surahs, WORDS), s);
  const s2 = await form("another-meaning");
  check("the same word with another meaning: still refused as a duplicate, nothing written", s2.fieldError && s2.windowOpen && (await raw("public/data")).rev === 7, s2);
  await ctx.close();
}

console.log("\n== surah edits ==");
{
  const { ctx, p } = await fresh();
  await tab(p, "s"); await p.waitForSelector('[data-a="editS"]');
  const n = await p.locator('[data-a="editS"]').count(); let good = 0, rev = 6;
  for (let i = 0; i < n; i++) { await p.locator('[data-a="editS"]').nth(i).click(); await p.waitForSelector('[data-a="saveS"]'); await p.click('[data-a="saveS"]'); await p.waitForFunction(() => !SAVING && !document.querySelector('[data-a="saveS"]'), null, { timeout: 25000 }); const d = await raw("public/data"); if (d.rev === rev + 1 && eq(d.surahs, WORDS)) good++; rev = d.rev; await p.waitForSelector('[data-a="editS"]'); }
  check(`every surah form (${n}) with no edit: one version each, the words identical`, good === n && n === WORDS.length, { good, n });
  const c = await openChanges(p, rev);
  check("no edit: the row says no change, and the changes window shows none", (await raw("history/" + rev)).summary.includes(NO_CHANGE_ROW) && noChange(c), c);
  await tab(p, "s"); await p.waitForSelector('[data-a="editS"]');
  await p.locator('[data-a="editS"]').first().click(); await p.waitForSelector("#e-src"); await p.fill("#e-src", "another source"); await p.click('[data-a="saveS"]'); await p.waitForFunction(() => !SAVING && !document.querySelector('[data-a="saveS"]'), null, { timeout: 25000 });
  const last = (await raw("public/data")).rev, e = await openChanges(p, last);
  check("a real source edit: one surah card and no word cards", e.cards === 1 && e.kinds.length === 0, e);
  await ctx.close();
}

console.log("\n== import ==");
{
  const { ctx, p } = await fresh();
  const reorder = (v) => Array.isArray(v) ? v.map(reorder) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).reverse().map((k) => [k, reorder(v[k])])) : v;
  await tab(p, "t"); await p.waitForFunction(() => HIST && !HIST.loading);
  await p.setInputFiles('[data-f="imp"]', { name: "words.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(reorder(WORDS))) });
  await p.click('[data-cd="yes"]'); await p.waitForFunction(() => D.rev === 7 && !SAVING, null, { timeout: 25000 });
  const d = await raw("public/data"), h = await raw("history/7");
  check("the same words in another key order: one version, kind import, the words identical", d.rev === 7 && h.kind === "import" && eq(d.surahs, WORDS) && JSON.stringify(await revs("history")) === "[6,7]");
  const c = await openChanges(p, 7);
  check("its changes window: no word cards, and the no-change text", noChange(c), c);
  const next = JSON.parse(JSON.stringify(WORDS)); next[SI].meanings[0] = "imported-meaning";
  await tab(p, "t"); await p.waitForFunction(() => HIST && !HIST.loading);
  await p.setInputFiles('[data-f="imp"]', { name: "words.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(reorder(next))) });
  await p.click('[data-cd="yes"]'); await p.waitForFunction(() => D.rev === 8 && !SAVING, null, { timeout: 25000 });
  const e = await openChanges(p, 8);
  check("one real change in the file: the changes window lists that one", onlyField(e, "meaning"), e);
  await ctx.close();
}

console.log("\n== restore ==");
{
  const { ctx, p } = await fresh();
  await openWord(p, SI, 0); await p.fill("#e-m", "edited-meaning"); await pressSave(p);
  await tab(p, "t"); await p.waitForFunction(() => HIST && !HIST.loading && document.querySelector('[data-a="hRestore"][data-v="6"]'), null, { timeout: 15000 });
  await p.click('#app [data-a="hRestore"][data-v="6"]'); await p.waitForSelector('#cd.open [data-cd="yes"]'); await p.click('[data-cd="yes"]');
  await p.waitForFunction(() => D.rev === 8 && !SAVING, null, { timeout: 25000 });
  const d = await raw("public/data"), h = await raw("history/8");
  check("restoring 6: one version, kind restore, the words identical to 6", d.rev === 8 && h.kind === "restore" && h.restoredFrom === 6 && eq(d.surahs, WORDS));
  const c = await openChanges(p, 8);
  check("its changes window lists the one word that came back", onlyField(c, "meaning"), c);
  const b = await openChanges(p, 6, "cur");
  check("6 against the current: no word cards, and the no-change text", noChange(b), b);
  const e = await openChanges(p, 7, "cur");
  check("7 against the current: the one word", onlyField(e, "meaning"), e);
  await ctx.close();
}

console.log("\n== a word deleted, and a challenge day saved ==");
{
  const { ctx, p } = await fresh();
  await tab(p, "w"); await p.click(`[data-a="delW"][data-v="${SI}.0"]`); await p.click('[data-cd="yes"]'); await p.waitForFunction(() => D.rev === 7 && !SAVING, null, { timeout: 25000 });
  const c = await openChanges(p, 7);
  check("deleting a word: the changes window lists that one", c.cards === 1 && c.kinds.length === 1, c);
  await ctx.close();
}
{
  const { ctx, p } = await fresh();
  const days = JSON.parse(fs.readFileSync(path.join(REPO, "public/challenge.json"), "utf8"));
  const doc = await p.evaluate((d) => chDoc(chFromLocal(d)), days);
  await write("public/challenge", doc);
  await p.evaluate(async () => { CH = await store.chLoad(); render(); });
  await tab(p, "c"); await p.waitForSelector('[data-a="chDay"]');
  await p.locator('[data-a="chDay"]').first().click(); await p.waitForSelector('[data-a="chSaveDay"]');
  await p.click('[data-a="chSaveDay"]');
  await p.waitForFunction(() => !SAVING && (!document.querySelector('[data-a="chSaveDay"]') || document.querySelector("#md .werr")), null, { timeout: 25000 });
  check("a challenge day saved with no edit: no false 'changed elsewhere'", (await p.locator("#md .werr").count()) === 0);
  await ctx.close();
}

check("no error on any page", pageErrors.length === 0, pageErrors.length);
check("no console error (a refused write would show here)", consoleErrors.length === 0, consoleErrors.slice(0, 3));
await br.close(); server.close();
check("no request reached a Google host", leaks.length === 0, leaks.length);
await env.cleanup();
console.log("\n" + passed + " passed, " + fail + " failed");
console.log(fail ? fail + " CHECKS FAILED" : "ALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
