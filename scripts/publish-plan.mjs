#!/usr/bin/env node
/*
 * publish-plan.mjs - what the scheduled Publish does with the admin's data (owner decision: admin saves and deletes go
 * live automatically, within limits; see docs/PROJECT-HANDBOOK.md section 4.2 and runbook 10.4).
 *
 * Two commands, both read-only:
 *
 *   check   The cheap first step. Reads only the rev of public/data (field mask) and public/challenge through the
 *           Firestore REST API, and compares them with the published site: public/rev.json and public/challenge.json
 *           on main. Same rev and the same public challenge: nothing to do. It needs no npm packages (no npm ci).
 *           Credentials: ACCESS_TOKEN (an OAuth access token), or the emulator (FIRESTORE_EMULATOR_HOST).
 *
 *   plan    After the sign-in, before the build. Reads public/data and public/challenge once and saves them for the build
 *           (--data-out, --challenge-out), so the build publishes exactly what was planned. Then decides:
 *             auto  no word is removed; or at most MAX_AUTO_REMOVALS words are removed and each one was removed by an
 *                   admin save (a history row of kind "edit", in practice a delete or an edit that changed the word's
 *                   page) recorded after the published rev. Removed surahs follow the same rule.
 *             pr    anything else that removes words: more than MAX_AUTO_REMOVALS, removed by an import or a restore,
 *                   or not provable from the history (a missing row or snapshot, a write the admin did not record).
 *           The build's own removal guard (publish-build.mjs) still applies on top: the count must match exactly and
 *           never exceed 10% of the published words.
 *
 * Outputs go to GITHUB_OUTPUT when it is set, and to stdout. They name revs, counts, slugs, surah numbers and reason
 * codes, never document content. ASCII only.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = await import(pathToFileURL(path.join(ROOT, "scripts", "publish-build.mjs")).href);

export const MAX_AUTO_REMOVALS = 7;
export const MAX_REVISIONS = 300; // more saves than this since the last publish: not checked one by one, a PR instead

// --- the published site ------------------------------------------------------------------------------------------
export function published(site) {
  const read = (f) => fs.readFileSync(path.join(site, f), "utf8");
  let rev = null;
  try { const r = JSON.parse(read("rev.json")).rev; rev = Number.isInteger(r) ? r : null; } catch (e) { rev = null; }
  return { rev, challenge: read("challenge.json") };
}
// The challenge file the build would write for this Firestore document (the same function, the same format).
export const challengeFile = (doc) => JSON.stringify(build.publicChallenge(doc || {}), null, 1);
export const shortHash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 16);

// Same Firestore rev and the same public challenge as the published site: nothing to publish.
export function compare(site, fsRev, challengeDoc) {
  const pub = published(site);
  let file = null, invalid = false;
  try { file = challengeFile(challengeDoc); } catch (e) { invalid = true; } // an invalid challenge: let the build say why
  const revChanged = !(Number.isInteger(fsRev) && fsRev === pub.rev);
  const challengeChanged = invalid || file !== pub.challenge;
  return { same: !revChanged && !challengeChanged, revChanged, challengeChanged, rev: fsRev, publishedRev: pub.rev, challengeHash: shortHash(file == null ? "invalid" : file) };
}

// --- Firestore REST (the check needs no npm packages) ---------------------------------------------------------------
export function fromRest(v) {
  if (v == null) return null;
  if ("nullValue" in v) return null;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("stringValue" in v) return v.stringValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("referenceValue" in v) return v.referenceValue;
  if ("bytesValue" in v) return v.bytesValue;
  if ("geoPointValue" in v) return v.geoPointValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromRest);
  if ("mapValue" in v) return fieldsOf(v.mapValue);
  throw new Error("unknown Firestore value type: " + Object.keys(v).join(","));
}
const fieldsOf = (m) => Object.fromEntries(Object.entries((m && m.fields) || {}).map(([k, x]) => [k, fromRest(x)]));

async function restDoc(project, docPath, mask) {
  const emu = process.env.FIRESTORE_EMULATOR_HOST;
  const base = emu ? "http://" + emu + "/v1" : "https://firestore.googleapis.com/v1";
  const token = process.env.ACCESS_TOKEN || (emu ? "owner" : "");
  if (!token) throw new Error("no ACCESS_TOKEN (and no emulator)");
  const url = base + "/projects/" + project + "/databases/(default)/documents/" + docPath + (mask ? "?" + mask.map((f) => "mask.fieldPaths=" + encodeURIComponent(f)).join("&") : "");
  const res = await fetch(url, { headers: { authorization: "Bearer " + token } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("reading " + docPath + " failed: HTTP " + res.status);
  return fieldsOf(await res.json());
}

// --- which removals may go live without a PR -----------------------------------------------------------------------
const slugsOf = (surahs) => new Set(build.wordIndex(build.normaliseSurahs(surahs)).keys());

/*
 * decide({ committed, current, publishedRev, currentRev, rows, snaps })
 *   committed     the published words.json (surahs, committed shape)
 *   current       public/data's surahs now (Firestore shape)
 *   rows, snaps   history/{rev} rows and snapshots/{rev} surahs, as Maps from rev to value, for revs after publishedRev
 * Returns { mode: "auto" | "pr", removed: [slug], removedSurahs: [no], reasons: [code] }.
 */
