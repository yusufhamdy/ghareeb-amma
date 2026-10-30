// Video links and day words, end to end, against the Firestore EMULATOR (never production): the full path
// reel-links-emulator.mjs missed.
//   1. Every one of the 30 days is opened in the admin's own day editor and saved with no change: each save must go
//      through, and the saved words must be the stored words, character for character (days 3 and 21 store ي where
//      the word list has ئ; the admin matches them with the site search normalization and keeps the stored text).
//   2. Links are typed into the editor for days 1-4 and saved; store.chUpdate is wrapped to capture chDoc() of the
//      challenge it returns, the exact document the live store.chUpdate writes in its transaction. That document is written to public/challenge as the
//      owner, through the Firestore rules.
//   3. The site, through its real client data path (public/migrate.js with ?emul=1 -> the emulator, and the app's
//      challenge load):
//      a. migrate.js maps the Firestore document with every link field (window.__CH__).
//      b. Visitors get links from the published challenge.json: publicChallenge() of the stored document (what
//         publish-build.mjs writes) served as /challenge.json shows each day's video card.
//      c. A Firestore answer that lands after first render changes nothing on the page: same elements, no card put in,
//         the done button does not move.
// Run from the repo root:
//   npx firebase emulators:exec --project demo-ghareeb --only firestore "node scripts/checks/reel-links-client.mjs"
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const { initializeTestEnvironment, assertSucceeds } = require("@firebase/rules-unit-testing");
const { chromium } = require("playwright");
const { serve } = require("./lib.js");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { buildFirestoreData } = require(REPO + "/src/utils/migrate.js");
const { publicChallenge } = await import(pathToFileURL(path.join(REPO, "scripts/publish-build.mjs")).href);

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!HOST) { console.error("FIRESTORE_EMULATOR_HOST is not set: run this inside firebase emulators:exec (see the header)."); process.exit(1); }
// public/migrate.js connects to the emulator at 127.0.0.1:8080 (firebase.json)
if (!/:8080$/.test(HOST)) { console.error("the client expects the Firestore emulator on port 8080, got " + HOST); process.exit(1); }
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };
const KEYS = ["reelIg", "reelTt", "reelYt"];

const L = { reelIg: "https://www.instagram.com/reel/DdGdwxkzHmg/", reelTt: "https://www.tiktok.com/@a/video/1", reelYt: "https://youtu.be/xyz" };
// typed into the admin fields; day 3 is one of the two days whose stored words spell ئ as ي
const EDIT = { 1: { reelIg: L.reelIg }, 2: { reelTt: L.reelTt, reelYt: L.reelYt }, 3: { reelTt: L.reelTt }, 4: L };
const OLD = "https://www.youtube.com/shorts/old"; // day 5: only the old single link, never opened in the editor
const DAYS = [1, 2, 3, 4, 5, 6];
const SHOW = { 1: [["إنستجرام", L.reelIg]], 2: [["تيك توك", L.reelTt], ["يوتيوب", L.reelYt]], 3: [["تيك توك", L.reelTt]], 4: [["إنستجرام", L.reelIg], ["تيك توك", L.reelTt], ["يوتيوب", L.reelYt]], 5: [["يوتيوب", OLD]], 6: [] };

const words = JSON.parse(fs.readFileSync(path.join(REPO, "public/words.json"), "utf8"));
const local = JSON.parse(fs.readFileSync(path.join(REPO, "public/challenge.json"), "utf8"));
ok(local.days.length === 30, "public/challenge.json has " + local.days.length + " days, want 30");
ok(DAYS.every((n) => !KEYS.some((k) => k in local.days[n - 1]) && !local.days[n - 1].reel), "public/challenge.json already has links on the checked days: the check would not tell the paths apart");

// the Firebase SDK the client imports, fetched once by Node and served to the browser (hermetic, as verify-client-firestore.mjs)
const SDK = "https://www.gstatic.com/firebasejs/10.14.1/";
const SDK_CACHE = path.join(os.tmpdir(), "ghareeb-fb-sdk-10.14.1");
fs.mkdirSync(SDK_CACHE, { recursive: true });
const sdkFile = async (name) => {
  const f = path.join(SDK_CACHE, name);
  if (!fs.existsSync(f)) { const r = await fetch(SDK + name); if (!r.ok) throw new Error("SDK " + name + " " + r.status); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); }
  return fs.readFileSync(f);
};

