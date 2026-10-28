// The Firestore rules in firestore.rules against copies of the REAL production documents, in the EMULATORS only.
// Input: a read-only export made by scripts/firestore-export.mjs (timestamps kept as timestamps).
// Run from the repo root, with an emulator config that has auth and firestore (firebase.json has only firestore):
//   npx firebase emulators:exec --config <config> --project demo-ghareeb --only auth,firestore \
//     "node scripts/checks/rules-real-data.mjs backup/firestore/<export dir>"
// 1. Loads every exported document into the emulator; as the owner, writes each one back unchanged (set and update).
// 2. Runs scripts/fix-ayat-firestore.mjs --apply --confirm against the emulator (project demo-ghareeb), checks it made
//    the 9 listed text corrections (plus the encoding-only rewrites to the official bytes) and that a second
//    --dry-run finds 0; then, as the owner, writes public/data and
//    public/prev back unchanged again.
// 3. The real admin page (public/admin/index.html, Firebase SDK pointed at the emulators, owner signed in) on the
//    corrected documents: a save that edits one meaning, undo, a challenge save and a note save.
// Prints every write with "allowed" or "DENIED" and the error; exit 1 if anything that must be allowed was denied.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");
const firebase = require("firebase/compat/app"); require("firebase/compat/firestore");
const { chromium } = require("playwright");
const { serve } = require("./lib.js");

const FSH = process.env.FIRESTORE_EMULATOR_HOST, AUH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!FSH || !AUH) { console.error("run inside emulators:exec with auth and firestore (see the header)"); process.exit(1); }
const EXPORT = path.resolve(REPO, process.argv[2] || "");
const index = JSON.parse(fs.readFileSync(path.join(EXPORT, "index.json"), "utf8"));
const PROJECT = "demo-ghareeb", OWNER = "yusufhamdy20@gmail.com";
const untag = (v) => {
  if (v && typeof v === "object" && !Array.isArray(v) && Array.isArray(v.__ts) && Object.keys(v).length === 1) return new firebase.firestore.Timestamp(v.__ts[0], v.__ts[1]);
  if (Array.isArray(v)) return v.map(untag);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, untag(x)]));
  return v;
};
const DOCS = Object.fromEntries(Object.entries(index.docs).filter(([, d]) => d.exists).map(([k, d]) => [k, untag(JSON.parse(fs.readFileSync(path.join(EXPORT, d.file), "utf8")))]));
console.log("export " + path.relative(REPO, EXPORT) + " (" + index.at + "): " + Object.keys(DOCS).join(", ") + (Object.values(index.docs).some((d) => !d.exists) ? "; missing: " + Object.entries(index.docs).filter(([, d]) => !d.exists).map(([k]) => k).join(", ") : ""));

const [host, port] = FSH.split(":");
const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: fs.readFileSync(path.join(REPO, "firestore.rules"), "utf8"), host, port: Number(port) } });
const results = [], must = (id, r) => { results.push({ id, ...r }); console.log((r.ok ? "  allowed  " : "  DENIED   ") + id + (r.ok ? "" : "  " + r.err)); };
const attempt = async (id, fn) => { try { await fn(); must(id, { ok: true }); } catch (e) { must(id, { ok: false, err: String(e.message || e).split("\n")[0] }); } };
async function seed(docs) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (c) => { for (const [k, v] of Object.entries(docs)) await c.firestore().doc(k).set(v); });
}
const raw = async (k) => { let out; await env.withSecurityRulesDisabled(async (c) => { const s = await c.firestore().doc(k).get(); out = s.exists ? s.data() : null; }); return out; };
const owner = () => env.authenticatedContext("owner-uid", { email: OWNER, email_verified: true }).firestore();
let bad = 0;

