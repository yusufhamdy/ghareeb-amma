"use strict";
/*
 * data/quran/fix.js - rebuilds an ayah segment from the official text (data/quran/index.js) byte for byte, keeping the
 * segment's split between before / hl / after. Used for public/words.json and by scripts/fix-ayat-firestore.mjs, so
 * both get exactly the same bytes.
 *
 * Only segments that fail the rule (public/admin/ayah-check.js: a byte-exact piece of the official ayah) are touched.
 *   1. Same text, other encoding: when the segment is canonically equivalent to a piece of its ayah (it was stored
 *      in NFC: alef + maddah composed into U+0622, marks in NFC order), that piece is found in the NFC form of the
 *      ayah, cluster by cluster (a base letter with its marks), and each field becomes the official bytes of its own
 *      part. Field boundaries stay where they were, also inside a word (an attached article stays in before).
 *   2. Wrong text (a missing or different mark): the segment is matched to a run of words in its own ayah (num) by
 *      its consonant skeleton (marks, tatweel and alef/hamza seats removed, alef maqsura and teh marbuta unified),
 *      with the same number of words; the run's official words are dealt out to before / hl / after in the segment's
 *      own word counts, keeping the official separator at the end of before and at the start of after where the
 *      segment had one.
 * A segment that cannot be matched to exactly one place is reported, never guessed.
 *
 * ASCII-ONLY (see test/arabic-guard.test.js).
 */
const quran = require("./index.js");
const AyahCheck = require("../../public/admin/ayah-check.js");

const MARKS = /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u08f0-\u08f2\u0640]/g;
const SEATS = /[\u0621\u0622\u0623\u0625\u0627\u0671]/g;
const nfc = (s) => String(s == null ? "" : s).normalize("NFC");

function skeleton(word) {
  return String(word).normalize("NFD").replace(MARKS, "").replace(SEATS, "").replace(/\u0649/g, "\u064a").replace(/\u0629/g, "\u0647");
}

const words = (s) => String(s).trim().split(/\s+/).filter(Boolean);

// The ayah as clusters (a code point that is not a combining mark, with the marks after it): the NFC text and, for
// every cluster boundary, its offset in the NFC text -> its offset in the official text.
function clusters(ref) {
  const parts = ref.match(/[^\p{M}][\p{M}]*|[\p{M}]+/gu) || [];
  const map = new Map([[0, 0]]);
  let n = 0, r = 0;
  for (const p of parts) { n += nfc(p).length; r += p.length; map.set(n, r); }
  return { text: parts.map(nfc).join(""), map };
}

// 1. canonically equivalent: the official bytes of the same piece, field by field
function byEncoding(g, ref) {
  const f = [nfc(g.before), nfc(g.hl), nfc(g.after)], full = f.join("");
  if (!full.trim() || full !== nfc((g.before || "") + (g.hl || "") + (g.after || ""))) return null;
  const c = clusters(ref);
  if (c.text !== nfc(ref)) return null;
  const hits = [];
  for (let i = c.text.indexOf(full); i >= 0; i = c.text.indexOf(full, i + 1)) {
    const b = [i, i + f[0].length, i + f[0].length + f[1].length, i + full.length];
    if (b.every((x) => c.map.has(x))) hits.push(b.map((x) => c.map.get(x)));
  }
  if (hits.length !== 1) return hits.length ? { error: "several matching pieces" } : null;
  const [s, x, y, e] = hits[0];
  return { before: ref.slice(s, x), hl: ref.slice(x, y), after: ref.slice(y, e) };
}

// 2. wrong text: by the words' consonant skeleton
function bySkeleton(g, ref, where) {
  const parts = [words(g.before), words(g.hl), words(g.after)];
  const n = parts[0].length + parts[1].length + parts[2].length;
  const want = parts[0].concat(parts[1], parts[2]).map(skeleton).join(" ");
  const toks = [...ref.matchAll(/\S+/g)].map((m) => ({ w: m[0], s: m.index, e: m.index + m[0].length }));
  const hits = [];
  for (let i = 0; i + n <= toks.length; i++) if (toks.slice(i, i + n).map((t) => skeleton(t.w)).join(" ") === want) hits.push(i);
  if (hits.length !== 1) return { error: (hits.length ? "several" : "no") + " matching runs in " + where };
  const i = hits[0], a = i + parts[0].length, b = a + parts[1].length, end = i + n;
  const piece = (x, y) => (x < y ? ref.slice(toks[x].s, toks[y - 1].e) : "");
  const sepAfter = (k) => (k + 1 < toks.length ? ref.slice(toks[k].e, toks[k + 1].s) : "");
  return {
    before: piece(i, a) + (a > i && /\s$/.test(g.before) ? sepAfter(a - 1) : ""),
    hl: piece(a, b),
    after: (end > b && /^\s/.test(g.after) ? sepAfter(b - 1) : "") + piece(b, end),
  };
}

// The fixed copy of one segment, or { error } when it cannot be rebuilt.
function fixSegment(g, surah) {
  const ref = quran.ayah(surah, Number(g.num));
  const where = surah + ":" + g.num;
  if (!ref) return { error: "no ayah " + where };
  let r = byEncoding(g, ref);
  if (r && r.error) return { error: r.error + " in " + where };
  if (!r) r = bySkeleton(g, ref, where);
  if (r.error) return r;
  const out = Object.assign({}, g, r);
  if (AyahCheck.check([out], surah, quran.ayah).length) return { error: "rebuilt text still fails " + where };
  return { seg: out };
}

/*
 * fixSurahs(surahs) -> { surahs, changes, errors }
 * surahs: the words list (public/data .surahs or words.json); it is not modified, a fixed deep copy is returned.
 * changes: [{ surah, no, word, ayahLabel, si, ai, gi, num, field, from, to, encoding }] one per changed field, in
 * order; encoding is true when from and to are canonically equivalent (the same text, other bytes).
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
          if (r.seg[f] !== g[f]) changes.push({ surah: e.surah, no, word: (e.words || [])[ai], ayahLabel: a.label, si, ai, gi, num: g.num, field: f, from: g[f], to: r.seg[f], encoding: nfc(g[f]) === nfc(r.seg[f]) });
        }
        a.segments[gi] = r.seg;
      });
    });
  });
  return { surahs: copy, changes, errors };
}

module.exports = { fixSurahs, fixSegment, skeleton };
