#!/usr/bin/env node
/*
 * reel-links.mjs - adds a challenge day's video links (Instagram reel, TikTok video, YouTube Short) to Firestore and
 * publishes them. Run by the owner on the owner's machine; running it is the owner's approval for its one write (day
 * N's EMPTY link fields in public/challenge) and its one Publish run (handbook 10, AGENTS.md).
 *
 *   node scripts/reel-links.mjs --login         first run: a normal browser window opens with the three sign-in pages;
 *                                               the owner signs in, then closes the window. Nothing is typed or read
 *                                               by the script.
 *   node scripts/reel-links.mjs --day N         finds day N's links, prints them and asks before writing
 *   options:
 *     --yes            write and publish without asking
 *     --find-only      find and print the links; no Firestore read or write, no Publish
 *     --headed         search in a visible window (when a platform asks for a check in headless mode)
 *     --no-publish     write, but don't start Publish (the next scheduled Publish picks the change up)
 *     --links-json F   take the links from a JSON file { "reelIg": url, ... } instead of searching (tests, fallback)
 *     --project ID     Firestore project (default ghareebalquran-d9ae5); the emulator when FIRESTORE_EMULATOR_HOST
 *                      is set
 *     --config F       the handles (default %LOCALAPPDATA%\ghareeb-reel-links\config.json):
 *                      { "instagram": "<user>", "tiktok": "<user>", "youtube": "@<handle>" }
 *     --profile D      the browser profile (default %LOCALAPPDATA%\ghareeb-reel-links-profile)
 *
 * Steps (--day N):
 *   1. Finds, in the persistent profile (headless), the newest post on each platform whose caption or title names
 *      day N (scripts/reel-links-core.js dayMatches): the Instagram reels tab (each reel's own page for its caption,
 *      newest first by the time in its shortcode), the TikTok profile (newest first by the time in the video id), the
 *      YouTube Shorts tab (page order, newest first). Read only, one page at a time with pauses: it never clicks
 *      like, comment, follow or post, never types, and takes no screenshots.
 *   2. Prints the link per platform (or "not found" and why) and the fields it would write; stops for the owner's
 *      "yes" unless --yes.
 *   3. In one transaction (firebase-admin, application default credentials): re-reads public/challenge, refuses if
 *      it changed since step 2, sets only day N's empty link fields, verifies every other field is unchanged, writes.
 *      A link that is already set is reported and never overwritten.
 *   4. Starts Publish on main (allow_removals empty), waits for it, and checks that the live challenge.json has the
 *      links and the live day N page shows them (if day N is still locked, the page is opened with its clock set to
 *      day N's opening time).
 *   5. Prints the links found, the fields written and the Publish result. Never prints document content.
 *
 * ASCII-only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const C = require("./reel-links-core.js");
const CH = require("../shared/challenge.js");

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const has = (k) => argv.includes(k);
const LOCAL = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
const CONFIG = opt("--config") || path.join(LOCAL, "ghareeb-reel-links", "config.json");
const PROFILE = opt("--profile") || path.join(LOCAL, "ghareeb-reel-links-profile");
const PROJECT = opt("--project") || "ghareebalquran-d9ae5";
const SITE = "https://ghareebalquran.com";
const DAY = Number(opt("--day"));

const log = (s) => console.log(s);
const fail = (s) => { console.error("reel-links: " + s); process.exit(1); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms + Math.floor(Math.random() * 1000)));

if (path.resolve(PROFILE).toLowerCase().startsWith(ROOT.toLowerCase())) fail("the browser profile must be outside the repository");

// --- browser -------------------------------------------------------------------------------------------------------
async function openProfile(headed) {
  const { chromium } = require("playwright");
  fs.mkdirSync(PROFILE, { recursive: true });
  // Arabic as the browser language: YouTube shows a title in the viewer's language (auto-translated) otherwise
  const base = { headless: !headed, locale: "ar-EG", viewport: { width: 1280, height: 900 }, args: ["--disable-blink-features=AutomationControlled"], ignoreDefaultArgs: ["--enable-automation"] };
  let lastErr = null;
  // the installed Chrome, then Edge, then Playwright's Chromium: the same order every run, so the sign-ins are found
  for (const channel of ["chrome", "msedge", undefined]) {
    try {
      let ctx = await chromium.launchPersistentContext(PROFILE, Object.assign({}, base, channel ? { channel } : {}));
      if (!headed) {
        const p = ctx.pages()[0] || (await ctx.newPage());
        const ua = await p.evaluate(() => navigator.userAgent);
        if (/HeadlessChrome/.test(ua)) {
          await ctx.close();
          ctx = await chromium.launchPersistentContext(PROFILE, Object.assign({}, base, channel ? { channel } : {}, { userAgent: ua.replace("HeadlessChrome", "Chrome") }));
        }
      }
      return { ctx, channel: channel || "chromium" };
    } catch (e) { lastErr = e; }
  }
  throw new Error("no browser could open the profile: " + (lastErr && lastErr.message.split("\n")[0]));
}

async function login() {
  const { ctx, channel } = await openProfile(true);
  const pages = ["https://www.instagram.com/accounts/login/", "https://www.tiktok.com/login", "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2F"];
  const first = ctx.pages()[0] || (await ctx.newPage());
  await first.goto(pages[0]).catch(() => {});
  for (const u of pages.slice(1)) { const p = await ctx.newPage(); await p.goto(u).catch(() => {}); }
  log("A " + channel + " window is open with three tabs: Instagram, TikTok and YouTube (Google).");
  log("Sign in on each tab yourself. The script reads nothing and types nothing.");
  log("When you are done, close the whole window. The sign-ins stay in " + PROFILE);
  await new Promise((r) => ctx.on("close", r));
  log("Saved. Next: node scripts/reel-links.mjs --day N");
}

// Each finder returns { url, time?, order? } or { url: null, why }.
async function findYouTube(ctx, handle, n) {
  const p = await ctx.newPage();
  try {
    const h = handle.startsWith("@") ? handle : "@" + handle;
    await p.goto("https://www.youtube.com/" + encodeURIComponent(h).replace("%40", "@") + "/shorts?hl=ar", { waitUntil: "domcontentloaded", timeout: 45000 });
    await p.waitForTimeout(3000);
    const items = await p.evaluate(() => {
      const out = [], seen = new Set();
      const walk = (o, d) => {
        if (!o || typeof o !== "object" || d > 60) return;
        const v = o.shortsLockupViewModel;
        if (v) {
          const id = v.onTap && v.onTap.innertubeCommand && v.onTap.innertubeCommand.reelWatchEndpoint && v.onTap.innertubeCommand.reelWatchEndpoint.videoId;
          const t = ((v.overlayMetadata && v.overlayMetadata.primaryText && v.overlayMetadata.primaryText.content) || "") + " " + (v.accessibilityText || "");
          if (id && !seen.has(id)) { seen.add(id); out.push({ id, text: t }); }
        }
        const r = o.reelItemRenderer;
        if (r && r.videoId && !seen.has(r.videoId)) { seen.add(r.videoId); out.push({ id: r.videoId, text: JSON.stringify(r.headline || "") }); }
        for (const k in o) walk(o[k], d + 1);
      };
      walk(window.ytInitialData, 0);
      return out;
    });
    if (!items.length) return { url: null, why: "the Shorts tab listed no videos" };
    const hit = C.pickLatest(items.map((x, i) => ({ url: "https://www.youtube.com/shorts/" + x.id, text: x.text, order: i })), n);
    return hit || { url: null, why: "no Short among the " + items.length + " newest names day " + n };
  } finally { await p.close(); }
}

async function findTikTok(ctx, user, n) {
  const p = await ctx.newPage(), api = [];
  p.on("response", async (r) => {
    if (!/\/api\/post\/item_list/.test(r.url())) return;
    try { const j = await r.json(); (j.itemList || []).forEach((it) => api.push({ id: String(it.id), text: String(it.desc || "") })); } catch (e) {}
  });
  try {
    const u = user.replace(/^@/, "");
    await p.goto("https://www.tiktok.com/@" + encodeURIComponent(u), { waitUntil: "domcontentloaded", timeout: 45000 });
    await p.waitForTimeout(5000);
    for (let i = 0; i < 2 && !api.length; i++) { await p.mouse.wheel(0, 1200); await pause(1500); }
    const dom = await p.evaluate(() => [...document.querySelectorAll('[data-e2e="user-post-item"]')].map((el) => {
      const a = el.querySelector('a[href*="/video/"]'), img = el.querySelector("img[alt]");
      const m = a && a.getAttribute("href").match(/\/video\/([0-9]+)/);
      return m ? { id: m[1], text: img ? img.getAttribute("alt") : "" } : null;
    }).filter(Boolean));
    const captcha = await p.evaluate(() => !!document.querySelector('[id*="captcha"], .captcha_verify_container, [class*="captcha"]'));
    const all = new Map();
    for (const x of [...api, ...dom]) { const prev = all.get(x.id); all.set(x.id, { id: x.id, text: (prev ? prev.text + " " : "") + x.text }); }
    if (!all.size) return { url: null, why: captcha ? "TikTok asked for a check (run with --headed, or sign in again with --login)" : "the profile listed no videos (signed in? run --login)" };
    const hit = C.pickLatest([...all.values()].map((x) => ({ url: "https://www.tiktok.com/@" + u + "/video/" + x.id, text: x.text, time: C.ttTime(x.id) })), n);
    return hit || { url: null, why: "no video among the " + all.size + " listed names day " + n };
  } finally { await p.close(); }
}

async function findInstagram(ctx, user, n) {
  const p = await ctx.newPage();
  try {
    const u = user.replace(/^@/, "");
    await p.goto("https://www.instagram.com/" + encodeURIComponent(u) + "/reels/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await p.waitForTimeout(5000);
    if (/\/accounts\/login/.test(p.url())) return { url: null, why: "Instagram asked to sign in (run --login)" };
    const codes = await p.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/reel/"]')].map((a) => (a.getAttribute("href").match(/\/reel\/([A-Za-z0-9_-]+)/) || [])[1]).filter(Boolean))]);
    if (!codes.length) return { url: null, why: "the reels tab listed no reels (signed in? run --login)" };
    // newest first by the time in the shortcode (a pinned reel is not the newest); read each reel's caption until a match
    const order = codes.map((c) => ({ c, t: C.igTime(c) || 0 })).sort((a, b) => b.t - a.t).slice(0, 12);
    for (const { c, t } of order) {
      await pause(2500);
      await p.goto("https://www.instagram.com/reel/" + c + "/", { waitUntil: "domcontentloaded", timeout: 45000 });
      await p.waitForTimeout(2500);
      const text = await p.evaluate(() => ["og:title", "og:description"].map((k) => (document.querySelector('meta[property="' + k + '"]') || {}).content || "").join(" ") + " " + ((document.querySelector("h1") || {}).textContent || ""));
      const hit = C.pickLatest([{ url: "https://www.instagram.com/reel/" + c + "/", text, time: t }], n);
      if (hit) return hit;
    }
    return { url: null, why: "no reel among the " + order.length + " newest names day " + n };
  } finally { await p.close(); }
}

async function findLinks(n) {
  if (!fs.existsSync(CONFIG)) fail("no handles file at " + CONFIG + ' ({ "instagram": "...", "tiktok": "...", "youtube": "@..." })');
  const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  const { ctx, channel } = await openProfile(has("--headed"));
  log("Searching day " + n + " (" + channel + (has("--headed") ? ", visible window" : ", headless") + ")");
  const found = {}, why = {};
  try {
    for (const [key, fn, handle] of [["reelIg", findInstagram, cfg.instagram], ["reelTt", findTikTok, cfg.tiktok], ["reelYt", findYouTube, cfg.youtube]]) {
      if (!handle) { why[key] = "no handle in the config"; continue; }
      let r;
      try { r = await fn(ctx, String(handle), n); } catch (e) { r = { url: null, why: "page error: " + e.message.split("\n")[0].slice(0, 120) }; }
      if (r && r.url && C.linkOk(key, r.url)) found[key] = r.url; else why[key] = (r && r.why) || "not found";
      await pause(2000);
    }
  } finally { await ctx.close(); }
  return { found, why };
}

// --- Firestore, Publish, live check ----------------------------------------------------------------------------------
async function firestore() {
  const { initializeApp, getApps } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = getApps()[0] || initializeApp({ projectId: PROJECT });
  return getFirestore(app);
}

function gh(args) {
  const r = spawnSync("gh", args, { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error("gh " + args[0] + " " + args[1] + " failed: " + String(r.stderr || "").trim().split("\n")[0]);
  return r.stdout;
}

async function publish() {
  const t0 = Date.now();
  gh(["workflow", "run", "publish.yml", "--ref", "main", "-f", "allow_removals="]);
  let run = null;
  for (let i = 0; i < 24 && !run; i++) {
    await pause(4000);
    const list = JSON.parse(gh(["run", "list", "--workflow", "publish.yml", "--event", "workflow_dispatch", "--limit", "5", "--json", "databaseId,createdAt,url"]));
    run = list.filter((x) => Date.parse(x.createdAt) >= t0 - 15000).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0] || null;
  }
  if (!run) throw new Error("the Publish run did not appear");
  log("Publish run " + run.databaseId + " started: " + run.url);
  spawnSync("gh", ["run", "watch", String(run.databaseId), "--interval", "20"], { cwd: ROOT, stdio: "ignore", shell: process.platform === "win32" });
  const v = JSON.parse(gh(["run", "view", String(run.databaseId), "--json", "conclusion"]));
  return { id: run.databaseId, url: run.url, conclusion: v.conclusion };
}

async function liveChallenge() {
  const r = await fetch(SITE + "/challenge.json?nc=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error("live challenge.json: HTTP " + r.status);
  return r.json();
}

async function checkLive(n, want) {
  const keys = C.KEYS.filter((k) => want[k]);
  let live = null;
  for (let i = 0; i < 18; i++) {
    live = await liveChallenge();
    const d = (live.days || []).find((x) => Number(x.d) === n) || {};
    if (keys.every((k) => d[k] === want[k])) break;
    live = null; await pause(10000);
  }
  if (!live) return { json: false };
  const state = CH.normalizeState(live), now = new Date();
  const locked = CH.computeUnlocked(state, {}, now) < n;
  const { chromium } = require("playwright");
  const br = await chromium.launch();
  try {
    const ctx = await br.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: "block" });
    await ctx.addInitScript(() => { try { localStorage.setItem("gq-ld", "1"); } catch (e) {} });
    const p = await ctx.newPage(); let errors = 0;
    p.on("pageerror", () => errors++);
    if (locked) await p.clock.install({ time: new Date(CH.dayOpensAt(state, n)).getTime() + 60000 });
    await p.goto(SITE + "/?nc=" + Date.now() + "#/day/" + n, { waitUntil: "networkidle" });
    await p.waitForSelector("#app .vcard a.vb", { timeout: 15000 }).catch(() => {});
    const hrefs = await p.$$eval("#app .vcard a.vb", (a) => a.map((x) => x.getAttribute("href")));
    return { json: true, locked, page: keys.every((k) => hrefs.includes(want[k])), buttons: hrefs.length, errors };
  } finally { await br.close(); }
}

function ask(q) {
  if (!process.stdin.isTTY) return Promise.resolve("");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(q, (a) => { rl.close(); r(String(a).trim().toLowerCase()); }));
}

// --- main ----------------------------------------------------------------------------------------------------------
async function main() {
  if (has("--login")) return login();
  if (!Number.isInteger(DAY) || DAY < 1 || DAY > 366) fail("use --day N (a challenge day number) or --login");

  let found, why = {};
  if (opt("--links-json")) {
    found = JSON.parse(fs.readFileSync(opt("--links-json"), "utf8"));
    for (const k of Object.keys(found)) if (!C.KEYS.includes(k)) fail("unknown link field in --links-json: " + k);
  } else ({ found, why } = await findLinks(DAY));

  log("Day " + DAY + " links:");
  for (const k of C.KEYS) log("  " + C.NAMES[k].padEnd(10) + (found[k] ? found[k] : "not found (" + (why[k] || "not given") + ")"));
  if (has("--find-only")) return;
  if (!C.KEYS.some((k) => found[k])) fail("no link found; nothing to write");

  const db = await firestore();
  const snap = await db.collection("public").doc("challenge").get();
  if (!snap.exists) fail("public/challenge does not exist in " + PROJECT);
  const before = snap.data();
  const plan = C.planWrite(before, DAY, found);
  log("Firestore " + PROJECT + " public/challenge, day " + DAY + ":");
  log("  will write: " + (plan.written.map((k) => k + " (" + C.NAMES[k] + ")").join(", ") || "nothing"));
  for (const s of plan.skipped) log("  already set, not changed: " + s.key + " (" + C.NAMES[s.key] + ")" + (s.same ? ", same link" : ", a DIFFERENT link is set; change it in the admin if needed"));

  let written = [];
  if (plan.written.length) {
    if (!has("--yes")) {
      const a = await ask("Write these " + plan.written.length + " link(s) and run Publish? Type yes: ");
      if (a !== "yes") { log("Stopped: nothing written."); return; }
    }
    const done = await C.writeLinks(db, DAY, found, before);
    written = done.written;
    const after = (await db.collection("public").doc("challenge").get()).data();
    const ok = C.sameExcept(before, after, done.index, written) && written.every((k) => after.days[done.index][k] === found[k]);
    if (!ok) fail("the document read back does not match the write; check the admin");
    log("Written: " + written.join(", ") + " (read back: only these fields changed)");
  } else log("Nothing to write.");

  const want = {};
  const day = (await db.collection("public").doc("challenge").get()).data().days.find((d) => Number(d.d) === DAY) || {};
  for (const k of C.KEYS) if (typeof day[k] === "string" && day[k]) want[k] = day[k];

  if (process.env.FIRESTORE_EMULATOR_HOST || has("--no-publish")) { log("Publish: not started (" + (has("--no-publish") ? "--no-publish" : "emulator") + ")"); return; }
  if (written.length) {
    const run = await publish();
    log("Publish run " + run.id + ": " + run.conclusion + " (" + run.url + ")");
    if (run.conclusion !== "success") fail("Publish did not succeed; the links are saved in Firestore and the next scheduled Publish will try again");
  }
  const live = await checkLive(DAY, want);
  if (!live.json) fail("the live challenge.json does not show day " + DAY + "'s links yet");
  log("Live: challenge.json has day " + DAY + "'s " + Object.keys(want).length + " link(s); the day page shows " + live.buttons + " button(s), all links " + (live.page ? "present" : "NOT all present") + (live.locked ? " (day " + DAY + " is still locked: checked with the page clock at its opening time)" : "") + ", page errors " + live.errors);
  if (!live.page) process.exitCode = 1;
}

main().catch((e) => fail(e.message.split("\n")[0]));