// ---- 1. every real document written back unchanged by the owner
console.log("\n== 1. production documents written back unchanged, as the owner ==");
await seed(DOCS);
for (const k of Object.keys(DOCS)) {
  await attempt(k + " set (unchanged)", () => owner().doc(k).set(DOCS[k]));
  await attempt(k + " update (unchanged)", () => owner().doc(k).update(DOCS[k]));
}
console.log("-- for reference: the public reads, and an unauthenticated write (must be refused)");
await attempt("public/data read (unauthenticated)", () => env.unauthenticatedContext().firestore().doc("public/data").get());
{ let refused = false; try { await env.unauthenticatedContext().firestore().doc("public/data").set(DOCS["public/data"]); } catch (e) { refused = true; } console.log("  " + (refused ? "refused  " : "ALLOWED! ") + "public/data set (unauthenticated)"); if (!refused) bad++; }

// ---- 2. the fix script against the emulator, then the corrected documents written back unchanged
console.log("\n== 2. fix-ayat-firestore.mjs --apply --confirm against the emulator (project " + PROJECT + ") ==");
await seed(DOCS);
const run = (args) => spawnSync(process.execPath, [path.join(REPO, "scripts/fix-ayat-firestore.mjs"), ...args, "--project", PROJECT], { cwd: REPO, env: process.env, encoding: "utf8" });
const ap = run(["--apply", "--confirm"]);
const apOut = ap.stdout + ap.stderr;
const nFix = (apOut.match(/== corrections \((\d+)\) ==/) || [])[1];
const kinds = (apOut.match(/^\d+ fields in .*$/m) || [""])[0];
console.log("  apply: exit " + ap.status + ", corrections " + nFix + " (" + kinds + "), " + (apOut.match(/fix-ayat-firestore: .*$/m) || [""])[0]);
const dr = run(["--dry-run"]), drOut = dr.stdout + dr.stderr;
const nAfter = (drOut.match(/== corrections \((\d+)\) ==/) || [])[1], same = (drOut.match(/public\/words\.json, ayah text: ([^=]+) ==/) || [])[1];
console.log("  dry run after: exit " + dr.status + ", corrections " + nAfter + ", vs public/words.json: " + (same || "").trim());
if (ap.status !== 0 || !(Number(nFix) > 0) || !/: 9 text corrections,/.test(kinds) || dr.status !== 0 || nAfter !== "0") { bad++; console.log(apOut + "\n" + drOut); }
const fixed = { "public/data": await raw("public/data"), "public/prev": await raw("public/prev") };
console.log("  public/data after: rev " + fixed["public/data"].rev + ", by " + JSON.stringify(fixed["public/data"].by) + ", keys " + Object.keys(fixed["public/data"]).sort().join(","));
console.log("  public/prev after: rev " + fixed["public/prev"].rev + ", keys " + Object.keys(fixed["public/prev"]).sort().join(","));
if (fixed["public/data"].by !== OWNER) { bad++; console.log("  by is not the owner's lowercase address"); }
{ // the run log next to the backup
  const lf = (apOut.match(/^log: (.+)$/m) || [])[1], lg = lf ? JSON.parse(fs.readFileSync(path.join(REPO, lf.trim()), "utf8")) : null;
  const ok = lg && lg.mode === "apply" && lg.result === "written" && lg.corrections.length === Number(nFix) && lg.corrections.filter((c) => c.kind === "text").length === 9 && lg.revBefore === DOCS["public/data"].rev && lg.revAfter === DOCS["public/data"].rev + 1;
  console.log("  run log " + (lf || "(none)").trim() + ": " + (lg ? lg.time + ", " + lg.target + ", rev " + lg.revBefore + " -> " + lg.revAfter + ", " + lg.corrections.length + " corrections: " + lg.corrections.map((c) => c.surah + ":" + c.ayah + " " + c.field).join(", ") + ", " + lg.result : "missing") + (ok ? "" : "  <- WRONG"));
  if (!ok) bad++;
}
for (const k of Object.keys(fixed)) {
  await attempt(k + " (corrected) set (unchanged)", () => owner().doc(k).set(fixed[k]));
  await attempt(k + " (corrected) update (unchanged)", () => owner().doc(k).update(fixed[k]));
}

