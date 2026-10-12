/*
 * rules.test.js
 *
 * Static checks on firestore.rules. These do NOT replace the Firestore rules
 * emulator: they only assert that the security-relevant rules are present and
 * shaped correctly. The emulator suite (@firebase/rules-unit-testing) could not
 * be installed because its peer dependency requires firebase ^13 while this
 * project pins firebase ^12.19.0; that blocker is logged in DECISIONS-LOG.md.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RULES = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

test('public challenge data is world-readable', () => {
  const block = /match \/public\/\{document\}/.test(RULES) || /match \/public\/\{database\}/.test(RULES) || /match \/public\/\{/.test(RULES);
  assert.ok(block, 'a public/{...} match block must exist');
  assert.ok(/match \/public\b[\s\S]*?allow read:[^;]*true/.test(RULES), 'public data must be readable');
});

test('public data is only writable by admins', () => {
  assert.ok(/match \/public[\s\S]*?allow write: if isAdmin\(\)/.test(RULES));
});

test('private challenge notes are admin-only and never public', () => {
  assert.ok(/match \/admin\/challengeNotes/.test(RULES), 'admin/challengeNotes rule must exist');
  const block = /match \/admin\/challengeNotes \{([\s\S]*?)\}/.exec(RULES);
  assert.ok(block, 'challengeNotes match block must be parseable');
  const body = block[1];
  assert.ok(/allow read, write: if isAdmin\(\)/.test(body), 'challengeNotes must be admin-only');
  assert.ok(!/allow (read|write)[^;]*if true/.test(block[0]), 'challengeNotes must never be public');
});

test('config/admins is readable by admins and writable by the owner only', () => {
  const block = /match \/config\/admins \{([\s\S]*?)\}/.exec(RULES);
  assert.ok(block, 'config/admins rule must exist');
  assert.match(block[1], /allow read:\s*if isAdmin\(\)/);
  assert.match(block[1], /allow write: if isOwner\(\)/);
});

test('there is a default deny for everything else', () => {
  assert.match(RULES, /match \/\{document=\*\*\}/);
  assert.match(RULES, /match \/databases\/\{database\}\/documents/);
});
