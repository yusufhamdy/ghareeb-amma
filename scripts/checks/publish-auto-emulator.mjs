// The automatic publish against the Firestore EMULATOR, end to end: the same commands, in the same order, as
// .github/workflows/publish.yml runs them (publish-plan.mjs check, then publish-plan.mjs plan, then publish-build.mjs
// --publish with the planned data and removal counts), on a copy of the site. For each case it checks what the
// workflow would do next: nothing, commit and deploy ("auto"), or a pull request ("pr"), or fail with nothing written.
// The data, history rows and snapshots are seeded the way the admin writes them. Run by
// test/publish-auto-emulator.test.js inside emulators:exec. Prints cases, booleans, counts, slugs and file names only.
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
if (!/^(127\.0\.0\.1|localhost):/.test(process.env.FIRESTORE_EMULATOR_HOST || "")) { console.error("emulator only"); process.exit(1); }
const build = await import(pathToFileURL(path.join(ROOT, "scripts", "publish-build.mjs")).href);
const { Firestore, Timestamp } = require("firebase-admin").firestore;
const db = new Firestore({ projectId: PROJECT });

const fails = [];
const ok = (cond, msg) => { console.log((cond ? "ok   " : "FAIL ") + msg); if (!cond) fails.push(msg); };
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));
const WORDS = readJson(path.join(ROOT, "public", "words.json"));
const CH = readJson(path.join(ROOT, "public", "challenge.json"));
const PUBLISHED = readJson(path.join(ROOT, "public", "rev.json")).rev;
const toFirestore = (list) => clone(list).map((s) => ({ no: build.surahNumber(s.surah), ...s })).sort((a, b) => a.no - b.no);
const chToFirestore = (ch) => ({ ...clone(ch), days: ch.days.map((d) => ({ ...d, w: d.w.map(([no, word]) => ({ no, word })) })) });
const removeAt = (list, si, wi) => { for (const k of ["words", "meanings", "ayahs"]) list[si][k].splice(wi, 1); return list; };
const multi = WORDS.map((s, i) => [s.words.length, i]).filter(([n]) => n >= 2).map(([, i]) => i);
// Every published word is used by a challenge day, and the build refuses a reference to a word that is gone. So a
// delete is published together with the challenge edit that drops the word from its day, as the admin does it.
const free = multi.map((si) => [si, 0]);
const keyOf = (list, si, wi) => [build.surahNumber(list[si].surah), build.siteWordKey(list[si].words[wi])];
const dropRefs = (ch, refs) => { const c = clone(ch); c.days.forEach((d) => { d.w = d.w.filter(([no, k]) => !refs.some(([n2, k2]) => n2 === no && k2 === k)); }); return chToFirestore(c); };

function treeFiles(dir) {
  const out = new Map();
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.set(path.relative(dir, p).split(path.sep).join("/"), crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex")); } };
  walk(dir);
  return out;
}
const changed = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter((f) => a.get(f) !== b.get(f)).sort();
function workCopy() {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "gq-auto-emu-"));
  fs.cpSync(path.join(ROOT, "public"), path.join(work, "site"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "firebase.json"), path.join(work, "firebase.json"));
  return work;
}

// the state the admin leaves: public/data at rev N, and a history row and a snapshot for every save after the publish
async function seed({ list, rev, steps = [], challenge = chToFirestore(CH) }) {
  for (const c of ["history", "snapshots"]) for (const d of (await db.collection(c).get()).docs) await d.ref.delete();
  await db.doc("public/data").set({ rev, surahs: toFirestore(list), by: "owner-uid", updatedAt: Timestamp.now() });
  await db.doc("public/challenge").set(challenge);
  for (const [r, kind, l] of steps) {
    await db.doc("snapshots/" + r).set({ rev: r, surahs: toFirestore(l) });
    await db.doc("history/" + r).set({ rev: r, kind, summary: "case", by: "owner-uid", byEmail: "owner@example.test", at: Timestamp.now() });
  }
}

