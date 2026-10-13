/*
 * data-migration.test.js
 *
 * Verifies the Firestore MIGRATION artifacts WITHOUT touching the emulator:
 *  - the shared migrate utility derives the Mushaf `no` for every surah from
 *    the authoritative Juz Amma ORDER used by the client, admin and seo function
 *  - the 30-day challenge joins perfectly against the migrated data (73 words)
 *  - the canonical English slug set (sitemap + redirects) stays consistent
 *    with the static word pages (one page per slug, no stale pages)
 *
 * The emulator-run proofs (rules lab + seeded client reads) are separate:
 * see test/rules-emulator.test.js and scripts/verify-client-firestore.mjs.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const { normalizeArabic } = require('../src/utils/normalize');
const { SURAH_ORDER, deriveSurahNo, buildFirestoreData, buildFirestoreChallenge, hasArrayOfArrays } = require('../src/utils/migrate');

const words = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/words.json'), 'utf8'));
const challenge = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/challenge.json'), 'utf8'));

test('migration adds a Mushaf `no` to every surah (28 surahs, 73 words, unique 78..114 ascending)', () => {
  const doc = buildFirestoreData(words);
  assert.strictEqual(doc.surahs.length, 28, 'expected 28 surahs in Juz Amma data');
  const nos = doc.surahs.map((s) => s.no);
  assert.ok(nos.every((n) => Number.isInteger(n) && n >= 78 && n <= 114), 'every no must be an integer in 78..114');
  assert.strictEqual(new Set(nos).size, 28, 'surah numbers must be unique');
  assert.deepStrictEqual(nos, [...nos].sort((a, b) => a - b), 'surahs must be ordered ascending by no');
  assert.strictEqual(nos[0], 78, 'first surah must be 78 (النبأ)');
  assert.strictEqual(nos[nos.length - 1], 114, 'last surah must be 114 (الناس)');
  const wordCount = doc.surahs.reduce((n, s) => n + (s.words || []).length, 0);
  assert.strictEqual(wordCount, 73, 'expected 73 words in the migrated data');
  assert.ok(doc.surahs.every((s) => typeof s.words === 'object' && typeof s.meanings === 'object' && typeof s.ayahs === 'object' && typeof s.source === 'string'), 'every surah keeps words/meanings/ayahs/source shape');
  assert.ok(doc.surahs.every((s) => s.words.length === s.meanings.length), 'words and meanings stay parallel by index');
});

test('deriveSurahNo matches the authoritative ORDER (client/admin/seo shared list)', () => {
  assert.strictEqual(SURAH_ORDER.length, 37, 'Juz Amma order must cover surahs 78..114');
  SURAH_ORDER.forEach((name, i) => assert.strictEqual(deriveSurahNo(name), 78 + i, `order position ${i} must map to ${78 + i}`));
  assert.strictEqual(deriveSurahNo('سورة الناس'), 114);
  assert.strictEqual(deriveSurahNo('سورة الفلق'), 113);
  assert.strictEqual(deriveSurahNo('الناس'), 114);
  assert.strictEqual(deriveSurahNo('سورة البقرة'), null, 'non-Juz-surah names must return null');
});

test('the seo function ORDER and the client NAMES never drift from migrate util', () => {
  const fns = fs.readFileSync(path.join(ROOT, 'functions/index.js'), 'utf8');
  const idx = fs.readFileSync(path.join(ROOT, 'public/index.html'), 'utf8');
  const mOrder = /const ORDER = "([^"]+)"/.exec(fns);
  const mNames = /const NAMES='([^']+)'\.split\(' '\)/.exec(idx);
  assert.ok(mOrder && mNames, 'must find ORDER in functions/index.js and NAMES in public/index.html');
  assert.deepStrictEqual(
    mOrder[1].split(','),
    SURAH_ORDER,
    'functions ORDER must equal migrate SURAH_ORDER',
  );
  assert.deepStrictEqual(
    mNames[1].split(' '),
    SURAH_ORDER,
    'client NAMES must equal migrate SURAH_ORDER',
  );
});

test('every challenge reference (30 days, 73 refs) resolves against the migrated data', () => {
  const doc = buildFirestoreData(words);
  const keys = new Set();
  doc.surahs.forEach((s) => (s.words || []).forEach((w) => keys.add(s.no + '::' + normalizeArabic(w))));
  assert.strictEqual(keys.size, 73, 'migrated data must expose 73 unique no::word keys');

  const refs = new Set();
  let total = 0;
  challenge.days.forEach((d) => (d.w || []).forEach((ref) => {
    total += 1;
    refs.add(Number(ref[0]) + '::' + normalizeArabic(ref[1]));
  }));
  assert.strictEqual(total, 73, 'challenge must reference 73 words in total');
  assert.strictEqual(refs.size, 73, 'challenge references must be unique');

  const missing = [...refs].filter((r) => !keys.has(r));
  assert.deepStrictEqual(missing, [], 'every challenge reference must resolve against migrated data');
  const extra = [...keys].filter((k) => !refs.has(k));
  assert.deepStrictEqual(extra, [], 'every migrated word must be assigned to exactly one challenge day');

  const surahNos = new Set(doc.surahs.map((s) => s.no));
  const unknown = challenge.days.flatMap((d) => d.w || []).filter((ref) => !surahNos.has(Number(ref[0])));
  assert.deepStrictEqual(unknown, [], 'challenge refs must only use existing surah numbers');
});

test('canonical slugs from sitemap match the static word pages one-to-one', () => {
  const sitemap = fs.readFileSync(path.join(ROOT, 'public/sitemap.xml'), 'utf8');
  const locs = [...sitemap.matchAll(/<loc>https:\/\/ghareebalquran\.com\/word\/([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.strictEqual(locs.length, 73, 'sitemap must list exactly the 73 canonical word pages');
  assert.strictEqual(new Set(locs).size, 73, 'canonical slugs must be unique');

  const files = fs.readdirSync(path.join(ROOT, 'public/word')).filter((f) => f.endsWith('.html'));
  assert.strictEqual(files.length, 73, `public/word must contain exactly the 73 canonical pages, found ${files.length} — stale/non-canonical pages must be removed (T5 hygiene)`);
  for (const slug of locs) {
    assert.ok(files.includes(slug), `missing static page for canonical slug ${slug}`);
  }
});

test('Firestore payloads never contain arrays inside arrays (data + challenge)', () => {
  const dataDoc = buildFirestoreData(words);
  const chDoc = buildFirestoreChallenge(challenge);
  assert.strictEqual(hasArrayOfArrays(dataDoc), false, 'public/data must be Firestore-representable');
  assert.strictEqual(hasArrayOfArrays(chDoc), false, 'public/challenge must be Firestore-representable');
  // The JSON baseline intentionally uses tuple refs [surahNo, word] (array of arrays).
  assert.strictEqual(hasArrayOfArrays(challenge), true, 'JSON baseline uses array-of-array tuple refs by design');
});

test('buildFirestoreChallenge stores refs as objects and round-trips to tuples', () => {
  const chDoc = buildFirestoreChallenge(challenge);
  assert.strictEqual(chDoc.days.length, 30, 'challenge keeps 30 days');
  assert.deepStrictEqual(Object.keys(chDoc), ['startDate', 'releasedUpTo', 'days']);
  // every day keeps d/reel and stores w as plain { no, word } objects
  chDoc.days.forEach((d, i) => {
    assert.strictEqual(d.d, challenge.days[i].d);
    assert.strictEqual(d.reel, challenge.days[i].reel);
    assert.ok(Array.isArray(d.w) && d.w.every((u) => u && typeof u === 'object' && !Array.isArray(u)),
      `day ${d.d} w refs must be objects`);
  });
  // round-trip objects -> tuples equals the baseline exactly
  const back = chDoc.days.map((d) => ({ d: d.d, w: d.w.map((r) => [r.no, r.word]), reel: d.reel }));
  assert.deepStrictEqual(back, challenge.days.map((d) => ({ d: d.d, w: d.w, reel: d.reel })));
});

test('every redirect (71 legacy Arabic URLs) targets an existing canonical slug', () => {
  const redirects = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/redirects.json'), 'utf8'));
  const dest = Object.values(redirects).map((s) => s + '.html');
  assert.strictEqual(dest.length, 71, 'expected 71 legacy redirects');
  const slugs = new Set([...fs.readFileSync(path.join(ROOT, 'public/sitemap.xml'), 'utf8').matchAll(/<loc>https:\/\/ghareebalquran\.com\/word\/([^<]+)<\/loc>/g)].map((m) => m[1]));
  const broken = dest.filter((d) => !slugs.has(d));
  assert.deepStrictEqual(broken, [], 'all redirect destinations must be canonical slugs');
});