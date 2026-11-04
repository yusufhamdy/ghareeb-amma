"use strict";
/*
 * backup.test.js - T-40, the backup with fake data and a throwaway key: export folder -> seal -> decrypt is byte-identical,
 * the plaintext is gone, another key cannot read it, retention keeps what it should, and the upload step works against a
 * local repository. Also the workflow's safety properties. T-41 is test/backup-rehearsal-emulator.test.js. ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const lib = () => import(pathToFileURL(path.join(ROOT, "scripts", "backup-lib.mjs")).href);
const age = () => import("age-encryption");
const CLI = path.join(ROOT, "scripts", "backup.mjs");
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ghareeb-backup-test-"));
const FAKE = { "index.json": JSON.stringify({ project: "demo", at: "2026-11-01T00:00:00.000Z", docs: {} }), "public-data.json": JSON.stringify({ rev: 7, surahs: [{ surah: "fake", words: ["w"], meanings: ["CANARY-MEANING"], ayahs: [{ label: "1", segments: [] }] }] }, null, 1), "admin-challengeNotes.json": JSON.stringify({ 1: "CANARY-NOTE" }) };
const fakeExport = (dir) => { fs.mkdirSync(dir, { recursive: true }); for (const [n, c] of Object.entries(FAKE)) fs.writeFileSync(path.join(dir, n), c); return dir; };
const keys = async () => { const { generateIdentity, identityToRecipient } = await age(); const identity = await generateIdentity(); return { identity, recipient: await identityToRecipient(identity) }; };

test("T-40: export, encrypt, decrypt, compare: byte-identical, and the plaintext is gone", async () => {
  const L = await lib(), k = await keys(), d = tmp(), from = fakeExport(path.join(d, "export")), out = path.join(d, "sealed");
  const r = spawnSync(process.execPath, [CLI, "seal", "--from", from, "--out", out], { encoding: "utf8", env: { ...process.env, BACKUP_AGE_RECIPIENT: k.recipient } });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(!fs.existsSync(from), "the plaintext export was deleted");
  const [name] = fs.readdirSync(out); assert.match(name, /^backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.age$/);
  const sealed = fs.readFileSync(path.join(out, name));
  assert.ok(!sealed.includes("CANARY"), "no plaintext in the file");
  assert.ok(sealed.subarray(0, 21).toString().startsWith("age-encryption.org/v1"));
  assert.ok(!(r.stdout + r.stderr).includes("CANARY"), "no content in the log");
  const b = L.unpack(await L.open(sealed, k.identity));
  assert.deepStrictEqual(Object.keys(b.files).sort(), Object.keys(FAKE).sort());
  for (const n of Object.keys(FAKE)) assert.ok(Buffer.from(b.files[n], "utf8").equals(Buffer.from(FAKE[n], "utf8")), n + " byte for byte");
  fs.rmSync(d, { recursive: true, force: true });
});

test("T-40: another key cannot read it, and a changed file is refused", async () => {
  const L = await lib(), k = await keys(), other = await keys(), d = tmp(), gz = L.pack(fakeExport(path.join(d, "e"))), sealed = await L.seal(gz, k.recipient);
  await assert.rejects(L.open(sealed, other.identity));
  const flipped = Buffer.from(sealed); flipped[flipped.length - 5] ^= 1; await assert.rejects(L.open(flipped, k.identity), "a changed file does not decrypt");
  const zlib = require("zlib"), o = JSON.parse(zlib.gunzipSync(gz).toString()); o.files["public-data.json"] += " "; assert.throws(() => L.unpack(zlib.gzipSync(Buffer.from(JSON.stringify(o)))), /hash mismatch/);
  fs.rmSync(d, { recursive: true, force: true });
});

test("the recipient must be a public key: a private key is refused, with nothing written", async () => {
  const L = await lib(), k = await keys(), d = tmp(), from = fakeExport(path.join(d, "export")), out = path.join(d, "sealed");
  assert.throws(() => L.assertRecipient(k.identity), /public key/); assert.throws(() => L.assertRecipient(""), /public key/); assert.throws(() => L.assertRecipient(undefined), /public key/);
  const r = spawnSync(process.execPath, [CLI, "seal", "--from", from, "--out", out], { encoding: "utf8", env: { ...process.env, BACKUP_AGE_RECIPIENT: k.identity } });
  assert.notStrictEqual(r.status, 0); assert.ok(!fs.existsSync(out)); assert.ok(fs.existsSync(from), "the export is kept for another try");
  assert.ok(!(r.stdout + r.stderr).includes(k.identity), "the key is not echoed");
  fs.rmSync(d, { recursive: true, force: true });
});

test("the identity is read from a file as age-keygen writes it", async () => {
  const L = await lib(), k = await keys(), d = tmp(), f = path.join(d, "key");
  fs.writeFileSync(f, "# created: 2026-11-01\n# public key: " + k.recipient + "\n" + k.identity + "\n"); assert.strictEqual(L.readIdentity(f), k.identity);
  fs.writeFileSync(f, "nothing here\n"); assert.throws(() => L.readIdentity(f), /no age private key/);
  fs.rmSync(d, { recursive: true, force: true });
});

test("retention: 14 daily, 8 weekly, 12 monthly", async () => {
  const L = await lib(), names = [], day = 86400000, end = Date.UTC(2026, 10, 1, 3, 17);
  for (let i = 0; i < 800; i++) { const t = new Date(end - i * day); names.push(L.backupName(t)); if (i < 3) names.push(L.backupName(new Date(t.getTime() + 3600000))); }
  const { keep, drop } = L.retention(names.concat(["README.md", "notes.txt"]));
  assert.strictEqual(keep.length + drop.length, names.length, "files with other names are left alone");
  const dates = keep.map((n) => n.slice(7, 17)), uniq = new Set(dates);
  assert.strictEqual(uniq.size, dates.length, "one backup a day");
  const newest14 = [...Array(14)].map((_, i) => new Date(end - i * day).toISOString().slice(0, 10)); for (const d of newest14) assert.ok(uniq.has(d), "daily " + d);
  assert.ok(keep[0].includes("T04-17-00Z"), "the newest backup of a day is the one kept");
  assert.ok(keep.length >= 14 && keep.length <= 14 + 8 + 12, "at most 34: " + keep.length);
  assert.strictEqual(new Set(dates.map((d) => d.slice(0, 7))).size, 12, "12 months reach back");
  const oldest = new Date(dates[dates.length - 1]); assert.ok((end - oldest) / day > 300 && (end - oldest) / day < 370, "the oldest is about a year old");
  assert.deepStrictEqual(L.retention(keep).drop, [], "running it again drops nothing");
  const gap = [L.backupName(new Date(end)), L.backupName(new Date(end - 300 * day))]; assert.deepStrictEqual(L.retention(gap).drop, [], "failed runs never age a good backup out");
});

test("upload: to a local bare repository, again with retention, and the dropped file is really gone", async (t) => {
  const git = spawnSync("git", ["--version"]); if (git.error) { t.skip("no git"); return; }
  const L = await lib(), d = tmp(), bare = path.join(d, "bare.git"); execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  const up = (name) => { const f = path.join(d, name); fs.writeFileSync(f, "sealed " + name); const r = spawnSync(process.execPath, [CLI, "upload", "--file", f, "--remote", bare], { encoding: "utf8" }); assert.strictEqual(r.status, 0, r.stderr); };
  const list = () => execFileSync("git", ["--git-dir", bare, "ls-tree", "--name-only", "main", "backups/"], { encoding: "utf8" }).trim().split("\n").filter(Boolean).map((x) => x.replace("backups/", ""));
  const day = 86400000, end = Date.UTC(2026, 10, 1, 3, 17), oldName = L.backupName(new Date(end - 15 * day));
  up(oldName); assert.deepStrictEqual(list(), [oldName], "the first upload, into an empty repository");
  const seen = []; for (let i = 14; i >= 0; i--) { const n = L.backupName(new Date(end - i * day)); up(n); seen.push(n); }
  const after = list(); assert.ok(after.includes(seen[seen.length - 1])); assert.strictEqual(execFileSync("git", ["--git-dir", bare, "rev-list", "--count", "main"], { encoding: "utf8" }).trim(), "1", "one commit, so a dropped backup leaves no copy in history");
  const objs = execFileSync("git", ["--git-dir", bare, "ls-tree", "-r", "main"], { encoding: "utf8" }); assert.ok(objs.split("\n").filter(Boolean).length === after.length);
  fs.rmSync(d, { recursive: true, force: true });
});

test("the workflow: scheduled and manual, main only, inert until enabled, nothing leaves unencrypted", () => {
  const y = fs.readFileSync(path.join(ROOT, ".github", "workflows", "backup.yml"), "utf8");
  assert.match(y, /schedule:\s*\n\s*- cron:/); assert.match(y, /workflow_dispatch:/);
  assert.ok(!/pull_request/.test(y), "never on a pull request");
  assert.match(y, /if: vars\.BACKUP_ENABLED == 'true' && github\.ref == 'refs\/heads\/main'/);
  assert.match(y, /permissions:\s*\n\s*contents: read\s*\n\s*id-token: write/);
  assert.ok(!/upload-artifact|cache@|gh release|AGE-SECRET-KEY|credentials_json/.test(y), "no artifact, no cache, no release, no private key, no long-lived Google key");
  const steps = ["Export (read-only)", "Encrypt to the public key", "Upload to the private repository"].map((s) => y.indexOf(s)); assert.ok(steps[0] > 0 && steps[0] < steps[1] && steps[1] < steps[2], "export, then encrypt, then upload");
  assert.match(y, /--quiet/, "the export prints no field names into public logs");
  assert.match(y, /StrictHostKeyChecking=yes/); assert.match(y, /github\.com ssh-ed25519 AAAA/);
  for (const m of y.matchAll(/uses: ([^\s]+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, "actions are pinned: " + m[1]);
  assert.ok(!/run:[^\n]*\$\{\{/.test(y), "no expression is pasted into a shell line");
});

test("the rehearsal refuses without a local emulator", () => {
  const f = path.join(ROOT, "scripts", "backup-restore-rehearsal.mjs");
  for (const host of [undefined, "firestore.googleapis.com:443"]) { const env = { ...process.env }; delete env.FIRESTORE_EMULATOR_HOST; if (host) env.FIRESTORE_EMULATOR_HOST = host; const r = spawnSync(process.execPath, [f, "--file", "x", "--identity", "y"], { encoding: "utf8", env }); assert.strictEqual(r.status, 1); assert.match(r.stderr, /refusing/); }
});

test("the export refuses the emulator unless told, and production when told", () => {
  const f = path.join(ROOT, "scripts", "firestore-export.mjs");
  const r = spawnSync(process.execPath, [f, "--out", path.join(os.tmpdir(), "no")], { encoding: "utf8", env: { ...process.env, FIRESTORE_EMULATOR_HOST: "127.0.0.1:1" } }); assert.strictEqual(r.status, 1); assert.match(r.stderr, /refusing/);
  const e = { ...process.env }; delete e.FIRESTORE_EMULATOR_HOST; const r2 = spawnSync(process.execPath, [f, "--emulator", "--out", path.join(os.tmpdir(), "no")], { encoding: "utf8", env: e }); assert.strictEqual(r2.status, 1); assert.match(r2.stderr, /emulator/);
});
