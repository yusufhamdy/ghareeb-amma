#!/usr/bin/env node
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');
const { normalizeArabic } = require('../src/utils/normalize');

if (process.env.FIREBASE_EMULATOR_HOST) {
  admin.initializeApp({ projectId: 'ghareebalquran-d9ae5' });
} else {
  console.log('No emulator host set; exiting');
  process.exit(0);
}
const db = admin.firestore();
async function run() {
  const words = JSON.parse(fs.readFileSync(path.join(__dirname, '../ghareeb-handoff/data/words.json'), 'utf8'));
  const challenge = JSON.parse(fs.readFileSync(path.join(__dirname, '../ghareeb-handoff/data/challenge.json'), 'utf8'));
  let notes = {};
  try {
    notes = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/challenge-notes-private.json'), 'utf8'));
  } catch (e) {}
  // write public/data
  await db.doc('public/data').set(words);
  await db.doc('public/challenge').set(challenge);
  // write private notes to admin/challengeNotes
  await db.doc('admin/challengeNotes').set(notes);
  console.log('Seeded emulator');
}
run().catch(e => { console.error(e); process.exit(1); });

