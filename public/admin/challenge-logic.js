/*
 * challenge-logic.js - browser-side mirror of the pure challenge logic in
 * shared/challenge.js (rouletteSelect + validateDayReferences).
 *
 * The free (Spark) plan runs no Cloud Functions, so the admin Challenge tab
 * does its own work in the browser and writes Firestore directly (admin-only
 * rules). This module keeps that browser logic identical to shared/challenge.js;
 * test/challenge-logic-parity.test.js asserts the two never drift.
 *
 * Same pattern as src/utils/normalize.js + shared/normalize.js: the shared
 * logic is duplicated deliberately, and a parity test guards against drift.
 *
 * ASCII-ONLY (see test/arabic-guard.test.js): Arabic UI strings are \u escapes.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ChallengeLogic = api;
})(typeof window !== "undefined" ? window : null, function () {
  "use strict";

  function normalizeState(state) {
    var src = state && typeof state === "object" ? state : {};
    return {
      startDate: typeof src.startDate === "string" ? src.startDate : null,
      releasedUpTo: src.releasedUpTo == null ? null : Number(src.releasedUpTo),
      days: Array.isArray(src.days) ? src.days.slice() : [],
    };
  }

  /**
   * Client-side roulette selection. Mirrors shared/challenge.js exactly:
   * pure, injectable random, never mutates the pool, empty pool returns null.
   */
  function rouletteSelect(pool, opts) {
    var options = opts || {};
    var list = Array.isArray(pool) ? pool : [];
    if (!list.length) return null;
    var rand = typeof options.random === "function" ? options.random : Math.random;
    var avoid = options.avoid;
    var keyOf = function (v) {
      return Array.isArray(v) ? v[0] + "::" + v[1] : v;
    };
    var avoidKey = avoid == null ? null : keyOf(avoid);
    var candidates = [];
    for (var i = 0; i < list.length; i++) {
      if (list.length > 1 && avoidKey != null && keyOf(list[i]) === avoidKey) continue;
      candidates.push(i);
    }
    var pickPool = candidates.length ? candidates : list.map(function (_, j) { return j; });
    var r = rand();
    var safe = Number.isFinite(r) ? Math.min(0.9999999, Math.max(0, r)) : 0;
    var idx = pickPool[Math.floor(safe * pickPool.length)];
    return {
      index: idx,
      value: list[idx],
      spinId: (options.spinId != null ? options.spinId : "") + ":" + idx,
    };
  }

  /**
   * Validate that every word reference in every day resolves against the data.
   * Mirrors shared/challenge.js validateDayReferences (replaces the old
   * server-side check now that the admin writes Firestore directly).
   */
  function validateDayReferences(state, resolve) {
    var s = normalizeState(state);
    var problems = [];
    s.days.forEach(function (day) {
      (Array.isArray(day.w) ? day.w : []).forEach(function (ref, i) {
        var ok = typeof resolve === "function" ? resolve(ref) : true;
        if (!ok) problems.push({ day: Number(day.d), index: i, ref: ref });
      });
    });
    return problems;
  }

  /**
   * Wire-shape helpers for the challenge `days` array.
   *
   * Firestore forbids nested arrays, so the day word references are stored as
   * objects `{ no, word }` (see src/utils/migrate.js buildFirestoreChallenge).
   * The admin UI works with tuples `[no, word]` (r[0] / r[1], rouletteSelect,
   * validateDayReferences). toTuples() normalises the stored form for the UI
   * (and passes tuples through unchanged, so demo/localStorage keeps working);
   * toObjects() is the inverse used right before writing back to Firestore.
   */
  function refToTuple(r) {
    if (Array.isArray(r)) return [r[0], r[1]];
    return [r && r.no, r && r.word];
  }

  function refToObject(r) {
    if (Array.isArray(r)) return { no: r[0], word: r[1] };
    return { no: r && r.no, word: r && r.word };
  }

  function toTuples(days) {
    return (Array.isArray(days) ? days : []).map(function (d) {
      return {
        d: d && d.d,
        w: (d && Array.isArray(d.w) ? d.w : []).map(refToTuple),
        reel: (d && d.reel) || "",
      };
    });
  }

  function toObjects(days) {
    return (Array.isArray(days) ? days : []).map(function (d) {
      return {
        d: d && d.d,
        w: (d && Array.isArray(d.w) ? d.w : []).map(refToObject),
        reel: (d && d.reel) || "",
      };
    });
  }

  return {
    normalizeState: normalizeState,
    rouletteSelect: rouletteSelect,
    validateDayReferences: validateDayReferences,
    toTuples: toTuples,
    toObjects: toObjects,
    // UI strings (escaped so this file stays ASCII-only).
    SPIN_LABEL: "\u0627\u0633\u062d\u0628 \u0643\u0644\u0645\u0629",
    NOTE:
      "\u062a\u0638\u0647\u0631 \u0627\u0644\u062a\u0639\u062f\u064a\u0644\u0627\u062a \u0639\u0644\u0649 " +
      "\u0635\u0641\u062d\u0627\u062a \u0627\u0644\u0643\u0644\u0645\u0627\u062a \u062e\u0644\u0627\u0644 " +
      "15 \u062f\u0642\u064a\u0642\u0629 \u062a\u0642\u0631\u064a\u0628\u064b\u0627\u060c " +
      "\u0648\u064a\u0638\u0647\u0631\u0647\u0627 \u0627\u0644\u062a\u0637\u0628\u064a\u0642 \u0641\u0648\u0631\u064b\u0627.",
  };
});
