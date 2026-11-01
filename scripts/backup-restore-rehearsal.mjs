#!/usr/bin/env node
/*
 * backup-restore-rehearsal.mjs - proves a backup can be restored, on the owner's machine, into the EMULATOR ONLY.
 *
 *   npx firebase emulators:exec --project demo-ghareeb --only firestore \
 *     "node scripts/backup-restore-rehearsal.mjs --file backup-....age --identity PATH-TO-PRIVATE-KEY [--compare EXPORT-DIR]"
 *
 * Decrypts locally, checks every file's hash, validates the structure, loads every document into the emulator with its
 * original types, reads them back and compares, then checks that a signed-out reader is still refused. Refuses to run
 * without a local emulator and a demo project, so it cannot write to production. Prints counts and booleans only; never
 * words, meanings, notes, addresses or the key. With --compare, says how many documents differ from that export.
 * A real restore is a separate, separately authorized step, as a new version through history: see BACKUP-RESTORE.md.
 * ASCII-only.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { open, unpack, readIdentity } from "./backup-lib.mjs";

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const HOST = process.env.FIRESTORE_EMULATOR_HOST || "", PROJECT = process.env.GCLOUD_PROJECT || "demo-ghareeb";
if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(HOST) || !PROJECT.startsWith("demo-")) { console.error("rehearsal: runs only against a local Firestore emulator and a demo project; refusing."); process.exit(1); }
const FILE = opt("--file"), IDENTITY = opt("--identity"), COMPARE = opt("--compare");
if (!FILE || !IDENTITY) { console.error("usage: --file BACKUP.age --identity KEY-FILE [--compare EXPORT-DIR]"); process.exit(2); }

const fail = (m) => { console.error("REHEARSAL FAILED: " + m); process.exit(1); };
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore(), { Timestamp } = admin.firestore;
const untag = (v) => Array.isArray(v) ? v.map(untag) : v && typeof v === "object" ? (Array.isArray(v.__ts) && Object.keys(v).length === 1 ? new Timestamp(v.__ts[0], v.__ts[1]) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, untag(x)]))) : v;
const tag = (v) => v && typeof v.toDate === "function" && typeof v.seconds === "number" ? { __ts: [v.seconds, v.nanoseconds] } : Array.isArray(v) ? v.map(tag) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tag(x)])) : v;
const sortK = (v) => Array.isArray(v) ? v.map(sortK) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortK(v[k])])) : v;
const same = (a, b) => JSON.stringify(sortK(a)) === JSON.stringify(sortK(b));

let bundle;
try { bundle = unpack(await open(fs.readFileSync(FILE), readIdentity(IDENTITY))); } catch (e) { fail("could not decrypt or verify: " + (e.message || "error").split("\n")[0].slice(0, 80)); }
const index = JSON.parse(bundle.files["index.json"]), docs = {};
for (const [p, i] of Object.entries(index.docs)) if (i.exists) docs[p] = JSON.parse(bundle.files[i.file]);
for (const [coll, list] of Object.entries(index.collections || {})) for (const [id, f] of Object.entries(list)) docs[coll + "/" + id] = JSON.parse(bundle.files[f]);
console.log("decrypted: " + Object.keys(bundle.files).length + " files, every hash checked; taken " + bundle.at);

// structure
const d = docs["public/data"]; if (!d || !Array.isArray(d.surahs)) fail("public/data is missing or has no surahs");
const countWords = (s) => s.reduce((n, e) => n + e.words.length, 0);
for (const e of d.surahs) if (!Array.isArray(e.words) || !Array.isArray(e.meanings) || !Array.isArray(e.ayahs) || e.words.length !== e.meanings.length || e.words.length !== e.ayahs.length) fail("a surah's lists differ in length");
const ch = docs["public/challenge"], snaps = Object.keys(docs).filter((k) => k.startsWith("snapshots/")), hist = Object.keys(docs).filter((k) => k.startsWith("history/"));
if (snaps.length !== hist.length) fail("snapshots and history differ in number");
for (const k of snaps) { const v = docs[k]; if (+k.split("/")[1] !== v.rev || !Array.isArray(v.surahs) || !docs["history/" + v.rev]) fail("a snapshot has no matching rev or row"); }
console.log("structure ok: rev " + d.rev + ", " + d.surahs.length + " surahs, " + countWords(d.surahs) + " words, " + (ch && ch.days ? ch.days.length : 0) + " challenge days, " + snaps.length + " snapshots, " + hist.length + " history rows, " + Object.keys(docs).length + " documents");

// load, read back, compare
for (const [p, v] of Object.entries(docs)) await db.doc(p).set(untag(v));
let bad = 0;
for (const [p, v] of Object.entries(docs)) { const s = await db.doc(p).get(); if (!s.exists || !same(tag(s.data()), v)) bad++; }
if (bad) fail(bad + " documents differ after loading");
console.log("loaded into the emulator and read back: all " + Object.keys(docs).length + " documents identical");

// the rules still hold on the restored data
const probes = ["public/data", "public/challenge", ...(docs["admin/challengeNotes"] ? ["admin/challengeNotes"] : []), ...snaps.slice(0, 1), ...hist.slice(0, 1)];
for (const p of probes) {
  const r = await fetch("http://" + HOST + "/v1/projects/" + PROJECT + "/databases/(default)/documents/" + p);
  if (r.status !== 403) fail("a signed-out read of " + p.split("/")[0] + " returned " + r.status);
}
console.log("rules still enforced: a signed-out reader is refused (" + probes.length + " probes)");

if (COMPARE) {
  const cur = JSON.parse(fs.readFileSync(path.join(COMPARE, "index.json"), "utf8")); let differ = 0, n = 0;
  for (const [p, i] of Object.entries(cur.docs)) { if (!i.exists) continue; n++; if (!docs[p] || !same(docs[p], JSON.parse(fs.readFileSync(path.join(COMPARE, i.file), "utf8")))) differ++; }
  console.log("compared with that export: " + differ + " of " + n + " documents differ");
}
console.log("REHEARSAL PASSED");
await db.terminate();
