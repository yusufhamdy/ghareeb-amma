#!/usr/bin/env node
/*
 * ayat-bytes.mjs - rewrites public/words.json so every ayah segment is the official text byte for byte (2026-10-28).
 *
 *   node scripts/ayat-bytes.mjs           write words.json and test/fixtures/ayat-bytes-2026-10-28.json
 *   node scripts/ayat-bytes.mjs --check   print what would change, write nothing
 *
 * The site had stored its ayah text in Unicode NFC: alef + maddah composed into U+0622 (KFGQPC has no glyph for it,
 * so Safari drew it from the fallback face and broke the lam-alef join) and marks in NFC order instead of the
 * official order. data/quran/fix.js rebuilds each such segment from the official bytes, keeping its split between
 * before / hl / after; every change must be canonically equivalent (the same text, other bytes) or the script stops.
 * Only segment before / hl / after change; meanings, source, words, labels and nums stay byte-identical. The fixture
 * keeps every old value, so test/quran-text.test.js can put them back and get the previous file byte for byte.
 *
 * ASCII-only.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { fixSurahs } = require("../data/quran/fix.js");
const FILE = path.join(ROOT, "public", "words.json");
const FIXTURE = path.join(ROOT, "test", "fixtures", "ayat-bytes-2026-10-28.json");

const raw = fs.readFileSync(FILE, "utf8");
const r = fixSurahs(JSON.parse(raw));
const cp = (s) => [...s].map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0"));
if (r.errors.length) { console.error("ayat-bytes: cannot rebuild: " + r.errors.join("; ")); process.exit(1); }
const text = r.changes.filter((c) => !c.encoding);
if (text.length) { console.error("ayat-bytes: changes that are not encoding-only: " + text.map((c) => c.no + ":" + c.num + " " + c.field).join(", ")); process.exit(1); }
const composed = {};
for (const c of r.changes) for (const ch of new Set(cp(c.from))) if (!cp(c.to).includes(ch)) composed[ch] = (composed[ch] || 0) + 1;
const segs = new Set(r.changes.map((c) => c.si + "/" + c.ai + "/" + c.gi));
console.log("segments changed: " + segs.size + ", fields changed: " + r.changes.length + " (all canonically equivalent)");
console.log("code points in the old fields that the official bytes do not have (fields): " + JSON.stringify(composed));
if (process.argv.includes("--check")) process.exit(0);

const out = JSON.stringify(r.surahs, null, 2);
fs.writeFileSync(FILE, out);
fs.writeFileSync(FIXTURE, JSON.stringify({
  note: "2026-10-28: ayah segments rewritten to the official bytes (no Unicode normalization). Each entry is a changed field and its previous (NFC) value; putting them back gives the previous words.json byte for byte (beforeSha256).",
  beforeSha256: crypto.createHash("sha256").update(raw).digest("hex"),
  afterSha256: crypto.createHash("sha256").update(out).digest("hex"),
  fields: r.changes.map((c) => ({ si: c.si, ai: c.ai, gi: c.gi, surah: c.no, num: c.num, field: c.field, from: c.from })),
}, null, 1) + "\n");
console.log("wrote " + path.relative(ROOT, FILE) + " and " + path.relative(ROOT, FIXTURE));
