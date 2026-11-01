/*
 * rules-history.test.js - firestore.rules for the version history (snapshots/{rev}, history/{rev}) and the checks on
 * saving public/data, on the emulator only. Actors: signed out, non-admin, admin (listed, not the owner), owner.
 *
 * Run with the emulator: npm run rules:test
 * Without the emulator environment variables (plain `npm test`) this file skips itself.
 * ASCII only.
 */
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { serverTimestamp } = require('firebase/firestore');

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_EMULATOR_HOST;
if (!EMULATOR_HOST) {
  console.log('SKIP rules-history: Firestore emulator not running.');
  process.exit(0);
}

const OWNER_T = { email: 'yusufhamdy20@gmail.com', email_verified: true };
const ADMIN_T = { email: 'admin2@example.com', email_verified: true };
const USER_T = { email: 'visitor@gmail.com', email_verified: true };
const WORDS = [{ surah: 'old', no: 114, words: ['w'], meanings: ['m'], ayahs: [{ label: '1', segments: [] }], source: 's' }];
const NEXT = [{ surah: 'new', no: 114, words: ['w'], meanings: ['changed'], ayahs: [{ label: '1', segments: [] }], source: 's' }];
const REAL = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'words.json'), 'utf8'));
const OLD_TIME = new Date('2001-01-01T00:00:00Z');

let env;
const ctxs = [];
const db = (uid, tok) => { const c = uid ? env.authenticatedContext(uid, tok) : env.unauthenticatedContext(); ctxs.push(c); return c.firestore(); };
const ACTORS = () => ({ signedOut: db(), nonAdmin: db('user', USER_T), admin: db('admin', ADMIN_T), owner: db('owner', OWNER_T) });
const put = (k, v) => env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc(k).set(v); });
const raw = async (k) => { let o; await env.withSecurityRulesDisabled(async (c) => { const s = await c.firestore().doc(k).get(); o = s.exists ? s.data() : null; }); return o; };

const row = (rev, uid, tok, over) => Object.assign({ rev, kind: 'edit', summary: 'x', by: uid, byEmail: tok.email, at: serverTimestamp() }, over);
// one save as the admin page commits it. over: { data, hist, snap, surahs, rev, base } replaces parts of it; null leaves a document out.
function save(d, uid, tok, over) {
  const o = over || {}, rev = o.rev === undefined ? 6 : o.rev, surahs = o.surahs || NEXT, b = d.batch();
  if (o.base) {
    b.set(d.doc('snapshots/' + o.base.rev), { rev: o.base.rev, surahs: o.base.surahs || WORDS });
    b.set(d.doc('history/' + o.base.rev), row(o.base.rev, uid, tok, Object.assign({ kind: 'baseline' }, o.base.hist)));
  }
  if (o.snap !== null) b.set(d.doc('snapshots/' + (o.snapId || rev)), Object.assign({ rev, surahs }, o.snap));
  if (o.hist !== null) b.set(d.doc('history/' + (o.histId || rev)), row(rev, uid, tok, o.hist));
  if (o.data !== null) b.set(d.doc('public/data'), Object.assign({ rev, surahs, updatedAt: serverTimestamp(), by: uid }, o.data));
  return b.commit();
}
const asAdmin = (over) => save(db('admin', ADMIN_T), 'admin', ADMIN_T, over);
const asOwner = (over) => save(db('owner', OWNER_T), 'owner', OWNER_T, over);

before(async () => {
  const [host, port] = EMULATOR_HOST.split(':');
  env = await initializeTestEnvironment({ projectId: 'demo-ghareeb-history', firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'), host, port: Number(port) } });
});
// public/data at rev 5, recorded, unless a test takes the record away
beforeEach(async () => {
  await env.clearFirestore();
  await put('config/admins', { emails: [ADMIN_T.email] });
  await put('public/data', { rev: 5, surahs: WORDS, by: 'someone' });
  await put('public/prev', { rev: 4, surahs: WORDS });
  await put('snapshots/5', { rev: 5, surahs: WORDS });
  await put('history/5', { rev: 5, kind: 'edit', summary: 's', by: 'someone', byEmail: 'a@b.c', at: new Date() });
});
after(async () => { for (const c of ctxs) { try { await c.cleanup(); } catch (_) { /* ignore */ } } if (env) await env.cleanup(); });
const unrecorded = async () => env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc('snapshots/5').delete(); await c.firestore().doc('history/5').delete(); });

