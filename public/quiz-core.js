/*
 * quiz-core.js - pure, dependency-free quiz helpers shared by the app (loaded
 * as a classic script, exposing window.QCORE) and by Node tools/tests (which
 * require() it as a CommonJS module).
 *
 * ASCII-only on purpose: test/arabic-guard.test.js treats any file containing
 * Arabic code points as protected content (see the note in functions/seo.js),
 * so keeping this file ASCII lets it evolve without touching protected runs.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.QCORE = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Byte-for-byte the same normalisation as the app's inline norm() (index.html).
  function nrm(s) {
    return String(s == null ? "" : s)
      .replace(/[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
      .replace(/[\u0623\u0625\u0622\u0671]/g, "\u0627")
      .replace(/\u0649/g, "\u064A")
      .replace(/\u0629/g, "\u0647")
      .replace(/\u0624/g, "\u0648")
      .replace(/\u0626/g, "\u064A")
      .replace(/\s+/g, " ")
      .trim();
  }

  // Normalised word tokens: "shared vocabulary" is measured on these.
  function toks(s) {
    return nrm(s).split(" ").filter(Boolean);
  }

  // How many tokens the two meanings have in common.
  function overlap(a, b) {
    var A = toks(a), B = toks(b), set = {}, n = 0, i;
    for (i = 0; i < B.length; i++) set[B[i]] = 1;
    for (i = 0; i < A.length; i++) if (set[A[i]]) { n++; set[A[i]] = 0; }
    return n;
  }

  // ASCII surah slug -> surah number, limited to the surahs that actually
  // appear in public/words.json. Derived from the app's NAMES order
  // (index.html) and the slug table in functions/seo.js.
  var SURAH_NO = {
    "an-naba": 78,
    "an-naziat": 79,
    "abasa": 80,
    "at-takwir": 81,
    "al-mutaffifin": 83,
    "al-inshiqaq": 84,
    "at-tariq": 86,
    "al-ala": 87,
    "al-ghashiyah": 88,
    "al-fajr": 89,
    "al-balad": 90,
    "ash-shams": 91,
    "al-layl": 92,
    "ad-duha": 93,
    "ash-sharh": 94,
    "al-alaq": 96,
    "al-bayyinah": 98,
    "az-zalzalah": 99,
    "al-adiyat": 100,
    "al-qariah": 101,
    "al-humazah": 104,
    "al-fil": 105,
    "quraysh": 106,
    "al-maun": 107,
    "al-kawthar": 108,
    "al-ikhlas": 112,
    "al-falaq": 113,
    "an-nas": 114
  };

  // Flat word pool built from the raw public/words.json entries, in exactly the
  // order (and with exactly the ids) the app uses: per surah, sorted by ayah
  // number, id = "<surah>-<index>". numOf(rawSurahString) -> surah number.
  function buildPool(entries, numOf) {
    var out = [];
    (entries || []).forEach(function (e) {
      var num = numOf ? numOf(e.surah) : 0;
      var items = [];
      (e.words || []).forEach(function (word, i) {
        var m = (e.meanings || [])[i] || "";
        var c = m.indexOf(":");
        if (c > 0 && c < 60 && nrm(m.slice(0, c)) === nrm(word)) m = m.slice(c + 1).trim();
        var a = (e.ayahs || [])[i] || (e.ayahs || [])[0] || {};
        var seg = (a.segments || [])[0] || {};
        items.push({ word: word, mean: m, km: nrm(m), k: nrm(word), n: +seg.num || 0 });
      });
      items.sort(function (a, b) { return a.n - b.n; });
      items.forEach(function (it, i) {
        out.push({ id: num + "-" + i, sn: num, sname: e.surah, word: it.word, mean: it.mean, km: it.km, k: it.k, n: it.n });
      });
    });
    return out;
  }

  // A pool entry's surah number, whichever shape it comes in (the app's W items
  // carry it as .s.num, buildPool() entries as .sn).
  function snOf(x) {
    return (x && (x.sn != null ? x.sn : x.s && x.s.num)) || 0;
  }

  // Unbiased Fisher-Yates shuffle (sort(() => Math.random() - .5) is not uniform).
  function shuffle(a, rand) {
    rand = rand || Math.random;
    var out = (a || []).slice(), i, j, t;
    for (i = out.length - 1; i > 0; i--) {
      j = Math.floor(rand() * (i + 1));
      t = out[i]; out[i] = out[j]; out[j] = t;
    }
    return out;
  }

  // Pick up to k wrong options for word t out of the pool. Candidates are always
  // real meanings of other words and are never equal to, contain, or be
  // contained in the correct meaning.
  function pickDistractors(t, pool, k, rand) {
    k = k || 3;
    rand = rand || Math.random;
    var tk = nrm(t && t.mean), tl = tk.length, tn = snOf(t);
    var seen = {}, cand = [];
    (pool || []).forEach(function (x) {
      if (!x || x.id === (t && t.id)) return;
      var km = nrm(x.mean);
      if (!km || seen[km]) return;
      if (km === tk || km.indexOf(tk) >= 0 || tk.indexOf(km) >= 0) return;
      seen[km] = 1;
      cand.push(x);
    });
    if (!cand.length) return [];
    // (a) prefer meanings of a similar length; widen the window only when too
    // few candidates qualify (very short / very long meanings).
    var usable = null, i;
    [0.25, 0.5].forEach(function (w) {
      if (usable) return;
      var s = cand.filter(function (x) { return Math.abs(nrm(x.mean).length - tl) <= w * tl; });
      if (s.length >= k) usable = s;
    });
    if (!usable) usable = cand;
    // (b) weight by shared vocabulary first, then by how close the surah is.
    var left = usable.slice(), wts = usable.map(function (x) {
      return (1 + 3 * overlap(tk, x.mean)) / (1 + 0.25 * Math.abs(snOf(x) - tn));
    });
    var out = [];
    while (out.length < k && left.length) {
      var total = 0;
      for (i = 0; i < wts.length; i++) total += wts[i];
      var r = rand() * total, idx = wts.length - 1;
      for (i = 0; i < wts.length; i++) { r -= wts[i]; if (r <= 0) { idx = i; break; } }
      out.push(left[idx]);
      left.splice(idx, 1); wts.splice(idx, 1);
    }
    return out;
  }

  return {
    nrm: nrm,
    toks: toks,
    overlap: overlap,
    SURAH_NO: SURAH_NO,
    buildPool: buildPool,
    shuffle: shuffle,
    pickDistractors: pickDistractors
  };
});
