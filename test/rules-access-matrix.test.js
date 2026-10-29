/*
 * rules-access-matrix.test.js
 *
 * Emulator-only access matrix for firestore.rules: what each kind of visitor can and cannot do with every document the
 * site uses (public/data = the words, public/prev = the previous words for undo, public/challenge, admin/challengeNotes =
 * the private notes, config/admins = the admins list) plus documents that do not exist yet (a "settings" document under
 * public/ and config/, other collections).
 *
 * Actors:
 *   - anonymous visitor (no sign-in)
 *   - Firebase anonymous sign-in (no email)
 *   - signed-in Google user who is not an admin (verified email)
 *   - the owner's address with email_verified=false
 *   - the owner's and an admin's address in different letter case (accepted: addresses compare case-insensitively)
 *   - a non-admin token carrying custom claims (admin: true) - the rules must ignore claims
 *   - an admin listed in config/admins who is not the owner
 *   - the owner
 * and the document shapes: admins write only public/data, public/prev and public/challenge (no other ID, no
 * delete), each with its keys, types and size limits; notes are day-number keys with text values; the admins list
 * holds lowercase addresses only.
 *
 * Run with the emulator:
 *   firebase emulators:exec --project demo-ghareeb --only firestore "node --test test/rules-access-matrix.test.js"
 * Without the emulator environment variables (plain `npm test`) this file skips itself.
 */
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_EMULATOR_HOST;

if (!EMULATOR_HOST) {
  console.log('SKIP rules-access-matrix: Firestore emulator not running.');
  process.exit(0);
}

const OWNER = { email: 'yusufhamdy20@gmail.com', email_verified: true };
const ADMIN2 = { email: 'admin2@example.com', email_verified: true };
const USER = { email: 'visitor@gmail.com', email_verified: true, firebase: { sign_in_provider: 'google.com' } };
const PROJECT_ID = 'demo-ghareeb-matrix';

// documents and what they hold before each test
const SEED = {
  'public/data': { rev: 1, surahs: [{ surah: 'سورة الناس', no: 114, words: ['الخناس'], meanings: ['m'], ayahs: [], source: 's' }] },
  'public/prev': { rev: 0, surahs: [] },
  'public/challenge': { startDate: '2026-01-01', releasedUpTo: 1, days: [] },
  'admin/challengeNotes': { 1: 'private note' },
  'config/admins': { emails: [ADMIN2.email] },
};
const PUBLIC_DOCS = ['public/data', 'public/prev', 'public/challenge'];

let env;
let contexts = [];
const track = (ctx) => { contexts.push(ctx); return ctx; };

before(async () => {
  const [host, port] = EMULATOR_HOST.split(':');
  env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'), host, port: Number(port) },
  });
});

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const [p, v] of Object.entries(SEED)) await ctx.firestore().doc(p).set(v);
  });
});

after(async () => {
  for (const ctx of contexts) { try { await ctx.cleanup(); } catch (_) { /* ignore */ } }
  if (env) await env.cleanup();
});

// everything a non-admin must be refused, whoever they are
async function deniedEverythingBeyondPublicReads(db, who) {
  // reads: the public documents and the public collection are readable
  for (const p of PUBLIC_DOCS) await assertSucceeds(db.doc(p).get());
  await assertSucceeds(db.collection('public').get());
  // no writes, updates, deletes or new documents under public/ (words, challenge, a settings document)
  for (const p of PUBLIC_DOCS) {
    await assertFails(db.doc(p).set({ hacked: who }));
    await assertFails(db.doc(p).update({ hacked: who }));
    await assertFails(db.doc(p).delete());
  }
  await assertFails(db.doc('public/settings').set({ hacked: who }));
  await assertFails(db.collection('public').add({ hacked: who }));
  // private notes: no read, no list, no write, no delete
  await assertFails(db.doc('admin/challengeNotes').get());
  await assertFails(db.collection('admin').get());
  await assertFails(db.doc('admin/challengeNotes').set({ 1: who }));
  await assertFails(db.doc('admin/challengeNotes').update({ 1: who }));
  await assertFails(db.doc('admin/challengeNotes').delete());
  // admins list: no read, no list, cannot add themselves, cannot replace or delete it
  await assertFails(db.doc('config/admins').get());
  await assertFails(db.collection('config').get());
  await assertFails(db.doc('config/admins').set({ emails: [who] }));
  await assertFails(db.doc('config/admins').set({ emails: [who] }, { merge: true }));
  await assertFails(db.doc('config/admins').delete());
  await assertFails(db.doc('config/settings').set({ hacked: who }));
  // anything else
  await assertFails(db.doc('users/x').get());
  await assertFails(db.doc('users/x').set({ hacked: who }));
  await assertFails(db.doc('settings/site').set({ hacked: who }));
}

