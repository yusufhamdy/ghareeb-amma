const { test } = require('node:test');
const assert = require('node:assert');
const C = require('../functions/challenge');

const state = {
  startDate: null,
  releasedUpTo: null,
  days: [
    { d: 1, w: [[114, 'الخناس'], [113, 'غاسق اذا وقب']], reel: '' },
    { d: 2, w: [[112, 'الصمد']], reel: '' },
    { d: 3, w: [[108, 'شانيك']], reel: 'https://example.com/reel3' },
    { d: 4, w: [[107, 'يكذب بالدين']], reel: '' },
  ],
};

test('cairoDateString uses Africa/Cairo', () => {
  // January in Cairo is UTC+2 (no DST): 22:30Z crosses midnight, 21:30Z does not.
  assert.strictEqual(C.cairoDateString(new Date('2026-01-14T22:30:00Z')), '2026-01-15');
  assert.strictEqual(C.cairoDateString(new Date('2026-01-14T21:30:00Z')), '2026-01-14');
});

test('daysBetween computes whole days', () => {
  assert.strictEqual(C.daysBetween('2026-10-05', '2026-10-05'), 0);
  assert.strictEqual(C.daysBetween('2026-10-05', '2026-10-08'), 3);
  assert.strictEqual(C.daysBetween('2026-10-08', '2026-10-05'), -3);
});

test('day 1 is unlocked initially, later days locked', () => {
  const p = { done: [] };
  assert.strictEqual(C.computeUnlocked(state, p), 1);
  assert.strictEqual(C.isDayUnlocked(state, 1, p), true);
  assert.strictEqual(C.isDayUnlocked(state, 2, p), false);
  assert.strictEqual(C.dayStatus(state, 1, p), 'today');
  assert.strictEqual(C.dayStatus(state, 4, p), 'locked');
});

test('next day unlocks only after previous marked done', () => {
  assert.strictEqual(C.computeUnlocked(state, { done: [1] }), 2);
  assert.strictEqual(C.computeUnlocked(state, { done: [1, 2] }), 3);
  assert.strictEqual(C.computeUnlocked(state, { done: [1, 2, 3] }), 4);
  assert.strictEqual(C.computeUnlocked(state, { done: [1, 2, 3, 4] }), 4);
});

test('cannot skip a day (missed day keeps frontier back)', () => {
  assert.strictEqual(C.computeUnlocked(state, { done: [1, 3] }), 2);
  assert.strictEqual(C.dayStatus(state, 1, { done: [1, 3] }), 'done');
  assert.strictEqual(C.dayStatus(state, 2, { done: [1, 3] }), 'today');
  assert.strictEqual(C.dayStatus(state, 3, { done: [1, 3] }), 'locked');
});

test('past open but not done shows as available', () => {
  // Admin override opens days 1-3; day 1 is the frontier (today), day 3 is
  // open but not the frontier => available.
  const s = Object.assign({}, state, { releasedUpTo: 3 });
  assert.strictEqual(C.dayStatus(s, 1, { done: [] }), 'today');
  assert.strictEqual(C.dayStatus(s, 2, { done: [] }), 'available');
  assert.strictEqual(C.dayStatus(s, 3, { done: [] }), 'available');
  assert.strictEqual(C.dayStatus(s, 4, { done: [] }), 'locked');
});

test('releasedUpTo override opens days beyond the sequential frontier', () => {
  assert.strictEqual(C.computeUnlocked(Object.assign({}, state, { releasedUpTo: 3 }), { done: [] }), 3);
  assert.strictEqual(C.computeUnlocked(Object.assign({}, state, { releasedUpTo: 0 }), { done: [] }), 1);
  assert.strictEqual(C.computeUnlocked(state, { done: [] }), 1);
});

