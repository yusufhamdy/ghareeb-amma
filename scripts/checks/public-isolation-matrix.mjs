// The Section 4.5 matrix for Phase 1B, in the EMULATORS only: unpublished canaries sit in the Firestore emulator while real
// browsers visit the site. A switchable local server gives the old site (OLD_PUBLIC, a checkout of public/ from before the
// change) and the new one on one origin, so the old worker really upgrades. Every Google host is blocked and counted: nothing
// here reaches production. Prints counts and booleans, never Quran text or meanings.
// Run from the repo root:
//   OLD_PUBLIC=<dir> npx firebase emulators:exec --project demo-ghareeb --only auth,firestore "node scripts/checks/public-isolation-matrix.mjs"
// ASCII only.
import fs from "node:fs";
import os from "node:os";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { chromium } = require("playwright");

const FSH = process.env.FIRESTORE_EMULATOR_HOST, AUH = process.env.FIREBASE_AUTH_EMULATOR_HOST, OLD = process.env.OLD_PUBLIC;
const local = (h) => /^(127\.0\.0\.1|localhost):/.test(h || "");
if (!local(FSH) || !local(AUH)) { console.error("emulators only"); process.exit(1); }
if (!OLD || !fs.existsSync(path.join(OLD, "migrate.js"))) { console.error("OLD_PUBLIC must be a public/ folder from before the change"); process.exit(1); }
const NEW = path.join(REPO, "public"), PROJECT = "demo-ghareeb", CANARY = "CANARY-UNPUBLISHED-DRAFT";
const rules = fs.readFileSync(path.join(REPO, "firestore.rules"), "utf8"), OWNER = (rules.match(/[\w.+-]+@[\w.-]+/) || [])[0];
const [host, port] = FSH.split(":");
const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { rules, host, port: Number(port) } });
let fail = 0, passed = 0;
const check = (id, ok, extra) => { console.log((ok ? "PASS  " : "FAIL  ") + id + (!ok && extra !== undefined ? "  " + JSON.stringify(extra) : "")); if (ok) passed++; else fail++; };
const write = (k, v) => env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc(k).set(v); });
const raw = async (k) => { let o; await env.withSecurityRulesDisabled(async (c) => { const s = await c.firestore().doc(k).get(); o = s.exists ? s.data() : null; }); return o; };

const JUZ = (fs.readFileSync(path.join(NEW, "admin/index.html"), "utf8").match(/const JUZ="([^"]+)"/) || [])[1].split(",");
const WORDS = JSON.parse(fs.readFileSync(path.join(NEW, "words.json"), "utf8")).map((s) => Object.assign({ no: 78 + JUZ.indexOf(s.surah.replace(/^\S+\s*/, "")) }, s));
const CH_FILE = JSON.parse(fs.readFileSync(path.join(NEW, "challenge.json"), "utf8"));
const canaryDoc = (rev) => ({ rev, surahs: [{ surah: CANARY, no: 114, words: [CANARY], meanings: [CANARY], ayahs: [], source: CANARY }] });
const seedCanary = async () => {
  await env.clearFirestore();
  await write("public/data", canaryDoc(2)); await write("public/prev", canaryDoc(1));
  await write("public/challenge", { startDate: null, releasedUpTo: null, days: [{ d: 1, w: [{ no: 114, word: CANARY }], reel: "https://" + CANARY + ".invalid/" }] });
};

