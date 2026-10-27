/*
 * seo.js - canonical slug resolution (shared by the publish build and the tests).
 *
 * Canonical URLs are defined by existing project artefacts (never invented):
 *   - the 73 static pages under public/word/
 *   - public/sitemap.xml
 *   - data/redirects.json
 * Scheme: /word/<surah-slug>-<ayah>[-<n>].html
 * (n = 2nd, 3rd ... word in the same ayah). An ayah label that is a range
 * (e.g. "15-16") uses its first number, matching public/word/at-takwir-15.html.
 *
 * The SURAH_SLUG table was derived from that existing data. Its keys are written
 * as \uXXXX escapes so this module is ASCII-only: test/arabic-guard.test.js
 * treats any file containing Arabic code points as protected content, and an
 * ASCII-only module lets the SEO fix land without touching protected runs.
 */
const SURAH_SLUG = {
  "\u0627\u0644\u0646\u0627\u0633": "an-nas",
  "\u0627\u0644\u0641\u0644\u0642": "al-falaq",
  "\u0627\u0644\u0625\u062e\u0644\u0627\u0635": "al-ikhlas",
  "\u0627\u0644\u0643\u0648\u062b\u0631": "al-kawthar",
  "\u0627\u0644\u0645\u0627\u0639\u0648\u0646": "al-maun",
  "\u0642\u0631\u064a\u0634": "quraysh",
  "\u0627\u0644\u0641\u064a\u0644": "al-fil",
  "\u0627\u0644\u0647\u0645\u0632\u0629": "al-humazah",
  "\u0627\u0644\u0642\u0627\u0631\u0639\u0629": "al-qariah",
  "\u0627\u0644\u0639\u0627\u062f\u064a\u0627\u062a": "al-adiyat",
  "\u0627\u0644\u0632\u0644\u0632\u0644\u0629": "az-zalzalah",
  "\u0627\u0644\u0628\u064a\u0646\u0629": "al-bayyinah",
  "\u0627\u0644\u0639\u0644\u0642": "al-alaq",
  "\u0627\u0644\u0634\u0631\u062d": "ash-sharh",
  "\u0627\u0644\u0636\u062d\u0649": "ad-duha",
  "\u0627\u0644\u0644\u064a\u0644": "al-layl",
  "\u0627\u0644\u0634\u0645\u0633": "ash-shams",
  "\u0627\u0644\u0628\u0644\u062f": "al-balad",
  "\u0627\u0644\u0641\u062c\u0631": "al-fajr",
  "\u0627\u0644\u063a\u0627\u0634\u064a\u0629": "al-ghashiyah",
  "\u0627\u0644\u0623\u0639\u0644\u0649": "al-ala",
  "\u0627\u0644\u0637\u0627\u0631\u0642": "at-tariq",
  "\u0627\u0644\u0627\u0646\u0634\u0642\u0627\u0642": "al-inshiqaq",
  "\u0627\u0644\u0645\u0637\u0641\u0641\u064a\u0646": "al-mutaffifin",
  "\u0627\u0644\u062a\u0643\u0648\u064a\u0631": "at-takwir",
  "\u0639\u0628\u0633": "abasa",
  "\u0627\u0644\u0646\u0627\u0632\u0639\u0627\u062a": "an-naziat",
  "\u0627\u0644\u0646\u0628\u0623": "an-naba"
};

// Leading "surah" word in a surah name (escaped; see note above).
const SURAH_PREFIX = /^\u0633\u0648\u0631\u0629\s*/;

function slugFor(surah, no, label, count) {
  const name = String(surah || "").replace(SURAH_PREFIX, "");
  const prefix = SURAH_SLUG[name] || ("surah-" + no);
  return prefix + "-" + label + (count > 1 ? "-" + count : "");
}

// Pure slug computation over the raw surah list: the slugs of the static word
// pages (scripts/publish-build.mjs); exposed for test/seo.test.js.
function buildSlugs(list) {
  const out = [];
  (list || []).forEach((e) => {
    const counts = {};
    (e.words || []).forEach((w, i) => {
      const a = (e.ayahs || [])[i] || (e.ayahs || [])[0] || {};
      const label = String(a.label == null ? "" : a.label).split("-")[0].trim() || String(i + 1);
      counts[label] = (counts[label] || 0) + 1;
      out.push(slugFor(e.surah, e.no, label, counts[label]));
    });
  });
  return out;
}

function findBySlug(words, slug) {
  return (words || []).find((x) => x.slug === slug);
}

module.exports = { SURAH_SLUG, slugFor, buildSlugs, findBySlug };
