/*
 * qtext.js - how Quran text is shown, shared by the app, the admin preview, the static-page generator
 * (scripts/publish-build.mjs) and the tests. Display only: the stored data is never changed.
 *
 *   displayWord(ayah)  the headword as the mushaf writes it: the highlighted text (hl) of the word's ayah segments,
 *                      NFC, joined with one space; when a segment's `before` ends with the article ٱل (with or
 *                      without its sukun) written onto hl with no space, that ٱل is part of the written word and is
 *                      put back in front. Other one-letter particles written onto hl (وَ فَ بِ كَ لِ) are not.
 *                      The stored headword (modern spelling) stays the key for search, the challenge, URLs and
 *                      page titles.
 *   markParts(seg)     the highlight widened to whole written words: the letters of `before` written onto hl and
 *                      the letters of `after` written onto it move into the mark, so a word is never split by the
 *                      mark (an inline-block breaks letter joining). Returns { pre, mark, post }, which concatenate
 *                      to before + hl + after.
 *   searchNorm(s)      the search key: diacritics and Quranic marks removed (ٰ and ٱ read as alef), letter forms
 *                      unified, so the modern and the Uthmani spelling of a word can both be typed.
 *
 * ASCII-ONLY (see test/arabic-guard.test.js).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.QText = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var AL = /ٱلۡ?$/; // alef wasla + lam, optional small high dotless head of khah (the mushaf's sukun)

  function nfc(s) { return String(s == null ? "" : s).normalize("NFC"); }

  function displayWord(ayah) {
    var segs = ayah && Array.isArray(ayah.segments) ? ayah.segments : [];
    return segs.map(function (g) {
      var hl = nfc(g && g.hl).replace(/^\s+|\s+$/g, ""), b = nfc(g && g.before), m = b.match(AL);
      return (m && hl ? m[0] : "") + hl;
    }).filter(Boolean).join(" ");
  }

  function markParts(g) {
    var b = String(g && g.before || ""), h = String(g && g.hl || ""), a = String(g && g.after || "");
    var mb = h && !/^\s/.test(h) ? b.match(/\S+$/) : null, ma = h && !/\s$/.test(h) ? a.match(/^\S+/) : null;
    return {
      pre: mb ? b.slice(0, b.length - mb[0].length) : b,
      mark: (mb ? mb[0] : "") + h + (ma ? ma[0] : ""),
      post: ma ? a.slice(ma[0].length) : a,
    };
  }

  function searchNorm(s) {
    return String(s == null ? "" : s)
      .replace(/[ٰٱ]/g, "ا")
      .replace(/[ـً-ٟۖ-ࣰۭ-ࣲ]/g, "")
      .replace(/[أإآ]/g, "ا")
      .replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
      .replace(/\s+/g, " ").trim();
  }

  return { displayWord: displayWord, markParts: markParts, searchNorm: searchNorm };
});
