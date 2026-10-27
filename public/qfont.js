/* qfont.js - guard for the Quran text face, KFGQPC Uthmanic Hafs v22 (fonts.css; loaded right after it).
   The stored ayah text uses the KFGQPC Hafs encoding of the open tanween (U+0657, U+065E, U+0656), which only that
   face draws correctly; the .q stack falls back to Amiri Quran, which shows U+065E as an empty box and the other two
   as different marks. If the face fails to load (blocked, or offline on a first visit), or has not loaded when the
   browser's 3s font block period ends, <html> gets the class "qf" and the text of .q elements is shown with the
   standard code points U+08F0, U+08F1, U+08F2, which Amiri Quran draws correctly. This is display only: form fields
   are never touched and stored data never changes. If the face loads later, the text and the class are restored.
   window.qText(s) applies the same mapping to text drawn elsewhere (the save-image canvas). A "qfont" event on
   document follows every switch, so measurements (word-gap.js) can be redone. */
(function () {
  var FAMILY = 'KFGQPC Uthmanic Hafs', BLOCK_MS = 3000;
  var TO = { 'ٗ': 'ࣰ', 'ٞ': 'ࣱ', 'ٖ': 'ࣲ' }, FROM = { 'ࣰ': 'ٗ', 'ࣱ': 'ٞ', 'ࣲ': 'ٖ' };
  var RE_TO = /[ٖٗٞ]/g, RE_FROM = /[ࣰ-ࣲ]/g, off = false, mo = null, settled = false;

  function qText(s) { return off ? String(s).replace(RE_TO, function (c) { return TO[c]; }) : String(s); }
  window.qText = qText;

  function inQ(n) {
    var e = n.nodeType === 1 ? n : n.parentElement;
    return !!(e && e.closest && e.closest('.q') && !e.closest('input,textarea,select,[contenteditable]'));
  }
  function one(n, re, map) {
    re.lastIndex = 0;
    if (re.test(n.data) && inQ(n)) n.data = n.data.replace(re, function (c) { return map[c]; });
    re.lastIndex = 0;
  }
  function remap(root, re, map) {
    if (!root) return;
    if (root.nodeType === 3) { one(root, re, map); return; }
    if (root.nodeType !== 1) return;
    var w = document.createTreeWalker(root, 4), n;
    while ((n = w.nextNode())) one(n, re, map);
  }
  function tell() { try { document.dispatchEvent(new Event('qfont')); } catch (e) {} }
  function fallback() {
    if (off) return;
    off = true;
    document.documentElement.classList.add('qf');
    var go = function () {
      if (!off) return;
      remap(document.body, RE_TO, TO);
      if (!mo && window.MutationObserver) {
        mo = new MutationObserver(function (list) {
          list.forEach(function (m) {
            if (m.type === 'characterData') remap(m.target, RE_TO, TO);
            else for (var i = 0; i < m.addedNodes.length; i++) remap(m.addedNodes[i], RE_TO, TO);
          });
        });
        mo.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
      }
      tell();
    };
    if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
  }
  function restore() {
    if (!off) return;
    off = false;
    if (mo) { mo.disconnect(); mo = null; }
    document.documentElement.classList.remove('qf');
    remap(document.body, RE_FROM, FROM);
    tell();
  }

  var face = null;
  try { document.fonts.forEach(function (f) { if (f.family.replace(/["']/g, '') === FAMILY) face = f; }); } catch (e) {}
  if (!face || !face.load) { fallback(); return; }
  var timer = setTimeout(function () { if (!settled) fallback(); }, BLOCK_MS);
  face.load().then(function () { settled = true; clearTimeout(timer); restore(); },
    function () { settled = true; clearTimeout(timer); fallback(); });
})();