test('reads: signed-out and non-admin users are refused; an admin and the owner read and list', async () => {
  const a = ACTORS();
  for (const who of [a.signedOut, a.nonAdmin]) {
    for (const p of ['snapshots/5', 'history/5']) await assertFails(who.doc(p).get());
    for (const c of ['snapshots', 'history']) await assertFails(who.collection(c).get());
  }
  for (const who of [a.admin, a.owner]) {
    for (const p of ['snapshots/5', 'history/5']) await assertSucceeds(who.doc(p).get());
    await assertSucceeds(who.collection('history').orderBy('rev', 'desc').limit(20).get());
    await assertSucceeds(who.collection('snapshots').get());
  }
});

test('nobody updates or deletes a version, the owner included', async () => {
  const a = ACTORS();
  for (const [name, who] of Object.entries(a)) {
    for (const p of ['snapshots/5', 'history/5']) {
      await assertFails(who.doc(p).delete());
      await assertFails(who.doc(p).set({ rev: 5, surahs: [] }));
      await assertFails(who.doc(p).update({ rev: 5 }));
    }
    await assertFails(who.doc('history/5').update({ summary: 'rewritten by ' + name }));
  }
  assert.strictEqual((await raw('history/5')).summary, 's');
  assert.deepStrictEqual((await raw('snapshots/5')).surahs, WORDS);
});

test('a version cannot be rewritten through a save either', async () => {
  // the next save re-creates its own record of 5, or an older one: a set over an existing version is an update
  await assertFails(asOwner({ base: { rev: 5, surahs: NEXT } }));
  await assertFails(asOwner({ base: { rev: 5 } }));
  assert.deepStrictEqual((await raw('snapshots/5')).surahs, WORDS);
});

test('signed-out and non-admin users cannot make a full, correct save', async () => {
  const a = ACTORS();
  await assertFails(save(a.nonAdmin, 'user', USER_T));
  await assertFails(save(a.signedOut, 'x', USER_T));
  assert.strictEqual((await raw('public/data')).rev, 5);
});

test('admin and owner: a full, correct save passes and leaves all three documents agreeing', async () => {
  await assertSucceeds(asAdmin());
  const d = await raw('public/data'), s = await raw('snapshots/6'), h = await raw('history/6');
  assert.strictEqual(d.rev, 6);
  assert.deepStrictEqual(s.surahs, d.surahs);
  assert.strictEqual(h.by, 'admin');
  assert.strictEqual(h.byEmail, ADMIN_T.email);
  assert.ok(h.at.toMillis() === d.updatedAt.toMillis(), 'one server time');
  await assertSucceeds(asOwner({ rev: 7 }));
});

test('a save without its matching documents is refused, for the admin and the owner', async () => {
  for (const go of [asAdmin, asOwner]) {
    await assertFails(go({ hist: null, snap: null }));
    await assertFails(go({ hist: null }));
    await assertFails(go({ snap: null }));
    await assertFails(go({ data: null })); // and records of a save that did not happen
    await assertFails(go({ data: null, hist: null }));
    await assertFails(go({ data: null, snap: null }));
    await assertFails(go({ snap: { surahs: WORDS } })); // a snapshot of something else
    await assertFails(go({ data: { surahs: WORDS } }));
    await assertFails(go({ snap: { rev: 7 }, snapId: '7' }));
    await assertFails(go({ hist: { rev: 7 }, histId: '7' }));
  }
  assert.strictEqual((await raw('public/data')).rev, 5);
  assert.strictEqual(await raw('snapshots/6'), null);
  assert.strictEqual(await raw('history/6'), null);
});

