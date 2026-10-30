#!/usr/bin/env node
/*
 * firestore-export.mjs - READ-ONLY copy of the production documents the site and the admin use, to a local folder.
 *
 *   node scripts/firestore-export.mjs [--project ID] [--out DIR]
 *
 * Reads public/data, public/prev, public/challenge, admin/challengeNotes and config/admins (each may be missing) with
 * the firebase-admin SDK (application default credentials) and writes one JSON file per document plus index.json to
 * DIR (default backup/firestore/export-<time>/, git-ignored). Timestamps are kept as {"__ts": [seconds, nanos]} so
 * scripts/checks/rules-real-data.mjs can load the documents into the emulator with their original types.
 * Only get() is called; it refuses to run when FIRESTORE_EMULATOR_HOST is set (that would read the emulator).
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
export const DOCS = ["public/data", "public/prev", "public/challenge", "admin/challengeNotes", "config/admins"];

if (process.env.FIRESTORE_EMULATOR_HOST) { console.error("firestore-export: FIRESTORE_EMULATOR_HOST is set; refusing (this script reads production)"); process.exit(1); }
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const tag = (v) => {
  if (v && typeof v.toDate === "function" && typeof v.seconds === "number") return { __ts: [v.seconds, v.nanoseconds] };
  if (Array.isArray(v)) return v.map(tag);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, tag(x)]));
  return v;
};
fs.mkdirSync(OUT, { recursive: true });
const index = { project: PROJECT, at: new Date().toISOString(), docs: {} };
for (const d of DOCS) {
  const s = await db.doc(d).get();
  if (!s.exists) { index.docs[d] = { exists: false }; console.log(d + ": does not exist"); continue; }
  const file = d.replace("/", "-") + ".json";
  fs.writeFileSync(path.join(OUT, file), JSON.stringify(tag(s.data()), null, 1));
  index.docs[d] = { exists: true, file, updateTime: s.updateTime.toDate().toISOString(), keys: Object.keys(s.data()).sort() };
  console.log(d + ": " + file + " (updated " + index.docs[d].updateTime + ", keys " + index.docs[d].keys.join(",") + ")");
}
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index, null, 1));
console.log("written to " + path.relative(ROOT, OUT));