// ---- 3. the real admin page on the corrected documents
console.log("\n== 3. the admin page (owner) on the corrected documents: save, undo, challenge save, note save ==");
await seed(Object.assign({}, DOCS, fixed));
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
const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route("**/firebase-config.js", (r) => r.fulfill({ contentType: "text/javascript", body: CONFIG }));
await ctx.route(SDK + "*", async (r) => { const n = r.request().url().slice(SDK.length); if (WRAP[n]) return r.fulfill({ contentType: "text/javascript", body: WRAP[n] }); r.fulfill({ contentType: "text/javascript", body: await sdk(n.replace(".real.js", ".js")) }); });
await ctx.route((u) => /googleapis\.com|firebaseio|firebaseapp\.com|google\.com|googleusercontent/.test(u.hostname), (r) => { leaks.push(r.request().url()); return r.abort(); });
const p = await ctx.newPage();
p.on("dialog", (d) => d.dismiss().catch(() => {}));
await p.goto(base + "/admin/index.html");
await p.waitForFunction(() => typeof FB !== "undefined" && FB.auth && READY, null, { timeout: 30000 });
await p.evaluate(async (e) => { const { GoogleAuthProvider, signInWithCredential } = FB.au; await signInWithCredential(FB.auth, GoogleAuthProvider.credential(JSON.stringify({ sub: "owner-uid", email: e, email_verified: true }))); }, OWNER);
await p.waitForFunction(() => U && READY && document.querySelector('[data-a="tab"]'), null, { timeout: 20000 });
const inPage = async (id, fn) => { const r = await p.evaluate(fn).then(() => ({ ok: true }), (e) => ({ ok: false, err: String(e.message || e).split("\n")[0] })); must(id, r); };
const before = await raw("public/data");
const s0 = before.surahs[0], w0 = s0.words[0];
await inPage("admin save (one meaning edited)", `store.update((ss) => { const s = ss.find((x) => x.words && x.words.indexOf(${JSON.stringify(w0)}) >= 0); s.meanings[s.words.indexOf(${JSON.stringify(w0)})] += " (test)"; return ss; })`);
const afterSave = await raw("public/data");
const diffs = [];
afterSave.surahs.forEach((s, i) => { const b = JSON.stringify(before.surahs[i]), a = JSON.stringify(s); if (a !== b) diffs.push(i); });
console.log("    saved: rev " + before.rev + " -> " + afterSave.rev + ", by " + afterSave.by + ", surahs changed: " + diffs.length + " (expected 1), the meaning ends with (test): " + /\(test\)$/.test(afterSave.surahs[diffs[0]] && afterSave.surahs[diffs[0]].meanings[0]));
if (diffs.length !== 1) bad++;
await inPage("admin undo", `store.undo()`);
const afterUndo = await raw("public/data");
const restored = JSON.stringify(afterUndo.surahs) === JSON.stringify(before.surahs);
console.log("    undone: rev " + afterUndo.rev + ", surahs identical to before the save: " + restored);
if (!restored) bad++;
await inPage("admin challenge save (unchanged)", `store.chUpdate((c) => c)`);
const chA = await raw("public/challenge");
console.log("    challenge after save identical: " + (JSON.stringify(chA) === JSON.stringify(DOCS["public/challenge"])));
const n1 = (DOCS["admin/challengeNotes"] || {})["1"] || "";
await inPage("admin note save (day 1, same text)", `store.chSetNote(1, ${JSON.stringify(n1)})`);
await br.close(); server.close();
if (leaks.length) { console.log("requests to Google hosts (blocked): " + leaks.length); bad++; }

const denied = results.filter((r) => !r.ok);
console.log("\n" + results.length + " writes, " + denied.length + " denied" + (bad ? ", " + bad + " other problems" : ""));
denied.forEach((d) => console.log("  DENIED " + d.id + ": " + d.err));
await env.cleanup();
process.exitCode = denied.length || bad ? 1 : 0;