// ---- a server that can switch sites, delay a file, or fail page and worker requests
const S = { root: NEW, delay: {}, failNav: false };
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const server = http.createServer(async (q, s) => {
  let p = decodeURIComponent(q.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
  if (S.failNav && (p === "/index.html" || p === "/sw.js")) return q.socket.destroy();
  if (S.delay[p]) await new Promise((r) => setTimeout(r, S.delay[p]));
  if (p === "/firebase-config.js") { s.writeHead(200, { "content-type": "text/javascript" }); return s.end("window.FIREBASE_CONFIG={};"); }
  const f = path.join(S.root, p);
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end("not found"); }
  s.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream", "cache-control": "no-cache" }); fs.createReadStream(f).pipe(s);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;
const br = await chromium.launch();
const BLOCK = /googleapis\.com|firebaseio|firebaseapp\.com|google\.com|googleusercontent|gstatic\.com|sentry/;
const FORBID = /gstatic\.com\/firebasejs|firestore\.googleapis|google\.firestore/;

async function visitor(opts = {}) {
  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: opts.worker ? "allow" : "block" });
  const asked = [], emu = [], pe = [], ce = [], blocked = [];
  await ctx.route((u) => BLOCK.test(u.hostname), (r) => { blocked.push(r.request().url()); return r.abort(); });
  const watch = (q) => { const u = q.url(); if (FORBID.test(u)) asked.push(new URL(u).hostname); if (u.includes(":" + port + "/") || u.includes(":" + AUH.split(":")[1] + "/")) emu.push(new URL(u).pathname); };
  ctx.on("request", watch);
  const p = await ctx.newPage();
  p.on("pageerror", (e) => pe.push(e.message.slice(0, 120)));
  p.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED|ERR_BLOCKED/.test(m.text())) ce.push(m.text().replace(/https?:\/\/[^\s]+/g, (x) => { try { return new URL(x).pathname; } catch (_) { return "url"; } }).slice(0, 120)); });
  return { ctx, p, asked, emu, pe, ce, blocked };
}
const published = async (p) => {
  await p.waitForFunction(() => typeof W !== "undefined" && W.length > 0 && document.querySelector("#app"), null, { timeout: 30000 });
  return p.evaluate((c) => ({ src: window.__DATA_SRC__, words: W.length, surahs: S.length, days: CH.length, overrides: window.__WORDS__ !== undefined || window.__CH__ !== undefined, draft: document.documentElement.outerHTML.includes(c) || JSON.stringify(W, (k, x) => (k === "s" ? x && x.surah : x)).includes(c) || JSON.stringify(CH).includes(c) }), CANARY);
};
const isPub = (s) => s.src === "json" && s.words === 73 && s.surahs === 28 && s.days === 30 && !s.overrides && !s.draft;
const clean = (v) => v.asked.length === 0 && v.emu.length === 0;
// polled from here: waitForFunction does not wait for an async predicate
const until = async (p, fn, arg, ms = 45000) => { const end = Date.now() + ms; for (;;) { if (await p.evaluate(fn, arg).catch(() => false)) return; if (Date.now() > end) throw new Error("timed out waiting for the worker"); await new Promise((r) => setTimeout(r, 200)); } };
const workerOn = (p, name) => until(p, async (n) => (await caches.keys()).includes(n) && !!navigator.serviceWorker.controller, name);
const OLD_NAME = (fs.readFileSync(path.join(OLD, "sw.js"), "utf8").match(/ghareeb-pwa-v\d+/) || [])[0], NEW_NAME = (fs.readFileSync(path.join(NEW, "sw.js"), "utf8").match(/ghareeb-pwa-v\d+/) || [])[0];
check("the worker versions are " + OLD_NAME + " and " + NEW_NAME, OLD_NAME !== NEW_NAME && NEW_NAME === "ghareeb-pwa-v45");

console.log("== fresh and returning browser ==");
await seedCanary();
{
  const v = await visitor({ worker: true });
  await v.p.goto(base + "/"); const a = await published(v.p);
  check("fresh: 73 words, 28 surahs, 30 days, json, no draft", isPub(a), a);
  check("fresh: 0 SDK, Firestore or emulator requests", clean(v), { asked: v.asked, emu: v.emu });
  await workerOn(v.p, NEW_NAME);
  await v.p.reload(); const b = await published(v.p);
  check("returning (cache and worker): the same", isPub(b) && clean(v), { b, asked: v.asked });
  check("fresh and returning: 0 page and console errors", v.pe.length === 0 && v.ce.length === 0, { pe: v.pe, ce: v.ce });
  await v.ctx.close();
}

console.log("\n== an old worker meets the new site ==");
{
  S.root = OLD; const v = await visitor({ worker: true });
  await v.p.goto(base + "/"); await workerOn(v.p, OLD_NAME);
  const had = await v.p.evaluate(async (n) => (await (await caches.open(n)).keys()).some((r) => r.url.endsWith("/migrate.js")), OLD_NAME);
  check("the old worker is active, with migrate.js in its cache", had);
  v.asked.length = 0; v.emu.length = 0; S.root = NEW;
  await v.p.reload(); await until(v.p, async (n) => (await caches.keys()).includes(n), NEW_NAME);
  await until(v.p, async (o) => !(await caches.keys()).includes(o), OLD_NAME);
  const st = await v.p.evaluate(async (n) => { const k = await caches.keys(), l = (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname); return { caches: k, migrate: l.includes("/migrate.js"), config: l.includes("/firebase-config.js"), sw: (await navigator.serviceWorker.getRegistration()).active.state }; }, NEW_NAME);
  check("upgrade: only the v45 cache remains", JSON.stringify(st.caches) === JSON.stringify([NEW_NAME]), st.caches);
  check("upgrade: migrate.js and firebase-config.js are not in it", !st.migrate && !st.config, st);
  v.asked.length = 0; v.emu.length = 0;
  await v.p.reload(); const a = await published(v.p);
  check("upgrade: the next visit is published, with 0 SDK or Firestore requests", isPub(a) && clean(v), { a, asked: v.asked });
  await v.ctx.close();
}
{
  S.root = OLD; const v = await visitor({ worker: true });
  await v.p.goto(base + "/"); await workerOn(v.p, OLD_NAME);
  S.root = NEW; S.failNav = true; v.asked.length = 0; v.emu.length = 0;
  const r = await v.p.reload().catch(() => null);
  const a = await published(v.p);
  const mig = await v.p.evaluate(async () => { try { return (await fetch("/migrate.js", { cache: "no-store" })).status; } catch (e) { return "failed"; } });
  check("cached old page, fix live: the words are published, and no draft", a.words === 73 && a.surahs === 28 && !a.draft, a);
  check("cached old page, fix live: no Firestore read and no SDK request", clean(v), { asked: v.asked, emu: v.emu });
  check("cached old page, fix live: migrate.js is a 404, not the cached copy", mig === 404, mig);
  S.failNav = false; await v.ctx.close();
}

