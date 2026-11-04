#!/usr/bin/env node
/*
 * firestore-export.mjs - READ-ONLY copy of the production documents the site and the admin use, to a local folder.
 *
 *   node scripts/firestore-export.mjs [--project ID] [--out DIR] [--quiet]
 *
 * Reads public/data, public/prev, public/challenge, admin/challengeNotes, config/admins (each may be missing) and every
 * document of snapshots/ and history/ with the firebase-admin SDK (application default credentials) and writes one JSON
 * file per document plus index.json to DIR (default backup/firestore/export-<time>/, git-ignored). --quiet prints counts
 * only, for the backup workflow, whose logs are public. Timestamps are kept as {"__ts": [seconds, nanos]} so
 * scripts/checks/rules-real-data.mjs can load the documents into the emulator with their original types.
 * Only reads are called. It refuses to run when FIRESTORE_EMULATOR_HOST is set (that would read the emulator), unless
 * --emulator is given for the backup's own test, which then refuses anything but a local emulator.
 * ASCII-only.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2), opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const PROJECT = opt("--project") || "ghareebalquran-d9ae5";
const OUT = opt("--out") || path.join(ROOT, "backup", "firestore", "export-" + new Date().toISOString().replace(/[:.]/g, "-"));
const QUIET = argv.includes("--quiet"), EMULATOR = argv.includes("--emulator");
const say = (m) => { if (!QUIET) console.log(m); };
export const DOCS = ["public/data", "public/prev", "public/challenge", "admin/challengeNotes", "config/admins"];
export const COLLECTIONS = ["snapshots", "history"];

if (EMULATOR && !/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) { console.error("firestore-export: --emulator needs a local FIRESTORE_EMULATOR_HOST"); process.exit(1); }
if (process.env.FIRESTORE_EMULATOR_HOST && !EMULATOR) { console.error("firestore-export: FIRESTORE_EMULATOR_HOST is set; refusing (this script reads production)"); process.exit(1); }
// The Firestore client itself, not admin.initializeApp(): firebase-admin 12 refuses the short-lived Workload Identity
// credential file that the backup workflow signs in with, while the client accepts it (and a local gcloud login).
const { Firestore } = require("firebase-admin").firestore;
const db = new Firestore({ projectId: PROJECT });
const tag = (v) => {
  if (v && typeof v.toDate === "function" && typeof v.seconds === "number") return { __ts: [v.seconds, v.nanoseconds] };
  if (Array.isArray(v)) return v.map(tag);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tag(x)]));
  return v;
};
fs.mkdirSync(OUT, { recursive: true });
const index = { project: PROJECT, at: new Date().toISOString(), docs: {}, collections: {} };
for (const d of DOCS) {
  const s = await db.doc(d).get();
  if (!s.exists) { index.docs[d] = { exists: false }; say(d + ": does not exist"); continue; }
  const file = d.replace("/", "-") + ".json";
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(tag(s.data()), null, 1));
  index.docs[d] = { exists: true, file, updateTime: s.updateTime.toDate().toISOString(), keys: Object.keys(s.data()).sort() };
  say(d + ": " + file + " (updated " + index.docs[d].updateTime + ", keys " + index.docs[d].keys.join(",") + ")");
}
for (const c of COLLECTIONS) {
  const docs = (await db.collection(c).get()).docs; index.collections[c] = {};
  for (const s of docs) { const file = c + "-" + s.id + ".json"; fs.writeFileSync(path.join(OUT, file), JSON.stringify(tag(s.data()), null, 1)); index.collections[c][s.id] = file; }
  say(c + ": " + docs.length + " documents");
}
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 1));
if (QUIET) console.log("exported " + Object.values(index.docs).filter((x) => x.exists).length + " documents and " + COLLECTIONS.map((c) => Object.keys(index.collections[c]).length + " " + c).join(", "));
else console.log("written to " + path.relative(ROOT, OUT));
await db.terminate();