test('the revision goes up by exactly one', async () => {
  for (const rev of [7, 100, 5, 4, 0]) {
    await assertFails(asAdmin({ rev }));
    await assertFails(asOwner({ rev }));
  }
  await assertFails(asOwner({ data: { rev: 7 } }));
  await assertFails(asOwner({ data: { rev: 6.5 } }));
  await assertFails(asOwner({ rev: '6' }));
  await assertSucceeds(asOwner({ rev: 6 }));
});

test('forged authors and times are refused', async () => {
  for (const [go, uid] of [[asAdmin, 'admin'], [asOwner, 'owner']]) {
    await assertFails(go({ data: { by: 'someone-else' } }));
    await assertFails(go({ data: { updatedAt: OLD_TIME } }));
    await assertFails(go({ data: { updatedAt: new Date(Date.now() + 86400000) } }));
    await assertFails(go({ data: { by: uid + '-not' } }));
    await assertFails(go({ hist: { by: 'someone-else' } }));
    await assertFails(go({ hist: { byEmail: 'someone@else.com' } }));
    await assertFails(go({ hist: { at: OLD_TIME } }));
    await assertFails(go({ hist: { at: new Date() } }));
  }
  // required, not optional
  const d = db('owner', OWNER_T), b = d.batch();
  b.set(d.doc('snapshots/6'), { rev: 6, surahs: NEXT });
  b.set(d.doc('history/6'), row(6, 'owner', OWNER_T));
  b.set(d.doc('public/data'), { rev: 6, surahs: NEXT });
  await assertFails(b.commit());
  const d2 = db('owner', OWNER_T), b2 = d2.batch();
  b2.set(d2.doc('snapshots/6'), { rev: 6, surahs: NEXT });
  b2.set(d2.doc('history/6'), { rev: 6, kind: 'edit', summary: 'x' });
  b2.set(d2.doc('public/data'), { rev: 6, surahs: NEXT, updatedAt: serverTimestamp(), by: 'owner' });
  await assertFails(b2.commit());
});

test('the author is required on the data: a save with a time but no by is refused', async () => {
  const d = db('owner', OWNER_T), b = d.batch();
  b.set(d.doc('snapshots/6'), { rev: 6, surahs: NEXT });
  b.set(d.doc('history/6'), row(6, 'owner', OWNER_T));
  b.set(d.doc('public/data'), { rev: 6, surahs: NEXT, updatedAt: serverTimestamp() });
  await assertFails(b.commit());
});

test('a stray version under another id is refused, even alongside a correct save', async () => {
  for (const [coll, doc] of [['history', row(6, 'owner', OWNER_T)], ['snapshots', { rev: 6, surahs: NEXT }]]) {
    const d = db('owner', OWNER_T), b = d.batch();
    b.set(d.doc('snapshots/6'), { rev: 6, surahs: NEXT });
    b.set(d.doc('history/6'), row(6, 'owner', OWNER_T));
    b.set(d.doc('public/data'), { rev: 6, surahs: NEXT, updatedAt: serverTimestamp(), by: 'owner' });
    b.set(d.doc(coll + '/stray'), doc);
    await assertFails(b.commit());
  }
  assert.strictEqual((await raw('public/data')).rev, 5);
});