console.log("\n== delayed files ==");
for (const f of ["/fonts/fonts.css", "/quiz-core.js", "/qtext.js", "/qfont.js", "/word-gap.js", "/fonts/kfgqpc-uthmanic-hafs-v22.ttf"]) {
  S.delay = { [f]: 3000 }; const v = await visitor();
  await v.p.goto(base + "/", { waitUntil: "commit" }); const a = await published(v.p); await v.p.waitForTimeout(3300); const b = await published(v.p);
  check("delayed " + f + ": published, no draft, 0 requests, before and after it lands", isPub(a) && isPub(b) && clean(v), { a, asked: v.asked });
  S.delay = {}; await v.ctx.close();
}

console.log("\n== Firestore available, unavailable, malformed ==");
{
  const v = await visitor(); await v.p.goto(base + "/"); const a = await published(v.p); await v.p.waitForTimeout(1500);
  check("available, with valid canaries: published", isPub(a) && clean(v), a); await v.ctx.close();
}
{
  const v = await visitor();
  await v.ctx.route(new RegExp("firestore|:" + port + "/"), (r) => r.abort());
  await v.p.goto(base + "/"); const a = await published(v.p);
  check("unavailable: published, 0 page and console errors", isPub(a) && !v.pe.length && !v.ce.length, { a, pe: v.pe, ce: v.ce }); await v.ctx.close();
}
for (const [name, doc] of [["[null]", { rev: 3, surahs: [null] }], ["junk", { rev: "x", surahs: "junk" }], ["empty", { rev: 3, surahs: [] }], ["huge", { rev: 3, surahs: [{ surah: CANARY, no: 114, words: [CANARY], meanings: ["x".repeat(900000)], ayahs: [] }] }]]) {
  await write("public/data", doc); const v = await visitor();
  await v.p.goto(base + "/"); const a = await published(v.p);
  check("malformed " + name + ": published, no error page", isPub(a) && !v.pe.length && clean(v), { a, pe: v.pe }); await v.ctx.close();
}

console.log("\n== offline ==");
{
  await seedCanary(); const v = await visitor({ worker: true });
  await v.p.goto(base + "/"); await workerOn(v.p, NEW_NAME); await v.p.reload(); await published(v.p);
  await v.ctx.setOffline(true);
  await v.p.reload(); const a = await published(v.p);
  await v.p.evaluate(() => { location.hash = "#/word/114-0"; }); await v.p.waitForSelector("#app .wd.q", { timeout: 15000 });
  await v.p.evaluate(() => { location.hash = "#/challenge"; }); await v.p.waitForSelector("#app .cg .dy", { timeout: 15000 });
  check("offline, worker active: published, word and challenge routes render", isPub(a) && !v.pe.length, { a, pe: v.pe });
  await v.ctx.close();
}

