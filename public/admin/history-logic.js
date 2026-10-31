/*
 * history-logic.js - the version history's pure logic: what changed between two versions of the words, the one-line
 * summary of a save, and the Arabic time labels. No DOM, no Firestore, and it never changes its arguments.
 *
 * A word's identity and its fields are the merge's (word-merge.js): the same text in its surah; then, moved or renamed,
 * WordMerge.locate. Stored Quran text is compared byte for byte and never normalized.
 *
 * ASCII-ONLY (see test/arabic-guard.test.js): Arabic UI strings are \u escapes.
 */
(function (root, factory) {
  var WM = typeof module !== "undefined" && module.exports ? require("./word-merge.js") : root.WordMerge;
  var api = factory(WM);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.HistoryLogic = api;
})(typeof window !== "undefined" ? window : null, function (WM) {
  "use strict";

  var MAX_SUMMARY = 300, MAX_ITEMS = 2, DAY_MS = 86400000;
  var FIELDS = WM.FIELDS, same = WM.same;
  var nameOfDefault = function (e) { return String(e && e.surah || "").replace(/^\u0633\u0648\u0631\u0629\s*/, ""); };
  var list = function (x) { return Array.isArray(x) ? x : []; };

  function entry(e, wi, name) {
    var a = list(e.ayahs)[wi] || {};
    return { surah: name, word: list(e.words)[wi], meaning: list(e.meanings)[wi], label: a.label, segments: a.segments };
  }

  /*
   * diff(old, next, nameOf) -> { surahs: [...], words: [...] }
   *   words: { type: "add" | "edit" | "del", surah, word, label, fields: [{ field, before, after }] }, in the order of the
   *          version they are read from (added and edited: next; deleted: old).
   *   surahs: what the words cannot show: a surah's name, number or source changed, or an empty surah added or deleted.
   *           { type: "add" | "edit" | "del", name, fields: [{ field: "name" | "no" | "source", before, after }] }
   */
  function diff(oldS, newS, nameOf) {
    var nm = nameOf || nameOfDefault, olds = list(oldS), news = list(newS), surahs = [], words = [];
    var oldNames = olds.map(nm), newNames = news.map(nm);
    // a renamed surah: its old name is gone, its new name is new, and its number is the same
    var back = {};
    news.forEach(function (e, i) {
      if (oldNames.indexOf(newNames[i]) >= 0) return;
      var j = -1;
      olds.forEach(function (o, k) { if (j < 0 && newNames.indexOf(oldNames[k]) < 0 && o.no != null && o.no === e.no) j = k; });
      if (j >= 0) back[newNames[i]] = oldNames[j];
    });
    var asOld = function (e) { var n = nm(e); return Object.prototype.hasOwnProperty.call(back, n) ? back[n] : n; };

    var claimed = {}, pair = [], left = [];
    olds.forEach(function (e, si) {
      list(e.words).forEach(function (w, wi) {
        var hit = null;
        news.forEach(function (t, ti) {
          if (hit || asOld(t) !== oldNames[si]) return;
          list(t.words).forEach(function (tw, tj) { if (!hit && tw === w && !claimed[ti + "." + tj]) hit = { si: ti, wi: tj }; });
        });
        if (hit) { claimed[hit.si + "." + hit.wi] = 1; pair.push({ si: si, wi: wi, to: hit }); } else left.push({ si: si, wi: wi });
      });
    });
    var dels = [];
    left.forEach(function (o) {
      var base = entry(olds[o.si], o.wi, oldNames[o.si]), to = WM.locate(news, base, asOld);
      if (to && !claimed[to.si + "." + to.wi]) { claimed[to.si + "." + to.wi] = 1; pair.push({ si: o.si, wi: o.wi, to: to }); } else dels.push(o);
    });
    var paired = {};
    pair.forEach(function (p) { paired[p.to.si + "." + p.to.wi] = p; });
    news.forEach(function (t, ti) {
      list(t.words).forEach(function (w, tj) {
        var after = entry(t, tj, newNames[ti]), p = paired[ti + "." + tj];
        if (!p) { words.push({ type: "add", surah: newNames[ti], word: w, label: after.label, fields: ["meaning", "segments"].map(function (f) { return { field: f, after: after[f] }; }) }); return; }
        var before = entry(olds[p.si], p.wi, oldNames[p.si]), fields = [];
        FIELDS.forEach(function (f) {
          if (f === "surah" && asOld(t) === oldNames[p.si]) return; // the surah was renamed: reported once, on the surah
          if (!same(before[f], after[f])) fields.push({ field: f, before: before[f], after: after[f] });
        });
        if (fields.length) words.push({ type: "edit", surah: newNames[ti], word: w, label: after.label, fields: fields });
      });
    });
    dels.forEach(function (o) {
      var before = entry(olds[o.si], o.wi, oldNames[o.si]);
      words.push({ type: "del", surah: oldNames[o.si], word: before.word, label: before.label, fields: ["meaning", "segments"].map(function (f) { return { field: f, before: before[f] }; }) });
    });

    news.forEach(function (t, ti) {
      var was = oldNames.indexOf(asOld(t));
      if (was < 0) { if (!list(t.words).length) surahs.push({ type: "add", name: newNames[ti], fields: [] }); return; }
      var o = olds[was], fields = [];
      if (oldNames[was] !== newNames[ti]) fields.push({ field: "name", before: oldNames[was], after: newNames[ti] });
      if (!same(o.no, t.no)) fields.push({ field: "no", before: o.no, after: t.no });
      if (!same(o.source, t.source)) fields.push({ field: "source", before: o.source, after: t.source });
      if (fields.length) surahs.push({ type: "edit", name: newNames[ti], fields: fields });
    });
    olds.forEach(function (o, k) {
      var gone = !news.some(function (t) { return asOld(t) === oldNames[k]; });
      if (gone && !list(o.words).length) surahs.push({ type: "del", name: oldNames[k], fields: [] });
    });
    return { surahs: surahs, words: words };
  }

  var ONE_FIELD = { meaning: "\u062a\u0639\u062f\u064a\u0644 \u0645\u0639\u0646\u0649", label: "\u062a\u0639\u062f\u064a\u0644 \u0631\u0642\u0645 \u0622\u064a\u0629", segments: "\u062a\u0639\u062f\u064a\u0644 \u0646\u0635 \u0622\u064a\u0629", word: "\u062a\u0639\u062f\u064a\u0644 \u0646\u0635", surah: "\u0646\u0642\u0644" };
  function wordItem(w) {
    var q = "\u00ab" + w.word + "\u00bb";
    if (w.type === "add") return "\u0625\u0636\u0627\u0641\u0629 " + q;
    if (w.type === "del") return "\u062d\u0630\u0641 " + q;
    return (w.fields.length === 1 ? ONE_FIELD[w.fields[0].field] : "\u062a\u0639\u062f\u064a\u0644") + " " + q;
  }
  function surahItem(s) {
    return (s.type === "add" ? "\u0625\u0636\u0627\u0641\u0629 \u0633\u0648\u0631\u0629 " : s.type === "del" ? "\u062d\u0630\u0641 \u0633\u0648\u0631\u0629 " : "\u062a\u0639\u062f\u064a\u0644 \u0633\u0648\u0631\u0629 ") + "\u00ab" + s.name + "\u00bb";
  }
  // the app's number agreement for "and N other changes"
  function others(n) {
    if (n === 1) return "\u0648\u062a\u0639\u062f\u064a\u0644 \u0622\u062e\u0631";
    if (n === 2) return "\u0648\u062a\u0639\u062f\u064a\u0644\u0627\u0646 \u0622\u062e\u0631\u0627\u0646";
    if (n <= 10) return "\u0648 " + n + " \u062a\u0639\u062f\u064a\u0644\u0627\u062a \u0623\u062e\u0631\u0649";
    return "\u0648 " + n + " \u062a\u0639\u062f\u064a\u0644\u064b\u0627 \u0622\u062e\u0631";
  }
  function changesCount(n) {
    if (n === 1) return "\u062a\u0639\u062f\u064a\u0644 \u0648\u0627\u062d\u062f";
    if (n === 2) return "\u062a\u0639\u062f\u064a\u0644\u0627\u0646";
    if (n <= 10) return n + " \u062a\u0639\u062f\u064a\u0644\u0627\u062a";
    return n + " \u062a\u0639\u062f\u064a\u0644\u064b\u0627";
  }
  var SEP = " \u00b7 ";

  /*
   * summary(kind, old, next, opts) -> the history row's text, at most 300 characters. opts: { nameOf, restoredFrom }.
   * A word in it is always between the marks, so the page can show it in the Quran face. Never cuts a word in two: when
   * the text would not fit, it names fewer words.
   */
  function summary(kind, oldS, newS, opts) {
    var o = opts || {};
    if (kind === "baseline") return "\u0627\u0644\u0646\u0633\u062e\u0629 \u0627\u0644\u0623\u0633\u0627\u0633\u064a\u0629 \u0642\u0628\u0644 \u0628\u062f\u0621 \u0627\u0644\u0633\u062c\u0644";
    if (kind === "restore") return "\u0627\u0633\u062a\u0631\u062c\u0627\u0639 \u0627\u0644\u0646\u0633\u062e\u0629 " + o.restoredFrom;
    if (kind === "import") {
      var S = list(newS).length, N = list(newS).reduce(function (n, e) { return n + list(e.words).length; }, 0);
      return "\u0627\u0633\u062a\u064a\u0631\u0627\u062f \u0645\u0646 \u0645\u0644\u0641" + SEP + S + " \u0633\u0648\u0631\u0629\u060c " + N + " \u0643\u0644\u0645\u0629";
    }
    var d = diff(oldS, newS, o.nameOf), items = d.surahs.map(surahItem).concat(d.words.map(wordItem));
    if (!items.length) return "\u062d\u0641\u0638 \u062f\u0648\u0646 \u062a\u063a\u064a\u064a\u0631 \u0641\u064a \u0627\u0644\u0643\u0644\u0645\u0627\u062a";
    for (var k = Math.min(MAX_ITEMS, items.length); k >= 1; k--) {
      var rest = items.length - k, text = items.slice(0, k).join(SEP) + (rest ? SEP + others(rest) : "");
      if (text.length <= MAX_SUMMARY) return text;
    }
    return changesCount(items.length);
  }

  // Western digits, and every name spelled here so no browser's locale data can change it
  var WEEKDAYS = ["\u0627\u0644\u0623\u062d\u062f", "\u0627\u0644\u0627\u062b\u0646\u064a\u0646", "\u0627\u0644\u062b\u0644\u0627\u062b\u0627\u0621", "\u0627\u0644\u0623\u0631\u0628\u0639\u0627\u0621", "\u0627\u0644\u062e\u0645\u064a\u0633", "\u0627\u0644\u062c\u0645\u0639\u0629", "\u0627\u0644\u0633\u0628\u062a"];
  var MONTHS = ["\u064a\u0646\u0627\u064a\u0631", "\u0641\u0628\u0631\u0627\u064a\u0631", "\u0645\u0627\u0631\u0633", "\u0623\u0628\u0631\u064a\u0644", "\u0645\u0627\u064a\u0648", "\u064a\u0648\u0646\u064a\u0648", "\u064a\u0648\u0644\u064a\u0648", "\u0623\u063a\u0633\u0637\u0633", "\u0633\u0628\u062a\u0645\u0628\u0631", "\u0623\u0643\u062a\u0648\u0628\u0631", "\u0646\u0648\u0641\u0645\u0628\u0631", "\u062f\u064a\u0633\u0645\u0628\u0631"];
  function absTime(d) {
    var m = d.getMinutes();
    return WEEKDAYS[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()] + "\u060c " + (d.getHours() % 12 || 12) + ":" + (m < 10 ? "0" : "") + m + " " + (d.getHours() < 12 ? "\u0635" : "\u0645");
  }
  function ago(ms) {
    var mins = Math.floor(ms / 60000), h = Math.floor(ms / 3600000);
    if (mins < 1) return "\u0645\u0646\u0630 \u0644\u062d\u0638\u0627\u062a";
    if (mins < 60) return mins === 1 ? "\u0645\u0646\u0630 \u062f\u0642\u064a\u0642\u0629" : mins === 2 ? "\u0645\u0646\u0630 \u062f\u0642\u064a\u0642\u062a\u064a\u0646" : mins <= 10 ? "\u0645\u0646\u0630 " + mins + " \u062f\u0642\u0627\u0626\u0642" : "\u0645\u0646\u0630 " + mins + " \u062f\u0642\u064a\u0642\u0629";
    return h === 1 ? "\u0645\u0646\u0630 \u0633\u0627\u0639\u0629" : h === 2 ? "\u0645\u0646\u0630 \u0633\u0627\u0639\u062a\u064a\u0646" : h <= 10 ? "\u0645\u0646\u0630 " + h + " \u0633\u0627\u0639\u0627\u062a" : "\u0645\u0646\u0630 " + h + " \u0633\u0627\u0639\u0629";
  }
  // under 24 hours: how long ago, then the date; otherwise the date alone
  function rowTime(d, now) {
    var ms = now.getTime() - d.getTime();
    return ms >= 0 && ms < DAY_MS ? ago(ms) + SEP + absTime(d) : absTime(d);
  }

  return { MAX_SUMMARY: MAX_SUMMARY, diff: diff, summary: summary, absTime: absTime, rowTime: rowTime };
});
