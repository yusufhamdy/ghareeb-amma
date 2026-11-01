#!/usr/bin/env node
/*
 * backup.mjs - the two steps after scripts/firestore-export.mjs. Used by .github/workflows/backup.yml.
 *
 *   node scripts/backup.mjs seal --from DIR --out DIR     encrypts the export to BACKUP_AGE_RECIPIENT (a public key), writes
 *                                                         backup-<time>.age, then deletes the plaintext export
 *   node scripts/backup.mjs upload --file FILE --remote URL    commits it to the private backup repository, drops what
 *                                                         retention no longer keeps, and pushes
 *
 * Holds no private key and needs none. Logs print sizes and counts, never content: this repository's Actions logs are public.
 * The backup repository keeps a single commit, amended on each run, so a backup that retention drops is really gone.
 * ASCII-only.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pack, seal, backupName, retention } from "./backup-lib.mjs";

const argv = process.argv.slice(2), cmd = argv[0], opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const need = (k) => { const v = opt(k); if (!v) { console.error("missing " + k); process.exit(2); } return v; };

if (cmd === "seal") {
  const from = need("--from"), out = need("--out");
  const gz = pack(from), sealed = await seal(gz, process.env.BACKUP_AGE_RECIPIENT);
  if (!sealed.subarray(0, 21).toString("latin1").startsWith("age-encryption.org/v1")) throw new Error("the output is not an age file");
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, backupName());
  fs.writeFileSync(file, sealed);
  fs.rmSync(from, { recursive: true, force: true });
  console.log("sealed " + path.basename(file) + " (" + sealed.length + " bytes); plaintext deleted");
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, "file=" + file + "\n");
} else if (cmd === "upload") {
  const file = need("--file"), remote = need("--remote"), work = fs.mkdtempSync(path.join(os.tmpdir(), "ghareeb-backup-"));
  const git = (...a) => execFileSync("git", a, { cwd: work, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    execFileSync("git", ["clone", "--quiet", "--depth", "1", remote, work], { stdio: ["ignore", "ignore", "pipe"] });
    git("config", "user.name", "ghareeb-backup"); git("config", "user.email", "backup@invalid.example");
    let first = false; try { git("rev-parse", "--verify", "HEAD"); } catch (_) { first = true; }
    if (first) git("checkout", "-q", "-b", "main");
    const dest = path.join(work, "backups"); fs.mkdirSync(dest, { recursive: true });
    fs.copyFileSync(file, path.join(dest, path.basename(file)));
    const r = retention(fs.readdirSync(dest));
    for (const n of r.drop) fs.rmSync(path.join(dest, n));
    git("add", "-A");
    if (first) git("commit", "-q", "-m", "backups"); else git("commit", "-q", "--amend", "-m", "backups");
    git("push", "-q", "--force-with-lease", "origin", "HEAD:main");
    console.log("uploaded " + path.basename(file) + "; kept " + r.keep.length + ", dropped " + r.drop.length);
  } finally { fs.rmSync(work, { recursive: true, force: true }); }
} else { console.error("usage: backup.mjs seal|upload ..."); process.exit(2); }
