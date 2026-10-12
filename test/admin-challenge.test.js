const { test } = require('node:test');
const assert = require('node:assert');
const { handleChallengeAction, publicChallenge } = require('../functions/admin-challenge');

const state = {
  startDate: '2026-10-01',
  releasedUpTo: null,
  days: [
    { d: 1, w: [[114, 'الخناس'], [113, 'غاسق اذا وقب']], reel: '' },
    { d: 2, w: [[112, 'الصمد']], reel: '' },
    { d: 3, w: [[108, 'شانيك']], reel: '' },
  ],
};

const notes = { 1: 'note-1', 2: 'note-2' };
// In tests we only ever use the word 114, so this resolver is enough.
const resolveWord = (ref) => Array.isArray(ref) && ref[0] === 114;

const call = (over) =>
  handleChallengeAction(Object.assign({ isAdmin: true, payload: {}, state, notes, resolveWord, random: () => 0 }, over));

test('rejects every action for a non-admin', () => {
  ['get', 'setStartDate', 'setReleasedUpTo', 'setDay', 'setNotes', 'roulette', 'releaseStatus'].forEach((action) => {
    const out = call({ isAdmin: false, action });
    assert.strictEqual(out.status, 403, action);
    assert.strictEqual(out.body.error, 'forbidden', action);
  });
});

test('rejects unknown actions', () => {
  const out = call({ action: 'drop-tables' });
  assert.strictEqual(out.status, 400);
  assert.strictEqual(out.body.error, 'unknown-action');
});

test('get returns the challenge and, for admins only, the notes', () => {
  const out = call({ action: 'get' });
  assert.strictEqual(out.status, 200);
  assert.strictEqual(out.body.challenge.notes, undefined);
  assert.deepStrictEqual(Object.keys(out.body.challenge).sort(), ['days', 'releasedUpTo', 'startDate']);
  assert.deepStrictEqual(out.body.notes, notes);
});

test('setStartDate validates the date format', () => {
  assert.strictEqual(call({ action: 'setStartDate', payload: { startDate: '2026-11-01' } }).body.apply.startDate, '2026-11-01');
  assert.strictEqual(call({ action: 'setStartDate', payload: { startDate: null } }).body.apply.startDate, null);
  assert.strictEqual(call({ action: 'setStartDate', payload: { startDate: '01-11-2026' } }).status, 422);
  assert.strictEqual(call({ action: 'setStartDate', payload: { startDate: 'garbage' } }).status, 422);
});

test('setReleasedUpTo validates the range', () => {
  assert.strictEqual(call({ action: 'setReleasedUpTo', payload: { releasedUpTo: 2 } }).body.apply.releasedUpTo, 2);
  assert.strictEqual(call({ action: 'setReleasedUpTo', payload: { releasedUpTo: null } }).body.apply.releasedUpTo, null);
  assert.strictEqual(call({ action: 'setReleasedUpTo', payload: { releasedUpTo: '' } }).body.apply.releasedUpTo, null);
  assert.strictEqual(call({ action: 'setReleasedUpTo', payload: { releasedUpTo: 99 } }).status, 422);
  assert.strictEqual(call({ action: 'setReleasedUpTo', payload: { releasedUpTo: -1 } }).status, 422);
});

test('setDay rejects references to words that do not exist', () => {
  const out = call({ action: 'setDay', payload: { day: 1, w: [[999, 'nope']] } });
  assert.strictEqual(out.status, 422);
  assert.strictEqual(out.body.error, 'unknown-word');
  assert.strictEqual(out.body.problems.length, 1);
});

test('setDay updates words and reel, validating the reel URL', () => {
  const ok = call({ action: 'setDay', payload: { day: 1, w: [[114, 'الخناس']], reel: 'https://example.com/r' } });
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(ok.body.apply.day.w, [[114, 'الخناس']]);
  assert.strictEqual(ok.body.apply.day.reel, 'https://example.com/r');

  assert.strictEqual(call({ action: 'setDay', payload: { day: 1, reel: 'http://insecure' } }).status, 422);
  assert.strictEqual(call({ action: 'setDay', payload: { day: 99, w: [] } }).status, 404);
});

test('setNotes writes a private note for an existing day only', () => {
  const ok = call({ action: 'setNotes', payload: { day: 2, note: 'updated' } });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(ok.body.apply.notes['2'], 'updated');
  assert.strictEqual(call({ action: 'setNotes', payload: { day: 42, note: 'x' } }).status, 404);
  assert.strictEqual(call({ action: 'setNotes', payload: { day: 1, note: 5 } }).status, 422);
});

test('roulette is deterministic under injected randomness and empty-safe', () => {
  const day3 = { startDate: null, releasedUpTo: null, days: [{ d: 1, w: [], reel: '' }] };
  assert.strictEqual(call({ action: 'roulette', payload: { day: 1 }, state: day3 }).body.empty, true);

  const r = call({ action: 'roulette', payload: { day: 1 }, random: () => 0 });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.index, 0);
  assert.deepStrictEqual(r.body.ref, [114, 'الخناس']);
  assert.strictEqual(r.body.spinId, ':0');
});

test('releaseStatus reports per-day state', () => {
  const out = call({ action: 'releaseStatus', progress: { done: [1] } });
  assert.strictEqual(out.status, 200);
  assert.strictEqual(out.body.unlocked, 2);
  const byDay = {};
  out.body.days.forEach((d) => (byDay[d.d] = d.status));
  assert.strictEqual(byDay[1], 'done');
  assert.strictEqual(byDay[2], 'today');
  assert.strictEqual(byDay[3], 'locked');
});

test('publicChallenge never leaks notes', () => {
  const out = publicChallenge(Object.assign({}, state, { notes: { 1: 'secret' } }));
  assert.strictEqual(out.notes, undefined);
  assert.strictEqual(out.privateNotes, undefined);
});
