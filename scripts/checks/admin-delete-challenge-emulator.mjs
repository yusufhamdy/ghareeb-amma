// A delete in the admin takes its challenge references with it, in the same save, against the real rules, in the
// EMULATORS only: the real admin page, signed in as a helper admin (the stricter rules path), on the real words and the
// real challenge. One confirmation writes the words (with its history row, kind "edit") and the challenge in one
// transaction; days are never removed, and a day the delete would leave with no words is named in the dialog first.
// Run by test/admin-delete-challenge-emulator.test.js, inside emulators:exec with auth and firestore. Prints ids,
// booleans and counts only, never document content.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { SDK, sdk } from "./firebase-sdk-local.mjs";
import { publicChallenge, checkChallenge } from "../publish-build.mjs";
const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const { chromium } = require("playwright");
const { serve } = require("./lib.js");

const FSH = process.env.FIRESTORE_EMULATOR_HOST, AUH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const local = (h) => /^(127\.0\.0\.1|localhost):/.test(h || "");
if (!local(FSH) || !local(AUH)) { console.error("emulators only"); process.exit(1); }
const PROJECT = "demo-ghareeb", HELPER = "helper@example.com";
const rules = fs.readFileSync(path.join(REPO, "firestore.rules"), "utf8");
const [host, port] = FSH.split(":");
const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules, host, port: Number(port) } });
let fail = 0;
const check = (id, ok, extra) => { console.log((ok ? "PASS  " : "FAIL  ") + id + (extra !== undefined && !ok ? "  " + extra : "")); if (!ok) fail++; };
const raw = async (k) => { let o; await env.withSecurityRulesDisabled(async (c) => { const s = await c.firestore().doc(k).get(); o = s.exists ? s.data() : null; }); return o; };
const write = (k, v) => env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc(k).set(v); });

// as production holds them: every surah carries its number; the challenge stores each reference as {no, word}
const JUZ = (fs.readFileSync(path.join(REPO, "public/admin/index.html"), "utf8").match(/const JUZ="([^"]+)"/) || [])[1].split(",");
const official = JSON.parse(fs.readFileSync(path.join(REPO, "public/words.json"), "utf8")).map((s) => Object.assign({ no: 78 + JUZ.indexOf(s.surah.replace(/^\S+\s*/, "")) }, s));
const chFile = JSON.parse(fs.readFileSync(path.join(REPO, "public/challenge.json"), "utf8"));
const CH = { startDate: chFile.startDate ?? null, releasedUpTo: chFile.releasedUpTo ?? null, days: chFile.days.map((d) => Object.assign({}, d, { w: d.w.map((r) => ({ no: r[0], word: r[1] })) })) };
const START = 4;

const WRAP = {
  "firebase-auth.js": `export * from "${SDK}firebase-auth.real.js";import {getAuth as g,connectAuthEmulator as c} from "${SDK}firebase-auth.real.js";export function getAuth(a){const x=g(a);if(!x.__emu){c(x,"http://${AUH}",{disableWarnings:true});x.__emu=1}return x}`,
  "firebase-firestore.js": `export * from "${SDK}firebase-firestore.real.js";import {getFirestore as g,connectFirestoreEmulator as c} from "${SDK}firebase-firestore.real.js";export function getFirestore(a){const x=g(a);if(!x.__emu){c(x,"${host}",${port});x.__emu=1}return x}`,
};
const CONFIG = `window.FIREBASE_CONFIG={apiKey:"demo-key",authDomain:"${PROJECT}.firebaseapp.com",projectId:"${PROJECT}",appId:"1:1:web:1"};`;
const { server, base } = await serve(undefined, { liveFirebase: true });
const br = await chromium.launch(), leaks = [], pageErrors = [];

