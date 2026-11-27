/*
 * qcf-dom.js - the browser side of qcf.js (the Madinah Mushaf page fonts V2): loads the page fonts the visible ayat
 * need, swaps each ayah from the Hafs v22 rendering to its page glyphs once all its fonts have loaded, and keeps copy
 * on the official text. Needs public/qcf.css (not qcf.js). Exposes window.QCFDom.
 *
 * Markup (QCF.html): <span class="qcf" data-p="582 583" data-qs="78"><span class="qcf-t">official text, Hafs
 * (QText.ayahHtml)</span><span class="qcf-g" aria-hidden="true">glyphs</span></span>. States (qcf.css):
 *   waiting (no class)  the glyph layer holds the ayah's final space, invisible (every glyph word has its measured
 *                       width), while its page fonts load: never the Hafs rendering first, never empty boxes.
 *   "on"                every page font it needs has loaded: the glyphs. When they are already loaded in this
 *                       document (a loaded-pages registry), "on" is set in the same task the ayah is put in the DOM
 *                       (the MutationObserver runs before the next paint), so the first paint already has the glyphs.
 *   "hafs"              a font failed, or it was not ready WAIT ms after its loading started: the official text in
 *                       Hafs v22, as before. It still switches to the glyphs when the font arrives later.
 * In every state but "hafs" .qcf-t stays in the DOM, visually hidden (screen readers, find in page and copy use it).
 *
 *   QCFDom.table()        Promise of the table (/qcf-v2.json), fetched once; resolves null if it can't be loaded
 *                         (then QCF.html gives the Hafs rendering).
 *   QCFDom.load(pages)    Promise<boolean>: true when every page font of the list has loaded (each fetched once,
 *                         from /fonts/qcf-v2/, through the service worker cache); false if any failed.
 *   QCFDom.loaded(pages)  boolean, synchronous: every page font of the list has loaded in this document.
 *   QCFDom.scan(root)     finds .qcf elements under root (default document) and handles each one: at once when its
 *                         fonts are loaded, else when it comes near the viewport. Elements added later are found by a
 *                         MutationObserver started on first use, so a surface only has to put QCF.html in the DOM.
 *   QCFDom.ready(pages)   for a canvas: same as load(), call it before drawing with QCF.family(page).
 *   QCFDom.warm(surahs)   in idle time, after the first paint: loads the page fonts of those surahs (the site passes
 *                         the released challenge days' surahs; every ayah on a page adds its own surah, data-qs), and
 *                         all the pages first..last when the connection allows it (not Save-Data, not cellular, not
 *                         2g/3g). Never blocks rendering; each font is fetched once.
 * After every swap a "qcf" event is dispatched on document (word-gap.js measures again).
 * Glyphs are never shown before their font has loaded, so no private-use code point is ever drawn by another font.
 *
 * ASCII-ONLY (see test/arabic-guard.test.js).
 */
