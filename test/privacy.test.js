/*
 * privacy.test.js - guarantees the owner-only day notes never leak into the
 * built site or the public function sources.
 *
 * The private notes live in data/challenge-notes-private.json, which is
 * gitignored and must never be committed, deployed, or served. This test:
 *   1. confirms the private file is git-ignored and not tracked by git;
 *   2. scans public/ and functions/ for any private note text;
 *   3. confirms the public API shape drops notes for non-admins.
 *
 * If the private file is absent (e.g. on CI), the content scan is skipped but
 * the ignore/tracking assertions still run.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const PRIVATE = path.join(ROOT, 'data', 'challenge-notes-private.json');
const REL = path.join('data', 'challenge-notes-private.json');

function walk(dir, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  entries.forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.name === 'node_modules' || entry.name === '.git') return;
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  });
  return out;
}

test('private notes file is git-ignored and not tracked', () => {
  let ignored = false;
  try {
    execFileSync('git', ['check-ignore', REL], { cwd: ROOT });
    ignored = true;
  } catch (e) {
    ignored = false;
  }
  assert.strictEqual(ignored, true, REL + ' must be gitignored');

  let tracked = '';
  try {
    tracked = execFileSync('git', ['ls-files', REL], { cwd: ROOT }).toString().trim();
  } catch (e) {
    tracked = '';
  }
  assert.strictEqual(tracked, '', 'the private notes file must not be tracked by git');
});

test('no private note text appears under public/ or functions/', (t) => {
  if (!fs.existsSync(PRIVATE)) {
    t.skip('private notes file is not present locally');
    return;
  }
  let notes;
  try {
    notes = JSON.parse(fs.readFileSync(PRIVATE, 'utf8'));
  } catch (e) {
    t.skip('private notes file is not valid JSON');
    return;
  }
  const needles = Object.values(notes)
    .filter((v) => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length >= 8)
    .map((v) => v.slice(0, 24));
  if (!needles.length) {
    t.skip('private notes file has no non-trivial entries to scan for');
    return;
  }

  const files = [];
  walk(path.join(ROOT, 'public'), files);
  walk(path.join(ROOT, 'functions'), files);

  const offenders = [];
  files.forEach((f) => {
    let text;
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch (e) {
      return;
    }
    needles.forEach((needle) => {
      if (text.indexOf(needle) !== -1) offenders.push({ file: path.relative(ROOT, f), needle });
    });
  });

  assert.deepStrictEqual(offenders, [], 'private note content leaked: ' + JSON.stringify(offenders));
});

test('public challenge payload never carries notes', () => {
  const A = require('../functions/admin-challenge');
  const shaped = A.publicChallenge({
    startDate: null,
    releasedUpTo: null,
    days: [{ d: 1, w: [], reel: '' }],
    notes: { 1: 'should not leak' },
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(shaped, 'notes'), false);
});
