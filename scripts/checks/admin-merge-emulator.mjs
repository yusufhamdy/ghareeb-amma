// The admin's three-way word merge against the real rules, in the EMULATORS only: the real admin page, signed in, on the
// real data. Reproduces the case of 2026-10-30: the editor opens on an old copy, another write changes the data (newer
// ayah text and other fields), only the meaning is edited, save. Run by test/admin-merge-emulator.test.js, inside
// emulators:exec with auth and firestore.
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
const PROJECT = "demo-ghareeb", NAME = "\u0627\u0644\u0646\u0627\u0632\u0639\u0627\u062a", ME = "\u0645\u0639\u0646\u0649 \u0645\u0646\u064a", THEM = "\u0645\u0639\u0646\u0649 \u0623\u062d\u062f\u062b";
const rules = fs.readFileSync(path.join(REPO, "firestore.rules"), "utf8");
const OWNER = (rules.match(/[\w.+-]+@[\w.-]+/) || [])[0];
const [host, port] = FSH.split(":");
const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules, host, port: Number(port) } });
let fail = 0;
const check = (id, ok, extra) => { console.log((ok ? "PASS  " : "FAIL  ") + id + (extra ? "  " + extra : "")); if (!ok) fail++; };
const raw = async (k) => { let o; await env.withSecurityRulesDisabled(async (c) => { const s = await c.firestore().doc(k).get(); o = s.exists ? s.data() : null; }); return o; };
const write = (k, v) => env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc(k).set(v); });

// as production holds it: every surah carries its number in the mushaf (the ayah check needs it)
const JUZ = (fs.readFileSync(path.join(REPO, "public/admin/index.html"), "utf8").match(/const JUZ="([^"]+)"/) || [])[1].split(",");
const official = JSON.parse(fs.readFileSync(path.join(REPO, "public/words.json"), "utf8")).map((s) => Object.assign({ no: 78 + JUZ.indexOf(s.surah.replace(/^\S+\s*/, "")) }, s));
const SI = official.findIndex((s) => s.surah.includes(NAME)), WI = 2;
const staleSurahs = JSON.parse(JSON.stringify(official));
{ const g = staleSurahs[SI].ayahs[WI].segments[0]; g.hl = g.hl.slice(0, 1) + "\u0640" + g.hl.slice(1); }
const CH = { startDate: null, releasedUpTo: null, days: [] };

const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
const CACHE = path.join(os.tmpdir(), "ghareeb-fb-sdk-10.14.1"); fs.mkdirSync(CACHE, { recursive: true });
const sdk = async (n) => { const f = path.join(CACHE, n); if (!fs.existsSync(f)) { const r = await fetch(SDK + n); if (!r.ok) throw new Error(n + " " + r.status); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); } return fs.readFileSync(f); };
const WRAP = {
  "firebase-auth.js": `export * from "${SDK}firebase-auth.real.js";import {getAuth as g,connectAuthEmulator as c} from "${SDK}firebase-auth.real.js";export function getAuth(a){const x=g(a);if(!x.__emu){c(x,"http://${AUH}",{disableWarnings:true});x.__emu=1}return x}`,
  "firebase-firestore.js": `export * from "${SDK}firebase-firestore.real.js";import {getFirestore as g,connectFirestoreEmulator as c} from "${SDK}firebase-firestore.real.js";export function getFirestore(a){const x=g(a);if(!x.__emu){c(x,"${host}",${port});x.__emu=1}return x}`,
};
const CONFIG = `window.FIREBASE_CONFIG={apiKey:"demo-key",authDomain:"${PROJECT}.firebaseapp.com",projectId:"${PROJECT}",appId:"1:1:web:1"};`;
const { server, base } = await serve(undefined, { liveFirebase: true });
const br = await chromium.launch(), leaks = [];

async function session(surahs) {
  await env.clearFirestore();
  await write("public/data", { rev: 4, surahs, by: "someone" });
  await write("public/challenge", CH);
  const ctx = await br.newContext({ viewport: { width: 1000, height: 900 } });
  await ctx.route("**/firebase-config.js", (r) => r.fulfill({ contentType: "text/javascript", body: CONFIG }));
  await ctx.route(SDK + "*", async (r) => { const n = r.request().url().slice(SDK.length); if (WRAP[n]) return r.fulfill({ contentType: "text/javascript", body: WRAP[n] }); r.fulfill({ contentType: "text/javascript", body: await sdk(n.replace(".real.js", ".js")) }); });
  await ctx.route((u) => /googleapis\.com|firebaseio|firebaseapp\.com|google\.com|googleusercontent/.test(u.hostname), (r) => { leaks.push(r.request().url()); return r.abort(); });
  const p = await ctx.newPage();
  await p.goto(base + "/admin/index.html");
  await p.waitForFunction(() => typeof FB !== "undefined" && FB.auth && READY, null, { timeout: 30000 });
  await p.evaluate(async (e) => { const { GoogleAuthProvider, signInWithCredential } = FB.au; await signInWithCredential(FB.auth, GoogleAuthProvider.credential(JSON.stringify({ sub: "owner-sub", email: e, email_verified: true }))); }, OWNER);
  await p.waitForFunction(() => U && READY && D && document.querySelector('[data-a="tab"]'), null, { timeout: 20000 });
  await p.click('[data-a="tab"][data-v="w"]');
  await p.click(`[data-a="editW"][data-v="${SI}.${WI}"]`);
  await p.waitForSelector("#e-m");
  return { ctx, p };
}
// the other window: a real document write with the revision up, as any save makes
const otherWrite = async (edit) => { const d = await raw("public/data"); edit(d.surahs); await write("public/data", { ...d, rev: d.rev + 1 }); return (await raw("public/data")); };
const newerEdit = (ss) => {
  ss[SI].ayahs[WI].segments = official[SI].ayahs[WI].segments;
  ss[SI].ayahs[WI].label = "3";
  ss[SI].source = "newer source";
  ss[0].meanings[0] += " newer";
};

