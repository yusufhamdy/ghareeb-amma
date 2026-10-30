#!/usr/bin/env node
/*
 * smoke-live.mjs - after a deploy: is the site up, with its headers and its Quran font?
 *
 *   node scripts/smoke-live.mjs https://ghareebalquran.com       (release.yml runs it against the live site)
 *   node scripts/smoke-live.mjs https://<project>--preview-xxxx.web.app
 *
 * Checks, with up to 4 attempts 10s apart (a fresh deploy can take a moment to reach every edge):
 *   - the home page, an app word route and a static word page answer 200 with HTML;
 *   - each of them carries the Content-Security-Policy written in firebase.json (exactly), and
 *     X-Content-Type-Options, Referrer-Policy, X-Frame-Options and Permissions-Policy with the firebase.json values;
 *   - the Quran font file answers 200 with the size of the committed file.
 * Prints every check; exits 1 with "SMOKE CHECK FAILED" when any fails.
 * ASCII-only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.argv[2] || "").replace(/\/$/, "");
if (!/^https:\/\//.test(BASE)) { console.error("usage: node scripts/smoke-live.mjs https://<site>"); process.exit(2); }

const fb = JSON.parse(fs.readFileSync(path.join(ROOT, "firebase.json"), "utf8"));
const want = Object.fromEntries(((fb.hosting.headers || []).find((h) => h.source === "**") || { headers: [] }).headers.map((h) => [h.key.toLowerCase(), h.value]));
const FONT = "/fonts/kfgqpc-uthmanic-hafs-v22.ttf";
const fontSize = fs.statSync(path.join(ROOT, "public", FONT)).size;
const PAGES = ["/", "/?smoke=word#/word/114-0", "/word/an-nas-4.html"];

async function once() {
  const fails = [], ok = [];
  for (const p of PAGES) {
    const r = await fetch(BASE + p, { redirect: "manual", headers: { "cache-control": "no-cache" } });
    const type = r.headers.get("content-type") || "";
    if (r.status !== 200 || !/text\/html/.test(type)) fails.push(p + ": status " + r.status + " " + type);
    else ok.push(p + ": 200");
    for (const [k, v] of Object.entries(want)) {
      const got = r.headers.get(k);
      if (got !== v) fails.push(p + ": header " + k + (got == null ? " missing" : " differs from firebase.json"));
    }
  }
  const f = await fetch(BASE + FONT, { headers: { "cache-control": "no-cache" } });
  const len = f.status === 200 ? (await f.arrayBuffer()).byteLength : 0;
  if (f.status !== 200 || len !== fontSize) fails.push(FONT + ": status " + f.status + ", " + len + " bytes (expected " + fontSize + ")");
  else ok.push(FONT + ": 200, " + len + " bytes");
  return { fails, ok };
}

if (!Object.keys(want).length || !want["content-security-policy"]) { console.error("smoke-live: firebase.json has no security headers to check"); process.exit(1); }
let res;
for (let attempt = 1; attempt <= 4; attempt++) {
  try { res = await once(); } catch (e) { res = { fails: ["request failed: " + e.message], ok: [] }; }
  if (!res.fails.length) break;
  console.log("attempt " + attempt + ": " + res.fails.length + " problem(s); " + (attempt < 4 ? "retrying in 10s" : "giving up"));
  if (attempt < 4) await new Promise((r) => setTimeout(r, 10000));
}
res.ok.forEach((l) => console.log("ok   " + l));
for (const k of Object.keys(want)) if (!res.fails.some((f) => f.includes(" " + k + " "))) console.log("ok   header " + k + " on every page");
if (res.fails.length) {
  res.fails.forEach((l) => console.log("FAIL " + l));
  console.log("SMOKE CHECK FAILED against " + BASE);
  process.exit(1);
}
console.log("SMOKE CHECK PASSED against " + BASE);