export function decide({ committed, current, publishedRev, currentRev, rows, snaps }) {
  const reasons = [];
  const before = build.wordIndex(committed);
  let afterIdx;
  try { afterIdx = build.wordIndex(build.normaliseSurahs(current)); } catch (e) { return { mode: "pr", removed: [], removedSurahs: [], reasons: ["shape: " + e.message.split("\n")[0]] }; }
  const removed = [...before.keys()].filter((s) => !afterIdx.has(s)).sort();
  const nosAfter = new Set([...afterIdx.values()].map((w) => w.no));
  const removedSurahs = [...new Set([...before.values()].map((w) => w.no))].filter((n) => !nosAfter.has(n)).sort((a, b) => a - b);
  const out = (mode) => ({ mode, removed, removedSurahs, reasons });
  if (!removed.length) return out("auto");
  if (removed.length > MAX_AUTO_REMOVALS) reasons.push("removes " + removed.length + " words, more than " + MAX_AUTO_REMOVALS);
  if (!Number.isInteger(publishedRev)) reasons.push("the published rev is unknown");
  else if (!Number.isInteger(currentRev) || currentRev <= publishedRev) reasons.push("the data rev " + currentRev + " is not after the published rev " + publishedRev);
  else if (currentRev - publishedRev > MAX_REVISIONS) reasons.push((currentRev - publishedRev) + " saves since the last publish, more than " + MAX_REVISIONS);
  if (reasons.length) return out("pr");

  // walk every save after the published rev; for each word, remember which kind of save removed it last
  let prev = new Set(before.keys());
  const lastGone = new Map();
  for (let r = publishedRev + 1; r <= currentRev; r++) {
    const row = rows.get(r), snap = snaps.get(r);
    if (!row || !snap) { reasons.push("rev " + r + " has no " + (!row ? "history row" : "snapshot")); return out("pr"); }
    let keys;
    try { keys = slugsOf(snap); } catch (e) { reasons.push("rev " + r + ": snapshot shape"); return out("pr"); }
    for (const s of prev) if (!keys.has(s)) lastGone.set(s, row.kind);
    for (const s of keys) if (!prev.has(s)) lastGone.delete(s);
    prev = keys;
  }
  const latest = snaps.get(currentRev);
  if (JSON.stringify(build.normaliseSurahs(latest)) !== JSON.stringify(build.normaliseSurahs(current))) { reasons.push("the snapshot of rev " + currentRev + " differs from the data"); return out("pr"); }
  const notEdit = removed.filter((s) => lastGone.get(s) !== "edit");
  if (notEdit.length) {
    const kinds = {};
    for (const s of notEdit) { const k = lastGone.get(s) || "unknown"; kinds[k] = (kinds[k] || 0) + 1; }
    for (const [k, n] of Object.entries(kinds)) reasons.push(n + " removed by " + (k === "unknown" ? "a write with no history" : "a save of kind " + k));
    return out("pr");
  }
  return out("auto");
}