test('done mark requires all meanings viewed', () => {
  const p = { done: [], viewed: {} };
  assert.strictEqual(C.viewedAllMeanings(state, 1, p), false);
  assert.strictEqual(C.canMarkDayDone(state, 1, p), false);

  const p2 = C.markViewed(p, 1, [114, 'الخناس']);
  assert.strictEqual(C.viewedAllMeanings(state, 1, p2), false);
  const p3 = C.markViewed(p2, 1, [113, 'غاسق اذا وقب']);
  assert.strictEqual(C.viewedAllMeanings(state, 1, p3), true);
  assert.strictEqual(C.canMarkDayDone(state, 1, p3), true);

  const r = C.toggleDayDone(state, 1, p3);
  assert.strictEqual(r.changed, true);
  assert.deepStrictEqual(r.progress.done, [1]);
});

test('cannot mark a locked day done', () => {
  const r = C.toggleDayDone(state, 2, { done: [], viewed: { 2: { '112::الصمد': true } } });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.reason, 'locked');
});

test('cannot mark done before viewing (reason not-viewed)', () => {
  const r = C.toggleDayDone(state, 1, { done: [], viewed: {} });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.reason, 'not-viewed');
});

test('duplicate same-day completion is idempotent / toggles', () => {
  const p = { done: [1], viewed: { 1: { '114::الخناس': true, '113::غاسق اذا وقب': true } } };
  const again = C.toggleDayDone(state, 1, p);
  assert.deepStrictEqual(again.progress.done, []); // second call unmarks
  const back = C.toggleDayDone(state, 1, again.progress);
  assert.deepStrictEqual(back.progress.done, [1]);
});

test('challenge not started / empty days edge cases', () => {
  const empty = { startDate: null, releasedUpTo: null, days: [] };
  assert.strictEqual(C.computeUnlocked(empty, { done: [] }), 0);
  assert.strictEqual(C.dayStatus(empty, 1, { done: [] }), 'unknown');
  assert.strictEqual(C.isDayUnlocked(empty, 1, { done: [] }), false);
});

test('roulette selects server-side with injected randomness', () => {
  const pool = [[114, 'الخناس'], [113, 'غاسق'], [112, 'الصمد']];
  assert.strictEqual(C.rouletteSelect(pool, { random: () => 0 }).index, 0);
  assert.strictEqual(C.rouletteSelect(pool, { random: () => 0.99 }).index, 2);
  assert.strictEqual(C.rouletteSelect(pool, { random: () => 0.5 }).index, 1);
});

test('roulette avoids repeats when pool has >1 and handles empty pool', () => {
  const pool = [[114, 'الخناس'], [113, 'غاسق']];
  const r = C.rouletteSelect(pool, { random: () => 0, avoid: [114, 'الخناس'] });
  assert.strictEqual(r.index, 1);
  assert.strictEqual(C.rouletteSelect([], { random: () => 0 }), null);
});

test('roulette spinId is auditable and deterministic', () => {
  const pool = [[114, 'الخناس'], [113, 'غاسق']];
  const a = C.rouletteSelect(pool, { random: () => 0.5, spinId: 'day3' });
  const b = C.rouletteSelect(pool, { random: () => 0.5, spinId: 'day3' });
  assert.strictEqual(a.spinId, b.spinId);
  assert.strictEqual(a.value, b.value);
});

test('validateDayReferences flags unknown words', () => {
  const resolve = (ref) => ref[0] === 114;
  const problems = C.validateDayReferences(state, resolve);
  assert.ok(problems.length >= 1);
  assert.ok(problems.every((p) => p.ref[0] !== 114));
});

test('sanitizePublicChallenge never contains notes', () => {
  const dirty = Object.assign({}, state, { notes: { 1: 'SECRET' }, privateNotes: 'SECRET' });
  const out = C.sanitizePublicChallenge(dirty);
  assert.strictEqual(out.notes, undefined);
  assert.strictEqual(out.privateNotes, undefined);
  assert.deepStrictEqual(Object.keys(out).sort(), ['days', 'releasedUpTo', 'startDate']);
});

test('withNotesForViewer exposes notes only to admins', () => {
  const notes = { 1: 'خاص' };
  const asAdmin = C.withNotesForViewer(state, notes, true);
  const asVisitor = C.withNotesForViewer(state, notes, false);
  assert.deepStrictEqual(asAdmin.notes, notes);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(asVisitor, 'notes'), false);
});
