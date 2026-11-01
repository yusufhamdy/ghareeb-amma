/*
 * backup-lib.mjs - what the backup scripts share: the bundle (every exported file, with its hash), age encryption, and
 * which old backups to keep. The bundle is one gzipped JSON, so no archive tool is needed on a runner or a laptop, and a
 * file comes back byte for byte. Encrypted output is standard age: the age command line tool can read it too.
 * ASCII-only.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { Encrypter, Decrypter } from "age-encryption";

export const FORMAT = "ghareeb-backup-1";
export const KEEP = { daily: 14, weekly: 8, monthly: 12 };
const NAME = /^backup-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.age$/;
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");

export function backupName(date = new Date()) {
  return "backup-" + date.toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-") + ".age";
}

// every *.json file of an export folder; refuses a folder that is not an export
export function pack(dir) {
  const names = fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort();
  if (!names.includes("index.json")) throw new Error("not an export folder: no index.json");
  const files = {}, hashes = {};
  for (const n of names) { const b = fs.readFileSync(path.join(dir, n)); files[n] = b.toString("utf8"); hashes[n] = sha(b); }
  const index = JSON.parse(files["index.json"]);
  return zlib.gzipSync(Buffer.from(JSON.stringify({ format: FORMAT, project: index.project, at: index.at, sha256: hashes, files })));
}

// the bundle back, each file checked against its hash
export function unpack(gz) {
  const b = JSON.parse(zlib.gunzipSync(gz).toString("utf8"));
  if (b.format !== FORMAT) throw new Error("unknown backup format");
  for (const [n, c] of Object.entries(b.files)) if (sha(Buffer.from(c, "utf8")) !== b.sha256[n]) throw new Error("hash mismatch: " + n);
  if (Object.keys(b.files).length !== Object.keys(b.sha256).length) throw new Error("the bundle's file list and hash list differ");
  return b;
}

export function assertRecipient(r) {
  // a public key only: a private key here would be a mistake to stop, not to use
  if (typeof r !== "string" || !/^age1[0-9a-z]{20,}$/.test(r.trim())) throw new Error("the recipient must be an age public key (age1...)");
  return r.trim();
}

export async function seal(gz, recipient) {
  const e = new Encrypter(); e.addRecipient(assertRecipient(recipient));
  return Buffer.from(await e.encrypt(new Uint8Array(gz)));
}

export async function open(sealed, identity) {
  const d = new Decrypter(); d.addIdentity(identity);
  return Buffer.from(await d.decrypt(new Uint8Array(sealed)));
}

// the private key from a file as age-keygen writes it: comment lines, then the key
export function readIdentity(file) {
  const line = fs.readFileSync(file, "utf8").split(/\r?\n/).map((l) => l.trim()).find((l) => l.startsWith("AGE-SECRET-KEY-"));
  if (!line) throw new Error("no age private key in that file");
  return line;
}

const isoWeek = (d) => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y = t.getUTCFullYear(), w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return y + "-W" + w;
};

/*
 * Which backups to keep: the newest of each of the latest 14 days, 8 ISO weeks and 12 months that have a backup. Counting
 * only periods with a backup means failed runs never age a good backup out. Files with other names are not ours to judge.
 */
export function retention(names) {
  const mine = names.map((n) => { const m = n.match(NAME); return m ? { n, d: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) } : null; }).filter(Boolean).sort((a, b) => b.d - a.d);
  const keep = new Set();
  for (const [count, key] of [[KEEP.daily, (d) => d.toISOString().slice(0, 10)], [KEEP.weekly, isoWeek], [KEEP.monthly, (d) => d.toISOString().slice(0, 7)]]) {
    const seen = new Set();
    for (const x of mine) { const k = key(x.d); if (seen.has(k)) continue; if (seen.size >= count) break; seen.add(k); keep.add(x.n); }
  }
  return { keep: mine.filter((x) => keep.has(x.n)).map((x) => x.n), drop: mine.filter((x) => !keep.has(x.n)).map((x) => x.n) };
}
