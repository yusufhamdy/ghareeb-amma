/*
 * migrate.js - shared Firestore migration helpers.
 *
 * The authoritative Mushaf ORDER for Juz Amma (surah 78..114). Word-for-word
 * identical to the list in functions/index.js, public/index.html (NAMES) and
 * public/admin/index.html (fix), so the `no` field computed here matches the
 * number the client, the seo function and the admin fall back to.
 */
const SURAH_ORDER = "النبأ,النازعات,عبس,التكوير,الانفطار,المطففين,الانشقاق,البروج,الطارق,الأعلى,الغاشية,الفجر,البلد,الشمس,الليل,الضحى,الشرح,التين,العلق,القدر,البينة,الزلزلة,العاديات,القارعة,التكاثر,العصر,الهمزة,الفيل,قريش,الماعون,الكوثر,الكافرون,النصر,المسد,الإخلاص,الفلق,الناس".split(",");

/** Derive the Mushaf surah number for a surah name: 78 + position in Juz Amma order. */
function deriveSurahNo(name) {
  const clean = String(name || "").replace(/^سورة\s*/, "").trim();
  const idx = SURAH_ORDER.indexOf(clean);
  return idx >= 0 ? 78 + idx : null;
}

/**
 * Return a NEW array of surahs, each with a numeric `no` derived from the
 * authoritative Mushaf ORDER, sorted ascending by `no`. The source JSON never
 * carries `no` today; the migration adds it once, here.
 */
function migrateSurahs(words) {
  if (!Array.isArray(words)) return [];
  const out = words.map((e) => {
    const no = deriveSurahNo(e && e.surah);
    if (no == null) {
      throw new Error("Unknown surah name in source data: " + (e && e.surah));
    }
    return Object.assign({}, e, { no });
  });
  out.sort((a, b) => a.no - b.no);
  return out;
}

/** Build the Firestore `public/data` document shape: { rev, surahs }. */
function buildFirestoreData(words, opts) {
  const o = opts || {};
  return { rev: o.rev == null ? 1 : o.rev, surahs: migrateSurahs(words) };
}

/**
 * Build the Firestore `public/challenge` document shape.
 *
 * Firestore forbids arrays inside arrays, so the tuple refs `[surahNo, word]`
 * of the JSON baseline (and of data/challenge.json) are stored as objects
 * `{ no, word }` in Firestore. Readers (client loader, admin store layer)
 * normalize the object form back to tuples. The JSON baseline and the admin
 * "export challenge.json" action keep the tuple form.
 */
function buildFirestoreChallenge(challenge) {
  const c = challenge == null ? {} : challenge;
  return {
    startDate: c.startDate == null ? null : c.startDate,
    releasedUpTo: c.releasedUpTo == null ? null : c.releasedUpTo,
    days: (Array.isArray(c.days) ? c.days : []).map((d) => ({
      d: (d && d.d) || 0,
      w: (d && Array.isArray(d.w) ? d.w : []).map((u) => {
        if (Array.isArray(u)) return { no: u[0], word: u[1] };
        return { no: u && u.no, word: u && u.word };
      }),
      reel: (d && d.reel) || "",
    })),
  };
}

/** True when a plain object/array tree contains an array directly inside an array. */
function hasArrayOfArrays(node) {
  if (Array.isArray(node)) {
    if (node.some((v) => Array.isArray(v))) return true;
    return node.some((v) => v && typeof v === "object" && hasArrayOfArrays(v));
  }
  if (node && typeof node === "object") {
    return Object.values(node).some((v) => v && typeof v === "object" && hasArrayOfArrays(v));
  }
  return false;
}

module.exports = { SURAH_ORDER, deriveSurahNo, migrateSurahs, buildFirestoreData, buildFirestoreChallenge, hasArrayOfArrays };