async function seed() {
  await env.clearFirestore();
  await write("config/admins", { emails: [HELPER] });
  await write("public/data", { rev: START, surahs: official, by: "someone" });
  await write("public/challenge", CH);
}
async function open() {
  const ctx = await br.newContext({ viewport: { width: 1000, height: 900 } });
  await ctx.route("**/firebase-config.js", (r) => r.fulfill({ contentType: "text/javascript", body: CONFIG }));
  await ctx.route(SDK + "*", async (r) => { const n = r.request().url().slice(SDK.length); if (WRAP[n]) return r.fulfill({ contentType: "text/javascript", body: WRAP[n] }); r.fulfill({ contentType: "text/javascript", body: await sdk(n.replace(".real.js", ".js")) }); });
  await ctx.route((u) => /googleapis\.com|firebaseio|firebaseapp\.com|google\.com|googleusercontent/.test(u.hostname), (r) => { leaks.push(r.request().url()); return r.abort(); });
  const p = await ctx.newPage();
  p.on("pageerror", () => pageErrors.push(1));
  await p.goto(base + "/admin/index.html");
  await p.waitForFunction(() => typeof FB !== "undefined" && FB.auth && READY, null, { timeout: 30000 });
  await p.evaluate(async (e) => { const { GoogleAuthProvider, signInWithCredential } = FB.au; await signInWithCredential(FB.auth, GoogleAuthProvider.credential(JSON.stringify({ sub: "sub-helper", email: e, email_verified: true }))); }, HELPER);
  await p.waitForFunction(() => U && READY && ADM && D && CH && CH.days.length && document.querySelector('[data-a="tab"]'), null, { timeout: 20000 });
  return { ctx, p };
}
const tab = (p, v) => p.click(`[data-a="tab"][data-v="${v}"]`);
const dialogText = (p) => p.locator("#cd").textContent();
const revIs = (p, r) => p.waitForFunction((x) => D.rev === x && !SAVING, r, { timeout: 25000 });
// day numbers named in a text, in order ("اليوم 3، اليوم 5")
const daysIn = (t) => [...String(t).matchAll(/اليوم (\d+)/g)].map((m) => +m[1]);
const LEFT_MARK = "أي كلمة"; // "أي كلمة": only the left-with-no-words sentence has it

// In the page, with the page's own matching: the surahs and words a choice needs, and which day references they match.
// Returns indices only.
const pick = (p, mode) => p.evaluate((mode) => {
  const refsOf = (no, w) => CH.days.map((d) => d.w.map((r, k) => (+r[0] === +no && (w == null || NM(r[1]) === NM(w)) ? k : -1)).filter((k) => k >= 0));
  for (let s = 0; s < D.surahs.length; s++) {
    const e = D.surahs[s];
    if (mode === "surah") { const m = refsOf(e.no, null); if (m.some((l) => l.length)) return { s, no: e.no, m }; continue; }
    if (e.words.length < 2 && mode !== "empties") continue; // the admin allows deleting a surah's last word too
    for (let i = 0; i < e.words.length; i++) {
      const w = e.words[i];
      if (e.words.filter((x) => NM(x) === NM(w)).length > 1) continue;
      const m = refsOf(e.no, w), used = m.map((l, d) => (l.length ? d : -1)).filter((d) => d >= 0);
      const empties = used.filter((d) => CH.days[d].w.length === m[d].length);
      if (mode === "kept" && used.length && !empties.length) return { s, i, no: e.no, m };
      if (mode === "empties" && empties.length) return { s, i, no: e.no, m, empties: empties.map((d) => CH.days[d].d) };
    }
  }
  return null;
}, mode);

// the stored challenge after a delete: the same days, with exactly the matched references gone
function expectCh(m) {
  return CH.days.map((d, i) => Object.assign({}, d, { w: d.w.filter((_, k) => !m[i].includes(k)) }));
}
async function challengeAfter(id, m, rev) {
  const c = await raw("public/challenge"), d = await raw("public/data"), h = await raw("history/" + rev);
  check(id + ": one save, rev " + rev + ", history kind edit", d.rev === rev && h && h.kind === "edit");
  check(id + ": the same number of days, none removed", c.days.length === CH.days.length && c.days.every((x, i) => x.d === CH.days[i].d));
  check(id + ": exactly the references to the deleted words are gone, nothing else changed", JSON.stringify(c.days) === JSON.stringify(expectCh(m)));
  check(id + ": start date and released day unchanged", c.startDate === CH.startDate && c.releasedUpTo === CH.releasedUpTo);
  let ok = true;
  try { checkChallenge(publicChallenge(c), d.surahs, { days: CH.days }); } catch { ok = false; }
  check(id + ": the publish build's challenge check passes on the saved words and challenge", ok);
  return { c, d };
}

console.log("== delete a word used by a challenge day: one confirmation, words and challenge in one save ==");
{
  await seed();
  const { ctx, p } = await open();
  await tab(p, "w");
  const k = await pick(p, "kept");
  check("found a word used by days that keep other words", !!k);
  await p.click(`[data-a="delW"][data-v="${k.s}.${k.i}"]`); await p.waitForSelector("#cd.open");
  const t = await dialogText(p), used = k.m.map((l, d) => (l.length ? CH.days[d].d : -1)).filter((d) => d > 0);
  check("the dialog names the days that use the word", JSON.stringify(daysIn(t)) === JSON.stringify(used), "named " + daysIn(t).length + " of " + used.length);
  check("the dialog says no day is left without words", !t.includes(LEFT_MARK));
  await p.click('[data-cd="yes"]'); await revIs(p, START + 1);
  await challengeAfter("word delete", k.m, START + 1);
  check("the page holds the saved challenge", await p.evaluate((n) => JSON.stringify(CH.days.map((d) => d.w.length)) === n, JSON.stringify(expectCh(k.m).map((d) => d.w.length))));
  check("no second confirmation was asked", await p.evaluate(() => !document.querySelector("#cd.open")));
  await ctx.close();
}

