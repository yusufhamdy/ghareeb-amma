// Two tabs saving at the same moment, against the real rules, in the EMULATORS only: the real admin page, signed in, two
// tabs of one browser. Both saves read the same revision N and both create history/{N+1} and snapshots/{N+1}; the rules
// allow those to be created only, so the second commit is refused. The admin then runs its save again on the newer
// revision: two different words both survive, and the same field changed to two values opens the conflict picker.
// A refusal for any other reason still fails at once. Run by test/admin-concurrent-emulator.test.js, inside
// emulators:exec with auth and firestore. Prints ids, booleans and counts only, never document content.
//
// "The same moment" is made exact: each tab's first transaction attempt waits after reading public/data until both tabs
// have read it, so both always start from the same revision. Later attempts (the admin's re-run) are not held.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { SDK, sdk } from "./firebase-sdk-local.mjs";
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
const OWNER = (rules.match(/[\w.+-]+@[\w.-]+/) || [])[0];
const [host, port] = FSH.split(":");
const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules, host, port: Number(port) } });
let fail = 0;
const check = (id, ok, extra) => { console.log((ok ? "PASS  " : "FAIL  ") + id + (extra ? "  " + extra : "")); if (!ok) fail++; };
const raw = async (k) => { let o; await env.withSecurityRulesDisabled(async (c) => { const s = await c.firestore().doc(k).get(); o = s.exists ? s.data() : null; }); return o; };
const write = (k, v) => env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc(k).set(v); });
const historyRevs = async () => { let l = []; await env.withSecurityRulesDisabled(async (c) => { l = (await c.firestore().collection("history").get()).docs.map((d) => d.data()); }); return l; };

// as production holds it: every surah carries its number in the mushaf (the ayah check needs it)
const JUZ = (fs.readFileSync(path.join(REPO, "public/admin/index.html"), "utf8").match(/const JUZ="([^"]+)"/) || [])[1].split(",");
const official = JSON.parse(fs.readFileSync(path.join(REPO, "public/words.json"), "utf8")).map((s) => Object.assign({ no: 78 + JUZ.indexOf(s.surah.replace(/^\S+\s*/, "")) }, s));
const CH = { startDate: null, releasedUpTo: null, days: [] };
const START = 4;
const SI = official.findIndex((s) => s.words.length >= 2); // the first surah with two words or more

// The SDK comes from the vendored, hash-pinned copy: no download at test time (see firebase-sdk-local.mjs).
const WRAP = {
  "firebase-auth.js": `export * from "${SDK}firebase-auth.real.js";import {getAuth as g,connectAuthEmulator as c} from "${SDK}firebase-auth.real.js";export function getAuth(a){const x=g(a);if(!x.__emu){c(x,"http://${AUH}",{disableWarnings:true});x.__emu=1}return x}`,
  "firebase-firestore.js": `export * from "${SDK}firebase-firestore.real.js";import {getFirestore as g,connectFirestoreEmulator as c} from "${SDK}firebase-firestore.real.js";export function getFirestore(a){const x=g(a);if(!x.__emu){c(x,"${host}",${port});x.__emu=1}return x}`,
};
const CONFIG = `window.FIREBASE_CONFIG={apiKey:"demo-key",authDomain:"${PROJECT}.firebaseapp.com",projectId:"${PROJECT}",appId:"1:1:web:1"};`;
const { server, base } = await serve(undefined, { liveFirebase: true });
const br = await chromium.launch(), leaks = [], pageErrors = [];

// Counts the admin's own runs of a save (runTransaction calls) and holds the first attempt after its read of
// public/data until the gate opens. The save code itself is the page's own.
const HOLD = () => {
  window.__runs = 0; window.__read = false; window.__gate = new Promise((r) => { window.__open = r; });
  const o = FB.fs.runTransaction;
  FB.fs = { ...FB.fs, runTransaction: (db, fn, ...rest) => {
    const run = ++window.__runs;
    return o(db, (tx) => {
      if (run !== 1) return fn(tx);
      const w = { get: async (ref) => { const s = await tx.get(ref); if (ref.path === "public/data" && !window.__read) { window.__read = true; await window.__gate; } return s; },
        set: (...a) => { tx.set(...a); return w; }, update: (...a) => { tx.update(...a); return w; }, delete: (...a) => { tx.delete(...a); return w; } };
      return fn(w);
    }, ...rest);
  } };
};

