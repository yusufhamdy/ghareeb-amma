/*
 * rules-emulator.test.js
 *
 * Live Firestore rules tests executed against the Firestore Emulator.
 * Run with:  npm run rules:test
 * (which wraps `firebase emulators:exec --project demo-ghareeb --only firestore
 *  "node --test test/rules-emulator.test.js"`).
 *
 * When executed without the emulator environment variables (e.g. plain
 * `npm test`), this file self-skips so the default test run stays green.
 *
 * Contexts follow the production auth model in firestore.rules:
 *   - owner  : yusufhamdy20@gmail.com (email_verified = true)
 *   - admin  : any verified email listed in config/admins.emails
 *   - public : world-readable; writes only for admins
 *   - admin/challengeNotes: admin-only
 */
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_EMULATOR_HOST;

if (!EMULATOR_HOST) {
  console.log('SKIP rules-emulator: Firestore emulator not running. Use `npm run rules:test`.');
  process.exit(0);
}

const OWNER = { email: 'yusufhamdy20@gmail.com', email_verified: true };
const ADMIN2 = { email: 'admin2@example.com', email_verified: true };
const USER = { email: 'user@example.com', email_verified: true };
const PROJECT_ID = 'demo-ghareeb';

let env;
let contexts = [];

function track(ctx) {
  contexts.push(ctx);
  return ctx;
}

async function loadRulesEnv() {
  const [host, port] = EMULATOR_HOST.split(':');
  return initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
      host,
      port: Number(port)
    }
  });
}

before(async () => {
  env = await loadRulesEnv();
  await env.clearFirestore();
});

after(async () => {
  for (const ctx of contexts) { try { await ctx.cleanup(); } catch (_) { /* ignore */ } }
  contexts = [];
  if (env) await env.cleanup();
});

test('unauthenticated can read every public document', async () => {
  const u = track(env.unauthenticatedContext());
  for (const p of ['public/data', 'public/challenge']) {
    await assertSucceeds(u.firestore().doc(p).get());
  }
});

test('unauthenticated cannot write or delete public documents', async () => {
  const u = track(env.unauthenticatedContext());
  await assertFails(u.firestore().doc('public/data').set({ surahs: [] }));
  await assertFails(u.firestore().doc('public/challenge').delete());
});

test('unauthenticated cannot read admin or config documents', async () => {
  const u = track(env.unauthenticatedContext());
  await assertFails(u.firestore().doc('admin/challengeNotes').get());
  await assertFails(u.firestore().doc('config/admins').get());
  await assertFails(u.firestore().doc('config/anything').get());
});

test('catch-all denies any other collection (read, list, write)', async () => {
  const u = track(env.unauthenticatedContext());
  await assertFails(u.firestore().doc('users/u1').get());
  await assertFails(u.firestore().collection('users').get());
  await assertFails(u.firestore().doc('admin/other').set({ x: 1 }));
});

test('owner has full public + admin + config/admins control', async () => {
  const o = track(env.authenticatedContext('owner', OWNER));
  const publicData = { rev: 1, surahs: [{ surah: 'سورة الناس', no: 114, words: ['x'], meanings: ['m'], ayahs: [], source: 's' }] };
  await assertSucceeds(o.firestore().doc('public/data').set(publicData));
  const snap = await assertSucceeds(o.firestore().doc('public/data').get());
  assert.strictEqual(snap.data().surahs[0].no, 114, 'owner-written public data round-trips with no field');
  await assertSucceeds(o.firestore().doc('admin/challengeNotes').set({ 1: 'private' }));
  await assertSucceeds(o.firestore().doc('admin/challengeNotes').get());
  await assertSucceeds(o.firestore().doc('admin/challengeNotes').delete());
  await assertSucceeds(o.firestore().doc('config/admins').set({ emails: [OWNER.email, ADMIN2.email] }));
  await assertSucceeds(o.firestore().doc('config/admins').get());
});

test('granted admin manages public + notes but cannot write config/admins', async () => {
  // seed config/admins as owner (fresh write ensures rule state)
  const o = track(env.authenticatedContext('seed-owner', OWNER));
  await assertSucceeds(o.firestore().doc('config/admins').set({ emails: [OWNER.email, ADMIN2.email] }));

  const a = track(env.authenticatedContext('admin2', ADMIN2));
  await assertSucceeds(a.firestore().doc('public/data').get());
  await assertSucceeds(a.firestore().doc('public/data').set({ rev: 2, surahs: [] }));
  await assertSucceeds(a.firestore().doc('admin/challengeNotes').get());
  await assertSucceeds(a.firestore().doc('admin/challengeNotes').set({ 2: 'allowed' }));
  await assertFails(a.firestore().doc('config/admins').set({ emails: [ADMIN2.email] }));
  await assertSucceeds(a.firestore().doc('config/admins').get());
});

test('plain verified user is not an admin and gets no admin access', async () => {
  const u = track(env.authenticatedContext('user', USER));
  await assertFails(u.firestore().doc('public/data').set({ rev: 3, surahs: [] }));
  await assertFails(u.firestore().doc('admin/challengeNotes').get());
  await assertFails(u.firestore().doc('admin/challengeNotes').set({ x: 1 }));
  await assertFails(u.firestore().doc('config/admins').get());
});

test('email_verified=false is treated as unauthenticated for admin checks', async () => {
  const o = track(env.authenticatedContext('unverified', { email: OWNER.email, email_verified: false }));
  await assertSucceeds(o.firestore().doc('public/data').get());
  await assertFails(o.firestore().doc('public/data').set({ rev: 4, surahs: [] }));
  await assertFails(o.firestore().doc('admin/challengeNotes').get());
});

test('admin only controls their own scope: no writes to unreachable paths', async () => {
  const a = track(env.authenticatedContext('admin2-scope', ADMIN2));
  await assertFails(a.firestore().doc('users/u9').set({ x: 1 }));
  await assertFails(a.firestore().doc('admin/other').set({ x: 1 }));
});