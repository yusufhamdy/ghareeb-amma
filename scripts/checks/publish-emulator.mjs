#!/usr/bin/env node
/*
 * publish-emulator.mjs - Phase 5, test T-36: the publish command end to end against the Firestore emulator, reading
 * with the Firestore client exactly as the workflow will (scripts/publish-build.mjs --publish --project demo-ghareeb).
 * Run inside the emulator (test/publish-emulator.test.js does that):
 *
 *   firebase emulators:exec --project demo-ghareeb --only firestore "node scripts/checks/publish-emulator.mjs"
 *   ... "node scripts/checks/publish-emulator.mjs --export backup/firestore/export-2026-11-01T15-45-07-715Z"
 *
 * Synthetic mode (the default, in npm test): the emulator gets the committed data in Firestore's shape with one meaning
 * edited, and private notes with a marker. Checks:
 *   1. the publish writes exactly words.json, that word's page and rev.json; no share image (the meaning is not on the
 *      image); no redirect; the report names exactly that word and the field "meaning";
 *   2. no private note reaches any file of the site, firebase.json or the report;
 *   3. a second run finds no change and writes nothing;
 *   4. after an ayah edit, the same tree is updated: that word's share image is made again and no other image changes;
 *   5. a removed word is refused by the removal guard, with nothing written.
 * Export mode (local only; the export is private and git-ignored): the emulator gets the export's public/data,
 * public/challenge and admin/challengeNotes, and the first publish must be exactly one changed meaning: words.json,
 * that word's page and rev.json, no image, no redirect, and no note anywhere; a second run finds no change.
 * Prints file names, slugs and counts only, never document content. ASCII only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROJECT = "demo-ghareeb";
const argv = process.argv.slice(2);
const EXPORT = argv.includes("--export") ? path.resolve(argv[argv.indexOf("--export") + 1]) : null;

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) {
  console.error("publish-emulator: run inside the Firestore emulator (FIRESTORE_EMULATOR_HOST is not a local emulator)");
  process.exit(1);
}
const mod = await import(pathToFileURL(path.join(ROOT, "scripts", "publish-build.mjs")).href);
const rep = await import(pathToFileURL(path.join(ROOT, "scripts", "publish-report.mjs")).href);
const { Firestore, Timestamp } = require("firebase-admin").firestore;
const db = new Firestore({ projectId: PROJECT });

const fails = [];
const ok = (cond, msg) => { console.log((cond ? "ok   " : "FAIL ") + msg); if (!cond) fails.push(msg); };
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const committedWords = () => readJson(path.join(ROOT, "public", "words.json"));
const committedChallenge = () => readJson(path.join(ROOT, "public", "challenge.json"));

function treeFiles(dir) {
  const out = new Map();
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.set(path.relative(dir, p).split(path.sep).join("/"), crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")); } };
  walk(dir);
  return out;
}
const changedFiles = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter((f) => a.get(f) !== b.get(f)).sort();

// the publish command as the workflow runs it, in a fresh process reading the emulator
function publish(work, extra = []) {
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts", "publish-build.mjs"), "--publish", "--project", PROJECT,
    "--site", path.join(work, "site"), "--firebase-json", path.join(work, "firebase.json"),
    "--summary", path.join(work, "summary.json"), "--report", path.join(work, "report.md"), ...extra], { encoding: "utf8", timeout: 600000, env: process.env });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || ""), summary: fs.existsSync(path.join(work, "summary.json")) ? readJson(path.join(work, "summary.json")) : null };
}
function workCopy() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "gq-publish-emu-"));
  fs.cpSync(path.join(ROOT, "public"), path.join(work, "site"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "firebase.json"), path.join(work, "firebase.json"));
  return work;
}
// every string of a document (for the leak check), at least 4 characters long
const strings = (v, out = []) => { if (typeof v === "string") { if (v.trim().length >= 4) out.push(v); } else if (v && typeof v === "object") for (const x of Object.values(v)) strings(x, out); return out; };
function leaks(work, secrets) {
  const hits = new Set();
  const files = [...treeFiles(path.join(work, "site")).keys()].map((f) => path.join(work, "site", f)).filter((f) => /\.(html|json|xml|css|txt|js)$/.test(f));
  files.push(path.join(work, "firebase.json"));
  if (fs.existsSync(path.join(work, "report.md"))) files.push(path.join(work, "report.md"));
  for (const f of files) { const t = fs.readFileSync(f, "utf8"); for (const s of secrets) if (t.includes(s)) hits.add(path.relative(work, f)); }
  return [...hits];
}

// Firestore's shape: a "no" field, surahs from 78 up, challenge references as {no, word}
function toFirestore(list) {
  return list.map((s) => ({ no: mod.surahNumber(s.surah), ...s })).sort((a, b) => a.no - b.no);
}
const chToFirestore = (ch) => ({ ...ch, days: ch.days.map((d) => ({ ...d, w: d.w.map(([no, word]) => ({ no, word })) })) });
const untag = (v) => (v && typeof v === "object" && Array.isArray(v.__ts) ? new Timestamp(v.__ts[0], v.__ts[1]) : Array.isArray(v) ? v.map(untag) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, untag(x)])) : v);

async function seed(data, challenge, notes) {
  for (const d of ["public/data", "public/challenge", "admin/challengeNotes"]) await db.doc(d).delete();
  await db.doc("public/data").set(data);
  await db.doc("public/challenge").set(challenge);
  if (notes) await db.doc("admin/challengeNotes").set(notes);
}

try {
  if (EXPORT) await exportMode();
  else await syntheticMode();
} finally {
  await db.terminate();
}
if (fails.length) { console.log(fails.length + " FAILED"); process.exit(1); }
console.log("ALL CHECKS PASSED");

async function syntheticMode() {
  const MARK = "PRIVATE-NOTE-MARKER-c41e";
  const list = committedWords();
  const sIdx = 5, wIdx = 0;
  list[sIdx].meanings[wIdx] = list[sIdx].meanings[wIdx] + " (T-36 edit)";
  const slug = [...mod.wordIndex(list).values()].find((w) => w.no === mod.surahNumber(list[sIdx].surah) && w.i === wIdx).slug;
  const ch = chToFirestore(committedChallenge());
  ch.notes = { 1: MARK }; // a stray notes map in the public document must not pass either
  await seed({ rev: 8, surahs: toFirestore(list), by: "owner", updatedAt: Timestamp.now() }, ch, { 1: MARK, 2: MARK + "-2" });

  const work = workCopy();
  try {
    // 1. one meaning: words.json, its page, rev.json
    const before = treeFiles(path.join(work, "site"));
    const fbBefore = fs.readFileSync(path.join(work, "firebase.json"), "utf8");
    const r1 = publish(work);
    ok(r1.status === 0 && /publish-build: changed/.test(r1.out), "1. the publish ran (exit " + r1.status + ")");
    const c1 = changedFiles(before, treeFiles(path.join(work, "site")));
    ok(JSON.stringify(c1) === JSON.stringify(["rev.json", "word/" + slug + ".html", "words.json"]), "1. changed files: " + c1.join(", "));
    ok(r1.summary && r1.summary.rev === 8 && r1.summary.images.length === 0 && r1.summary.remove.length === 0, "1. rev 8, no share image, nothing removed");
    ok(fs.readFileSync(path.join(work, "firebase.json"), "utf8") === fbBefore, "1. firebase.json unchanged (no redirect)");
    const md = fs.readFileSync(path.join(work, "report.md"), "utf8");
    const changedLines = md.split("\n").filter((l) => l.startsWith("- **"));
    ok(changedLines.length === 1 && changedLines[0] === "- **Changed** `" + slug + "`: meaning", "1. the report lists exactly " + slug + ": meaning");
    // 2. notes
    const l2 = leaks(work, [MARK]);
    ok(l2.length === 0, "2. no private note in any file or the report" + (l2.length ? ": " + l2.join(", ") : ""));
    // 3. no change
    const mid = treeFiles(path.join(work, "site"));
    const r3 = publish(work);
    ok(r3.status === 0 && /publish-build: no-change/.test(r3.out), "3. a second run finds no change");
    ok(changedFiles(mid, treeFiles(path.join(work, "site"))).length === 0, "3. and writes nothing");
    // 4. an ayah edit on another word: its image is made again, and only it
    const list2 = JSON.parse(JSON.stringify(list));
    const s2 = 9, w2 = 0;
    const seg = list2[s2].ayahs[w2].segments[list2[s2].ayahs[w2].segments.length - 1];
    seg.after = seg.after + " \u0627";
    const slug2 = [...mod.wordIndex(list2).values()].find((w) => w.no === mod.surahNumber(list2[s2].surah) && w.i === w2).slug;
    await db.doc("public/data").set({ rev: 9, surahs: toFirestore(list2), by: "owner", updatedAt: Timestamp.now() });
    const r4 = publish(work);
    ok(r4.status === 0, "4. the publish after an ayah edit ran (exit " + r4.status + ")" + (r4.status ? "\n" + r4.out.slice(-1500) : ""));
    const c4 = changedFiles(mid, treeFiles(path.join(work, "site")));
    ok(r4.summary && JSON.stringify(r4.summary.images) === JSON.stringify([slug2]), "4. share images made again: " + (r4.summary ? r4.summary.images.join(", ") : "none"));
    ok(c4.filter((f) => f.startsWith("og/")).join() === "og/word/" + slug2 + ".png", "4. the only changed image is og/word/" + slug2 + ".png");
    ok(c4.includes("word/" + slug2 + ".html") && c4.includes("rev.json") && c4.includes("words.json"), "4. its page, words.json and rev.json are updated: " + c4.join(", "));
    // 5. the removal guard, through the command
    const list5 = JSON.parse(JSON.stringify(list2));
    const big = list5.findIndex((s) => s.words.length >= 2);
    for (const k of ["words", "meanings", "ayahs"]) list5[big][k].pop();
    await db.doc("public/data").set({ rev: 10, surahs: toFirestore(list5), by: "owner", updatedAt: Timestamp.now() });
    const pre5 = treeFiles(path.join(work, "site"));
    const fb5 = fs.readFileSync(path.join(work, "firebase.json"), "utf8");
    const r5 = publish(work);
    ok(r5.status !== 0 && /removal guard/.test(r5.out), "5. a removed word is refused by the removal guard");
    ok(changedFiles(pre5, treeFiles(path.join(work, "site"))).length === 0 && fs.readFileSync(path.join(work, "firebase.json"), "utf8") === fb5, "5. nothing written");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

async function exportMode() {
  const idx = readJson(path.join(EXPORT, "index.json"));
  const data = untag(readJson(path.join(EXPORT, "public-data.json")));
  const ch = untag(readJson(path.join(EXPORT, "public-challenge.json")));
  const notes = idx.docs["admin/challengeNotes"] && idx.docs["admin/challengeNotes"].exists ? untag(readJson(path.join(EXPORT, "admin-challengeNotes.json"))) : null;
  console.log("export " + path.basename(EXPORT) + ": rev " + data.rev + ", " + data.surahs.length + " surahs, notes " + (notes ? "present" : "absent"));
  await seed(data, ch, notes);
  const work = workCopy();
  try {
    const before = treeFiles(path.join(work, "site"));
    const fbBefore = fs.readFileSync(path.join(work, "firebase.json"), "utf8");
    const r1 = publish(work);
    ok(r1.status === 0 && /publish-build: changed/.test(r1.out), "the first publish ran (exit " + r1.status + ")" + (r1.status ? "\n" + r1.out.split("\n").filter((l) => !/[^\x00-\x7f]/.test(l)).slice(-20).join("\n") : ""));
    if (r1.status !== 0) return;
    const d = rep.diffWords(committedWords(), mod.normaliseSurahs(data.surahs));
    const c1 = changedFiles(before, treeFiles(path.join(work, "site")));
    console.log("     changed files: " + c1.join(", "));
    console.log("     words added " + d.added.length + ", removed " + d.removed.length + ", changed " + d.changed.length + (d.changed.length ? " (" + d.changed.map((c) => c.slug + ": " + c.fields.map((f) => f.name).join("+")).join("; ") + ")" : ""));
    ok(d.added.length === 0 && d.removed.length === 0 && d.changed.length === 1, "exactly one word changed");
    ok(d.changed.length === 1 && d.changed[0].fields.map((f) => f.name).join() === "meaning", "and only its meaning");
    const slug = d.changed[0] && d.changed[0].slug;
    ok(JSON.stringify(c1) === JSON.stringify(["rev.json", "word/" + slug + ".html", "words.json"]), "the change set is words.json, word/" + slug + ".html and rev.json");
    ok(r1.summary.images.length === 0, "no share image is made again (the meaning is not on the image)");
    ok(r1.summary.rev === data.rev, "rev.json carries rev " + data.rev);
    ok(fs.readFileSync(path.join(work, "firebase.json"), "utf8") === fbBefore, "firebase.json unchanged (no redirect)");
    ok(rep.diffChallenge(committedChallenge(), readJson(path.join(work, "site", "challenge.json"))).length === 0, "challenge.json unchanged");
    const md = fs.readFileSync(path.join(work, "report.md"), "utf8");
    const lines = md.split("\n").filter((l) => l.startsWith("- **"));
    ok(lines.length === 1 && lines[0] === "- **Changed** `" + slug + "`: meaning", "the report lists exactly " + slug + ": meaning");
    if (notes) { const l = leaks(work, strings(notes)); ok(l.length === 0, "no private note text in any file or the report (" + strings(notes).length + " note strings checked)" + (l.length ? ": " + l.join(", ") : "")); }
    const mid = treeFiles(path.join(work, "site"));
    const r2 = publish(work);
    ok(r2.status === 0 && /publish-build: no-change/.test(r2.out) && changedFiles(mid, treeFiles(path.join(work, "site"))).length === 0, "a second run finds no change and writes nothing");
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}
