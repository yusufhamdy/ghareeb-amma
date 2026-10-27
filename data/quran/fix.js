"use strict";
/*
 * data/quran/fix.js - rebuilds a failing ayah segment from the official text (data/quran/index.js), keeping the
 * segment's word split between before / hl / after. Used for public/words.json and by
 * scripts/fix-ayat-firestore.mjs, so both get exactly the same text.
 *
 * Only segments that fail the rule (public/admin/ayah-check.js) are touched. A failing segment is matched to a run
 * of words in its own ayah (num) by its consonant skeleton (marks, tatweel and alef/hamza seats removed, alef
 * maqsura and teh marbuta unified), with the same number of words; the run's official words are then dealt out to
 * before / hl / after in the segment's own word counts, keeping a space at the end of before and at the start of
 * after where the segment had one. A rebuilt field is stored in NFC; a field that is already canonically equal to
 * the official text keeps its stored bytes, so only the wrong fields change. A segment that
 * cannot be matched to exactly one run is reported, never guessed.
 *
 * ASCII-ONLY (see test/arabic-guard.test.js).
 */
const quran = require("./index.js");
const AyahCheck = require("../../public/admin/ayah-check.js");

const MARKS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u08f0-\u08f2\u0640]/g;
const SEATS = /[\u0621\u0622\u0623\u0625\u0627\u0671]/g;

function skeleton(word) {
  return String(word).normalize("NFD").replace(MARKS, "").replace(SEATS, "").replace(/\u0649/g, "\u064a").replace(/\u0629/g, "\u0647");
}

const words = (s) => String(s).trim().split(/\s+/).filter(Boolean);

// The fixed copy of one segment, or { error } when it cannot be rebuilt.
function fixSegment(g, surah) {
  const ref = quran.ayah(surah, Number(g.num));
  if (!ref) return { error: "no ayah " + surah + ":" + g.num };
  const parts = [words(g.before), words(g.hl), words(g.after)];
  const n = parts[0].length + parts[1].length + parts[2].length;
  const want = parts[0].concat(parts[1], parts[2]).map(skeleton).join(" ");
  const rw = words(ref.normalize("NFC"));
  const hits = [];
  for (let i = 0; i + n <= rw.length; i++) if (rw.slice(i, i + n).map(skeleton).join(" ") === want) hits.push(i);
  if (hits.length !== 1) return { error: (hits.length ? "several" : "no") + " matching runs in " + surah + ":" + g.num };
  const run = rw.slice(hits[0], hits[0] + n);
  const a = parts[0].length, b = a + parts[1].length;
  const before = run.slice(0, a).join(" "), hl = run.slice(a, b).join(" "), after = run.slice(b).join(" ");
  const out = Object.assign({}, g, {
    before: before + (before && /\s$/.test(g.before) ? " " : ""),
    hl: hl,
    after: (after && /^\s/.test(g.after) ? " " : "") + after,
  });
  // a field that is already canonically equal to the official text keeps its stored bytes
  for (const f of ["before", "hl", "after"]) if (AyahCheck.nfc(out[f]) === AyahCheck.nfc(g[f])) out[f] = g[f];
  if (AyahCheck.check([out], surah, quran.ayah).length) return { error: "rebuilt text still fails " + surah + ":" + g.num };
  return { seg: out };
}

/*
 * fixSurahs(surahs) -> { surahs, changes, errors }
 * surahs: the words list (public/data .surahs or words.json); it is not modified, a fixed deep copy is returned.
 * changes: [{ surah, no, word, ayahLabel, si, ai, gi, num, field, from, to }] one per changed field, in order.
 */
function fixSurahs(surahs) {
  const copy = JSON.parse(JSON.stringify(surahs));
  const changes = [], errors = [];
  copy.forEach((e, si) => {
    const no = quran.surahNumber(e.surah);
    if (!no) { errors.push("unknown surah: " + e.surah); return; }
    (e.ayahs || []).forEach((a, ai) => {
      (a.segments || []).forEach((g, gi) => {
        if (!AyahCheck.check([g], no, quran.ayah).length) return;
        const r = fixSegment(g, no);
        if (r.error) { errors.push(r.error); return; }
        for (const f of ["before", "hl", "after"]) {
          if (r.seg[f] !== g[f]) changes.push({ surah: e.surah, no, word: (e.words || [])[ai], ayahLabel: a.label, si, ai, gi, num: g.num, field: f, from: g[f], to: r.seg[f] });
        }
        a.segments[gi] = r.seg;
      });
    });
  });
  return { surahs: copy, changes, errors };
}

module.exports = { fixSurahs, fixSegment, skeleton };
