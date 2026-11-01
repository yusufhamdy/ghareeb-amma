// T-41, end to end in the EMULATOR with fake data and a throwaway key: the real export, seal, upload (to a local bare
// repository) and restore-rehearsal scripts. Every collection comes back, the rules still hold, and the wrong key fails.
// Run by test/backup-rehearsal-emulator.test.js, inside emulators:exec with firestore. Prints counts only. ASCII only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { generateIdentity, identityToRecipient } from "age-encryption";
const require = createRequire(import.meta.url);
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOST = process.env.FIRESTORE_EMULATOR_HOST;
if (!/^(127\.0\.0\.1|localhost):/.test(HOST || "")) { console.error("emulators only"); process.exit(1); }
const PROJECT = "demo-ghareeb"; process.env.GCLOUD_PROJECT = PROJECT;
const admin = require("firebase-admin"); admin.initializeApp({ projectId: PROJECT }); const db = admin.firestore(), { Timestamp } = admin.firestore;
let fail = 0, passed = 0; const check = (id, ok, x) => { console.log((ok ? "PASS  " : "FAIL  ") + id + (!ok && x !== undefined ? "  " + JSON.stringify(x) : "")); if (ok) passed++; else fail++; };
const clear = async () => { for (const c of await db.listCollections()) await db.recursiveDelete(c); };
const run = (args, env) => spawnSync(process.execPath, args, { cwd: REPO, encoding: "utf8", env: { ...process.env, ...env } });
const sortK = (v) => v && typeof v.toMillis === "function" ? { ts: v.toMillis(), n: v.nanoseconds } : Array.isArray(v) ? v.map(sortK) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortK(v[k])])) : v;
const dump = async () => { const o = {}; for (const c of await db.listCollections()) for (const d of (await c.get()).docs) o[c.id + "/" + d.id] = JSON.stringify(sortK(d.data())); return o; };

const word = (n) => ({ surah: "fake " + n, no: 78 + n, words: ["w" + n, "x" + n], meanings: ["CANARY m" + n, "m"], ayahs: [{ label: "1", segments: [{ num: 1, before: "b", hl: "h", after: "a" }] }, { label: "2", segments: [] }], source: "s" });
const words = [word(0), word(1)], at = new Timestamp(1793000000, 123000000);
const DATA = {
  "public/data": { rev: 8, surahs: words, updatedAt: at, by: "u" }, "public/prev": { rev: 7, surahs: [word(0)], savedAt: at },
  "public/challenge": { startDate: null, releasedUpTo: null, days: [{ d: 1, w: [{ no: 78, word: "w0" }] }] }, "admin/challengeNotes": { 1: "CANARY note" }, "config/admins": { emails: ["fake@example.test"] },
  "snapshots/7": { rev: 7, surahs: [word(0)] }, "snapshots/8": { rev: 8, surahs: words },
  "history/7": { rev: 7, kind: "baseline", summary: "s", by: "u", byEmail: "fake@example.test", at }, "history/8": { rev: 8, kind: "edit", summary: "s", by: "u", byEmail: "fake@example.test", at },
};
const d = fs.mkdtempSync(path.join(os.tmpdir(), "ghareeb-backup-e2e-")), exp = path.join(d, "export"), sealedDir = path.join(d, "sealed"), bare = path.join(d, "bare.git"), keyFile = path.join(d, "test.key"), wrongFile = path.join(d, "wrong.key");
const identity = await generateIdentity(), recipient = await identityToRecipient(identity);
fs.writeFileSync(keyFile, "# throwaway test key\n" + identity + "\n"); fs.writeFileSync(wrongFile, (await generateIdentity()) + "\n");

for (const [k, v] of Object.entries(DATA)) await db.doc(k).set(v);
const original = await dump();
check("the fake data has every kind of document", Object.keys(original).length === Object.keys(DATA).length, Object.keys(original).length);

console.log("== export, seal, upload ==");
const e = run(["scripts/firestore-export.mjs", "--emulator", "--quiet", "--project", PROJECT, "--out", exp]);
check("the export ran", e.status === 0, (e.stderr || "").slice(-200));
check("the quiet export prints no field names or content", !/CANARY|emails|meanings|surahs|\bby\b/.test(e.stdout + e.stderr));
const index = JSON.parse(fs.readFileSync(path.join(exp, "index.json"), "utf8"));
check("the export has all five documents and both collections", Object.values(index.docs).every((x) => x.exists) && Object.keys(index.collections.snapshots).length === 2 && Object.keys(index.collections.history).length === 2);
const s = run(["scripts/backup.mjs", "seal", "--from", exp, "--out", sealedDir], { BACKUP_AGE_RECIPIENT: recipient });
check("sealed, and the plaintext deleted", s.status === 0 && !fs.existsSync(exp), (s.stderr || "").slice(-200));
const file = path.join(sealedDir, fs.readdirSync(sealedDir)[0]);
check("no plaintext in the sealed file", !fs.readFileSync(file).includes("CANARY") && !fs.readFileSync(file).includes("fake@example"));
execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
const u = run(["scripts/backup.mjs", "upload", "--file", file, "--remote", bare]);
check("uploaded to the repository", u.status === 0, (u.stderr || "").slice(-200));
const fetched = path.join(d, "fetched"); execFileSync("git", ["clone", "-q", bare, fetched]);
const back = path.join(fetched, "backups", path.basename(file));
check("the repository holds the same bytes", fs.readFileSync(back).equals(fs.readFileSync(file)));

console.log("\n== a wrong key, then the rehearsal into an empty emulator ==");
await clear();
check("the emulator is empty", Object.keys(await dump()).length === 0);
const w = run(["scripts/backup-restore-rehearsal.mjs", "--file", back, "--identity", wrongFile]);
check("the wrong key is refused, and nothing is loaded", w.status === 1 && Object.keys(await dump()).length === 0, w.status);
const r = run(["scripts/backup-restore-rehearsal.mjs", "--file", back, "--identity", keyFile]);
check("the rehearsal passes", r.status === 0 && r.stdout.includes("REHEARSAL PASSED"), { status: r.status, tail: (r.stdout + r.stderr).slice(-160) });
check("it reports the counts", /rev 8, 2 surahs, 4 words, 1 challenge days, 2 snapshots, 2 history rows, 9 documents/.test(r.stdout), r.stdout.slice(0, 300));
check("it prints no content and no key", !/CANARY|fake@example/.test(r.stdout + r.stderr) && !(r.stdout + r.stderr).includes(identity));
const restored = await dump();
check("all collections restored, every document identical, timestamps included", JSON.stringify(Object.entries(restored).sort()) === JSON.stringify(Object.entries(original).sort()));
const denied = await Promise.all(["public/data", "public/prev", "public/challenge", "admin/challengeNotes", "config/admins", "snapshots/8", "history/8"].map(async (p) => (await fetch(`http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents/${p}`)).status));
check("rules still enforced: a signed-out reader is refused everything restored", denied.every((x) => x === 403), denied);
const t = fs.readFileSync(back); t[t.length - 3] ^= 1; const bad = path.join(d, "bad.age"); fs.writeFileSync(bad, t);
const b = run(["scripts/backup-restore-rehearsal.mjs", "--file", bad, "--identity", keyFile]);
check("a damaged backup is refused", b.status === 1, b.status);
fs.rmSync(d, { recursive: true, force: true });
console.log("\n" + passed + " passed, " + fail + " failed"); console.log(fail ? fail + " CHECKS FAILED" : "ALL CHECKS PASSED"); process.exit(fail ? 1 : 0);
