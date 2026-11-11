/*
 * qcf-editor.js - the admin word editor's side of qcf.js (the Madinah Mushaf page fonts V2): the ayah preview and the
 * headword preview in the page glyphs, filling an ayah from the committed table when the surah and the ayah number are
 * chosen, and picking the highlighted words by clicking them in the preview. Pure: no DOM, no network; the admin page
 * (public/admin/index.html) puts the HTML in the DOM and public/qcf-dom.js loads the fonts. Exposes window.QCFEditor
 * (module.exports in Node). Needs qcf.js (window.QCF, or require("../qcf.js") in Node).
 *
 * The stored segment conventions this module writes (the same as public/words.json): one segment per ayah, num = that
 * ayah's number (a label "1-2" has the segments 1 and 2, in order); before + hl + after is the whole official ayah
 * (the table's words, joined by single spaces); hl is whole words without outer spaces; before ends with the space
 * before hl (or is empty), after starts with the space after hl (or is empty). Built from word positions, so a
 * segment written here always matches the table (QCF.ayah ok).
 *
 * API (table: public/qcf-v2.json; surah: the surah's number; segs: [{ num, before, hl, after }])
 *   range(label)                 "5" -> [5], "5-6" -> [5, 6]; null for anything else.
 *   words(table, surah, num)     the ayah's official words (no end marker), or null when the table has no such ayah.
 *   build(table, surah, num, from, to)
 *                                the segment of ayah num with words from..to (1-based, inclusive) highlighted; from = 0
 *                                means no highlight (the whole ayah in before). null when the table has no such ayah.
 *   selection(table, surah, seg) { from, to } of the highlighted words (whole words, as QCF.segment marks them;
 *                                from = to = 0 when nothing is highlighted), or null when seg does not match the table.
 *   pick(sel, pos)               a click on word pos: no highlight -> that word; outside the run -> the run grows to
 *                                it; the first or last word of the run -> it leaves the run; inside -> that word alone.
 *   click(table, surah, segs, si, pos)
 *                                the segments after a click on word pos of segment si (a new array), or null.
 *   fill(table, surah, label, segs, from)
 *                                the segments for a newly chosen surah / ayah number: one per ayah of the label, from
 *                                the table, with no highlight; a segment that already belongs to that ayah and matches
 *                                the table is kept as it is (its stored bytes and highlight). from: the surah the
 *                                current segments were written for (default surah). Text typed by hand is never
 *                                replaced (SEC-2): when a segment with text does not match the table for from, null.
 *                                null also when there is nothing to fill (label not a number or range, an ayah missing
 *                                from the table, or the segments already are those ayat).
 *   wordAt(parts, index)         the word under the index-th ".qcf-g .w" element of a preview: { si, pos, end }.
 *   preview(table, surah, segs, esc, plain, loaded)
 *                                the ayah preview: { html, ok, note, pages }. ok: QCF glyphs (with plain, the Hafs
 *                                HTML, as the official text layer, shown until the fonts load); not ok: plain alone,
 *                                and note is true when the table is loaded and there is text that does not match it
 *                                (the ayah will be shown in the fallback font). loaded(page) tells whether a page font
 *                                has already loaded, so a repaint does not flash the Hafs text.
 *   head(table, surah, segs, esc, shown, loaded)
 *                                the headword preview: { html, pages }. Glyphs of the highlighted words when the
 *                                ayah matches and they are exactly the headword shown (shown: QText.displayWord),
 *                                else esc(shown) alone.
 *
 * ASCII-ONLY (see test/arabic-guard.test.js).
 */