console.log("== today's case: open, another write, edit the meaning only, save ==");
{
  const { ctx, p } = await session(staleSurahs);
  const before = await otherWrite(newerEdit);
  check("the data moved on while the editor was open", before.rev === 5 && (await p.evaluate(() => D.rev)) === 4);
  await p.fill("#e-m", ME);
  await p.click('[data-a="saveW"]');
  await p.waitForFunction(() => !document.querySelector("#e-m"), null, { timeout: 20000 });
  const toast = await p.locator("#toast").textContent();
  check("the merged message is shown", toast.includes("\u062f\u0645\u062c"), toast);
  const a = await raw("public/data"), s = a.surahs[SI], b = before.surahs[SI];
  check("saved as one revision", a.rev === 6, "rev " + a.rev);
  check("by is the signed-in uid", a.by === (await p.evaluate(() => U.uid)));
  check("the meaning is mine", s.meanings[WI] === ME);
  check("the ayah text is the newer version, byte for byte", JSON.stringify(s.ayahs[WI].segments) === JSON.stringify(b.ayahs[WI].segments));
  check("the stale text was not written", !JSON.stringify(a.surahs).includes(staleSurahs[SI].ayahs[WI].segments[0].hl));
  check("the word is the newer version", s.words[WI] === b.words[WI]);
  check("the label is the newer version", s.ayahs[WI].label === b.ayahs[WI].label);
  check("the source is the newer version", s.source === "newer source");
  const copy = JSON.parse(JSON.stringify(a.surahs)); copy[SI].meanings[WI] = b.meanings[WI];
  check("every other field in every surah is the newer version", JSON.stringify(copy) === JSON.stringify(before.surahs));
  const pv = await raw("public/prev");
  check("public/prev is the newer version, for undo", pv.rev === 5 && JSON.stringify(pv.surahs) === JSON.stringify(before.surahs) && !("by" in pv));
  await p.click('[data-a="tab"][data-v="t"]');
  await p.click('[data-a="undo"]');
  await p.click('[data-cd="yes"]');
  await p.waitForFunction(() => D.rev === 7, null, { timeout: 20000 });
  const u = await raw("public/data");
  check("undo restores the newer version", JSON.stringify(u.surahs) === JSON.stringify(before.surahs));
  await ctx.close();
}

console.log("\n== a real conflict: nothing saved until a value is picked ==");
{
  const { ctx, p } = await session(staleSurahs);
  const before = await otherWrite((ss) => { newerEdit(ss); ss[SI].meanings[WI] = THEM; });
  await p.fill("#e-m", ME);
  await p.click('[data-a="saveW"]');
  await p.waitForSelector(".cf", { timeout: 20000 });
  const mid = await raw("public/data");
  check("nothing was saved", mid.rev === before.rev && JSON.stringify(mid.surahs) === JSON.stringify(before.surahs));
  const txt = await p.locator(".cf").textContent();
  check("both values are shown", txt.includes(ME) && txt.includes(THEM));
  await p.check('.cf input[value="mine"]');
  await p.click('[data-a="saveC"]');
  await p.waitForFunction(() => !document.querySelector("#md .mb"), null, { timeout: 20000 });
  const a = await raw("public/data");
  check("the pick is saved", a.surahs[SI].meanings[WI] === ME && a.rev === before.rev + 1);
  check("the ayah text stays the newer version", JSON.stringify(a.surahs[SI].ayahs[WI].segments) === JSON.stringify(before.surahs[SI].ayahs[WI].segments));
  await ctx.close();
}

console.log("\n== focus: a newer revision reloads silently; unsaved edits show the banner ==");
{
  const { ctx, p } = await session(official);
  await otherWrite((ss) => { ss[SI].meanings[WI] = THEM; });
  await p.evaluate(() => window.dispatchEvent(new Event("focus")));
  await p.waitForFunction((v) => document.querySelector("#e-m").value === v, THEM, { timeout: 20000 });
  check("the untouched window is rebuilt from the newer word", true);
  await p.fill("#e-m", ME);
  await otherWrite((ss) => { ss[0].meanings[0] += " x"; });
  await p.evaluate(() => window.dispatchEvent(new Event("focus")));
  await p.waitForSelector(".wnew", { timeout: 20000 });
  check("unsaved edits: the banner shows and the edit stays", (await p.inputValue("#e-m")) === ME);
  await ctx.close();
}

await br.close(); server.close();
check("no request reached a Google host", leaks.length === 0, leaks.slice(0, 3).join(" "));
await env.cleanup();
console.log("\n" + (fail ? fail + " CHECKS FAILED" : "ALL CHECKS PASSED"));
process.exitCode = fail ? 1 : 0;
