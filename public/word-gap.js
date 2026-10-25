/* word-gap.js - word page (app #/word/... and the static /word/ pages): puts the word card's
   dashed divider exactly GAP px below the lowest ink of the word's last line, diacritics
   included. Until it runs (or if it cannot measure), the stylesheet's .68em padding applies. */
(function () {
  var GAP = 20, BASE_MB = 4, cv, raf = 0;

  function lastLine(el) {
    var t = el.firstChild;
    if (!t || t.nodeType !== 3) return el.textContent;
    var s = t.data, words = [], i = 0, r = document.createRange();
    s.split(' ').forEach(function (w) {
      if (w) { r.setStart(t, i); r.setEnd(t, i + w.length); var b = r.getClientRects(); if (b.length) words.push({ w: w, top: b[b.length - 1].top }); }
      i += w.length + 1;
    });
    if (!words.length) return s;
    var top = Math.max.apply(null, words.map(function (x) { return x.top; }));
    return words.filter(function (x) { return Math.abs(x.top - top) < 2; }).map(function (x) { return x.w; }).join(' ');
  }

  function measure(wd, vr) {
    var cs = getComputedStyle(wd), fs = parseFloat(cs.fontSize);
    var lh = /px$/.test(cs.lineHeight) ? parseFloat(cs.lineHeight) : parseFloat(cs.lineHeight) * fs;
    cv = cv || document.createElement('canvas');
    var x = cv.getContext('2d');
    x.direction = 'rtl';
    x.font = cs.fontWeight + ' ' + fs + 'px ' + cs.fontFamily;
    var m = x.measureText(lastLine(wd));
    if (m.fontBoundingBoxAscent == null || m.actualBoundingBoxDescent == null) return null;
    var pad = parseFloat(cs.paddingBottom), mb = parseFloat(cs.marginBottom);
    // offsets are layout positions inside the card, unaffected by the page-enter transform
    var contentBottom = wd.offsetTop + wd.offsetHeight - pad - parseFloat(cs.borderBottomWidth);
    var base = contentBottom - lh + (lh - (m.fontBoundingBoxAscent + m.fontBoundingBoxDescent)) / 2 + m.fontBoundingBoxAscent;
    var space = pad + mb + (base + m.actualBoundingBoxDescent + GAP - vr.offsetTop);
    return isFinite(space) ? space : null;
  }

  function fit() {
    var wd = document.querySelector('.cols .card .wd'), vr = wd && wd.parentElement.querySelector('.vr');
    if (!wd || !vr || !document.fonts || !document.fonts.load) return;
    var cs = getComputedStyle(wd);
    document.fonts.load(parseFloat(cs.fontSize) + 'px "Amiri Quran"', wd.textContent).then(function () {
      if (!wd.isConnected) return;
      var s = measure(wd, vr);
      if (s == null) return;
      s = Math.round(s); // whole pixels keep the text below on the pixel grid
      // one write: padding takes the space, and margin gives back the base 4px when less is needed
      wd.style.paddingBottom = Math.max(0, s - BASE_MB) + 'px';
      wd.style.marginBottom = Math.min(BASE_MB, s) + 'px';
    }).catch(function () {});
  }

  // Ayah highlight: each <mark>'s ::before is sized to the real ink of its text (diacritics above and below and
  // overhangs included) plus an equal 0.12em on every side. A mark is an inline-block, so its text is shaped on its
  // own and the canvas measurement matches the page; the box metrics come from the computed style, so collapsed
  // cards measure too. Without measurement the stylesheet's highlight (the mark's padding box) stays.
  // Glyphs are drawn on whole device pixels, so once the page has settled the highlight's edges are snapped to the
  // device-pixel grid as well; otherwise a mark's sub-pixel position could shift the two apart by a pixel.
  var PAD = 0.12, cv2;
  function setBox(m, b) {
    m.style.setProperty('--hl-t', b.t.toFixed(2) + 'px');
    m.style.setProperty('--hl-l', b.l.toFixed(2) + 'px');
    m.style.setProperty('--hl-w', b.w.toFixed(2) + 'px');
    m.style.setProperty('--hl-h', b.h.toFixed(2) + 'px');
  }
  function snap(list) {
    var d = window.devicePixelRatio || 1;
    list.forEach(function (it) {
      var m = it[0], b = it[1];
      if (!m.isConnected || !m.getClientRects().length) return;
      var r = m.getBoundingClientRect(), y = r.top + scrollY, x = r.left + scrollX;
      var t = Math.round((y + b.t) * d) / d - y, bt = Math.round((y + b.t + b.h) * d) / d - y;
      var l = Math.round((x + b.l) * d) / d - x, rt = Math.round((x + b.l + b.w) * d) / d - x;
      setBox(m, { t: t, l: l, w: rt - l, h: bt - t });
    });
  }
  function settled() {
    // finite animations (page enter, card rise) move the marks while they run
    var a = document.getAnimations ? document.getAnimations().filter(function (x) {
      var c = x.effect && x.effect.getComputedTiming ? x.effect.getComputedTiming() : null;
      return c && isFinite(c.endTime);
    }) : [];
    return Promise.race([
      Promise.all(a.map(function (x) { return x.finished.catch(function () {}); })),
      new Promise(function (r) { setTimeout(r, 1500); })
    ]).then(function () { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(r); }); }); });
  }
  // Exact ink of a text run: drawn right-aligned on the baseline into a scratch canvas at scale s, then scanned.
  // Returns extents from the alignment point (left/right) and from the baseline (asc/desc) in CSS px, or null.
  function rasterInk(font, size, text, s) {
    try {
      var c = document.createElement('canvas'), x = c.getContext('2d'), fz = size * s;
      x.font = font.replace(/[\d.]+px/, fz + 'px'); x.direction = 'rtl'; x.textAlign = 'right';
      var adv = x.measureText(text).width, W = Math.ceil(adv + 4 * fz), H = Math.ceil(4 * fz), x0 = W - 2 * fz, y0 = 2.5 * fz;
      c.width = W; c.height = H;
      x.font = font.replace(/[\d.]+px/, fz + 'px'); x.direction = 'rtl'; x.textAlign = 'right'; x.fillStyle = '#000';
      x.fillText(text, x0, y0);
      var d = x.getImageData(0, 0, W, H).data, l = W, r = -1, t = H, b = -1;
      for (var yy = 0; yy < H; yy++) for (var xx = 0; xx < W; xx++) if (d[(yy * W + xx) * 4 + 3] > 8) {
        if (xx < l) l = xx; if (xx > r) r = xx; if (yy < t) t = yy; if (yy > b) b = yy;
      }
      return r < 0 ? null : { left: (x0 - l) / s, right: (r + 1 - x0) / s, asc: (y0 - t) / s, desc: (b + 1 - y0) / s };
    } catch (e) { return null; }
  }
  window.rasterInk = rasterInk;

  function inkMarks(root) {
    var ms = (root || document).querySelectorAll('mark');
    if (!ms.length || !document.fonts || !document.fonts.load) return;
    var fonts = {};
    Array.prototype.forEach.call(ms, function (m) { var cs = getComputedStyle(m); fonts[cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily] = m.textContent; });
    Promise.all(Object.keys(fonts).map(function (k) { return document.fonts.load(k, fonts[k]).catch(function () {}); })).then(function () {
      cv2 = cv2 || document.createElement('canvas');
      var x = cv2.getContext('2d'), list = [];
      Array.prototype.forEach.call(ms, function (m) {
        if (!m.isConnected) return;
        var cs = getComputedStyle(m), fs = parseFloat(cs.fontSize), lh = parseFloat(cs.lineHeight);
        x.font = cs.fontWeight + ' ' + fs + 'px ' + cs.fontFamily; x.direction = 'rtl'; x.textAlign = 'right';
        var k = x.measureText(m.textContent);
        if (k.fontBoundingBoxAscent == null || k.actualBoundingBoxLeft == null || !isFinite(lh) || !isFinite(fs)) return;
        var p = PAD * fs, xr = parseFloat(cs.paddingLeft) + k.width;
        var base = parseFloat(cs.paddingTop) + (lh - (k.fontBoundingBoxAscent + k.fontBoundingBoxDescent)) / 2 + k.fontBoundingBoxAscent;
        // the raster gives the visible ink; the font's glyph boxes are the fallback
        var ink = rasterInk(x.font, fs, m.textContent, Math.max(2, window.devicePixelRatio || 1)) ||
          { left: k.actualBoundingBoxLeft, right: k.actualBoundingBoxRight, asc: k.actualBoundingBoxAscent, desc: k.actualBoundingBoxDescent };
        var b = {
          t: base - ink.asc - p, l: xr - ink.left - p,
          w: ink.left + ink.right + 2 * p, h: ink.asc + ink.desc + 2 * p
        };
        setBox(m, b);
        list.push([m, b]);
      });
      if (list.length) settled().then(function () { snap(list); });
    });
  }

  // Static word pages: mark dark mode (the same decision theme-boot.js makes) so the glass chips can use their
  // higher-contrast colour in dark mode only. The app never shows chips.
  function markDark() {
    try {
      var s = JSON.parse(localStorage.getItem('gq-set')) || {}, m = s.mode || 'auto';
      document.documentElement.classList.toggle('dk', m === 'dark' || (m === 'auto' && matchMedia('(prefers-color-scheme:dark)').matches));
    } catch (e) {}
  }
  if (!document.getElementById('app')) {
    markDark();
    try { matchMedia('(prefers-color-scheme:dark)').addEventListener('change', markDark); } catch (e) {}
  }

  window.wordGap = fit;
  window.markInk = inkMarks;
  addEventListener('resize', function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(function () { fit(); inkMarks(); }); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { fit(); inkMarks(); }); else { fit(); inkMarks(); }
})();