async function unchanged() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    for (const [p, v] of Object.entries(SEED)) {
      const s = await ctx.firestore().doc(p).get();
      assert.deepStrictEqual(s.data(), JSON.parse(JSON.stringify(v)), p + ' changed');
    }
    for (const p of ['public/settings', 'config/settings', 'users/x', 'settings/site']) {
      assert.strictEqual((await ctx.firestore().doc(p).get()).exists, false, p + ' was created');
    }
  });
}

test('anonymous visitor: public reads only', async () => {
  await deniedEverythingBeyondPublicReads(track(env.unauthenticatedContext()).firestore(), 'anon');
  await unchanged();
});

test('Firebase anonymous sign-in (no email): public reads only', async () => {
  const c = track(env.authenticatedContext('anon-auth', { firebase: { sign_in_provider: 'anonymous' } }));
  await deniedEverythingBeyondPublicReads(c.firestore(), 'anon-auth');
  await unchanged();
});

test('signed-in Google user who is not an admin: public reads only', async () => {
  await deniedEverythingBeyondPublicReads(track(env.authenticatedContext('visitor', USER)).firestore(), USER.email);
  await unchanged();
});

test('the owner\'s address without a verified email: public reads only', async () => {
  const c = track(env.authenticatedContext('fake-owner', { email: OWNER.email, email_verified: false }));
  await deniedEverythingBeyondPublicReads(c.firestore(), 'fake-owner');
  await unchanged();
});

test('addresses compare case-insensitively: the owner and an admin in other letter case keep their access', async () => {
  const owner = track(env.authenticatedContext('case-owner', { email: 'YusufHamdy20@gmail.com', email_verified: true })).firestore();
  const admin = track(env.authenticatedContext('case-admin', { email: 'Admin2@Example.com', email_verified: true })).firestore();
  await assertSucceeds(owner.doc('config/admins').get());
  await assertSucceeds(owner.doc('config/admins').set({ emails: [ADMIN2.email, 'friend@gmail.com'] }));
  await assertSucceeds(admin.doc('admin/challengeNotes').get());
  await assertSucceeds(admin.doc('public/data').update({ rev: 7 }));
  // the admin is still not the owner, in any letter case
  await assertFails(admin.doc('config/admins').set({ emails: [ADMIN2.email] }));
  // and an unverified address in other letter case is nobody
  const fake = track(env.authenticatedContext('case-fake', { email: 'YUSUFHAMDY20@GMAIL.COM', email_verified: false })).firestore();
  await deniedEverythingBeyondPublicReads(fake, 'case-fake');
});

test('custom claims give nothing: a non-admin token with admin: true is refused', async () => {
  const c = track(env.authenticatedContext('claims', { email: 'claims@gmail.com', email_verified: true, admin: true, owner: true, role: 'admin' }));
  await deniedEverythingBeyondPublicReads(c.firestore(), 'claims');
  await unchanged();
});