console.log("\n== a delete that leaves a day with no words: named before confirming; cancel writes nothing; the day stays ==");
{
  await seed();
  const { ctx, p } = await open();
  await tab(p, "w");
  const k = await pick(p, "empties");
  check("found a word that is the only word of a day", !!k && k.empties.length > 0);
  await p.click(`[data-a="delW"][data-v="${k.s}.${k.i}"]`); await p.waitForSelector("#cd.open");
  const t = await dialogText(p), at = t.indexOf(LEFT_MARK);
  check("the dialog says which days are left with no words", at > 0 && JSON.stringify(daysIn(t.slice(t.lastIndexOf(".", at) + 1, at))) === JSON.stringify(k.empties));
  await p.click('[data-cd="no"]');
  await p.waitForFunction(() => !document.querySelector("#cd.open"));
  const d0 = await raw("public/data"), c0 = await raw("public/challenge");
  check("cancel: nothing written", d0.rev === START && JSON.stringify(c0) === JSON.stringify(CH));
  await p.click(`[data-a="delW"][data-v="${k.s}.${k.i}"]`); await p.waitForSelector("#cd.open"); await p.click('[data-cd="yes"]'); await revIs(p, START + 1);
  const { c } = await challengeAfter("emptying delete", k.m, START + 1);
  check("the emptied days are still there, with no words", k.empties.every((n) => { const d = c.days.find((x) => x.d === n); return d && Array.isArray(d.w) && d.w.length === 0; }));
  await ctx.close();
}

console.log("\n== delete a surah whose words the challenge uses ==");
{
  await seed();
  const { ctx, p } = await open();
  await tab(p, "s");
  const k = await pick(p, "surah");
  check("found a surah used by the challenge", !!k);
  await p.click(`[data-a="delS"][data-v="${k.s}"]`); await p.waitForSelector("#cd.open");
  const t = await dialogText(p), used = k.m.map((l, d) => (l.length ? CH.days[d].d : -1)).filter((d) => d > 0);
  check("the dialog names the days that use its words", used.every((n) => daysIn(t).includes(n)));
  await p.click('[data-cd="yes"]'); await revIs(p, START + 1);
  const { d } = await challengeAfter("surah delete", k.m, START + 1);
  check("the surah is gone from the words", !d.surahs.some((s) => s.no === k.no));
  await ctx.close();
}

console.log("\n== delete a word the challenge does not use: the challenge is not written ==");
{
  await seed();
  const { ctx, p } = await open();
  await tab(p, "w");
  // every published word is used by the challenge, so this case makes one unused: the challenge is seeded without the
  // references to a word, and the page is loaded again
  const k = await pick(p, "kept");
  const CH2 = Object.assign({}, CH, { days: expectCh(k.m) });
  await write("public/challenge", CH2);
  await p.reload();
  await p.waitForFunction(() => U && READY && ADM && D && CH && CH.days.length && document.querySelector('[data-a="tab"]'), null, { timeout: 20000 });
  await tab(p, "w");
  check("the word is no longer used by any day", await p.evaluate(([s, i]) => !daysUsing(D.surahs[s].no, D.surahs[s].words[i]).length, [k.s, k.i]));
  await p.click(`[data-a="delW"][data-v="${k.s}.${k.i}"]`); await p.waitForSelector("#cd.open");
  check("the dialog names no challenge day", daysIn(await dialogText(p)).length === 0);
  await p.click('[data-cd="yes"]'); await revIs(p, START + 1);
  check("unused word: the challenge document is unchanged", JSON.stringify(await raw("public/challenge")) === JSON.stringify(CH2));
  await ctx.close();
}

await br.close(); server.close();
check("no page errors", pageErrors.length === 0, "count " + pageErrors.length);
check("no request reached a Google host", leaks.length === 0, "count " + leaks.length);
await env.cleanup();
console.log("\n" + (fail ? fail + " CHECKS FAILED" : "ALL CHECKS PASSED"));
process.exitCode = fail ? 1 : 0;