// --- the two commands -----------------------------------------------------------------------------------------------
function setOutputs(o) {
  const lines = Object.entries(o).map(([k, v]) => k + "=" + (Array.isArray(v) ? v.join(",") : String(v)));
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  for (const l of lines) console.log("  " + l);
}
function args(argv) {
  const a = { project: null, site: path.join(ROOT, "public") };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === "--project") a.project = argv[++i];
    else if (k === "--site") a.site = path.resolve(argv[++i]);
    else if (k === "--data-out") a.dataOut = path.resolve(argv[++i]);
    else if (k === "--challenge-out") a.challengeOut = path.resolve(argv[++i]);
    else throw new Error("unknown argument " + k);
  }
  if (!a.project) throw new Error("--project is required");
  return a;
}

async function check(a) {
  const data = await restDoc(a.project, "public/data", ["rev"]);
  const ch = await restDoc(a.project, "public/challenge");
  const rev = data && Number.isInteger(data.rev) ? data.rev : null;
  const c = compare(a.site, rev, ch || {});
  console.log("publish-plan: " + (c.same ? "same" : "changed") + " (data rev " + rev + ", published rev " + c.publishedRev + (c.challengeChanged ? ", the challenge differs" : "") + ")");
  setOutputs({ changed: !c.same, rev: rev == null ? "none" : rev, challenge_hash: c.challengeHash });
}

async function plan(a) {
  if (!a.dataOut || !a.challengeOut) throw new Error("--data-out and --challenge-out are required");
  const { Firestore } = require("firebase-admin").firestore;
  const db = new Firestore({ projectId: a.project });
  try {
    const [d, c] = await Promise.all(["public/data", "public/challenge"].map((p) => db.doc(p).get()));
    const data = d.exists ? d.data() : {};
    const current = Array.isArray(data.surahs) ? data.surahs : [];
    const currentRev = Number.isInteger(data.rev) ? data.rev : null;
    fs.writeFileSync(a.dataOut, JSON.stringify({ rev: currentRev, surahs: current }));
    fs.writeFileSync(a.challengeOut, JSON.stringify(c.exists ? c.data() : {}));
    const committed = JSON.parse(fs.readFileSync(path.join(a.site, "words.json"), "utf8"));
    const publishedRev = published(a.site).rev;
    const rows = new Map(), snaps = new Map();
    const span = Number.isInteger(publishedRev) && Number.isInteger(currentRev) ? currentRev - publishedRev : 0;
    const removing = (() => { try { const after = slugsOf(current); return [...build.wordIndex(committed).keys()].some((s) => !after.has(s)); } catch (e) { return true; } })();
    if (removing && span > 0 && span <= MAX_REVISIONS) {
      const revs = Array.from({ length: span }, (_, i) => publishedRev + 1 + i);
      const [hs, ss] = await Promise.all(["history", "snapshots"].map((col) => db.getAll(...revs.map((r) => db.doc(col + "/" + r)))));
      hs.forEach((s, i) => { if (s.exists) rows.set(revs[i], s.data()); });
      ss.forEach((s, i) => { if (s.exists && Array.isArray(s.data().surahs)) snaps.set(revs[i], s.data().surahs); });
    }
    const r = decide({ committed, current, publishedRev, currentRev, rows, snaps });
    console.log("publish-plan: " + r.mode + " (data rev " + currentRev + ", published rev " + publishedRev + ", " + r.removed.length + " words removed" + (r.removedSurahs.length ? ", surahs " + r.removedSurahs.join(",") : "") + ")");
    for (const x of r.reasons) console.log("  reason: " + x);
    setOutputs({ mode: r.mode, rev: currentRev == null ? "none" : currentRev, allow_removals: r.removed.length, removed_surahs: r.removedSurahs, removed: r.removed });
  } finally {
    await db.terminate();
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const [cmd, ...rest] = process.argv.slice(2);
  const run = cmd === "check" ? check : cmd === "plan" ? plan : null;
  if (!run) { console.error("usage: publish-plan.mjs check|plan --project ID [--site DIR] [--data-out F --challenge-out F]"); process.exit(2); }
  run(args(rest)).catch((e) => { console.error("publish-plan: " + e.message); process.exit(1); });
}
