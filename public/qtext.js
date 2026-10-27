/*
 * qtext.js - how Quran text is shown, shared by the app, the admin preview, the static-page generator
 * (scripts/publish-build.mjs) and the tests. Display only: the stored data is never changed.
 *
 *   displayWord(ayah)  the headword as the mushaf writes it: the highlighted text (hl) of the word's ayah segments,
 *                      NFC, joined with one space; when a segment's `before` ends with the article \u0671\u0644 (with or
 *                      without its sukun) written onto hl with no space, that \u0671\u0644 is part of the written word and is
 *                      put back in front. Other one-letter particles written onto hl (\u0648\u064e \u0641\u064e \u0628\u0650 \u0643\u064e \u0644\u0650) are not.
 *                      The stored headword (modern spelling) stays the key for search, the challenge, URLs and
 *                      page titles.
 *   markParts(seg)     the highlight widened to whole written words: the letters of `before` written onto hl and
 *                      the letters of `after` written onto it move into the mark, so a word is never split by the
 *                      mark (an inline-block breaks letter joining). Returns { pre, mark, post }, which concatenate
 *                      to before + hl + after.
 *   ayahHtml(ayah,esc) the ayah's segments as HTML, each in ornate parentheses kept on the line of their first
 *                      and last word (no parenthesis alone at a line end or start).
 *   searchNorm(s)      the search key: diacritics and Quranic marks removed (\u0670 and \u0671 read as alef), letter forms
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

  var AL = /\u0671\u0644\u06e1?$/; // alef wasla + lam, optional small high dotless head of khah (the mushaf's sukun)

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

  // One ayah as HTML: each segment in ornate parentheses with its mark (markParts). The opening parenthesis is kept on
  // the line of the segment's first word (or of the mark, when the segment starts with it) and the closing one on the
  // line of its last word or mark, inside a white-space: nowrap span (class "nb"), so a parenthesis never ends or
  // starts a line on its own. esc escapes text for HTML.
  function ayahHtml(ayah, esc) {
    var OL = "\ufd3f", OR = "\ufd3e", nb = function (h) { return '<span class="nb">' + h + "</span>"; };
    var segs = ayah && Array.isArray(ayah.segments) ? ayah.segments : [];
    return segs.map(function (g) {
      var k = markParts(g), first = k.pre.match(/^\S+/), last = k.post.match(/\S+$/);
      var mark = k.mark ? "<mark>" + esc(k.mark) + "</mark>" : "";
      var head = first ? nb(OL + esc(first[0])) + esc(k.pre.slice(first[0].length)) : "";
      var tail = last ? esc(k.post.slice(0, k.post.length - last[0].length)) + nb(esc(last[0]) + OR) : "";
      var mid = (first ? "" : OL + esc(k.pre)) + mark + (last ? "" : esc(k.post) + OR);
      return head + (first && last ? mid : nb(mid)) + tail;
    }).join(" ");
  }

  function searchNorm(s) {
    return String(s == null ? "" : s)
      .replace(/[\u0670\u0671]/g, "\u0627")
      .replace(/[\u0640\u064b-\u065f\u06d6-\u06ed\u08f0-\u08f2]/g, "")
      .replace(/[\u0623\u0625\u0622]/g, "\u0627")
      .replace(/\u0649/g, "\u064a").replace(/\u0629/g, "\u0647").replace(/\u0624/g, "\u0648").replace(/\u0626/g, "\u064a")
      .replace(/\s+/g, " ").trim();
  }

  return { displayWord: displayWord, markParts: markParts, ayahHtml: ayahHtml, searchNorm: searchNorm };
});