test('field checks on a version: id, keys, types, kind, summary length, restoredFrom', async () => {
  const ar = 'ب'; // an Arabic letter: 300 of them are 300 characters, not 600
  await assertFails(asOwner({ hist: { summary: ar.repeat(301) } }));
  await assertFails(asOwner({ hist: { summary: 5 } }));
  await assertFails(asOwner({ hist: { kind: 'hack' } }));
  await assertFails(asOwner({ hist: { extra: 1 } }));
  await assertFails(asOwner({ snap: { extra: 1 } }));
  await assertFails(asOwner({ hist: { restoredFrom: 2 } })); // only on a restore
  await assertFails(asOwner({ hist: { kind: 'restore' } })); // required on a restore
  await assertFails(asOwner({ hist: { kind: 'restore', restoredFrom: 6 } })); // an older version only
  await assertFails(asOwner({ hist: { kind: 'restore', restoredFrom: 'x' } }));
  await assertFails(asOwner({ hist: { kind: 'restore', restoredFrom: -1 } }));
  await assertFails(asOwner({ histId: '06' }));
  await assertFails(asOwner({ snapId: '06' }));
  await assertSucceeds(asOwner({ hist: { summary: ar.repeat(300) } }));
});

test('every save path passes, as the owner and as an admin, on the real words', async () => {
  const paths = [
    ['edit', { kind: 'edit' }], ['add', { kind: 'edit' }], ['delete', { kind: 'edit' }], ['merge save', { kind: 'edit' }],
    ['import', { kind: 'import' }], ['restore', { kind: 'restore', restoredFrom: 5 }],
  ];
  let rev = 5;
  for (const [, hist] of paths) for (const go of [asAdmin, asOwner]) {
    rev++;
    await assertSucceeds(go({ rev, surahs: REAL, hist }));
  }
  assert.strictEqual((await raw('public/data')).rev, rev);
  assert.strictEqual((await raw('history/' + rev)).kind, 'restore');
  assert.strictEqual((await raw('history/' + rev)).restoredFrom, 5);
});

test('baseline: the first save records the data as it was, as one transaction', async () => {
  await unrecorded();
  await assertSucceeds(asAdmin({ base: { rev: 5 } }));
  const s = await raw('snapshots/5'), h = await raw('history/5');
  assert.deepStrictEqual(s, { rev: 5, surahs: WORDS });
  assert.strictEqual(h.kind, 'baseline');
  assert.strictEqual((await raw('public/data')).rev, 6);
});

test('baseline: passes for the listed admin on the real words, within the limit on document lookups', async () => {
  await unrecorded();
  await put('public/data', { rev: 5, surahs: REAL });
  await assertSucceeds(asAdmin({ base: { rev: 5, surahs: REAL }, surahs: REAL }));
});

test('baseline: refused unless it matches the current data', async () => {
  await unrecorded();
  await assertFails(asOwner({ base: { rev: 5, surahs: NEXT } })); // other words
  await assertFails(asOwner({ base: { rev: 4 } })); // other revision
  await assertFails(asOwner({ base: { rev: 6 } }));
  await assertFails(asOwner({ base: { rev: 5, hist: { kind: 'edit' } } })); // records no save
  await assertFails(asOwner({ base: { rev: 5 }, hist: { kind: 'baseline' } })); // a new version is never a baseline
  assert.strictEqual(await raw('history/5'), null);
  assert.strictEqual((await raw('public/data')).rev, 5);
});

test('baseline: a save cannot skip it, so a version with no record is never lost', async () => {
  await unrecorded();
  await assertFails(asOwner());
  await assertFails(asAdmin());
  assert.strictEqual((await raw('public/data')).rev, 5);
});

test('baseline: refused on its own for a revision that is not the current one, even with the current words', async () => {
  await assertFails(asOwner({ base: { rev: 4 }, data: null, hist: null, snap: null }));
  await assertFails(asOwner({ base: { rev: 3 }, data: null, hist: null, snap: null }));
  assert.strictEqual(await raw('history/4'), null);
});

test('baseline: on its own it must be a matching pair', async () => {
  await unrecorded();
  const d = db('owner', OWNER_T);
  await assertFails(d.doc('history/5').set(row(5, 'owner', OWNER_T, { kind: 'baseline' })));
  await assertFails(d.doc('snapshots/5').set({ rev: 5, surahs: WORDS }));
  await assertSucceeds(asOwner({ base: { rev: 5 }, data: null, hist: null, snap: null }));
});