console.log("\n== draft against published, and the admin ==");
{
  const SDK = "https://www.gstatic.com/firebasejs/10.14.1/", CACHE = path.join(os.tmpdir(), "ghareeb-fb-sdk-10.14.1"); fs.mkdirSync(CACHE, { recursive: true });
  const sdk = async (n) => { const f = path.join(CACHE, n); if (!fs.existsSync(f)) { const r = await fetch(SDK + n); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); } return fs.readFileSync(f); };
  const WRAP = {
    "firebase-auth.js": `export * from "${SDK}firebase-auth.real.js";import {getAuth as g,connectAuthEmulator as c} from "${SDK}firebase-auth.real.js";export function getAuth(a){const x=g(a);if(!x.__emu){c(x,"http://${AUH}",{disableWarnings:true});x.__emu=1}return x}`,
    "firebase-firestore.js": `export * from "${SDK}firebase-firestore.real.js";import {getFirestore as g,connectFirestoreEmulator as c} from "${SDK}firebase-firestore.real.js";export function getFirestore(a){const x=g(a);if(!x.__emu){c(x,"${host}",${port});x.__emu=1}return x}`,
  };
  const SI = WORDS.findIndex((s) => s.words.length >= 2);
  // a draft with one word removed and one surah removed; the visitor's copy keeps both
  const draft = JSON.parse(JSON.stringify(WORDS)); const goneSurah = draft.findIndex((s, i) => i !== SI); const goneNo = draft[goneSurah].no;
  draft[SI].words.splice(1, 1); draft[SI].meanings.splice(1, 1); draft[SI].ayahs.splice(1, 1); draft.splice(goneSurah, 1);
  await env.clearFirestore(); await write("public/data", { rev: 6, surahs: draft, by: "someone" }); await write("public/challenge", { startDate: null, releasedUpTo: null, days: [] });
  const v = await visitor(); await v.p.goto(base + "/"); const a = await published(v.p);
  check("published vs draft: the visitor keeps 73 words and 28 surahs", isPub(a), a);
  await v.p.evaluate((n) => { location.hash = "#/surah/" + n; }, goneNo); await v.p.waitForSelector("#app .list.g .row", { timeout: 15000 });
  check("deleted surah, in the draft only: still shown", (await v.p.locator("#app .list.g .row").count()) > 0);
  await v.p.evaluate((id) => { location.hash = "#/word/" + id; }, WORDS[SI].no + "-1"); await v.p.waitForSelector("#app .wd.q", { timeout: 15000 });
  check("deleted word, in the draft only: still shown", (await v.p.locator("#app .wd.q").textContent()).trim().length > 0);
  check("the visitor made 0 SDK or Firestore requests", clean(v), { asked: v.asked, emu: v.emu }); await v.ctx.close();

  const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } }), pe = [], ce = [];
  await ctx.route("**/firebase-config.js", (r) => r.fulfill({ contentType: "text/javascript", body: `window.FIREBASE_CONFIG={apiKey:"demo-key",authDomain:"${PROJECT}.firebaseapp.com",projectId:"${PROJECT}",appId:"1:1:web:1"};` }));
  await ctx.route(SDK + "*", async (r) => { const n = r.request().url().slice(SDK.length); if (WRAP[n]) return r.fulfill({ contentType: "text/javascript", body: WRAP[n] }); r.fulfill({ contentType: "text/javascript", body: await sdk(n.replace(".real.js", ".js")) }); });
  await ctx.route((u) => /googleapis\.com|firebaseio|firebaseapp\.com|google\.com|googleusercontent/.test(u.hostname), (r) => r.abort());
  const p = await ctx.newPage(); p.on("pageerror", (e) => pe.push(e.message.slice(0, 120))); p.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED/.test(m.text())) ce.push(m.text().slice(0, 120)); });
  await p.goto(base + "/admin/index.html"); await p.waitForFunction(() => typeof FB !== "undefined" && FB.auth && READY, null, { timeout: 30000 });
  check("the admin page loads", true);
  await p.evaluate(async (e) => { const { GoogleAuthProvider, signInWithCredential } = FB.au; await signInWithCredential(FB.auth, GoogleAuthProvider.credential(JSON.stringify({ sub: "owner-sub", email: e, email_verified: true }))); }, OWNER);
  await p.waitForFunction(() => U && READY && D && document.querySelector('[data-a="tab"]'), null, { timeout: 25000 });
  const seen = await p.evaluate(() => ({ surahs: D.surahs.length, words: D.surahs.reduce((n, s) => n + s.words.length, 0) }));
  check("the admin signs in through the emulator and sees the draft, not the published words", seen.surahs === 27 && seen.words < 73, seen);
  await p.click('[data-a="tab"][data-v="w"]'); await p.click(`[data-a="editW"][data-v="0.0"]`); await p.waitForSelector("#e-m"); await p.fill("#e-m", "matrix-meaning"); await p.click('[data-a="saveW"]');
  await p.waitForFunction(() => !SAVING && !document.querySelector("#e-m"), null, { timeout: 25000 });
  const d = await raw("public/data"), h = await raw("history/7"), s7 = await raw("snapshots/7");
  check("the admin saves: rev 7, the meaning stored, one row and one snapshot", d.rev === 7 && d.surahs[0].meanings[0] === "matrix-meaning" && h && h.kind === "edit" && !!s7);
  check("the admin: 0 page and console errors", !pe.length && !ce.length, { pe, ce });
  await ctx.close();
  const after = await visitor(); await after.p.goto(base + "/"); const c = await published(after.p);
  check("after that save the visitor still sees the published words", isPub(c) && (await after.p.evaluate(() => !JSON.stringify(W, (k, x) => (k === "s" ? 0 : x)).includes("matrix-meaning"))), c);
  await after.ctx.close();
}

