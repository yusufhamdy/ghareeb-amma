#!/usr/bin/env node
/*
 * qcf-match.mjs - the match check of the Madinah Mushaf page fonts V2 (public/qcf.js, public/qcf-v2.json).
 *
 * For every ayah on the site (every segment of every word in public/words.json, or the file given with --words), the
 * segment's before + hl + after must equal, letter by letter, a run of whole words of the table's text of its ayah
 * (QCF.segment). Multi-ayah labels ("1-2") are matched segment by segment (each names its ayah); an ayah that crosses
 * pages gives each word its own page. The table's text is the official Hafs text (data/quran/), so the check also
 * confirms that the table still equals it, ayah by ayah.
 *
 * Prints only ids and positions (never text): "surah:ayah word <i>: positions ...". An ayah that does not match is
 * shown in Hafs v22 on the site (and listed by the publish build's summary); it never blocks a publish.
 *
 *   node scripts/qcf-match.mjs [--words <file>] [--strict] [--json]
 *     --strict  exit 1 on any mismatch (CI on pull requests)
 *     --json    print the result as JSON
 *
 * ASCII-ONLY (see test/arabic-guard.test.js).
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const QCF = require("../public/qcf.js");
const Q = require("../data/quran/index.js");

export function matchAll(words, table) {
  const out = { ayat: 0, segments: 0, multiAyah: 0, crossPage: 0, pages: [], mismatches: [], tableDiffers: [] };
  for (const key of Object.keys(table.ayat)) {
    const [s, a] = key.split(":").map(Number);
    if (table.ayat[key].slice(0, -1).map((e) => e[2]).join(" ") !== Q.ayah(s, a)) out.tableDiffers.push(key);
  }
  const pages = new Set();
  (Array.isArray(words) ? words : []).forEach((w, wi) => {
    const surah = Q.surahNumber(w && w.surah);
    (w && Array.isArray(w.ayahs) ? w.ayahs : []).forEach((ay) => {
      out.ayat++;
      if (/\D/.test(String(ay && ay.label == null ? "" : ay.label).trim())) out.multiAyah++;
      const r = QCF.ayah(table, surah, ay);
      out.segments += r.segments.length;
      if (r.pages.length > 1) out.crossPage++;
      r.pages.forEach((p) => pages.add(p));
      r.segments.forEach((p, i) => {
        if (!p.ok) out.mismatches.push({ ayah: surah + ":" + ay.segments[i].num, word: wi, segment: i, why: p.why, positions: p.positions });
      });
    });
  });
  out.pages = [...pages].sort((x, y) => x - y);
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const wf = args.includes("--words") ? args[args.indexOf("--words") + 1] : path.join(ROOT, "public", "words.json");
  const r = matchAll(JSON.parse(fs.readFileSync(wf, "utf8")), JSON.parse(fs.readFileSync(path.join(ROOT, "public", "qcf-v2.json"), "utf8")));
  if (args.includes("--json")) console.log(JSON.stringify(r));
  else {
    console.log("QCF V2 match check: " + r.ayat + " ayat, " + r.segments + " segments (" + r.multiAyah + " multi-ayah labels, " + r.crossPage + " across pages), page fonts " + r.pages.join(" "));
    if (r.tableDiffers.length) console.log("table differs from the official text: " + r.tableDiffers.join(" "));
    if (!r.mismatches.length) console.log("every ayah matches the table exactly");
    for (const m of r.mismatches) console.log("MISMATCH " + m.ayah + " (word " + m.word + ", segment " + m.segment + ", " + m.why + "): positions " + m.positions.join(","));
  }
  if (args.includes("--strict") && (r.mismatches.length || r.tableDiffers.length)) process.exit(1);
}