(function () {
  "use strict";
  var BASE = "/fonts/qcf-v2/", WAIT = 1000, fonts = {}, loaded = {}, tableP = null, io = null, mo = null;

  function table() {
    if (!tableP) {
      tableP = fetch("/qcf-v2.json").then(function (r) { return r.ok ? r.json() : null; })
        .then(function (t) { return t && t.ayat ? t : null; }, function () { return null; });
    }
    return tableP;
  }

  function font(page) {
    if (!fonts[page]) {
      fonts[page] = new Promise(function (res) {
        try {
          var f = new FontFace("QCF2 " + page, "url(" + BASE + "QCF2" + page + ".ttf)", { display: "block" }); // = QCF.family(page), QCF.FILE(page)
          f.load().then(function (x) { document.fonts.add(x); loaded[page] = true; res(true); }, function () { res(false); });
        } catch (e) { res(false); }
      });
    }
    return fonts[page];
  }

  function nums(pages) { return (pages || []).map(Number).filter(function (p) { return p > 0; }); }
  function load(pages) {
    return Promise.all(nums(pages).map(font)).then(function (ok) { return ok.every(Boolean); });
  }
  function isLoaded(pages) {
    var l = nums(pages);
    return l.length > 0 && l.every(function (p) { return loaded[p]; });
  }

  function pagesOf(el) { return String(el.getAttribute("data-p") || "").split(/\s+/).filter(Boolean); }

  function show(el) {
    el.classList.remove("hafs");
    el.classList.add("on");
    try { document.dispatchEvent(new Event("qcf")); } catch (e) {}
  }

  function swap(el) {
    if (el.__qcf) return;
    el.__qcf = 1;
    // still invisible after WAIT ms (a slow or failing font): the Hafs rendering, as before, until the font arrives
    var t = setTimeout(function () { if (!el.classList.contains("on")) el.classList.add("hafs"); }, WAIT);
    load(pagesOf(el)).then(function (ok) {
      clearTimeout(t);
      if (ok) show(el); else el.classList.add("hafs");
    });
  }

  function watch(el) {
    if (el.__qcfw) return;
    el.__qcfw = 1;
    var s = Number(el.getAttribute("data-qs"));
    if (s > 0) warm([s]);
    // Every font it needs has already loaded in this document (a later page view, the next word, the quiz after an
    // answer): the glyphs at once, in the same task, so the first paint of this ayah already shows them.
    if (isLoaded(pagesOf(el))) {
      el.__qcf = 1;
      show(el);
      return;
    }
    if (io) io.observe(el); else swap(el);
  }

  // Warming: after the first paint, in idle time; never blocks rendering.
  var idle = window.requestIdleCallback ? function (f) { window.requestIdleCallback(f, { timeout: 4000 }); } : function (f) { setTimeout(f, 300); };
  var warmQ = {}, warmT = false, allDone = false, painted = false;
  function roomy() {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c) return true;
    if (c.saveData) return false;
    if (c.type === "cellular") return false;
    return !/(^|-)(2g|3g)$/.test(String(c.effectiveType || ""));
  }
  function flush() {
    warmT = false;
    table().then(function (t) {
      if (!t) return;
      var want = {};
      Object.keys(t.ayat).forEach(function (k) {
        if (warmQ[k.split(":")[0]]) t.ayat[k].forEach(function (e) { want[e[0]] = 1; });
      });
      var list = Object.keys(want).map(Number).sort(function (a, b) { return a - b; });
      if (!allDone && roomy()) { allDone = true; for (var p = t.first; p <= t.last; p++) if (!want[p]) list.push(p); }
      // one font at a time, each in its own idle slot
      (function next() {
        var p = list.shift();
        if (p == null) return;
        idle(function () { font(p).then(next, next); });
      })();
    });
  }
  function warm(surahs) {
    (surahs || []).forEach(function (s) { s = Number(s); if (s > 0) warmQ[s] = 1; });
    if (warmT) return;
    warmT = true;
    if (painted) idle(flush);
  }
  function afterPaint() {
    painted = true;
    if (warmT) idle(flush); else { warmT = true; idle(flush); }
  }
  if (document.readyState === "complete") setTimeout(afterPaint, 0);
  else window.addEventListener("load", function () { setTimeout(afterPaint, 0); });

  function scan(root) {
    if (!io && window.IntersectionObserver) {
      io = new IntersectionObserver(function (es) {
        es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); swap(e.target); } });
      }, { rootMargin: "600px 0px" });
    }
    var r = root || document;
    if (r.nodeType === 1 && r.classList.contains("qcf")) watch(r);
    if (r.querySelectorAll) Array.prototype.forEach.call(r.querySelectorAll(".qcf"), watch);
    if (!mo && window.MutationObserver && document.body) {
      mo = new MutationObserver(function (list) {
        list.forEach(function (m) { for (var i = 0; i < m.addedNodes.length; i++) if (m.addedNodes[i].nodeType === 1) scan(m.addedNodes[i]); });
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  // Copy: the glyph layer holds private-use code points, so a selection that touches it is copied as the official
  // text instead: each glyph word as its data-t (the official word; the ayah-end marker has none), the hidden
  // official layer dropped (it would repeat the ayah), everything else as selected.
  document.addEventListener("copy", function (ev) {
    var sel = window.getSelection && window.getSelection();
    if (!sel || !sel.rangeCount || !ev.clipboardData) return;
    var frag = document.createElement("div"), hit = false;
    for (var i = 0; i < sel.rangeCount; i++) frag.appendChild(sel.getRangeAt(i).cloneContents());
    var anc = sel.getRangeAt(0).commonAncestorContainer, inG = anc && (anc.nodeType === 1 ? anc : anc.parentElement);
    inG = inG && inG.closest ? inG.closest(".qcf-g") : null;
    if (inG) { hit = true; }
    Array.prototype.forEach.call(frag.querySelectorAll(".qcf-t"), function (n) { hit = true; n.parentNode.removeChild(n); });
    Array.prototype.forEach.call(frag.querySelectorAll(".w[data-t]"), function (n) { hit = true; n.parentNode.replaceChild(document.createTextNode(n.getAttribute("data-t")), n); });
    if (inG && !frag.querySelector(".w")) {
      // the selection is inside one glyph word: cloneContents gives only its text node
      var w = anc.nodeType === 1 ? anc : anc.parentElement;
      w = w && w.closest ? w.closest(".w") : null;
      if (w) frag.textContent = w.getAttribute("data-t") || "";
    }
    if (!hit) return;
    var t = frag.textContent.replace(/[\ue000-\uf8ff\ufb50-\ufdff\ufe70-\ufeff]/g, function (c) {
      return c === "\ufd3e" || c === "\ufd3f" ? c : ""; // no glyph code ever reaches the clipboard
    }).replace(/[ \t]+/g, " ").replace(/ (\ufd3e)/g, "$1").trim(); // the end marker has no text: no space before the closing parenthesis
    ev.clipboardData.setData("text/plain", t);
    ev.preventDefault();
  });

  window.QCFDom = { table: table, load: load, ready: load, loaded: isLoaded, scan: scan, warm: warm, BASE: BASE, WAIT: WAIT };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { scan(); });
  else scan();
})();