test('admin who is not the owner: manages words, challenge and notes, but never the admins list', async () => {
  const db = track(env.authenticatedContext('admin2', ADMIN2)).firestore();
  // allowed
  await assertSucceeds(db.doc('public/data').set({ rev: 2, surahs: [] }));
  await assertSucceeds(db.doc('public/challenge').update({ releasedUpTo: 2 }));
  await assertSucceeds(db.doc('admin/challengeNotes').get());
  await assertSucceeds(db.doc('admin/challengeNotes').set({ 2: 'note' }, { merge: true }));
  await assertSucceeds(db.doc('config/admins').get());
  // refused: any change to the admins list (add someone, remove someone, replace, delete)
  await assertFails(db.doc('config/admins').set({ emails: [ADMIN2.email, 'friend@gmail.com'] }));
  await assertFails(db.doc('config/admins').set({ emails: [] }, { merge: true }));
  await assertFails(db.doc('config/admins').update({ emails: [ADMIN2.email, 'friend@gmail.com'] }));
  await assertFails(db.doc('config/admins').delete());
  // refused: other config documents and other collections
  await assertFails(db.doc('config/settings').set({ x: 1 }));
  await assertFails(db.doc('admin/other').set({ x: 1 }));
  await assertFails(db.doc('users/x').set({ x: 1 }));
  await env.withSecurityRulesDisabled(async (ctx) => {
    assert.deepStrictEqual((await ctx.firestore().doc('config/admins').get()).data(), SEED['config/admins']);
  });
});

test('only the owner changes the admins list; a removed admin loses access at once', async () => {
  const owner = track(env.authenticatedContext('owner', OWNER)).firestore();
  const admin = track(env.authenticatedContext('admin2b', ADMIN2)).firestore();
  await assertSucceeds(admin.doc('public/data').update({ rev: 5 }));
  await assertSucceeds(owner.doc('config/admins').set({ emails: [] }));
  await assertFails(admin.doc('public/data').update({ rev: 6 }));
  await assertFails(admin.doc('admin/challengeNotes').get());
  await assertFails(admin.doc('config/admins').get());
  // the owner can always add an admin again, and does not depend on the list
  await assertSucceeds(owner.doc('admin/challengeNotes').get());
  await assertSucceeds(owner.doc('config/admins').set({ emails: [ADMIN2.email] }));
  await assertSucceeds(admin.doc('admin/challengeNotes').get());
});

test('the owner is not locked out when the admins list is missing', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().doc('config/admins').delete(); });
  const owner = track(env.authenticatedContext('owner2', OWNER)).firestore();
  const admin = track(env.authenticatedContext('admin2c', ADMIN2)).firestore();
  await assertSucceeds(owner.doc('public/data').update({ rev: 9 }));
  await assertFails(admin.doc('public/data').update({ rev: 10 }));
  await assertSucceeds(owner.doc('config/admins').set({ emails: [ADMIN2.email] }));
});

