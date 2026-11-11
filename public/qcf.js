/*
 * qcf.js - the Madinah Mushaf page fonts V2 (QCF V2, King Fahd Glorious Quran Printing Complex): from an ayah's
 * stored segments to the glyphs of the printed Mushaf. Pure: no DOM, no network, no globals besides the UMD export
 * (window.QCF in a browser, module.exports in Node). Used by the site (index.html), the admin preview, the static
 * page generator (scripts/publish-build.mjs), the save and share images and the match check (test/qcf.test.js).
 *
 * Data (never changed by this module):
 *   table  public/qcf-v2.json (scripts/build-qcf-table.mjs): table.ayat["78:1"] = [[page, code_v2, text_qpc_hafs],
 *          ...], one entry per word in order (position = index + 1); the last entry is the ayah-end marker.
 *   fonts  public/fonts/qcf-v2/QCF2{page}.ttf, pages table.first..table.last (582-604), unmodified. Each code_v2
 *          is one glyph (or a few) of its own page's font; an ayah that crosses a page uses each word's own page.
 *   ayah   as stored in words.json / Firestore: { label, segments: [{ num, before, hl, after }] }. label may name
 *          several ayat ("1-2"); every segment names its own ayah (num), so each one is matched on its own.
 *
 * API
 *   QCF.FILE                  "QCF2" + page + ".ttf" for a page (file name in public/fonts/qcf-v2/).
 *   QCF.family(page)          the CSS / canvas font family of a page font: "QCF2 582".
 *   QCF.segment(table, surah, seg)
 *       Matches one segment to its ayah's words. before + hl + after (outer spaces removed) must equal, letter by
 *       letter, a run of whole words of the table's QPC Hafs text of ayah seg.num, joined by single spaces.
 *       -> { ok: true, words: [{ pos, page, code, text, hl, end }] }   (text: the official word; end: the ayah-end
 *          marker, added when the segment reaches the ayah's last word; hl: the word is (partly) in seg.hl, so the
 *          highlight always covers whole words, like QText.markParts)
 *       -> { ok: false, why: "ayah" | "text", positions: [word positions that differ] }
 *   QCF.ayah(table, surah, ayah)
 *       -> { ok, segments: [QCF.segment result per segment], pages: [page numbers needed, ascending] }
 *       ok only when every segment matched; a caller then shows the whole ayah with the fallback (Hafs) font.
 *   QCF.glyphHtml(parts, esc)  the HTML adapter: the glyph layer of a matched ayah (QCF.ayah result) as HTML.
 *       Each segment in ornate parentheses (drawn by the surrounding Quran font, as today) kept with its first and
 *       last word; each word <span class="w p582" data-t="official word">code</span>; a run of highlighted words in
 *       one <mark>. The caller puts it inside aria-hidden="true" next to the official text (see qcf-dom.js).
 *   QCF.html(table, surah, ayah, esc, QText)
 *       The whole ayah for a page: '<span class="qcf" data-p="582 583"><span class="qcf-t">official text (Hafs,
 *       QText.ayahHtml)</span><span class="qcf-g" aria-hidden="true">glyphs</span></span>'. When the ayah does not
 *       match the table it is QText.ayahHtml alone (the Hafs rendering). public/qcf.css shows the glyph layer only
 *       once public/qcf-dom.js has loaded every page font the ayah needs (class "on").
 *   QCF.layout(items, maxWidth, gap)  the canvas adapter: greedy right-to-left line breaking of measured items
 *       ({ w: width, ... }) -> [{ items, width }], each item given x: its distance from the line's right edge.
 *       Lines wrap to the given width (the card), not to the Mushaf's lines.
 *
 * Reels (or any other renderer) reuse it the same way: copy public/qcf.js, public/qcf-v2.json and
 * public/fonts/qcf-v2/; in Node: const QCF = require("./qcf.js"), table = JSON.parse(<qcf-v2.json>);
 * QCF.ayah(table, surah, { segments: [{ num, before: "", hl: <words to mark>, after: "" }] }) gives the glyphs;
 * register each page font under QCF.family(page) (e.g. @font-face or registerFont) and draw word.code in it. For a
 * whole ayah, pass the whole official text as hl or as before.
 *
 * ASCII-ONLY (see test/arabic-guard.test.js).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.QCF = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  var OL = "\ufd3f", OR = "\ufd3e";

  function FILE(page) { return "QCF2" + page + ".ttf"; }
  function family(page) { return "QCF2 " + page; }

  function entries(table, surah, num) {
    var a = table && table.ayat ? table.ayat[surah + ":" + num] : null;
    return Array.isArray(a) && a.length > 1 ? a : null;
  }

  // The ayah's words (without the end marker) joined by single spaces, with each word's [start, end) in that string.
  function joined(e) {
    var s = "", r = [];
    for (var i = 0; i < e.length - 1; i++) {
      if (i) s += " ";
      r.push([s.length, s.length + e[i][2].length]);
      s += e[i][2];
    }
    return { s: s, r: r };
  }

  // Word positions that differ, for the report: the stored text and the table's words split at white space, the
  // stored tokens slid along the table's tokens to the offset where most are equal; the positions of the unequal ones.
  function diffPositions(e, t) {
    var tt = [], tp = [];
    for (var i = 0; i < e.length - 1; i++) e[i][2].split(/\s+/).forEach(function (x) { if (x) { tt.push(x); tp.push(i + 1); } });
    var st = t.split(/\s+/).filter(Boolean), best = -1, at = 0;
    for (var o = 0; o + st.length <= Math.max(tt.length, st.length); o++) {
      var n = 0;
      for (var k = 0; k < st.length; k++) if (st[k] === tt[o + k]) n++;
      if (n > best) { best = n; at = o; }
    }
    var out = [];
    for (var j = 0; j < st.length; j++) {
      var p = tp[at + j] || tp[tp.length - 1];
      if (st[j] !== tt[at + j] && out.indexOf(p) < 0) out.push(p);
    }
    return out;
  }

  function segment(table, surah, g) {
    var e = entries(table, surah, Number(g && g.num));
    if (!e) return { ok: false, why: "ayah", positions: [] };
    var b = String(g.before || ""), h = String(g.hl || ""), a = String(g.after || "");
    var raw = b + h + a, t = raw.replace(/^\s+/, ""), lead = raw.length - t.length;
    t = t.replace(/\s+$/, "");
    var J = joined(e), starts = {}, ends = {};
    J.r.forEach(function (r, i) { starts[r[0]] = i; ends[r[1]] = i; });
    var k = -1, from = 0;
    while (t && (from = J.s.indexOf(t, from)) >= 0) {
      if (from in starts && (from + t.length) in ends) { k = from; break; }
      from++;
    }
    if (k < 0) return { ok: false, why: "text", positions: diffPositions(e, t) };
    var hs = k + b.length - lead, he = hs + h.length;
    while (hs < he && /\s/.test(raw.charAt(hs - k + lead))) hs++;
    while (he > hs && /\s/.test(raw.charAt(he - 1 - k + lead))) he--;
    var first = starts[k], last = ends[k + t.length], words = [];
    for (var i = first; i <= last; i++) {
      var r = J.r[i];
      words.push({ pos: i + 1, page: e[i][0], code: e[i][1], text: e[i][2], hl: he > hs && r[0] < he && r[1] > hs, end: false });
    }
    if (last === e.length - 2) {
      var m = e[e.length - 1];
      words.push({ pos: e.length, page: m[0], code: m[1], text: m[2], hl: false, end: true });
    }
    return { ok: true, words: words };
  }

  function ayah(table, surah, ay) {
    var segs = ay && Array.isArray(ay.segments) ? ay.segments : [];
    var parts = segs.map(function (g) { return segment(table, surah, g); }), pages = [];
    parts.forEach(function (p) { (p.words || []).forEach(function (w) { if (pages.indexOf(w.page) < 0) pages.push(w.page); }); });
    pages.sort(function (x, y) { return x - y; });
    return { ok: parts.length > 0 && parts.every(function (p) { return p.ok; }), segments: parts, pages: pages };
  }

  function glyphHtml(parts, esc) {
    var nb = function (x) { return '<span class="nb">' + x + "</span>"; };
    return parts.segments.map(function (p) {
      var ws = p.words, html = [], run = null;
      var word = function (w) { return '<span class="w p' + w.page + '" data-t="' + (w.end ? "" : esc(w.text)) + '">' + esc(w.code) + "</span>"; };
      ws.forEach(function (w) {
        var x = word(w);
        if (w.hl) { if (run) run.push(x); else { run = [x]; html.push(run); } }
        else { run = null; html.push(x); }
      });
      var out = html.map(function (x) { return Array.isArray(x) ? "<mark>" + x.join(" ") + "</mark>" : x; });
      if (!out.length) return "";
      // the parentheses stay outside the mark and on the line of the first / last item (never alone at a line end)
      out[0] = OL + out[0];
      out[out.length - 1] = out[out.length - 1] + OR;
      if (out.length > 1) { out[0] = nb(out[0]); out[out.length - 1] = nb(out[out.length - 1]); } else out[0] = nb(out[0]);
      return out.join(" ");
    }).join(" ");
  }

  function html(table, surah, ay, esc, QText) {
    var plain = QText.ayahHtml(ay, esc), parts = ayah(table, surah, ay);
    if (!parts.ok) return plain;
    return '<span class="qcf" data-p="' + parts.pages.join(" ") + '"><span class="qcf-t">' + plain +
      '</span><span class="qcf-g" aria-hidden="true">' + glyphHtml(parts, esc) + "</span></span>";
  }

  function layout(items, maxWidth, gap) {
    var lines = [], cur = null;
    (items || []).forEach(function (it) {
      if (cur && cur.items.length && cur.width + gap + it.w > maxWidth) cur = null;
      if (!cur) { cur = { items: [], width: 0 }; lines.push(cur); }
      if (cur.items.length) cur.width += gap;
      it.x = cur.width;
      cur.width += it.w;
      cur.items.push(it);
    });
    return lines;
  }

  return { FILE: FILE, family: family, segment: segment, ayah: ayah, glyphHtml: glyphHtml, html: html, layout: layout };
});