(function (root, factory) {
  var Q = root && root.QCF ? root.QCF : (typeof require === "function" ? require("../qcf.js") : null);
  var api = factory(Q);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.QCFEditor = api;
})(typeof window !== "undefined" ? window : null, function (QCF) {
  "use strict";

  var MAX_RANGE = 20;

  function range(label) {
    var m = String(label == null ? "" : label).trim().match(/^([0-9]+)(?:-([0-9]+))?$/);
    if (!m) return null;
    var a = Number(m[1]), b = m[2] == null ? a : Number(m[2]);
    if (!(a >= 1) || b < a || b - a >= MAX_RANGE) return null;
    var out = [];
    for (var i = a; i <= b; i++) out.push(i);
    return out;
  }

  function words(table, surah, num) {
    var e = table && table.ayat ? table.ayat[surah + ":" + num] : null;
    if (!Array.isArray(e) || e.length < 2) return null;
    return e.slice(0, -1).map(function (x) { return String(x[2]); });
  }

  function build(table, surah, num, from, to) {
    var w = words(table, surah, num);
    if (!w) return null;
    if (!(from >= 1) || !(to >= from) || to > w.length) return { num: num, before: w.join(" "), hl: "", after: "" };
    var b = w.slice(0, from - 1).join(" "), a = w.slice(to).join(" ");
    return { num: num, before: b ? b + " " : "", hl: w.slice(from - 1, to).join(" "), after: a ? " " + a : "" };
  }

  function selection(table, surah, seg) {
    if (!QCF || !table) return null;
    var r = QCF.segment(table, surah, seg);
    if (!r.ok) return null;
    var from = 0, to = 0;
    r.words.forEach(function (w) { if (w.hl && !w.end) { if (!from) from = w.pos; to = w.pos; } });
    return { from: from, to: to };
  }

  function pick(sel, pos) {
    var f = sel && sel.from || 0, t = sel && sel.to || 0;
    if (!f) return { from: pos, to: pos };
    if (pos < f) return { from: pos, to: t };
    if (pos > t) return { from: f, to: pos };
    if (pos === f && pos === t) return { from: 0, to: 0 };
    if (pos === f) return { from: f + 1, to: t };
    if (pos === t) return { from: f, to: t - 1 };
    return { from: pos, to: pos };
  }

  function copy(g) { return { num: g.num, before: g.before, hl: g.hl, after: g.after }; }

  function click(table, surah, segs, si, pos) {
    var g = segs && segs[si];
    if (!g) return null;
    var sel = selection(table, surah, g);
    if (!sel) return null;
    var n = pick(sel, pos), seg = build(table, surah, Number(g.num), n.from, n.to);
    if (!seg) return null;
    var out = segs.map(copy);
    out[si] = seg;
    return out;
  }

  function text(g) { return String((g && g.before || "") + (g && g.hl || "") + (g && g.after || "")).trim(); }

  function fill(table, surah, label, segs, from) {
    var nums = range(label);
    if (!nums || !table || !QCF) return null;
    for (var i = 0; i < nums.length; i++) if (!words(table, surah, nums[i])) return null;
    var cur = Array.isArray(segs) ? segs : [], was = from == null ? surah : from;
    for (var j = 0; j < cur.length; j++) if (text(cur[j]) && !QCF.segment(table, was, cur[j]).ok) return null;
    var out = nums.map(function (n) {
      for (var k = 0; k < cur.length; k++) {
        var g = cur[k];
        if (Number(g.num) === n && text(g) && QCF.segment(table, surah, g).ok) return copy(g);
      }
      return build(table, surah, n, 0, 0);
    });
    var same = out.length === cur.length && out.every(function (g, j) {
      var c = cur[j];
      return String(g.num) === String(c.num) && g.before === c.before && g.hl === c.hl && g.after === c.after;
    });
    return same ? null : out;
  }

  function wordAt(parts, index) {
    var n = 0;
    for (var s = 0; s < parts.segments.length; s++) {
      var ws = parts.segments[s].words || [];
      for (var k = 0; k < ws.length; k++, n++) if (n === index) return { si: s, pos: ws[k].pos, end: !!ws[k].end };
    }
    return null;
  }

  function allLoaded(pages, loaded) {
    return !!loaded && pages.length > 0 && pages.every(function (p) { return loaded(p); });
  }

  function wrap(pages, loaded, plain, glyphs) {
    return '<span class="qcf' + (allLoaded(pages, loaded) ? " on" : "") + '" data-p="' + pages.join(" ") + '"><span class="qcf-t">' +
      plain + '</span><span class="qcf-g" aria-hidden="true">' + glyphs + "</span></span>";
  }

  function preview(table, surah, segs, esc, plain, loaded) {
    var list = Array.isArray(segs) ? segs : [];
    if (!QCF || !table) return { html: plain, ok: false, note: false, pages: [] };
    var parts = QCF.ayah(table, surah, { segments: list });
    if (!parts.ok) return { html: plain, ok: false, note: list.some(function (g) { return !!text(g); }), pages: [] };
    return { html: wrap(parts.pages, loaded, plain, QCF.glyphHtml(parts, esc)), ok: true, note: false, pages: parts.pages, parts: parts };
  }

  function head(table, surah, segs, esc, shown, loaded) {
    var plain = esc(shown), list = Array.isArray(segs) ? segs : [];
    if (!QCF || !table || !shown) return { html: plain, pages: [] };
    var parts = QCF.ayah(table, surah, { segments: list });
    if (!parts.ok) return { html: plain, pages: [] };
    var hw = [], pages = [];
    parts.segments.forEach(function (p) { p.words.forEach(function (w) { if (w.hl && !w.end) hw.push(w); }); });
    var joined = parts.segments.map(function (p) {
      return p.words.filter(function (w) { return w.hl && !w.end; }).map(function (w) { return w.text; }).join(" ");
    }).filter(Boolean).join(" ");
    if (!hw.length || joined !== shown) return { html: plain, pages: [] };
    hw.forEach(function (w) { if (pages.indexOf(w.page) < 0) pages.push(w.page); });
    pages.sort(function (x, y) { return x - y; });
    var g = hw.map(function (w) { return '<span class="w p' + w.page + '" data-t="' + esc(w.text) + '">' + esc(w.code) + "</span>"; }).join(" ");
    return { html: wrap(pages, loaded, plain, g), pages: pages };
  }

  return { range: range, words: words, build: build, selection: selection, pick: pick, click: click, fill: fill,
    wordAt: wordAt, preview: preview, head: head };
});