test('admins write only the known public documents, in their shapes, and delete nothing', async () => {
  const db = track(env.authenticatedContext('admin2-shapes', ADMIN2)).firestore();
  const ts = require('firebase/firestore').serverTimestamp;
  // the shapes the admin page writes
  await assertSucceeds(db.doc('public/data').set({ rev: 2, surahs: SEED['public/data'].surahs, updatedAt: ts(), by: 'admin2-shapes' })); // by = the writer's own uid
  await assertSucceeds(db.doc('public/prev').set({ rev: 1, surahs: [], savedAt: ts() }));
  await assertSucceeds(db.doc('public/challenge').set({ startDate: '2026-11-01', releasedUpTo: 3, days: [{ d: 1, w: [{ no: 114, word: 'w' }], reelIg: 'https://www.instagram.com/p/x/' }] }));
  await assertSucceeds(db.doc('public/challenge').set({ startDate: null, releasedUpTo: null, days: [] }));
  // other document IDs under public/
  for (const id of ['settings', 'data2', 'Data', 'x']) await assertFails(db.doc('public/' + id).set({ rev: 1, surahs: [] }));
  // deletes
  for (const p of PUBLIC_DOCS) await assertFails(db.doc(p).delete());
  // words: missing or extra keys, wrong types, too many surahs, someone else as author
  await assertFails(db.doc('public/data').set({ surahs: [] }));
  await assertFails(db.doc('public/data').set({ rev: 3, surahs: [], extra: 1 }));
  await assertFails(db.doc('public/data').set({ rev: '3', surahs: [] }));
  await assertFails(db.doc('public/data').set({ rev: -1, surahs: [] }));
  await assertFails(db.doc('public/data').set({ rev: 3, surahs: 'all' }));
  await assertFails(db.doc('public/data').set({ rev: 3, surahs: Array.from({ length: 115 }, () => ({})) }));
  await assertFails(db.doc('public/data').set({ rev: 3, surahs: [], by: 'owner-uid' })); // someone else's uid
  // an address is never accepted as the author, not even the writer's own (public/data is world-readable)
  for (const by of [ADMIN2.email, 'Admin2@Example.com', 'yusufhamdy20@gmail.com']) await assertFails(db.doc('public/data').set({ rev: 3, surahs: [], by }));
  await assertFails(db.doc('public/data').set({ rev: 3, surahs: [], updatedAt: 'today' }));
  await assertFails(db.doc('public/data').update({ html: '<script>' }));
  // previous words: only its own keys
  await assertFails(db.doc('public/prev').set({ rev: 1, surahs: [], by: ADMIN2.email }));
  // challenge: date format, released day, days, keys
  await assertFails(db.doc('public/challenge').set({ startDate: 'tomorrow', releasedUpTo: 1, days: [] }));
  await assertFails(db.doc('public/challenge').set({ startDate: null, releasedUpTo: 1.5, days: [] }));
  await assertFails(db.doc('public/challenge').set({ startDate: null, releasedUpTo: 1, days: {} }));
  await assertFails(db.doc('public/challenge').set({ startDate: null, releasedUpTo: 1, days: [], notes: { 1: 'leak' } }));
  // notes: day-number keys and text values only
  await assertSucceeds(db.doc('admin/challengeNotes').set({ 3: 'note' }, { merge: true }));
  await assertSucceeds(db.doc('admin/challengeNotes').set({ 3: '' }, { merge: true }));
  await assertFails(db.doc('admin/challengeNotes').set({ day3: 'note' }, { merge: true }));
  await assertFails(db.doc('admin/challengeNotes').set({ 3: { html: 'x' } }, { merge: true }));
  await assertFails(db.doc('admin/challengeNotes').set({ 3: 'x'.repeat(200001) }, { merge: true }));
  await assertFails(db.doc('admin/challengeNotes').delete());
});

test('the admins list holds lowercase addresses only, and only the owner writes it', async () => {
  const owner = track(env.authenticatedContext('owner-list', OWNER)).firestore();
  await assertSucceeds(owner.doc('config/admins').set({ emails: [ADMIN2.email, 'friend@gmail.com'] }));
  await assertFails(owner.doc('config/admins').set({ emails: [ADMIN2.email, 'Friend@Gmail.com'] }));
  await assertFails(owner.doc('config/admins').set({ emails: ['not-an-address'] }));
  await assertFails(owner.doc('config/admins').set({ emails: [ADMIN2.email], note: 'x' }));
  await assertFails(owner.doc('config/admins').set({ emails: Array.from({ length: 51 }, (_, i) => 'a' + i + '@gmail.com') }));
  await assertSucceeds(owner.doc('config/admins').set({ emails: [] }));
  await assertSucceeds(owner.doc('config/admins').delete());
  // the admin page's own writes: one address added or removed
  const { arrayUnion, arrayRemove } = require('firebase/firestore');
  await assertSucceeds(owner.doc('config/admins').set({ emails: arrayUnion('new@gmail.com') }, { merge: true }));
  await assertFails(owner.doc('config/admins').set({ emails: arrayUnion('New@Gmail.com') }, { merge: true }));
  await assertSucceeds(owner.doc('config/admins').set({ emails: arrayRemove('new@gmail.com') }, { merge: true }));
  // nobody else
  const admin = track(env.authenticatedContext('admin2-list', ADMIN2)).firestore();
  await assertFails(admin.doc('config/admins').set({ emails: arrayUnion('x@gmail.com') }, { merge: true }));
  await assertFails(admin.doc('config/admins').delete());
});