test('a record cannot be added to a version already saved', async () => {
  await env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc('history/5').delete(); await c.firestore().doc('snapshots/5').delete(); });
  await assertFails(asOwner({ rev: 5, surahs: WORDS, data: null }));
  await assertFails(asOwner({ rev: 5, surahs: WORDS, data: null, hist: { kind: 'restore', restoredFrom: 1 } }));
});

test('the first save ever: revision 1, recorded', async () => {
  await env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc('public/data').delete(); });
  await assertFails(asOwner({ rev: 2 }));
  await assertFails(asOwner({ rev: 1, hist: null }));
  await assertSucceeds(asOwner({ rev: 1 }));
  assert.strictEqual((await raw('public/data')).rev, 1);
});

test('a version cannot be recorded without moving the data, even with the current words', async () => {
  await assertFails(asOwner({ data: null, surahs: WORDS }));
  // half of a version already there (never written by the page): the other half is still refused
  await put('snapshots/6', { rev: 6, surahs: WORDS });
  await assertFails(asOwner({ data: null, snap: null, surahs: WORDS }));
  await env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc('snapshots/6').delete(); });
  await put('history/6', { rev: 6, kind: 'edit', summary: 's', by: 'someone', byEmail: 'a@b.c', at: new Date() });
  await assertFails(asOwner({ data: null, hist: null, surahs: WORDS }));
  await assertFails(asOwner({ data: null, hist: null, surahs: NEXT }));
  // a baseline's row with no words: only the words the data holds at that revision can complete it, and it has moved on
  await put('history/3', { rev: 3, kind: 'baseline', summary: 's', by: 'someone', byEmail: 'a@b.c', at: new Date() });
  await assertFails(db('owner', OWNER_T).doc('snapshots/3').set({ rev: 3, surahs: WORDS }));
  assert.strictEqual(await raw('snapshots/3'), null);
});

test('public/data alone cannot go back to a recorded version, or be written again at its revision', async () => {
  await put('snapshots/4', { rev: 4, surahs: NEXT });
  await put('history/4', { rev: 4, kind: 'edit', summary: 's', by: 'someone', byEmail: 'a@b.c', at: new Date() });
  await assertFails(asOwner({ rev: 4, surahs: NEXT, snap: null, hist: null }));
  await assertFails(asOwner({ rev: 5, surahs: WORDS, snap: null, hist: null }));
  assert.strictEqual((await raw('public/data')).rev, 5);
  assert.strictEqual((await raw('public/data')).by, 'someone');
});

test('a snapshot left over for the next revision does not stand in for the save\'s own record', async () => {
  await put('snapshots/6', { rev: 6, surahs: NEXT });
  // no history row for the new revision
  await assertFails(asOwner({ surahs: NEXT, snap: null, hist: null }));
  // a row, but the leftover snapshot holds other words than the save
  await assertFails(asOwner({ surahs: WORDS, snap: null }));
  assert.strictEqual((await raw('public/data')).rev, 5);
});

test('public/data and public/prev are readable by admins only, and never deleted', async () => {
  const a = ACTORS();
  for (const [name, who] of Object.entries(a)) {
    for (const p of ['public/data', 'public/prev']) {
      if (name === 'owner' || name === 'admin') await assertSucceeds(who.doc(p).get());
      else await assertFails(who.doc(p).get());
      await assertFails(who.doc(p).delete());
    }
  }
});

test('a removed admin can no longer read or save versions', async () => {
  await put('config/admins', { emails: [] });
  const a = db('admin', ADMIN_T);
  await assertFails(a.doc('history/5').get());
  await assertFails(asAdmin());
});

test('the owner does not depend on the admins list; an admin does', async () => {
  await env.withSecurityRulesDisabled(async (c) => { await c.firestore().doc('config/admins').delete(); });
  await assertFails(asAdmin());
  await assertFails(db('admin', ADMIN_T).doc('history/5').get());
  await assertSucceeds(asOwner());
  await assertSucceeds(db('owner', OWNER_T).doc('history/5').get());
});