console.log("\n== the rules layer ==");
{
  await seedCanary();
  const anon = env.unauthenticatedContext().firestore(), other = env.authenticatedContext("u1", { email: "someone@example.test", email_verified: true }).firestore(), own = env.authenticatedContext("o1", { email: OWNER, email_verified: true }).firestore();
  for (const k of ["public/data", "public/prev", "public/challenge"]) {
    await assertFails(anon.doc(k).get()); await assertFails(other.doc(k).get()); await assertSucceeds(own.doc(k).get());
    const r = await fetch(`http://${FSH}/v1/projects/${PROJECT}/databases/(default)/documents/${k}`);
    check(k + ": signed out and non-admin refused, owner allowed, REST " + r.status, r.status === 403);
  }
}

console.log("\n== the whole app, and the static pages ==");
{
  // every day is open to a visitor who has done the ones before it
  const v = await visitor(); await v.ctx.addInitScript(() => { localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-prog", JSON.stringify({ done: Array.from({ length: 30 }, (_, i) => i + 1) })); });
  await v.p.goto(base + "/"); await published(v.p);
  const walk = async (hash, sel) => { await v.p.evaluate((h) => { location.hash = h; }, hash); await v.p.waitForFunction((s) => { const e = document.querySelector(s); return e && e.textContent.trim().length > 0; }, sel, { timeout: 15000 }).catch(() => { throw new Error("empty route " + hash); }); };
  const ids = await v.p.evaluate(() => ({ words: W.map((w) => w.id), surahs: S.map((s) => s.num) })); let n = 0;
  await walk("#/surahs", "#app .list.sl .row"); n++;
  for (const s of ids.surahs) { await walk("#/surah/" + s, "#app .list.g .row"); n++; }
  for (const w of ids.words) { await walk("#/word/" + w, "#app .wd.q"); n++; }
  await walk("#/challenge", "#app .cg .dy"); n++;
  for (let d = 1; d <= 30; d++) { await walk("#/day/" + d, "#dw .dcard"); n++; }
  await walk("#/quiz", "#app"); n++;
  for (const l of ["about", "privacy", "terms", "rights"]) { await walk("#/" + l, "#app h1"); n++; }
  await walk("#/no-such-route", "#app"); await walk("#/", "#app .acts"); n += 2;
  check("the app: " + n + " routes (73 words, 28 surahs, 30 days) all have content", ids.words.length === 73 && ids.surahs.length === 28);
  const list = (d) => fs.readdirSync(path.join(NEW, d), { withFileTypes: true }).filter((e) => e.isDirectory() || e.name.endsWith(".html")).map((e) => "/" + d + "/" + e.name + (e.isDirectory() ? "/" : ""));
  const pages = list("word").concat(list("surah"), ["/about/", "/privacy/", "/terms/", "/rights/", "/404.html"]);
  let bad = 0; for (const u of pages) { const r = await v.p.goto(base + u, { waitUntil: "load" }); if (!r || r.status() !== 200 || !(await v.p.evaluate(() => document.body.innerText.trim().length > 0))) bad++; }
  check("static pages: " + list("word").length + " word, " + list("surah").length + " surah, legal and 404 all render", bad === 0 && list("word").length === 73 && list("surah").length === 28, bad);
  check("everything: 0 SDK or Firestore requests", clean(v), { asked: v.asked, emu: v.emu });
  check("everything: 0 page errors", v.pe.length === 0, v.pe.slice(0, 3));
  check("everything: 0 console errors", v.ce.length === 0, v.ce.slice(0, 3));
  await v.ctx.close();
  const sm = (fs.readFileSync(path.join(NEW, "sitemap.xml"), "utf8").match(/\/word\/[^<]+/g) || []).length;
  check("sitemap: " + sm + " word pages for 73 words (removing a page on publish is Phase 5)", sm === 73, sm);
}

await br.close(); server.close(); await env.cleanup();
console.log("\n" + passed + " passed, " + fail + " failed");
console.log(fail ? fail + " CHECKS FAILED" : "ALL CHECKS PASSED");
process.exit(fail ? 1 : 0);