const node = (args) => { const r = spawnSync(process.execPath, args, { encoding: "utf8", timeout: 600000, env: process.env }); return { status: r.status, out: (r.stdout || "") + (r.stderr || "") }; };
const outputs = (out) => Object.fromEntries(out.split("\n").map((l) => l.match(/^  ([a-z_]+)=(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
// the workflow, step by step: check, plan, build; returns what it would do next. owner: a run started by hand with
// allow_removals ({ allow, surahs }), which the workflow always builds as a pull request with --owner-review; otherwise an
// automatic publish is built with --max-removals 7, as the workflow does.
function run(work, owner) {
  const site = path.join(work, "site");
  const c = node([path.join(ROOT, "scripts", "publish-plan.mjs"), "check", "--project", PROJECT, "--site", site]);
  const co = outputs(c.out);
  if (c.status !== 0) return { next: "fail", step: "check", out: c.out };
  if (co.changed !== "true") return { next: "nothing", check: co };
  const p = node([path.join(ROOT, "scripts", "publish-plan.mjs"), "plan", "--project", PROJECT, "--site", site, "--data-out", path.join(work, "data.json"), "--challenge-out", path.join(work, "challenge.json")]);
  const po = outputs(p.out);
  if (p.status !== 0) return { next: "fail", step: "plan", out: p.out };
  const b = node([path.join(ROOT, "scripts", "publish-build.mjs"), "--publish", "--from-json", path.join(work, "data.json"), "--challenge-json", path.join(work, "challenge.json"),
    "--site", site, "--firebase-json", path.join(work, "firebase.json"), "--summary", path.join(work, "summary.json"), "--report", path.join(work, "report.md"), "--no-images",
    ...(owner ? ["--allow-removals", owner.allow, "--allow-surah-removals", owner.surahs || "", "--owner-review"]
      : ["--allow-removals", po.allow_removals, "--allow-surah-removals", po.removed_surahs, ...(po.mode === "auto" ? ["--max-removals", "7"] : [])])]);
  if (b.status !== 0) return { next: "fail", step: "build", plan: po, out: b.out, reasons: p.out.split("\n").filter((l) => /reason:/.test(l)) };
  if (/publish-build: no-change/.test(b.out)) return { next: "nothing", step: "build", plan: po };
  return { next: po.mode === "auto" && !owner ? "commit and deploy" : "pull request", plan: po, summary: readJson(path.join(work, "summary.json")), reasons: p.out.split("\n").filter((l) => /reason:/.test(l)) };
}

async function kase(name, fn) {
  console.log("\n== " + name + " ==");
  const work = workCopy();
  try { await fn(work); } catch (e) { ok(false, name + ": " + e.message.split("\n")[0]); } finally { fs.rmSync(work, { recursive: true, force: true }); }
}

try {
  await kase("same rev and challenge: nothing to do", async (work) => {
    await seed({ list: WORDS, rev: PUBLISHED });
    const before = treeFiles(path.join(work, "site"));
    const r = run(work);
    ok(r.next === "nothing" && r.check && r.check.changed === "false", "the cheap check ends the run (" + r.next + ")");
    ok(changed(before, treeFiles(path.join(work, "site"))).length === 0, "nothing written");
  });

  await kase("a challenge change with the same rev is published", async (work) => {
    const ch = chToFirestore(CH); ch.releasedUpTo = 1;
    await seed({ list: WORDS, rev: PUBLISHED, challenge: ch });
    const r = run(work);
    ok(r.next === "commit and deploy", "commit and deploy (" + r.next + ")");
    ok(r.summary && r.summary.write.includes("challenge.json"), "challenge.json is written");
  });

  await kase("an edit: commit and deploy", async (work) => {
    const next = clone(WORDS); next[multi[0]].meanings[0] += " (auto edit)";
    await seed({ list: next, rev: PUBLISHED + 1, steps: [[PUBLISHED + 1, "edit", next]] });
    const before = treeFiles(path.join(work, "site"));
    const r = run(work);
    ok(r.next === "commit and deploy", "commit and deploy (" + r.next + ")");
    const c = changed(before, treeFiles(path.join(work, "site")));
    ok(c.length === 3 && c.includes("words.json") && c.includes("rev.json") && c.filter((f) => f.startsWith("word/")).length === 1, "changed: " + c.join(", "));
    ok(readJson(path.join(work, "site", "rev.json")).rev === PUBLISHED + 1, "rev.json is the new rev");
    const again = run(work);
    ok(again.next === "nothing", "the next run finds the site current (" + again.next + ")");
  });

  await kase("an admin delete of one word: commit, deploy and a redirect to its surah page", async (work) => {
    const [si, wi] = free[0];
    const slug = [...build.wordIndex(WORDS).values()].find((w) => w.no === build.surahNumber(WORDS[si].surah) && w.i === wi).slug;
    const surahSlug = build.buildSurahs(build.buildRecords(WORDS)).find((s) => s.no === build.surahNumber(WORDS[si].surah)).slug;
    const ch = dropRefs(CH, [keyOf(WORDS, si, wi)]);
    const next = removeAt(clone(WORDS), si, wi);
    await seed({ list: next, rev: PUBLISHED + 1, steps: [[PUBLISHED + 1, "edit", next]], challenge: ch });
    const r = run(work);
    ok(r.next === "commit and deploy", "commit and deploy (" + r.next + ")");
    ok(r.plan && r.plan.allow_removals === "1" && r.plan.removed === slug, "planned: 1 removal, " + (r.plan && r.plan.removed));
    ok(!fs.existsSync(path.join(work, "site", "word", slug + ".html")), "the word page is removed");
    const red = readJson(path.join(work, "firebase.json")).hosting.redirects.find((x) => x.source === "/word/" + slug + ".html");
    ok(!!red && red.destination === "/surah/" + surahSlug + ".html" && red.type === 301, "301 /word/" + slug + ".html -> " + (red && red.destination));
  });

  await kase("8 words deleted in the admin, on 73 published words: no auto-publish; the 10% guard refuses the build", async (work) => {
    let list = clone(WORDS); const steps = [];
    for (let k = 0; k < 8; k++) { const si = list.findIndex((s) => s.words.length >= 2); list = removeAt(clone(list), si, 0); steps.push([PUBLISHED + 1 + k, "edit", list]); }
    await seed({ list, rev: PUBLISHED + 8, steps });
    const before = treeFiles(path.join(work, "site"));
    const r = run(work);
    ok(r.plan && r.plan.mode === "pr", "planned: a pull request (" + (r.plan && r.plan.mode) + ")");
    ok(r.next === "fail" && r.step === "build" && /more than the ceiling/.test(r.out), "the build refuses it: more than 10% of " + WORDS.reduce((n, s) => n + s.words.length, 0) + " words");
    ok(changed(before, treeFiles(path.join(work, "site"))).length === 0, "nothing written");
  });

  await kase("8 words deleted, on 73 published words: Publish run by hand with the exact count opens a pull request", async (work) => {
    let list = clone(WORDS); const steps = [], refs = [];
    for (let k = 0; k < 8; k++) { const si = list.findIndex((s) => s.words.length >= 2); refs.push(keyOf(list, si, 0)); list = removeAt(clone(list), si, 0); steps.push([PUBLISHED + 1 + k, "edit", list]); }
    await seed({ list, rev: PUBLISHED + 8, steps, challenge: dropRefs(CH, refs) });
    const before = treeFiles(path.join(work, "site"));
    const r0 = run(work);
    ok(r0.next === "fail" && r0.step === "build" && /run Publish by hand with allow_removals 8/.test(r0.out), "the scheduled run fails and says how to go on (" + r0.next + ")");
    ok(changed(before, treeFiles(path.join(work, "site"))).length === 0, "nothing written by the scheduled run");
    const r7 = run(work, { allow: "7" });
    ok(r7.next === "fail" && r7.step === "build" && /must match exactly/.test(r7.out), "by hand with a wrong count (7): refused, the count must match exactly");
    ok(changed(before, treeFiles(path.join(work, "site"))).length === 0, "nothing written by the wrong count");
    const r = run(work, { allow: "8" });
    ok(r.next === "pull request", "by hand with allow_removals 8: a pull request, past the ceiling (" + r.next + ")");
    ok(r.summary && r.summary.words.after === WORDS.reduce((n, s) => n + s.words.length, 0) - 8, "the pull request removes exactly 8 words");
  });

  await kase("an automatic publish never removes more than 7, whatever the plan says", async (work) => {
    // a plan that allows 8 automatically cannot happen (decide() refuses it); the build's own --max-removals 7 is checked
    // directly, on the 103-word list where the 10% ceiling alone would allow 10
    const big = clone(WORDS); const bi = multi[0];
    for (let k = 0; k < 30; k++) { big[bi].words.push(big[bi].words[0]); big[bi].meanings.push(big[bi].meanings[0] + " " + k); big[bi].ayahs.push({ ...clone(big[bi].ayahs[0]), label: String(200 + k) }); }
    await seed({ list: big, rev: PUBLISHED + 1, steps: [[PUBLISHED + 1, "edit", big]] });
    ok(run(work).next === "commit and deploy", "103 words published");
    let list = clone(big);
    for (let k = 0; k < 8; k++) list = removeAt(clone(list), bi, list[bi].words.length - 1);
    fs.writeFileSync(path.join(work, "data.json"), JSON.stringify(list));
    const b = node([path.join(ROOT, "scripts", "publish-build.mjs"), "--publish", "--from-json", path.join(work, "data.json"), "--challenge-json", path.join(work, "challenge.json"),
      "--site", path.join(work, "site"), "--firebase-json", path.join(work, "firebase.json"), "--no-images", "--allow-removals", "8", "--max-removals", "7"]);
    ok(b.status !== 0 && /more than the ceiling of 7 for this publish/.test(b.out), "the build refuses 8 removals with --max-removals 7");
  });

  await kase("8 words deleted in the admin, on 103 published words: a pull request only", async (work) => {
    // publish 30 more words first (an addition goes live by itself), so 8 is under the 10% guard
    const big = clone(WORDS); const bi = multi[0];
    for (let k = 0; k < 30; k++) { big[bi].words.push(big[bi].words[0]); big[bi].meanings.push(big[bi].meanings[0] + " " + k); big[bi].ayahs.push({ ...clone(big[bi].ayahs[0]), label: String(200 + k) }); }
    await seed({ list: big, rev: PUBLISHED + 1, steps: [[PUBLISHED + 1, "edit", big]] });
    const r0 = run(work);
    ok(r0.next === "commit and deploy" && r0.summary.words.after === 103, "the 30 added words go live by themselves (" + r0.next + ")");
    let list = clone(big); const steps = [[PUBLISHED + 1, "edit", big]];
    for (let k = 0; k < 8; k++) { list = removeAt(clone(list), bi, list[bi].words.length - 1); steps.push([PUBLISHED + 2 + k, "edit", list]); }
    await seed({ list, rev: PUBLISHED + 9, steps });
    const r = run(work);
    ok(r.next === "pull request", "a pull request (" + r.next + ")");
    ok(r.plan && r.plan.allow_removals === "8", "8 removals planned");
    ok((r.reasons || []).some((l) => /removes 8 words, more than 7/.test(l)), "reason: more than 7 words");
  });

  await kase("an import that removes a word: a pull request only", async (work) => {
    const next = removeAt(clone(WORDS), ...free[1]);
    await seed({ list: next, rev: PUBLISHED + 1, steps: [[PUBLISHED + 1, "import", next]], challenge: dropRefs(CH, [keyOf(WORDS, ...free[1])]) });
    const r = run(work);
    ok(r.next === "pull request", "a pull request (" + r.next + ")");
    ok((r.reasons || []).some((l) => /kind import/.test(l)), "reason: removed by an import");
  });

  await kase("a restore that removes a word: a pull request only", async (work) => {
    const next = removeAt(clone(WORDS), ...free[1]);
    await seed({ list: next, rev: PUBLISHED + 1, steps: [[PUBLISHED + 1, "restore", next]], challenge: dropRefs(CH, [keyOf(WORDS, ...free[1])]) });
    const r = run(work);
    ok(r.next === "pull request", "a pull request (" + r.next + ")");
  });

  await kase("a failing check: nothing written, nothing committed, nothing deployed", async (work) => {
    // deleting a word that a challenge day still uses breaks the challenge integrity check
    const [no, key] = CH.days[0].w[0];
    const si = WORDS.findIndex((s) => build.surahNumber(s.surah) === no);
    const wi = WORDS[si].words.findIndex((w) => build.siteWordKey(w) === key);
    const next = WORDS[si].words.length >= 2 ? removeAt(clone(WORDS), si, wi) : (() => { const l = clone(WORDS); l.splice(si, 1); return l; })();
    await seed({ list: next, rev: PUBLISHED + 1, steps: [[PUBLISHED + 1, "edit", next]] });
    const before = treeFiles(path.join(work, "site"));
    const fb = fs.readFileSync(path.join(work, "firebase.json"), "utf8");
    const r = run(work);
    ok(r.plan && r.plan.mode === "auto", "the plan alone would allow it (" + (r.plan && r.plan.mode) + ")");
    ok(r.next === "fail" && r.step === "build" && /challenge/.test(r.out), "the build fails on the challenge check");
    ok(changed(before, treeFiles(path.join(work, "site"))).length === 0 && fs.readFileSync(path.join(work, "firebase.json"), "utf8") === fb, "nothing written");
  });
} finally {
  await db.terminate();
}
console.log("\n" + (fails.length ? fails.length + " FAILED" : "ALL CHECKS PASSED"));
process.exit(fails.length ? 1 : 0);
