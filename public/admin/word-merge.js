/*
 * word-merge.js - three-way merge of one word, per field, for the admin's word editor.
 *
 *   base   = the word as it was when the editor opened
 *   mine   = the word in the form now
 *   theirs = the latest word, read inside the save's transaction
 *
 * For each field: mine == base takes theirs; theirs == base takes mine; both changed to the same value takes that
 * value; both changed differently is a real conflict, which only a choice made for exactly this "theirs" resolves.
 * Pure: no DOM, no Firestore, and it never changes its arguments.
 *
 * ASCII-ONLY (see test/arabic-guard.test.js).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.WordMerge = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var FIELDS = ["surah", "word", "meaning", "label", "segments"];

  // exact comparison, byte for byte: stored Quran text is never normalized
  function same(a, b) {
    return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b);
  }

  /*
   * resolved: { field: { theirs: <the "theirs" value the choice was made against>, value: <the chosen value> } }.
   * A choice no longer applies when "theirs" has changed again: the field is then a conflict once more.
   * Returns { merged, conflicts: [{ field, mine, theirs }] }; when there are conflicts, merged has only the other fields.
   */
  function merge(base, mine, theirs, resolved) {
    var merged = {}, conflicts = [], res = resolved || {};
    FIELDS.forEach(function (f) {
      if (same(mine[f], base[f])) merged[f] = theirs[f];
      else if (same(theirs[f], base[f])) merged[f] = mine[f];
      else if (same(mine[f], theirs[f])) merged[f] = theirs[f];
      else if (res[f] && same(res[f].theirs, theirs[f])) merged[f] = res[f].value;
      else conflicts.push({ field: f, mine: mine[f], theirs: theirs[f] });
    });
    return { merged: merged, conflicts: conflicts };
  }

  /*
   * Where the word is now, in the latest surahs: { si, wi }, or null when it can no longer be identified.
   *   1. the same text in its surah;
   *   2. moved: the same text in one other surah, with its meaning or its ayah unchanged;
   *   3. renamed (perhaps moved too): the one entry whose meaning or ayah is still the word's.
   * nameOf(surah) gives a surah's name in the form base.surah uses.
   */
  function locate(surahs, base, nameOf) {
    var si, wi, e, found = [];
    var kept = function (e, j) {
      var a = (e.ayahs || [])[j] || {};
      return same((e.meanings || [])[j], base.meaning) || (base.segments != null && same(a.segments, base.segments));
    };
    for (si = 0; si < surahs.length; si++) {
      e = surahs[si];
      if (nameOf(e) === base.surah) {
        wi = (e.words || []).indexOf(base.word);
        if (wi >= 0) return { si: si, wi: wi };
      }
    }
    for (si = 0; si < surahs.length; si++) {
      e = surahs[si];
      wi = (e.words || []).indexOf(base.word);
      if (wi >= 0 && kept(e, wi)) found.push({ si: si, wi: wi });
    }
    if (found.length === 1) return found[0];
    if (found.length > 1) return null;
    for (si = 0; si < surahs.length; si++) {
      e = surahs[si];
      for (wi = 0; wi < (e.words || []).length; wi++) if (kept(e, wi)) found.push({ si: si, wi: wi });
    }
    return found.length === 1 ? found[0] : null;
  }

  return { FIELDS: FIELDS, same: same, merge: merge, locate: locate };
});
