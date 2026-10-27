/*
 * normalize-parity.test.js
 *  - the shared copy (shared/normalize.js) of the Arabic normalizer must behave identically
 *    to the shared src/utils/normalize.js (guards against drift);
 *  - every word reference stored in challenge.json must resolve to a real word
 *    in words.json, using the same matching the client uses.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const src = require('../src/utils/normalize');
const fn = require('../shared/normalize');

const NAMES =
  'النبأ النازعات عبس التكوير الانفطار المطففين الانشقاق البروج الطارق الأعلى الغاشية الفجر البلد الشمس الليل الضحى الشرح التين العلق القدر البينة الزلزلة العاديات القارعة التكاثر العصر الهمزة الفيل قريش الماعون الكوثر الكافرون النصر المسد الإخلاص الفلق الناس'.split(
    ' '
  );

test('the two Arabic normalizers behave identically', () => {
  const corpus = [
    'شَانِئَكَ',
    'الْأَبْتَرُ',
    'التَّرَائِبِ',
    'تُبْلَى السَّرَائِرُ',
    'قُرْآن',
    'مسؤول',
    'إِيلَافِهِمْ',
    '١٢٣',
    '  spaces   here  ',
    '',
  ];
  corpus.forEach((s) => {
    assert.strictEqual(fn.normalizeArabic(s), src.normalizeArabic(s), 'mismatch for ' + JSON.stringify(s));
  });
});

test('every challenge word reference resolves to a real word', (t) => {
  const wordsPath = path.join(ROOT, 'public', 'words.json');
  const challengePath = path.join(ROOT, 'public', 'challenge.json');
  if (!fs.existsSync(wordsPath) || !fs.existsSync(challengePath)) {
    t.skip('words.json / challenge.json not present');
    return;
  }
  const words = JSON.parse(fs.readFileSync(wordsPath, 'utf8'));
  const challenge = JSON.parse(fs.readFileSync(challengePath, 'utf8'));

  const NUM = {};
  NAMES.forEach((n, i) => {
    NUM[src.normalizeArabic(n)] = 78 + i;
  });

  const keys = new Set();
  words.forEach((e) => {
    const no = NUM[src.normalizeArabic(e.surah.replace(/^سورة\s*/, ''))] || 0;
    e.words.forEach((w) => keys.add(no + '::' + src.normalizeArabic(w)));
  });

  const missing = [];
  (challenge.days || []).forEach((d) => {
    (d.w || []).forEach((ref) => {
      if (!keys.has(String(ref[0]) + '::' + src.normalizeArabic(ref[1]))) missing.push({ day: d.d, ref });
    });
  });
  assert.deepStrictEqual(missing, []);
});
