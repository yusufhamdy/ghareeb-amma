#!/usr/bin/env node
/*
 * seed-emulator.js - seeds the Firestore emulator with the migrated data.
 *
 * Emulator-only by design. It refuses to run when no Firestore emulator host
 * is present, so it can never target the live project accidentally. Live
 * seeding is a separate, explicitly-inert tool (scripts/seed-live.js).
 *
 * Run with npm run seed (wrapped in firebase emulators:exec).
 *
 * Writes:
 *   public/data          -> { rev, surahs: [ { ..., no } ] }  (migrated: `no` added)
 *   public/challenge     -> challenge object (unchanged shape)
 *   admin/challengeNotes -> private per-day reflections (rules: admin-only)
 */
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("fs");
const path = require("path");
const { buildFirestoreData, buildFirestoreChallenge } = require("../src/utils/migrate");

const E = process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_EMULATOR_HOST;

if (!E) {
  console.log("seed-emulator: no Firestore emulator host set; exiting. (Run via `npm run seed`.)");
  process.exit(0);
}

initializeApp({ projectId: "demo-ghareeb" });
const db = getFirestore();

function readJSON(p) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", p), "utf8"));
}

async function run() {
  const words = readJSON("public/words.json");
  const challenge = readJSON("public/challenge.json");
  let notes = {};
  try {
    notes = readJSON("data/challenge-notes-private.json");
  } catch (_) {
    /* private file absent locally: seed an empty notes doc */
  }

  const dataDoc = buildFirestoreData(words);
  const challengeDoc = buildFirestoreChallenge(challenge);

  await db.doc("public/data").set(dataDoc);
  await db.doc("public/challenge").set(challengeDoc);
  await db.doc("admin/challengeNotes").set(notes);

  const back = (await db.doc("public/data").get()).data();
  const wordCount = back.surahs.reduce((n, s) => n + (s.words || []).length, 0);
  const missingNo = back.surahs.filter((s) => typeof s.no !== "number").length;
  console.log(
    `seed-emulator: public/data with ${back.surahs.length} surahs (${missingNo} missing no), ` +
      `${wordCount} words; public/challenge days=${(challenge.days || []).length}; ` +
      `admin/challengeNotes keys=${Object.keys(notes).length}`,
  );
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});