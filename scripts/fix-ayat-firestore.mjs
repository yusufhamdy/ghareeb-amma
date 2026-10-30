#!/usr/bin/env node
/*
 * fix-ayat-firestore.mjs - makes every ayah segment of the production words document (Firestore public/data) the
 * official text byte for byte, at release, together with the KFGQPC font: the 2026-10-27 text corrections (9 fields)
 * and the 2026-10-28 rewrite of NFC-stored segments to the official bytes (no Unicode normalization).
 *
 *   node scripts/fix-ayat-firestore.mjs --dry-run            read only: back up, print the exact diff, change nothing
 *   node scripts/fix-ayat-firestore.mjs --apply --confirm    back up, then write the corrections (owner approval)
 *   options: --project ID (default ghareebalquran-d9ae5), --from-json FILE (dry run on a saved copy, no Firestore),
 *            --owner-uid UID (or env GHAREEB_OWNER_UID): the owner's Firebase uid, written as "by"
 *
 * What it does:
 *   1. reads public/data and writes it, unchanged, to backup/firestore/public-data-<time>.json
 *      (git-ignored; also in a dry run);
 *   2. finds the segments that fail the ayah rule (public/admin/ayah-check.js: a byte-exact piece of the official
 *      ayah) and rebuilds them from the official bytes with data/quran/fix.js - the same code that rewrote
 *      public/words.json;
 *   3. accepts a changed field only when it is the same text in other bytes (canonically equivalent: encoding only)
 *      or one of the text corrections listed in test/fixtures/ayat-fix-2026-10-27.json (same surah, ayah, field and
 *      old text); any other change, or a field that cannot be rebuilt, stops the script with no write;
 *   4. prints the diff, and every remaining difference in ayah text between the corrected document and
 *      public/words.json;
 *   5. with --apply --confirm only: in one transaction, re-reads public/data, refuses if its rev changed since the
 *      backup, copies it to public/prev (as the admin does before every save) and writes the corrected surahs with
 *      rev + 1, the time, and by = the owner's Firebase uid (the rules accept only the signed-in writer's own uid in
 *      "by", so the owner can later write the document back unchanged, and no address is stored in the public
 *      document). Nothing else changes. The uid comes from --owner-uid or GHAREEB_OWNER_UID; without either it is
 *      looked up, read-only, in Firebase Auth by the owner address that firestore.rules names in isOwner().
 *   6. every run writes a log next to its backup (<backup>.log.json): the time, mode, target, revision before and
 *      after, the corrections applied (or found, in a dry run) and the result. The run stays traceable through the
 *      backup, public/prev and this log.
 *
 * Uses the firebase-admin SDK with application default credentials. ASCII-only.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const quran = require("../data/quran/index.js");
const AyahCheck = require("../public/admin/ayah-check.js");
const { fixSurahs } = require("../data/quran/fix.js");
const FIXTURE = path.join(ROOT, "test", "fixtures", "ayat-fix-2026-10-27.json");

const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const DRY = argv.includes("--dry-run"), APPLY = argv.includes("--apply"), CONFIRM = argv.includes("--confirm");
const PROJECT = opt("--project") || "ghareebalquran-d9ae5";
const FROM_JSON = opt("--from-json");

const cps = (s) => [...String(s)].map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join(" ");

function changedPart(a, b) {
  const x = [...a], y = [...b];
  let i = 0; while (i < x.length && i < y.length && x[i] === y[i]) i++;
  let j = 0; while (j < x.length - i && j < y.length - i && x[x.length - 1 - j] === y[y.length - 1 - j]) j++;
  return { from: x.slice(i, x.length - j).join(""), to: y.slice(i, y.length - j).join("") };
}

function plan(doc) {
  const surahs = Array.isArray(doc.surahs) ? doc.surahs : [];
  const fx = JSON.parse(fs.readFileSync(FIXTURE, "utf8")).fields;
  const r = fixSurahs(surahs);
  // the 9 listed text corrections, and any change to the official bytes of the same text (encoding only)
  const listed = (c) => fx.some((f) => f.surah === c.no && f.num === c.num && f.field === c.field && f.from === c.from);
  const allowed = (c) => c.encoding || listed(c);
  const unexpected = r.changes.filter((c) => !allowed(c));
  // segments still failing after the corrections (should be none)
  const failing = [];
  r.surahs.forEach((e) => (e.ayahs || []).forEach((a) => (a.segments || []).forEach((g) => {
    if (AyahCheck.check([g], quran.surahNumber(e.surah), quran.ayah).length) failing.push(quran.surahNumber(e.surah) + ":" + g.num);
  })));
  return { surahs: r.surahs, changes: r.changes, errors: r.errors, unexpected, failing, missing: fx.filter((f) => !r.changes.some((c) => c.no === f.surah && c.num === f.num && c.field === f.field)) };
}

function report(doc, p) {
  console.log("public/data rev " + doc.rev + ": " + (doc.surahs || []).length + " surahs");
  console.log("\n== corrections (" + p.changes.length + ") ==");
  const nSeg = new Set(p.changes.map((c) => c.si + "/" + c.ai + "/" + c.gi)).size, enc = p.changes.filter((c) => c.encoding).length;
  console.log(p.changes.length + " fields in " + nSeg + " segments: " + (p.changes.length - enc) + " text corrections, " + enc + " encoding only (same text, official bytes)");
  for (const c of p.changes) {
    const d = changedPart(c.from, c.to);
    console.log("surahs[" + c.si + "].ayahs[" + c.ai + "].segments[" + c.gi + "]." + c.field + "  (surah " + c.no + ", ayah " + c.num + ", word " + JSON.stringify(c.word) + ")");
    console.log("  - " + JSON.stringify(c.from));
    console.log("  + " + JSON.stringify(c.to));
    console.log("    changed: [" + cps(d.from) + "] -> [" + cps(d.to) + "]");
  }
  if (p.unexpected.length) console.log("\nNOT IN THE RELEASE LIST (the script will not apply anything): " + p.unexpected.map((c) => c.no + ":" + c.num + " " + c.field).join(", "));
  if (p.missing.length) console.log("\nlisted corrections not needed in this document (already correct or changed since): " + p.missing.map((f) => f.surah + ":" + f.num + " " + f.field).join(", "));
  if (p.errors.length) console.log("\nCANNOT REBUILD: " + p.errors.join("; "));
  if (p.failing.length) console.log("\nSTILL FAILING after the corrections: " + p.failing.join(", "));
  // the corrected document against public/words.json (ayah text only)
  const site = JSON.parse(fs.readFileSync(path.join(ROOT, "public", "words.json"), "utf8"));
  const key = (e, w) => quran.surahNumber(e.surah) + "/" + w;
  const segs = (list) => { const m = new Map(); list.forEach((e) => (e.words || []).forEach((w, i) => m.set(key(e, w), JSON.stringify((((e.ayahs || [])[i] || {}).segments || []).map((g) => [Number(g.num), g.before, g.hl, g.after]))))); return m; }; // values only: Firestore returns map keys in its own order
  const a = segs(p.surahs), b = segs(site), diff = [];
  for (const [k, v] of a) if (!b.has(k)) diff.push("only in Firestore: " + k); else if (b.get(k) !== v) diff.push("ayah text differs: " + k);
  for (const k of b.keys()) if (!a.has(k)) diff.push("only in words.json: " + k);
  console.log("\n== corrected Firestore vs public/words.json, ayah text: " + (diff.length ? diff.length + " differences" : "identical") + " ==");
  diff.forEach((d) => console.log("  " + d));
}

// the owner's Firebase uid, for "by": --owner-uid / GHAREEB_OWNER_UID, else a read-only Auth lookup of the owner
// address in firestore.rules (no address in this script)
async function ownerUid(admin) {
  const v = opt("--owner-uid") || process.env.GHAREEB_OWNER_UID;
  if (v) return { uid: v, from: opt("--owner-uid") ? "--owner-uid" : "GHAREEB_OWNER_UID" };
  const m = fs.readFileSync(path.join(ROOT, "firestore.rules"), "utf8").match(/function isOwner\(\)\s*\{\s*return mail\(\) == '([^']+)';/);
  if (!m) throw new Error("no owner address in firestore.rules isOwner(); pass --owner-uid");
  return { uid: (await admin.auth().getUserByEmail(m[1])).uid, from: "Firebase Auth lookup of the isOwner() address" };
}

async function main() {
  if (!DRY && !(APPLY && CONFIRM)) {
    console.log("fix-ayat-firestore: pass --dry-run, or --apply --confirm (owner approval, at release).");
    return 2;
  }
  if (process.env.FIRESTORE_EMULATOR_HOST && APPLY) console.log("fix-ayat-firestore: FIRESTORE_EMULATOR_HOST is set - writing to the emulator.");
  let db = null, doc, owner = null;
  if (FROM_JSON) {
    if (APPLY) throw new Error("--from-json is for dry runs only");
    doc = JSON.parse(fs.readFileSync(FROM_JSON, "utf8"));
  } else {
    const admin = require("firebase-admin");
    if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT });
    db = admin.firestore();
    const snap = await db.doc("public/data").get();
    if (!snap.exists) throw new Error("public/data does not exist");
    doc = snap.data();
    owner = await ownerUid(admin).catch((e) => { if (APPLY) throw new Error("owner uid: " + e.message); console.log("owner uid: not found (" + e.message + ")"); return null; });
  }
  const dir = path.join(ROOT, "backup", "firestore"); // git-ignored
  fs.mkdirSync(dir, { recursive: true });
  const backup = path.join(dir, "public-data-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json");
  fs.writeFileSync(backup, JSON.stringify(doc, (k, v) => (v && typeof v.toDate === "function" ? v.toDate().toISOString() : v), 2));
  console.log("backup: " + path.relative(ROOT, backup));

  const p = plan(doc);
  report(doc, p);
  // exactly what --apply writes: the two documents, field by field (surahs: the corrected list above / the current one)
  console.log("\n== after --apply ==");
  console.log("public/data: { " + Object.keys(Object.assign({}, doc, { rev: 0, surahs: 0, updatedAt: 0, by: 0 })).sort().map((k) => k === "rev" ? "rev: " + ((doc.rev || 0) + 1) : k === "surahs" ? "surahs: (corrected, " + p.surahs.length + " surahs)" : k === "updatedAt" ? "updatedAt: (server time)" : k === "by" ? "by: " + JSON.stringify(owner ? owner.uid : "(owner uid)") : k + ": (unchanged)").join(", ") + " }" + (owner ? "   [uid from " + owner.from + "]" : ""));
  console.log("public/prev: { rev: " + (doc.rev || 0) + ", surahs: (the current public/data surahs), savedAt: (server time) }");
  const logFile = backup.replace(/\.json$/, ".log.json");
  const log = {
    time: new Date().toISOString(), mode: DRY ? "dry-run" : "apply", project: PROJECT,
    target: FROM_JSON ? "file " + FROM_JSON : process.env.FIRESTORE_EMULATOR_HOST ? "emulator " + process.env.FIRESTORE_EMULATOR_HOST : "production",
    backup: path.relative(ROOT, backup), revBefore: doc.rev == null ? null : doc.rev, revAfter: null, by: owner ? owner.uid : null,
    corrections: p.changes.map((c) => ({ surah: c.no, ayah: c.num, field: c.field, word: c.word, kind: c.encoding ? "encoding" : "text", from: c.from, to: c.to })),
    result: null,
  };
  const done = (result, code) => { log.result = result; fs.writeFileSync(logFile, JSON.stringify(log, null, 2)); console.log("log: " + path.relative(ROOT, logFile)); return code; };
  if (p.unexpected.length || p.errors.length || p.failing.length) { console.log("\nfix-ayat-firestore: stopped, nothing written."); return done("stopped, nothing written", 1); }
  if (DRY) { console.log("\nfix-ayat-firestore: dry run, nothing written."); return done("dry run, nothing written", 0); }
  if (!p.changes.length) { console.log("\nfix-ayat-firestore: nothing to correct."); return done("nothing to correct", 0); }

  const { FieldValue } = require("firebase-admin/firestore");
  await db.runTransaction(async (tx) => {
    const ref = db.doc("public/data"), cur = await tx.get(ref);
    if (!cur.exists || (cur.data().rev || 0) !== (doc.rev || 0)) throw new Error("public/data changed since the backup (rev " + (cur.exists ? cur.data().rev : "none") + "); run again");
    const again = plan(cur.data());
    if (JSON.stringify(again.surahs) !== JSON.stringify(p.surahs)) throw new Error("public/data changed since the backup; run again");
    tx.set(db.doc("public/prev"), { rev: cur.data().rev || 0, surahs: cur.data().surahs, savedAt: FieldValue.serverTimestamp() });
    tx.set(ref, Object.assign({}, cur.data(), { rev: (cur.data().rev || 0) + 1, surahs: p.surahs, updatedAt: FieldValue.serverTimestamp(), by: owner.uid }));
  }).catch((e) => { done("write failed: " + e.message, 1); throw e; });
  log.revAfter = (doc.rev || 0) + 1;
  console.log("\nfix-ayat-firestore: written (rev " + log.revAfter + "); the previous version is in public/prev.");
  return done("written", 0);
}

main().then((c) => { process.exitCode = c; }, (e) => { console.error("fix-ayat-firestore: " + e.message); process.exitCode = 1; });
