const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeArabic } = require('../src/utils/normalize');

test('unifies alef', () => {
  assert.strictEqual(normalizeArabic('\u0622\u0623\u0625'), '\u0627\u0627\u0627');
});


test('basic normalization works', () => {
  assert.strictEqual(normalizeArabic('\u0625\u0646'), '\u0627\u0646');
  assert.strictEqual(normalizeArabic('\u0622'), '\u0627');
});