async function seed() {
  await env.clearFirestore();
  await write("public/data", { rev: START, surahs: official, by: "someone" });
  await write("public/challenge", CH);
  await write("config/admins", { emails: [HELPER] });
}
async function context() {
  const ctx = await br.newContext({ viewport: { width: 1000, height: 900 } });
  await ctx.route("**/firebase-config.js", (r) => r.fulfill({ contentType: "text/javascript", body: CONFIG }));
  await ctx.route(SDK + "*", async (r) => { const n = r.request().url().slice(SDK.length); if (WRAP[n]) return r.fulfill({ contentType: "text/javascript", body: WRAP[n] }); r.fulfill({ contentType: "text/javascript", body: await sdk(n.replace(".real.js", ".js")) }); });
  await ctx.route((u) => /googleapis\.com|firebaseio|firebaseapp\.com|google\.com|googleusercontent/.test(u.hostname), (r) => { leaks.push(r.request().url()); return r.abort(); });
  return ctx;
}
async function tab(ctx, email) {
  const p = await ctx.newPage();
  p.on("pageerror", () => pageErrors.push(1));
  p.on("dialog", (d) => d.dismiss().catch(() => {}));
  await p.goto(base + "/admin/index.html");
  await p.waitForFunction(() => typeof FB !== "undefined" && FB.auth && READY, null, { timeout: 30000 });
  if (email) await p.evaluate(async (e) => { const { GoogleAuthProvider, signInWithCredential } = FB.au; await signInWithCredential(FB.auth, GoogleAuthProvider.credential(JSON.stringify({ sub: "sub-" + e.replace(/\W/g, ""), email: e, email_verified: true }))); }, email);
  await p.waitForFunction(() => U && READY && ADM && D && document.querySelector('[data-a="tab"]'), null, { timeout: 20000 });
  await p.click('[data-a="tab"][data-v="w"]');
  await p.waitForFunction(() => TAB === "w");
  await p.evaluate(HOLD);
  return p;
}
const edit = async (p, v, text) => { await p.click(`[data-a="editW"][data-v="${v}"]`); await p.waitForSelector("#e-m"); await p.fill("#e-m", text); };
// a save is finished when nothing is saving and the window closed, or it shows an error or the conflict picker
const settled = (p) => p.waitForFunction(() => !SAVING && (!document.querySelector("#md .mb") || document.querySelector("#md .werr") || document.querySelector("#md fieldset.cf")), null, { timeout: 30000 });
const state = (p) => p.evaluate(() => ({ closed: !document.querySelector("#md .mb"), error: !!document.querySelector("#md .werr"), picker: !!document.querySelector("#md fieldset.cf"), runs: window.__runs }));
// both tabs press save; once both have read public/data (so both hold revision N), both go on
async function saveTogether(a, b) {
  await Promise.all([a.click('[data-a="saveW"]'), b.click('[data-a="saveW"]')]);
  await Promise.all([a, b].map((p) => p.waitForFunction(() => window.__read, null, { timeout: 30000 })));
  await Promise.all([a, b].map((p) => p.evaluate(() => window.__open())));
  await Promise.all([settled(a), settled(b)]);
  return [await state(a), await state(b)];
}