const { server, base } = await serve(undefined, { liveFirebase: true }); // ?emul=1 points the real config at the emulator
const br = await chromium.launch();
const env = await initializeTestEnvironment({ projectId: "demo-ghareeb", firestore: { rules: fs.readFileSync(path.join(REPO, "firestore.rules"), "utf8"), host: HOST.split(":")[0], port: +HOST.split(":")[1] } });
const errs = [];
// the admin in demo mode (nothing reaches Google), seeded with a challenge; store.chUpdate is wrapped to capture chDoc() of what it saves
async function admin(seed) {
  const actx = await br.newContext({ viewport: { width: 1200, height: 900 } });
  await actx.route("**/firebase-config.js", (r) => r.fulfill({ contentType: "text/javascript", body: "window.FIREBASE_CONFIG={};" }));
  await actx.route(/googleapis|gstatic|firebaseio|firebaseapp/, (r) => { fails.push("admin: a request reached " + r.request().url()); return r.abort(); });
  await actx.addInitScript(([c, w]) => { if (!localStorage.getItem("gqch")) { localStorage.setItem("gqch", JSON.stringify(c)); localStorage.setItem("gqad", JSON.stringify({ rev: 1, surahs: w })); } }, [seed, words]);
  const a = await actx.newPage();
  a.on("pageerror", (e) => errs.push("admin: " + e.message));
  await a.goto(base + "/admin/index.html"); await a.waitForSelector('[data-a="tab"][data-v="c"]', { timeout: 20000 });
  await a.evaluate(() => { const demo = store.chUpdate.bind(store); store.chUpdate = async (fn) => { const c = await demo(fn); window.__doc = chDoc(c); return c; }; });
  await a.click('[data-a="tab"][data-v="c"]'); await a.waitForSelector('[data-a="chDay"]', { timeout: 20000 });
  const save = async (d, links) => {
    await a.click(`[data-a="chDay"][data-v="${d}"]`); await a.waitForSelector('[data-f="c.reelIg"]');
    if (links) for (const k of KEYS) await a.fill(`[data-f="c.${k}"]`, links[k] || "");
    await a.evaluate(() => { window.__doc = null; document.querySelector("#toast").textContent = ""; });
    await a.click('[data-a="chSaveDay"]');
    const got = await a.waitForFunction(() => window.__doc, null, { timeout: 5000 }).then(() => true, () => false);
    if (!got) { fails.push(`admin: saving day ${d} was refused: "${await a.evaluate(() => document.querySelector("#toast").textContent)}"`); await a.evaluate(() => closeWin(false)); }
    return got ? a.evaluate(() => window.__doc) : null;
  };
  return { save, close: () => actx.close() };
}
try {
  // ---- 1. every day opens and saves with its words unchanged
  {
    const seed = JSON.parse(JSON.stringify(local)); seed.releasedUpTo = 30;
    const ad = await admin(seed);
    let last = null;
    for (let d = 1; d <= 30; d++) {
      const doc = await ad.save(d, null);
      if (!doc) continue;
      last = doc;
      const w = doc.days[d - 1].w.map((r) => [r.no, r.word]);
      ok(JSON.stringify(w) === JSON.stringify(seed.days[d - 1].w), `admin day ${d}: saved words ${JSON.stringify(w)} want ${JSON.stringify(seed.days[d - 1].w)}`);
      ok(!KEYS.some((k) => k in doc.days[d - 1]) && !doc.days[d - 1].reel, `admin day ${d}: a save with no change added a link ${JSON.stringify(doc.days[d - 1])}`);
    }
    // after all 30 saves the whole document still has every day's words as stored
    if (last) ok(JSON.stringify(last.days.map((x) => x.w.map((r) => [r.no, r.word]))) === JSON.stringify(seed.days.map((x) => x.w)), "admin: the document after 30 saves differs from the stored words");
    await ad.close();
    console.log("  admin: 30 days opened and saved, words unchanged" + (fails.length ? " (with failures)" : ""));
  }

  // ---- 2. links typed into the editor, written as the owner through the rules
  const seed = JSON.parse(JSON.stringify(local)); seed.days[4].reel = OLD; seed.releasedUpTo = 30;
  const ad = await admin(seed);
  let doc = null;
  for (const [d, links] of Object.entries(EDIT)) doc = (await ad.save(+d, links)) || doc;
  await ad.close();
  if (!doc || !Array.isArray(doc.days)) throw new Error("admin: no challenge document was produced: " + fails.join(" | "));
  await env.clearFirestore();
  const owner = env.authenticatedContext("owner", { email: "yusufhamdy20@gmail.com", email_verified: true }).firestore();
  await env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc("public/data").set(buildFirestoreData(words)); });
  await assertSucceeds(owner.doc("public/challenge").set(doc));
  const stored = (await env.unauthenticatedContext().firestore().doc("public/challenge").get()).data();
  for (const [d, links] of Object.entries(EDIT)) for (const k of KEYS) ok((stored.days[d - 1][k] || "") === (links[k] || ""), `stored day ${d} ${k} = ${stored.days[d - 1][k]}`);
  ok(stored.days[4].reel === OLD && !KEYS.some((k) => k in stored.days[4]), "stored day 5: " + JSON.stringify(stored.days[4]));
  const published = JSON.stringify(publicChallenge(stored), null, 1);

  // ---- 3. the site
  for (const mode of ["published", "late"]) {
    const ctx = await br.newContext({ viewport: { width: 390, height: 900 } });
    await ctx.route(SDK + "*", async (r) => {
      const body = await sdkFile(r.request().url().slice(SDK.length));
      if (mode === "late") await new Promise((res) => setTimeout(res, 2000));
      r.fulfill({ contentType: "text/javascript", body });
    });
    // published: /challenge.json is what publish-build writes from the stored document
    if (mode === "published") await ctx.route("**/challenge.json", (r) => r.fulfill({ contentType: "application/json", body: published }));
    // the client must only ever talk to the emulator
    await ctx.route(/googleapis\.com|firebaseio|firebaseapp/, (r) => { fails.push(mode + ": a request reached " + r.request().url()); return r.abort(); });
    await ctx.addInitScript(() => {
      if (location.protocol === "about:") return; // the blank page between days
      localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-prog", JSON.stringify({ done: [1, 2, 3, 4, 5] }));
    });
    const p = await ctx.newPage(); p.on("pageerror", (e) => errs.push(mode + ": " + e.message));
    for (const n of DAYS) {
      await p.goto("about:blank"); await p.goto(base + "/?emul=1#/day/" + n); await p.waitForSelector("#dw .dcard", { timeout: 20000 });
      const at = () => p.evaluate(() => ({ top: document.querySelector('[data-a="done"]').getBoundingClientRect().top, cards: document.querySelectorAll(".vcard").length }));
      await p.evaluate(() => { window.__keep = [document.getElementById("dw"), document.querySelector('[data-a="done"]')]; });
      const before = await at();
      await p.waitForFunction(() => window.__DATA_SRC__ === "firestore", null, { timeout: 10000 }).catch(() => fails.push(`${mode} day ${n}: the client never read the emulator`));
      await p.waitForTimeout(600);
      const after = await at();
      const got = await p.evaluate(() => ({ btns: [...document.querySelectorAll(".vcard a.vb")].map((x) => [x.textContent.trim(), x.getAttribute("href"), x.target, x.rel]), order: [...document.querySelectorAll("#app .dmain > *")].map((x) => x.id || x.className.split(" ").pop()), kept: window.__keep.every((e) => e && e.isConnected), ch: (window.__CH__.days || []).map((d) => ({ reel: d.reel, reelIg: d.reelIg, reelTt: d.reelTt, reelYt: d.reelYt })) }));
      // a. migrate.js keeps every link field of the Firestore document
      for (const k of ["reel", ...KEYS]) ok((got.ch[n - 1][k] || "") === (stored.days[n - 1][k] || ""), `${mode} day ${n}: migrate.js ${k} = ${got.ch[n - 1][k]} want ${stored.days[n - 1][k]}`);
      // c. the Firestore answer changed nothing on the page
      ok(got.kept, `${mode} day ${n}: the page re-rendered when Firestore answered`);
      ok(after.cards === before.cards && Math.abs(after.top - before.top) < 0.5, `${mode} day ${n}: the page changed when Firestore answered (cards ${before.cards}->${after.cards}, done button ${before.top}->${after.top})`);
      // b. links from the published file; a late Firestore answer over the old file shows none
      const want = mode === "published" ? SHOW[n] : [];
      ok(JSON.stringify(got.btns.map((b) => b.slice(0, 2))) === JSON.stringify(want), `${mode} day ${n}: buttons ${JSON.stringify(got.btns)} want ${JSON.stringify(want)}`);
      ok(got.btns.every((b) => b[2] === "_blank" && b[3] === "noopener"), `${mode} day ${n}: link target/rel ${JSON.stringify(got.btns)}`);
      if (want.length) ok(got.order.join() === "dw,vcard,acts", `${mode} day ${n}: order ${got.order}`);
      console.log(`  ${mode} day ${n}: buttons ${got.btns.map((b) => b[0]).join(", ") || "none (no card)"}; done button ${before.top.toFixed(1)} -> ${after.top.toFixed(1)}`);
    }
    await ctx.close();
  }
  fails.push(...errs);
} finally {
  await env.cleanup(); await br.close(); server.close();
}
console.log(fails.length ? "FAILURES (" + fails.length + "):\n" + fails.join("\n") : "ALL CLIENT-PATH CHECKS PASSED (30 days saved unchanged; admin save -> rules -> migrate.js; published challenge.json -> day page; late Firestore answer changes nothing)");
process.exit(fails.length ? 1 : 0);
