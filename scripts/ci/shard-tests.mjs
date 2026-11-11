#!/usr/bin/env node
/*
 * shard-tests.mjs - runs `npm test` (node --test) split across CI jobs, and proves every test file ran exactly once.
 *
 *   node scripts/ci/shard-tests.mjs list                      every test file `npm test` runs, one per line
 *   node scripts/ci/shard-tests.mjs plan --of 4               which shard runs which file, with the expected seconds
 *   node scripts/ci/shard-tests.mjs run --shard 2 --of 4 [--jobs 2] [--report FILE]
 *        runs that shard's files, --jobs at a time (each file in its own `node --test` process, as `npm test` does
 *        with --test-concurrency), and writes a JSON report: the commit, and per file its seconds, exit code and the
 *        test counts from the TAP summary. Exits non-zero if any file fails, is cancelled or exits non-zero.
 *   node scripts/ci/shard-tests.mjs merge --of 4 --dir DIR [--durations-out FILE]
 *        reads the shard reports in DIR and fails unless every shard reported, from the same commit as this checkout,
 *        and every test file of `list` ran exactly once and passed. Prints the totals, and writes the measured seconds
 *        per file (the next balance) to --durations-out.
 *
 * The file list is the set `node --test` finds with no arguments (Node 20's default patterns, node_modules excluded),
 * taken from the tracked files, so a new test file is picked up without editing anything here. The balance uses the
 * seconds recorded in scripts/ci/shard-durations.json (from a CI run: the merge step writes them); a file without a
 * recorded time gets an estimate from its name. Shards are filled longest-first, each file going to the shard with
 * the least total so far (deterministic: ties go to the lower shard number).
 *
 * Prints file names, seconds and counts only. ASCII only.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DURATIONS = path.join(REPO, "scripts/ci/shard-durations.json");
const TIMEOUT_MS = 600000; // as in package.json's "test" script

// Node 20's default test patterns (`node --test` with no arguments), node_modules excluded
const PATTERNS = [/(^|\/)[^/]*\.test\.[cm]?js$/, /(^|\/)[^/]*-test\.[cm]?js$/, /(^|\/)[^/]*_test\.[cm]?js$/, /(^|\/)test-[^/]*\.[cm]?js$/, /(^|\/)test\.[cm]?js$/, /(^|\/)test\/(.*\/)?[^/]*\.[cm]?js$/];
export function listTests() {
  const files = execFileSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" }).split("\0").filter(Boolean);
  return files.filter((f) => !/(^|\/)node_modules\//.test(f) && PATTERNS.some((p) => p.test(f))).sort();
}

function estimate(f) {
  if (/emulator/.test(f)) return 120;
  const src = fs.readFileSync(path.join(REPO, f), "utf8");
  return /playwright|chromium/.test(src) ? 30 : 3;
}
function weights(files) {
  let rec = {};
  try { rec = JSON.parse(fs.readFileSync(DURATIONS, "utf8")); } catch {}
  return new Map(files.map((f) => [f, typeof rec[f] === "number" ? rec[f] : estimate(f)]));
}
export function plan(files, of, w = weights(files)) {
  const shards = Array.from({ length: of }, (_, i) => ({ shard: i + 1, files: [], seconds: 0 }));
  for (const f of [...files].sort((a, b) => w.get(b) - w.get(a) || (a < b ? -1 : 1))) {
    const s = shards.reduce((m, x) => (x.seconds < m.seconds ? x : m));
    s.files.push(f); s.seconds += w.get(f);
  }
  shards.forEach((s) => s.files.sort());
  return shards;
}

const arg = (name, dflt) => { const i = process.argv.indexOf("--" + name); return i > 0 ? process.argv[i + 1] : dflt; };
const intArg = (name, dflt) => { const v = Number(arg(name, dflt)); if (!Number.isInteger(v) || v < 1) { console.error("--" + name + " must be a positive integer"); process.exit(2); } return v; };
const head = () => execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
const COUNTS = ["tests", "suites", "pass", "fail", "cancelled", "skipped", "todo"];

function runFile(f) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const p = spawn(process.execPath, ["--test", "--test-reporter=tap", "--test-timeout=" + TIMEOUT_MS, f], { cwd: REPO, env: process.env });
    let out = "";
    p.stdout.on("data", (d) => (out += d)); p.stderr.on("data", (d) => (out += d));
    p.on("close", (code, signal) => {
      const counts = {};
      for (const k of COUNTS) { const m = [...out.matchAll(new RegExp("^# " + k + " (\\d+)\\s*$", "gm"))].pop(); counts[k] = m ? Number(m[1]) : null; }
      const ok = code === 0 && counts.tests !== null && counts.fail === 0 && counts.cancelled === 0;
      resolve({ file: f, seconds: Math.round((Date.now() - t0) / 100) / 10, exit: code === null ? signal : code, ok, ...counts, out });
    });
  });
}

async function run() {
  const of = intArg("of"), shard = intArg("shard"), jobs = intArg("jobs", "2");
  if (shard > of) { console.error("--shard is above --of"); process.exit(2); }
  const mine = plan(listTests(), of).find((s) => s.shard === shard);
  console.log("shard " + shard + " of " + of + ": " + mine.files.length + " files, about " + Math.round(mine.seconds) + "s recorded, " + jobs + " at a time");
  const queue = [...mine.files].sort((a, b) => weights(mine.files).get(b) - weights(mine.files).get(a)), results = [];
  const gh = !!process.env.GITHUB_ACTIONS;
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (queue.length) {
      const r = await runFile(queue.shift());
      // the whole output of one file at a time, so parallel files never interleave in the log
      console.log((gh ? "::group::" : "=== ") + (r.ok ? "ok   " : "FAIL ") + r.file + " (" + r.seconds + "s, tests " + r.tests + ", pass " + r.pass + ", fail " + r.fail + ", skipped " + r.skipped + ")");
      process.stdout.write(r.out.endsWith("\n") ? r.out : r.out + "\n");
      if (gh) console.log("::endgroup::");
      if (!r.ok && gh) console.log("::error file=" + r.file + "::" + r.file + " failed (exit " + r.exit + ", fail " + r.fail + ", cancelled " + r.cancelled + ")");
      delete r.out; results.push(r);
    }
  }));
  results.sort((a, b) => (a.file < b.file ? -1 : 1));
  const report = { shard, of, commit: head(), files: results };
  const file = arg("report");
  if (file) fs.writeFileSync(file, JSON.stringify(report, null, 1));
  const sum = (k) => results.reduce((n, r) => n + (r[k] || 0), 0);
  console.log("\nshard " + shard + ": " + results.length + " files; tests " + sum("tests") + ", pass " + sum("pass") + ", fail " + sum("fail") + ", cancelled " + sum("cancelled") + ", skipped " + sum("skipped"));
  const bad = results.filter((r) => !r.ok);
  if (bad.length) { console.log("FAILED: " + bad.map((r) => r.file).join(", ")); process.exit(1); }
}

function merge() {
  const of = intArg("of"), dir = arg("dir");
  const problems = [], want = listTests(), seen = new Map(), commit = head();
  const reports = [];
  for (let i = 1; i <= of; i++) {
    const f = path.join(dir, "shard-" + i + ".json");
    if (!fs.existsSync(f)) { problems.push("shard " + i + " sent no report"); continue; }
    const r = JSON.parse(fs.readFileSync(f, "utf8"));
    if (r.shard !== i || r.of !== of) problems.push("shard " + i + "'s report is for shard " + r.shard + " of " + r.of);
    if (r.commit !== commit) problems.push("shard " + i + " tested " + r.commit + ", not " + commit);
    reports.push(r);
    for (const x of r.files) {
      if (seen.has(x.file)) problems.push(x.file + " ran twice (shards " + seen.get(x.file).shard + " and " + i + ")");
      seen.set(x.file, Object.assign({ shard: i }, x));
      if (!x.ok) problems.push(x.file + " failed in shard " + i);
    }
  }
  for (const f of want) if (!seen.has(f)) problems.push(f + " ran in no shard");
  for (const f of seen.keys()) if (!want.includes(f)) problems.push(f + " is not a test file of npm test");
  const all = [...seen.values()], sum = (k) => all.reduce((n, r) => n + (r[k] || 0), 0);
  console.log("files: " + all.length + " of " + want.length + " test files, each in one shard");
  for (const r of reports) console.log("  shard " + r.shard + ": " + r.files.length + " files, " + Math.round(r.files.reduce((n, x) => n + x.seconds, 0)) + "s of test time");
  console.log("tests " + sum("tests") + ", pass " + sum("pass") + ", fail " + sum("fail") + ", cancelled " + sum("cancelled") + ", skipped " + sum("skipped") + ", todo " + sum("todo"));
  const out = arg("durations-out");
  if (out) fs.writeFileSync(out, JSON.stringify(Object.fromEntries(all.sort((a, b) => (a.file < b.file ? -1 : 1)).map((r) => [r.file, r.seconds])), null, 1) + "\n");
  if (problems.length) { console.log("\nPROBLEMS:\n" + problems.join("\n")); process.exit(1); }
  console.log("every test file ran exactly once and passed");
}

const cmd = process.argv[2];
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (cmd === "list") console.log(listTests().join("\n"));
  else if (cmd === "plan") for (const s of plan(listTests(), intArg("of"))) console.log("shard " + s.shard + " (" + Math.round(s.seconds) + "s): " + s.files.join(" "));
  else if (cmd === "run") await run();
  else if (cmd === "merge") merge();
  else { console.error("usage: shard-tests.mjs list | plan --of N | run --shard I --of N [--jobs J] [--report FILE] | merge --of N --dir DIR [--durations-out FILE]"); process.exit(2); }
}
