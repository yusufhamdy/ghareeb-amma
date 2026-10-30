// Video links round trip against the Firestore EMULATOR (never production):
//   admin chDoc() -> write public/challenge as the owner -> public read -> admin chFromDoc() -> publish publicChallenge()
//   -> the app's day page. Days: 0, 1, 2 and 3 links, and only the old single link. A private note is written to
//   admin/challengeNotes and must never reach the public file.
// Run from the repo root:
//   npx firebase emulators:exec --project demo-ghareeb --only firestore "node scripts/checks/reel-links-emulator.mjs"
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { chromium } = require("playwright");
const { serve } = require("./lib.js");
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { publicChallenge } = await import("file://" + REPO.split(path.sep).join("/") + "/scripts/publish-build.mjs");

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!HOST) { console.error("FIRESTORE_EMULATOR_HOST is not set: run this inside firebase emulators:exec (see the header)."); process.exit(1); }
const PROJECT = "demo-ghareeb"; // demo-* projects can only ever talk to emulators
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); };

const L = { reelIg: "https://www.instagram.com/reel/abc/", reelTt: "https://vm.tiktok.com/ZM1/", reelYt: "https://youtu.be/xyz" };
const ch = JSON.parse(fs.readFileSync(path.join(REPO, "public/challenge.json"), "utf8"));
const days = ch.days.map((d) => ({ d: d.d, w: d.w, reel: d.reel || "" }));
Object.assign(days[1], { reelTt: L.reelTt }); // day 2: 1 link
Object.assign(days[2], { reelIg: L.reelIg, reelYt: L.reelYt }); // day 3: 2 links
Object.assign(days[3], L); // day 4: 3 links
days[4].reel = "https://www.youtube.com/shorts/old"; // day 5: only the old link
const state = { startDate: null, releasedUpTo: 30, days };
const WANT = { 1: [], 2: ["reelTt"], 3: ["reelIg", "reelYt"], 4: ["reelIg", "reelTt", "reelYt"], 5: [] };
const SECRET = "SECRET-NOTE-" + Date.now();

const { server, base } = await serve();
const br = await chromium.launch();
const ctx = await br.newContext();
await ctx.route("**/firebase-config.js", (r) => r.fulfill({ contentType: "text/javascript", body: "window.FIREBASE_CONFIG={};" }));
await ctx.route(/googleapis|gstatic|firebaseio|firebaseapp/, (r) => { fails.push("a page request reached " + r.request().url()); return r.abort(); });
const admin = await ctx.newPage();
await admin.goto(base + "/admin/index.html"); await admin.waitForFunction(() => typeof chDoc === "function");
const doc = await admin.evaluate((s) => chDoc(s), state);

const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules: fs.readFileSync(path.join(REPO, "firestore.rules"), "utf8"), host: HOST.split(":")[0], port: +HOST.split(":")[1] } });
try {
  await env.clearFirestore();
  const owner = env.authenticatedContext("owner", { email: "yusufhamdy20@gmail.com", email_verified: true }).firestore();
  const user = env.authenticatedContext("user", { email: "user@example.com", email_verified: true }).firestore();
  const anon = env.unauthenticatedContext().firestore();
  await assertSucceeds(owner.doc("public/challenge").set(doc));
  await assertSucceeds(owner.doc("admin/challengeNotes").set({ 3: SECRET }));
  await assertFails(user.doc("public/challenge").set(doc));
  await assertFails(anon.doc("admin/challengeNotes").get());
  const snap = await assertSucceeds(anon.doc("public/challenge").get());
  const read = snap.data();
  // what Firestore stores: the links only where set, the old link untouched
  for (const d of read.days) {
    const want = WANT[d.d] || [];
    ok(JSON.stringify(["reelIg", "reelTt", "reelYt"].filter((k) => k in d)) === JSON.stringify(want), `stored day ${d.d}: link keys ${Object.keys(d)}`);
    for (const k of want) ok(d[k] === L[k], `stored day ${d.d} ${k} = ${d[k]}`);
    ok(d.reel === days[d.d - 1].reel, `stored day ${d.d}: old link changed (${d.reel})`);
  }
  // the admin reads it back unchanged
  const back = await admin.evaluate((x) => chFromDoc(x), read);
  ok(JSON.stringify(back.days.slice(0, 5)) === JSON.stringify(days.slice(0, 5)), "admin round trip differs: " + JSON.stringify(back.days.slice(0, 5)));
  // publish: the public file carries exactly the links; the private note never appears
  const pub = publicChallenge(read), txt = JSON.stringify(pub);
  ok(!txt.includes(SECRET) && !("notes" in pub), "the private note reached the public challenge");
  for (const d of pub.days.slice(0, 5)) {
    const keys = Object.keys(d).sort().join();
    ok(keys === ["d", "w", "reel", ...WANT[d.d]].sort().join(), `public day ${d.d}: keys ${keys}`);
  }
  ok(pub.days[4].reel === "https://www.youtube.com/shorts/old", "public day 5 lost the old link");
  // and the app shows them: one button per link, the old link as its platform's button, no card without links
  const app = await ctx.newPage();
  await app.addInitScript((c) => { window.__CH__ = c; localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-set", JSON.stringify({ cm: true })); }, pub);
  const SHOW = { 1: [], 2: ["تيك توك"], 3: ["إنستجرام", "يوتيوب"], 4: ["إنستجرام", "تيك توك", "يوتيوب"], 5: ["يوتيوب"] };
  for (const n of [1, 2, 3, 4, 5]) {
    await app.goto("about:blank"); await app.goto(base + "/#/day/" + n); await app.waitForSelector("#dw .dcard");
    const got = await app.evaluate(() => [...document.querySelectorAll(".vcard a.vb")].map((a) => a.textContent.trim()));
    ok(JSON.stringify(got) === JSON.stringify(SHOW[n]), `app day ${n}: ${JSON.stringify(got)} want ${JSON.stringify(SHOW[n])}`);
  }
} finally {
  await env.cleanup(); await br.close(); server.close();
}
console.log(fails.length ? "FAILURES (" + fails.length + "):\n" + fails.join("\n") : "ALL EMULATOR CHECKS PASSED (0, 1, 2, 3 links and the old link only)");
process.exit(fails.length ? 1 : 0);