console.log("== two tabs, two different words, saved at the same moment ==");
{
  await seed();
  const ctx = await context();
  const a = await tab(ctx, OWNER), b = await tab(ctx, null);
  const MA = "concurrent edit from tab A", MB = "concurrent edit from tab B";
  await edit(a, SI + ".0", MA); await edit(b, SI + ".1", MB);
  const [sa, sb] = await saveTogether(a, b);
  const d = await raw("public/data");
  check("both windows closed with no error", sa.closed && sb.closed && !sa.error && !sb.error, JSON.stringify({ a: sa, b: sb }));
  check("one save ran again after the other committed first", [sa.runs, sb.runs].sort().join(",") === "1,2", "runs " + sa.runs + "," + sb.runs);
  check("tab A's word keeps tab A's edit", d.surahs[SI].meanings[0] === MA);
  check("tab B's word keeps tab B's edit", d.surahs[SI].meanings[1] === MB);
  check("the revision advanced by 2", d.rev === START + 2, "rev " + d.rev);
  const h = (await historyRevs()).filter((r) => r.rev > START);
  check("two history rows, one per save", h.length === 2 && h.every((r) => r.kind === "edit") && h.map((r) => r.rev).sort().join(",") === [START + 1, START + 2].join(","), "rows " + h.length);
  const s6 = await raw("snapshots/" + (START + 2));
  check("the latest snapshot holds both edits", !!s6 && JSON.stringify(s6.surahs) === JSON.stringify(d.surahs));
  const o = official[SI].meanings.slice(2), n = d.surahs[SI].meanings.slice(2);
  check("every other meaning in that surah is unchanged", JSON.stringify(o) === JSON.stringify(n));
  const others = (l) => JSON.stringify(l.filter((_, i) => i !== SI));
  check("every other surah is unchanged", others(d.surahs) === others(official));
  await ctx.close();
}

console.log("\n== two tabs, the same word and field, two values at the same moment ==");
{
  await seed();
  const ctx = await context();
  const a = await tab(ctx, OWNER), b = await tab(ctx, null);
  const MA = "same field value from tab A", MB = "same field value from tab B";
  await edit(a, SI + ".0", MA); await edit(b, SI + ".0", MB);
  const [sa, sb] = await saveTogether(a, b);
  const d = await raw("public/data");
  const won = sa.closed ? "a" : sb.closed ? "b" : null, lost = won === "a" ? sb : won === "b" ? sa : null;
  check("one save committed and its window closed", !!won && (won === "a" ? !sa.error : !sb.error), JSON.stringify({ a: sa, b: sb }));
  check("the other tab shows the conflict picker, with its edit kept", !!lost && lost.picker && !lost.closed && !lost.error, JSON.stringify(lost));
  check("saved as one revision", d.rev === START + 1, "rev " + d.rev);
  check("the stored value is the committed tab's, not overwritten", d.surahs[SI].meanings[0] === (won === "a" ? MA : MB));
  const lp = won === "a" ? b : a;
  const offers = (v) => lp.evaluate((x) => [...document.querySelectorAll("#md fieldset.cf label")].some((l) => l.textContent.includes(x)), v);
  check("the picker offers both values: this tab's own and the committed one", !!lost && (await offers(MA)) && (await offers(MB)));
  await ctx.close();
}

console.log("\n== any other refusal still fails at once ==");
{
  await seed();
  const ctx = await context();
  const p = await tab(ctx, HELPER);
  await p.evaluate(() => { window.__open(); });
  await write("config/admins", { emails: [] }); // the helper is removed while the window is open
  await edit(p, SI + ".0", "edit by a removed helper");
  await p.click('[data-a="saveW"]');
  await settled(p);
  const s = await state(p), d = await raw("public/data");
  check("the save fails with an error and keeps the window", !s.closed && s.error, JSON.stringify(s));
  check("it ran once: not run again", s.runs === 1, "runs " + s.runs);
  check("nothing was written", d.rev === START && JSON.stringify(d.surahs) === JSON.stringify(official) && (await historyRevs()).length === 0);
  await ctx.close();
}

await br.close(); server.close();
check("no page errors", pageErrors.length === 0, "count " + pageErrors.length);
check("no request reached a Google host", leaks.length === 0, "count " + leaks.length);
await env.cleanup();
console.log("\n" + (fail ? fail + " CHECKS FAILED" : "ALL CHECKS PASSED"));
process.exitCode = fail ? 1 : 0;
