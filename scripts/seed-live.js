#!/usr/bin/env node
/*
 * seed-live.js - writes migrated data to the LIVE Firestore project.
 *
 * INERT BY DEFAULT. This tool refuses to run unless ALL of these are true:
 *   1. --allow-live is passed explicitly, AND
 *   2. env GHAREEB_LIVE_SEED_AUTHORIZED=1 is set (owner approval signal), AND
 *   3. --confirm is passed after reviewing the printed plan.
 * No emulator host may be set while running this tool, and the project id is
 * taken from .firebaserc (never a PASTE placeholder).
 *
 * Phase 5B DOES NOT call this tool. Live provisioning/seeding is a Phase 7
 * operation that happens only after its own explicit owner approval.
 */
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("fs");
const path = require("path");
const { buildFirestoreData, buildFirestoreChallenge } = require("../src/utils/migrate");

const argv = process.argv.slice(2);
const allowLive = argv.includes("--allow-live");
const confirm = argv.includes("--confirm");

if (!allowLive || process.env.GHAREEB_LIVE_SEED_AUTHORIZED !== "1" || confirm === false) {
  console.log(
    "seed-live: REFUSING to run. Requires --allow-live AND env GHAREEB_LIVE_SEED_AUTHORIZED=1 " +
      "(owner approval) AND --confirm after reviewing the plan.",
  );
  if (argv.includes("--confirm") && !allowLive) {
    console.log("seed-live: --confirm without --allow-live is ignored.");
  }
  process.exit(0);
}

if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_EMULATOR_HOST) {
  console.log("seed-live: refusing while a Firestore emulator host is set.");
  process.exit(1);
}

const { readFileSync } = fs;
const rc = JSON.parse(readFileSync(path.join(__dirname, "..", ".firebaserc"), "utf8"));
const projectId = rc && rc.projects && rc.projects.default;
if (!projectId || /PASTE|PROJECT_ID/.test(projectId)) {
  console.log("seed-live: refusing: default project id looks like a placeholder.");
  process.exit(1);
}

if (!confirm) {
  const words = JSON.parse(readFileSync(path.join(__dirname, "..", "ghareeb-handoff/data/words.json"), "utf8"));
  const plan = buildFirestoreData(words);
  console.log(`seed-live: PLAN for project ${projectId}:\n  set public/data         (${plan.surahs.length} surahs, rev ${plan.rev})\n  set public/challenge\n  set admin/challengeNotes`);
  console.log("seed-live: rerun with --confirm to apply. Nothing was written.");
  process.exit(0);
}

initializeApp({ projectId });
const db = getFirestore();

async function run() {
  const words = JSON.parse(readFileSync(path.join(__dirname, "..", "ghareeb-handoff/data/words.json"), "utf8"));
  const challenge = JSON.parse(readFileSync(path.join(__dirname, "..", "ghareeb-handoff/data/challenge.json"), "utf8"));
  let notes = {};
  try {
    notes = JSON.parse(readFileSync(path.join(__dirname, "..", "data/challenge-notes-private.json"), "utf8"));
  } catch (_) {}
  const dataDoc = buildFirestoreData(words);
  const challengeDoc = buildFirestoreChallenge(challenge);
  await db.doc("public/data").set(dataDoc);
  await db.doc("public/challenge").set(challengeDoc);
  await db.doc("admin/challengeNotes").set(notes);
  console.log(`seed-live: wrote migrated data to LIVE project ${projectId} (surahs=${dataDoc.surahs.length}).`);
}
run().catch((e) => {
  console.error(e);
  process.exit(1);
});