/*
 * ayah-check.js - the ayah text rule, shared by the admin (blocks a save) and the tests (words.json and the static
 * pages): each segment's before + hl + after must be one contiguous piece of its official ayah, byte for byte, and the
 * segment's num must be that ayah's number. There is no Unicode normalization: the site stores the official bytes
 * (a precomposed letter or a different mark order is a difference, because Safari draws them differently).
 *
 * The reference text comes from data/quran/ (the Complex's official Hafs text). The admin loads its copy,
 * /admin/quran-hafs.json (built by scripts/build-quran-ref.mjs), lazily on the first save; the public site never
 * loads it.
 *
 * ASCII-ONLY (see test/arabic-guard.test.js).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.AyahCheck = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  // The text a segment shows, as compared: before + hl + after, outer spaces removed.
  function segmentText(g) {
    return String((g && g.before || "") + (g && g.hl || "") + (g && g.after || "")).replace(/^\s+|\s+$/g, "");
  }

  /**
   * Checks the segments of one word against the official text.
   * segments: [{ num, before, hl, after }]; surah: the surah's number; ayahOf(surah, num) returns the official
   * ayah text or null.
   * Returns [] when every segment passes, else one problem per failing segment:
   * { i (segment index), num, why: "num" (no such ayah) | "text" (not a contiguous byte-exact piece of ayah num) }.
   */
  function check(segments, surah, ayahOf) {
    var out = [];
    (Array.isArray(segments) ? segments : []).forEach(function (g, i) {
      var num = Number(g && g.num);
      var ref = Number.isInteger(num) && num > 0 ? ayahOf(surah, num) : null;
      if (typeof ref !== "string") { out.push({ i: i, num: g && g.num, why: "num" }); return; }
      var t = segmentText(g);
      if (!t || ref.indexOf(t) < 0) out.push({ i: i, num: num, why: "text" });
    });
    return out;
  }

  // ayahOf for the admin's reference file: data[surah - 1][ayah - 1] (an array of 114 arrays of ayah texts).
  function fromTable(data) {
    return function (surah, num) {
      var s = Array.isArray(data) ? data[surah - 1] : null;
      return Array.isArray(s) && typeof s[num - 1] === "string" ? s[num - 1] : null;
    };
  }

  return { check: check, segmentText: segmentText, fromTable: fromTable };
});
