/*
 * qcf-canvas.js - the canvas side of qcf.js (the Madinah Mushaf page fonts V2): draws a matched ayah's glyphs on a
 * 2D canvas, for the save-as-image card (renderCard in index.html) and any other canvas renderer. A thin adapter:
 * qcf.js matches the ayah (QCF.ayah) and breaks lines (QCF.layout); qcf-dom.js loads the page fonts (QCFDom.ready).
 * Exposes window.QCFCanvas (module.exports in Node, where only the pure parts are useful: items, block, place).
 *
 * Usable only when the ayah matches the table and every page font it needs has loaded; otherwise get() returns null
 * and the caller keeps its Hafs v22 rendering. Glyph codes are never drawn in any other font (no empty boxes).
 *
 *   QCFCanvas.prepare(surah, ayah)  Promise<parts|null>: fetches the table (QCFDom.table), matches the ayah
 *                                   (QCF.ayah) and waits for its page fonts (QCFDom.ready). Call it before drawing,
 *                                   e.g. while the save sheet opens. Never rejects.
 *   QCFCanvas.get(surah, ayah)      synchronous: the parts (a QCF.ayah result) when prepare() has succeeded and the
 *                                   page fonts are still loaded (document.fonts.check), else null: use Hafs.
 *   QCFCanvas.state(surah, ayah)    "none" (prepare not called), "pending", "ready" or "off" (no match, no table or
 *                                   a font failed). A caller that must draw synchronously (a share in a click
 *                                   handler) draws at once unless the state is "pending".
 *   QCFCanvas.block(ctx, parts, o)  measures and lays out the ayah:
 *       o.size      glyph font size in px (each word in ctx.font = size + 'px "' + QCF.family(page) + '"')
 *       o.font      the CSS font of the ornate parentheses and of the word gap (the card's Quran font, e.g.
 *                   '58px "KFGQPC Uthmanic Hafs","Amiri Quran"'); o.gap overrides the gap (default: its space)
 *       o.maxWidth  the line width
 *       o.markX     horizontal padding inside a highlight run (like the site's mark padding), default 0
 *       o.markTop / o.markBot  the least room a highlighted item takes above / below the baseline, default 0
 *     -> { lines: [{ items, width, top, bot }], gap, over, size, font }. Each segment is kept in its parentheses,
 *        each run of highlighted words is one unbreakable item (like the site's inline-block mark), the
 *        parentheses stay with their first / last item; lines break right to left with QCF.layout. top / bot: the
 *        line's ink above / below the baseline. over: an item is wider than maxWidth (the caller shrinks the size).
 *   QCFCanvas.place(ctx, line, xRight, baseline, o)
 *     -> { texts: [{ t, x, y, font, src }], marks: [{ x, y, w, h }] }: right-aligned draw positions (ctx.direction
 *        "rtl", textAlign "right") from the line's right edge xRight, and one highlight box per highlighted run,
 *        covering whole words: the ink of its words (o.ink(font, size, text) if given, e.g. window.rasterInk, else
 *        measureText's bounding box) plus o.pad (default 0.12 * size) on every side. src: { pos, page, text } of a
 *        glyph word (text: the official word, for a test or an accessible copy), null for a parenthesis.
 *   QCFCanvas.draw(ctx, block, xRight, baselines, o, colors)
 *       draws every line (baselines[i] for line i): the highlights in colors.mark (with o.radius, default
 *       10/28 * size), then the text in colors.text. Returns the placed lines. renderCard uses place() instead, so
 *       its own draw order and ink boxes stay as they are.
 *
 * ASCII-ONLY (see test/arabic-guard.test.js).
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.QCFCanvas = api;
})(typeof window !== "undefined" ? window : null, function (root) {
  "use strict";

  var OL = "\ufd3f", OR = "\ufd3e";
  var Q = function () { return (root && root.QCF) || (typeof require === "function" ? require("./qcf.js") : null); };

  // --- preparing (browser) --------------------------------------------------------------------------------------
  var cache = {};
  function key(surah, ay) {
    var segs = ay && Array.isArray(ay.segments) ? ay.segments : [];
    return surah + "|" + JSON.stringify(segs.map(function (g) { return [g.num, g.before, g.hl, g.after]; }));
  }
  function fontsLoaded(pages, size) {
    try {
      if (!root || !root.document || !root.document.fonts || !root.document.fonts.check) return true;
      return pages.every(function (p) { return root.document.fonts.check((size || 40) + 'px "' + Q().family(p) + '"'); });
    } catch (e) { return false; }
  }
  function prepare(surah, ay) {
    var k = key(surah, ay), c = cache[k];
    if (c && c.p) return c.p;
    c = cache[k] = { s: "pending", parts: null };
    var D = root && root.QCFDom;
    c.p = (!D || !Q() ? Promise.resolve(null) : D.table().then(function (t) {
      var parts = t ? Q().ayah(t, surah, ay) : null;
      if (!parts || !parts.ok) return null;
      return D.ready(parts.pages).then(function (ok) { return ok ? parts : null; });
    })).then(function (parts) { c.parts = parts; c.s = parts ? "ready" : "off"; return parts; },
      function () { c.s = "off"; return null; });
    return c.p;
  }
  function state(surah, ay) { var c = cache[key(surah, ay)]; return c ? c.s : "none"; }
  function get(surah, ay) {
    var c = cache[key(surah, ay)];
    return c && c.s === "ready" && c.parts && fontsLoaded(c.parts.pages) ? c.parts : null;
  }

  // --- measuring and layout (pure apart from the context) ---------------------------------------------------------
  function gfont(size, page) { return size + 'px "' + Q().family(page) + '"'; }
  function meas(ctx, font, t) {
    ctx.font = font;
    var m = ctx.measureText(t);
    return { w: m.width, asc: m.actualBoundingBoxAscent || 0, desc: m.actualBoundingBoxDescent || 0 };
  }

  // One layout item per unbreakable piece: a word, or a run of highlighted words; parentheses join the first / last.
  function items(ctx, parts, o) {
    var size = o.size, mX = o.markX || 0, mT = o.markTop || 0, mB = o.markBot || 0;
    ctx.direction = "rtl"; ctx.textAlign = "right";
    var sp = o.gap != null ? o.gap : meas(ctx, o.font, " ").w, out = [];
    (parts.segments || []).forEach(function (seg) {
      var groups = [], run = null;
      (seg.words || []).forEach(function (w) {
        var k = meas(ctx, gfont(size, w.page), w.code);
        var pc = { t: w.code, font: gfont(size, w.page), w: k.w, asc: k.asc, desc: k.desc, src: { pos: w.pos, page: w.page, text: w.end ? "" : w.text } };
        if (w.hl) { if (run) run.words.push(pc); else { run = { mk: true, words: [pc] }; groups.push(run); } }
        else { run = null; groups.push({ mk: false, words: [pc] }); }
      });
      groups.forEach(function (g, gi) {
        var ps = [], x = 0;
        var add = function (p, w) { p.dx = x; ps.push(p); x += w; };
        if (gi === 0) { var a = meas(ctx, o.font, OL); add({ t: OL, font: o.font, w: a.w, asc: a.asc, desc: a.desc, src: null, br: 1 }, a.w); }
        if (g.mk) x += mX;
        g.words.forEach(function (p, i) { if (i) x += sp; add(p, p.w); });
        if (g.mk) x += mX;
        if (gi === groups.length - 1) { var b = meas(ctx, o.font, OR); add({ t: OR, font: o.font, w: b.w, asc: b.asc, desc: b.desc, src: null, br: 1 }, b.w); }
        var top = 0, bot = 0;
        ps.forEach(function (p) { top = Math.max(top, p.asc); bot = Math.max(bot, p.desc); });
        if (g.mk) { top = Math.max(top, mT); bot = Math.max(bot, mB); }
        out.push({ w: x, pieces: ps, mk: g.mk, top: top, bot: bot });
      });
    });
    return { items: out, gap: sp };
  }

  function block(ctx, parts, o) {
    var r = items(ctx, parts, o), lines = Q().layout(r.items, o.maxWidth, r.gap);
    lines.forEach(function (l) {
      l.top = Math.max.apply(null, l.items.map(function (it) { return it.top; }).concat(0));
      l.bot = Math.max.apply(null, l.items.map(function (it) { return it.bot; }).concat(0));
    });
    return { lines: lines, gap: r.gap, over: r.items.some(function (it) { return it.w > o.maxWidth; }), size: o.size, font: o.font };
  }

  function inkOf(ctx, o, p) {
    var k = o.ink ? o.ink(p.font, o.size, p.t, 1) : null;
    if (k) return k;
    ctx.font = p.font; ctx.direction = "rtl"; ctx.textAlign = "right";
    var m = ctx.measureText(p.t);
    return { left: m.actualBoundingBoxLeft || p.w, right: m.actualBoundingBoxRight || 0, asc: m.actualBoundingBoxAscent || 0, desc: m.actualBoundingBoxDescent || 0 };
  }

  function place(ctx, line, xRight, baseline, o) {
    var texts = [], marks = [], hp = o.pad != null ? o.pad : 0.12 * o.size;
    line.items.forEach(function (it) {
      var r0 = xRight - it.x, box = null;
      it.pieces.forEach(function (p) {
        var px = r0 - p.dx;
        texts.push({ t: p.t, x: px, y: baseline, font: p.font, src: p.src });
        if (it.mk && !p.br) {
          var k = inkOf(ctx, o, p), b = { l: px - k.left, r: px + k.right, t: baseline - k.asc, b: baseline + k.desc };
          box = box ? { l: Math.min(box.l, b.l), r: Math.max(box.r, b.r), t: Math.min(box.t, b.t), b: Math.max(box.b, b.b) } : b;
        }
      });
      if (box) marks.push({ x: box.l - hp, y: box.t - hp, w: box.r - box.l + 2 * hp, h: box.b - box.t + 2 * hp });
    });
    return { texts: texts, marks: marks };
  }

  function draw(ctx, blk, xRight, baselines, o, colors) {
    var placed = blk.lines.map(function (l, i) { return place(ctx, l, xRight, baselines[i], o); }), rad = o.radius != null ? o.radius : 10 / 28 * o.size;
    ctx.save();
    ctx.direction = "rtl"; ctx.textAlign = "right";
    placed.forEach(function (pl) {
      pl.marks.forEach(function (m) {
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(m.x, m.y, m.w, m.h, rad); else ctx.rect(m.x, m.y, m.w, m.h);
        ctx.fillStyle = colors.mark; ctx.fill();
      });
    });
    placed.forEach(function (pl) { pl.texts.forEach(function (t) { ctx.font = t.font; ctx.fillStyle = colors.text; ctx.fillText(t.t, t.x, t.y); }); });
    ctx.restore();
    return placed;
  }

  return { prepare: prepare, get: get, state: state, items: items, block: block, place: place, draw: draw };
});
