#!/usr/bin/env node
/*
 * build-quran-ref.mjs - writes public/admin/quran-hafs.json, the admin's copy of the official Hafs text: an array of
 * 114 arrays (surah 1..114), each holding that surah's ayat (1..n) exactly as data/quran/index.js returns them. The
 * admin fetches it lazily on the first word save to check the ayah text (public/admin/ayah-check.js); the public
 * site never loads it. test/quran-text.test.js fails when the file is not what this script would write.
 *
 *   node scripts/build-quran-ref.mjs
 *
 * ASCII-only.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const quran = require("../data/quran/index.js");
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const OUT = path.join(ROOT, "public", "admin", "quran-hafs.json");

export function buildRef() {
  const out = [];
  for (let s = 1; s <= quran.SURAHS; s++) {
    const ayat = [];
    for (let a = 1; a <= quran.ayahCount(s); a++) ayat.push(quran.ayah(s, a));
    out.push(ayat);
  }
  return JSON.stringify(out) + "\n";
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  fs.writeFileSync(OUT, buildRef(), "utf8");
  console.log("build-quran-ref: wrote " + path.relative(ROOT, OUT));
}
