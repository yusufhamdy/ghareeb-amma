"use strict";
/*
 * data/quran/index.js - the official Hafs text (King Fahd Glorious Quran Printing Complex), by surah and ayah.
 *
 * Source: hafsData_v2-0.json from the Complex's developer package UthmanicHafs_v2-0.zip
 * (https://download.qurancomplex.gov.sa/resources_dev/UthmanicHafs_v2-0.zip), committed unmodified; see README.md.
 * Its aya_text is in the KFGQPC Hafs encoding the site stores (U+06E1 sukun, open tanween U+0657 / U+065E / U+0656)
 * and is the text of the KFGQPC Uthmanic Hafs v22 font.
 *
 * Two display-only details of the file are removed when reading, never in the file itself:
 *   - each aya_text ends with a space (U+00A0 or U+0020) and the ayah-number glyph (one code point in the Arabic
 *     presentation forms block); both are stripped;
 *   - the file puts U+00A0 (no-break space) after the hizb mark U+06DE; it becomes an ordinary space, as everywhere
 *     else in the text.
 *
 * ASCII-only, like the other modules that handle Arabic (see test/arabic-guard.test.js).
 */
const path = require("path");

const FILE = path.join(__dirname, "hafsData_v2-0.json");
const SURAHS = 114;
const AYAT = 6236;

let cache = null;

// Strip the trailing ayah-number glyph (and the space before it), and turn no-break spaces into spaces.
function clean(raw) {
  return String(raw)
    .replace(/[  ]*[ﭐ-﷿ﹰ-﻿]$/, "")
    .replace(/ /g, " ")
    .trim();
}

// Surah names are compared without diacritics and with the alef/yeh/teh marbuta forms unified, so "سورة ..."
// names in words.json match the official sura_name_ar.
function normName(s) {
  return String(s == null ? "" : s)
    .replace(/^سورة\s*/, "")
    .replace(/[ـً-ٰٟۖ-ۭ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

function load() {
  if (cache) return cache;
  const rows = JSON.parse(require("fs").readFileSync(FILE, "utf8"));
  const text = [];
  const names = {};
  for (const r of rows) {
    const s = r.sura_no, a = r.aya_no;
    if (!Number.isInteger(s) || !Number.isInteger(a) || s < 1 || s > SURAHS || a < 1) throw new Error("bad row " + JSON.stringify(r.id));
    (text[s] = text[s] || [])[a] = clean(r.aya_text);
    names[normName(r.sura_name_ar)] = s;
  }
  let count = 0;
  for (let s = 1; s <= SURAHS; s++) {
    if (!text[s]) throw new Error("surah " + s + " missing");
    for (let a = 1; a < text[s].length; a++) {
      if (typeof text[s][a] !== "string" || !text[s][a]) throw new Error("ayah " + s + ":" + a + " missing");
      count++;
    }
  }
  if (rows.length !== AYAT || count !== AYAT) throw new Error("expected " + AYAT + " ayat, got " + rows.length + "/" + count);
  cache = { text, names };
  return cache;
}

// The official text of one ayah, or null when (surah, ayah) does not exist.
function ayah(surah, ayahNo) {
  const t = load().text[surah];
  return t && typeof t[ayahNo] === "string" ? t[ayahNo] : null;
}

// Number of ayat in a surah (0 when it does not exist).
function ayahCount(surah) {
  const t = load().text[surah];
  return t ? t.length - 1 : 0;
}

// Surah number from a name as words.json writes it ("سورة <name>" or the bare name), or 0.
function surahNumber(name) {
  return load().names[normName(name)] || 0;
}

module.exports = { ayah, ayahCount, surahNumber, normName, clean, FILE, SURAHS, AYAT };
