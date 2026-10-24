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

  window.wordGap = fit;
  addEventListener('resize', function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fit); else fit();
})();
