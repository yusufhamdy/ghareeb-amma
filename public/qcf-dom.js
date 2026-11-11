/*
 * qcf-dom.js - the browser side of qcf.js (the Madinah Mushaf page fonts V2): loads the page fonts the visible ayat
 * need, swaps each ayah from the Hafs v22 rendering to its page glyphs once all its fonts have loaded, and keeps copy
 * on the official text. Needs public/qcf.css (not qcf.js). Exposes window.QCFDom.
 *
 * Markup (QCF.html): <span class="qcf" data-p="582 583"><span class="qcf-t">official text, Hafs (QText.ayahHtml)
 * </span><span class="qcf-g" aria-hidden="true">glyphs</span></span>. Until the element gets the class "on",
 * qcf.css shows only .qcf-t (the current rendering, with qfont.js's guard). With "on", .qcf-t stays in the DOM,
 * visually hidden (screen readers, find in page and copy use it) and .qcf-g shows the glyphs.
 *
 *   QCFDom.table()        Promise of the table (/qcf-v2.json), fetched once; resolves null if it can't be loaded
 *                         (then QCF.html gives the Hafs rendering).
 *   QCFDom.load(pages)    Promise<boolean>: true when every page font of the list has loaded (each fetched once,
 *                         from /fonts/qcf-v2/, through the service worker cache); false if any failed.
 *   QCFDom.scan(root)     finds .qcf elements under root (default document) and swaps each one when it comes near the
 *                         viewport. Elements added later are found by a MutationObserver started on first use, so a
 *                         surface only has to put QCF.html in the DOM.
 *   QCFDom.ready(pages)   for a canvas: same as load(), call it before drawing with QCF.family(page).
 * After every swap a "qcf" event is dispatched on document (word-gap.js measures again).
 * A font that fails keeps its ayat in Hafs v22: glyphs are never shown before their font has loaded, so no
 * private-use code point is ever drawn by another font (no empty boxes).
 *
 * ASCII-ONLY (see test/arabic-guard.test.js).
 */
(function () {
  "use strict";
  var BASE = "/fonts/qcf-v2/", fonts = {}, tableP = null, io = null, mo = null;

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
          f.load().then(function (x) { document.fonts.add(x); res(true); }, function () { res(false); });
        } catch (e) { res(false); }
      });
    }
    return fonts[page];
  }

  function load(pages) {
    var list = (pages || []).map(Number).filter(function (p) { return p > 0; });
    return Promise.all(list.map(font)).then(function (ok) { return ok.every(Boolean); });
  }

  function pagesOf(el) { return String(el.getAttribute("data-p") || "").split(/\s+/).filter(Boolean); }

  function swap(el) {
    if (el.__qcf) return;
    el.__qcf = 1;
    load(pagesOf(el)).then(function (ok) {
      if (!ok) return; // stays on Hafs v22
      el.classList.add("on");
      try { document.dispatchEvent(new Event("qcf")); } catch (e) {}
    });
  }

  function watch(el) {
    if (el.__qcfw) return;
    el.__qcfw = 1;
    if (io) io.observe(el); else swap(el);
  }

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
    }).replace(/[ \t]+/g, " ").trim();
    ev.clipboardData.setData("text/plain", t);
    ev.preventDefault();
  });

  window.QCFDom = { table: table, load: load, ready: load, scan: scan, BASE: BASE };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { scan(); });
  else scan();
})();
