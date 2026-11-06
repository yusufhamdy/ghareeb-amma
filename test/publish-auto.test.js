"use strict";
/*
 * publish-auto.test.js - the automatic publish (owner decision; handbook 4.2 and 10.4):
 *   - scripts/publish-plan.mjs: the cheap check (same rev and challenge = nothing to do), the Firestore REST decoding,
 *     and decide(): which removals go live by themselves (at most 7 words, each removed by an admin save of kind "edit"
 *     after the published rev) and which wait for the owner in a pull request;
 *   - .github/workflows/publish.yml and release.yml: the schedule, the gates, the permissions of each job, and that a
 *     failed check can reach neither the commit nor the deploy.
 * The same commands against the Firestore emulator: test/publish-auto-emulator.test.js. ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const YAML = require("yaml");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const loadPlan = () => import(pathToFileURL(path.join(ROOT, "scripts", "publish-plan.mjs")).href);
const loadBuild = () => import(pathToFileURL(path.join(ROOT, "scripts", "publish-build.mjs")).href);
const words = () => JSON.parse(fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8"));
const challenge = () => JSON.parse(fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8"));
const clone = (x) => JSON.parse(JSON.stringify(x));
const workflow = (f) => YAML.parse(fs.readFileSync(path.join(ROOT, ".github", "workflows", f), "utf8"));

// Firestore's shape, as the admin saves it: a "no" field, surahs from 78 up
async function toFirestore(list) {
  const b = await loadBuild();
  return clone(list).map((s) => ({ no: b.surahNumber(s.surah), ...s })).sort((a, c) => a.no - c.no);
}
// surahs with at least two words (removing one leaves the surah in place)
const multi = () => words().map((s, i) => [s.words.length, i]).filter(([n]) => n >= 2).map(([, i]) => i);
const removeAt = (list, si, wi) => { for (const k of ["words", "meanings", "ayahs"]) list[si][k].splice(wi, 1); return list; };
// the history the admin writes: one row and one snapshot per save, for revs P+1..N
async function history(steps) {
  const rows = new Map(), snaps = new Map();
  for (const [rev, kind, list] of steps) { rows.set(rev, { rev, kind }); snaps.set(rev, await toFirestore(list)); }
  return { rows, snaps };
}

// ------------------------------------------------------------------------------------------- the cheap check
test("check: the same rev and challenge is nothing to do; a new rev or a changed challenge is something", async () => {
  const p = await loadPlan();
  const site = fs.mkdtempSync(path.join(os.tmpdir(), "gq-plan-"));
  try {
    fs.copyFileSync(path.join(PUBLIC, "challenge.json"), path.join(site, "challenge.json"));
    fs.writeFileSync(path.join(site, "rev.json"), JSON.stringify({ rev: 7, hash: "x", words: 1 }));
    // the challenge as Firestore holds it (references as {no, word}) builds exactly the committed file
    const doc = clone(challenge()); doc.days = doc.days.map((d) => ({ ...d, w: d.w.map(([no, word]) => ({ no, word })) }));
    assert.strictEqual(p.challengeFile(doc), fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8"), "the check builds the challenge file exactly as the build does");
    assert.deepStrictEqual((({ same, revChanged, challengeChanged }) => ({ same, revChanged, challengeChanged }))(p.compare(site, 7, doc)), { same: true, revChanged: false, challengeChanged: false });
    assert.strictEqual(p.compare(site, 8, doc).same, false, "a new rev");
    assert.strictEqual(p.compare(site, 8, doc).revChanged, true);
    const edited = clone(doc); edited.releasedUpTo = 1;
    const c = p.compare(site, 7, edited);
    assert.strictEqual(c.same, false, "a challenge change with the same rev");
    assert.strictEqual(c.challengeChanged, true);
    assert.notStrictEqual(c.challengeHash, p.compare(site, 7, doc).challengeHash, "the state name changes with the challenge");
    assert.strictEqual(p.compare(site, null, doc).same, false, "no rev in Firestore is never the same");
    fs.writeFileSync(path.join(site, "rev.json"), "{}");
    assert.strictEqual(p.compare(site, 7, doc).same, false, "no published rev is never the same");
  } finally {
    fs.rmSync(site, { recursive: true, force: true });
  }
});

test("check: Firestore REST values decode to plain values", async () => {
  const p = await loadPlan();
  const v = p.fromRest({ mapValue: { fields: { rev: { integerValue: "8" }, a: { arrayValue: { values: [{ stringValue: "x" }, { nullValue: null }, { booleanValue: true }, { doubleValue: 1.5 }] } }, e: { arrayValue: {} }, m: { mapValue: {} } } } });
  assert.deepStrictEqual(v, { rev: 8, a: ["x", null, true, 1.5], e: [], m: {} });
  assert.throws(() => p.fromRest({ oddValue: 1 }), /unknown Firestore value type/);
});

// ------------------------------------------------------------------------------------------- decide()
test("decide: an edit or an addition goes live by itself", async () => {
  const p = await loadPlan();
  const committed = words(), next = clone(committed);
  next[3].meanings[0] += " (edited)";
  const r = p.decide({ committed, current: await toFirestore(next), publishedRev: 7, currentRev: 8, rows: new Map(), snaps: new Map() });
  assert.deepStrictEqual([r.mode, r.removed.length, r.reasons.length], ["auto", 0, 0]);
});

test("decide: one word deleted in the admin (a save of kind edit) goes live by itself", async () => {
  const p = await loadPlan();
  const committed = words(), next = removeAt(clone(committed), multi()[0], 0);
  const h = await history([[8, "edit", next]]);
  const r = p.decide({ committed, current: await toFirestore(next), publishedRev: 7, currentRev: 8, ...h });
  assert.strictEqual(r.mode, "auto", r.reasons.join("; "));
  assert.strictEqual(r.removed.length, 1);
});

test("decide: a whole surah deleted in the admin, at most 7 words, goes live by itself, with the surah listed", async () => {
  const p = await loadPlan();
  const b = await loadBuild();
  const committed = words();
  const si = committed.findIndex((s) => s.words.length >= 2 && s.words.length <= 3);
  const next = clone(committed); next.splice(si, 1);
  const h = await history([[8, "edit", removeAt(clone(committed), si, 0)], [9, "edit", next]]);
  const r = p.decide({ committed, current: await toFirestore(next), publishedRev: 7, currentRev: 9, ...h });
  assert.strictEqual(r.mode, "auto", r.reasons.join("; "));
  assert.deepStrictEqual(r.removedSurahs, [b.surahNumber(committed[si].surah)]);
  assert.strictEqual(r.removed.length, committed[si].words.length);
});

test("decide: 8 words deleted in the admin wait for the owner (a pull request), on a list where 8 is under the 10% guard", async () => {
  const p = await loadPlan();
  // 103 words: the build's own 10% guard allows 10, so only the 7-word limit sends this to a pull request
  const committed = words();
  const big = committed.findIndex((s) => s.words.length >= 2);
  for (let k = 0; k < 30; k++) { committed[big].words.push(committed[big].words[0]); committed[big].meanings.push(committed[big].meanings[0]); committed[big].ayahs.push({ ...clone(committed[big].ayahs[0]), label: String(200 + k) }); }
  let list = clone(committed); const steps = [];
  for (let k = 0; k < 8; k++) { list = removeAt(clone(list), big, list[big].words.length - 1); steps.push([8 + k, "edit", list]); }
  const r = p.decide({ committed, current: await toFirestore(list), publishedRev: 7, currentRev: 15, ...(await history(steps)) });
  assert.strictEqual(r.mode, "pr");
  assert.strictEqual(r.removed.length, 8);
  assert.ok(r.reasons.some((x) => /removes 8 words, more than 7/.test(x)), r.reasons.join("; "));
  // and 7 of them go live by themselves
  const seven = steps.slice(0, 7);
  const r7 = p.decide({ committed, current: await toFirestore(seven[6][2]), publishedRev: 7, currentRev: 14, ...(await history(seven)) });
  assert.strictEqual(r7.mode, "auto", r7.reasons.join("; "));
});

test("decide: words removed by an import or a restore wait for the owner", async () => {
  const p = await loadPlan();
  const M = multi();
  const committed = words(), next = removeAt(clone(committed), M[0], 0);
  for (const kind of ["import", "restore", "baseline"]) {
    const r = p.decide({ committed, current: await toFirestore(next), publishedRev: 7, currentRev: 8, ...(await history([[8, kind, next]])) });
    assert.strictEqual(r.mode, "pr", kind);
    assert.ok(r.reasons.some((x) => x.includes("kind " + kind)), kind + ": " + r.reasons.join("; "));
  }
  // an import removed the word, a later edit changed something else: the word was still removed by the import
  const later = clone(next); later[5].meanings[0] += " (edited)";
  const r = p.decide({ committed, current: await toFirestore(later), publishedRev: 7, currentRev: 9, ...(await history([[8, "import", next], [9, "edit", later]])) });
  assert.strictEqual(r.mode, "pr");
  // a word an import removed and a later save brought back is not removed; a word an edit removed is
  const back = removeAt(clone(committed), M[1], 0);
  const r2 = p.decide({ committed, current: await toFirestore(back), publishedRev: 7, currentRev: 9, ...(await history([[8, "import", next], [9, "edit", back]])) });
  assert.strictEqual(r2.mode, "auto", r2.reasons.join("; "));
});

test("decide: removals the history can't prove wait for the owner", async () => {
  const p = await loadPlan();
  const M = multi();
  const committed = words(), next = removeAt(clone(committed), M[0], 0);
  const h = await history([[8, "edit", clone(committed)], [9, "edit", next]]);
  const missingRow = { rows: new Map([[9, h.rows.get(9)]]), snaps: h.snaps };
  assert.strictEqual(p.decide({ committed, current: await toFirestore(next), publishedRev: 7, currentRev: 9, ...missingRow }).mode, "pr", "a missing history row");
  const missingSnap = { rows: h.rows, snaps: new Map([[9, h.snaps.get(9)]]) };
  assert.strictEqual(p.decide({ committed, current: await toFirestore(next), publishedRev: 7, currentRev: 9, ...missingSnap }).mode, "pr", "a missing snapshot");
  const other = removeAt(clone(committed), M[1], 0);
  assert.strictEqual(p.decide({ committed, current: await toFirestore(other), publishedRev: 7, currentRev: 9, ...h }).mode, "pr", "the data differs from its snapshot");
  assert.strictEqual(p.decide({ committed, current: await toFirestore(next), publishedRev: null, currentRev: 9, ...h }).mode, "pr", "no published rev");
  assert.strictEqual(p.decide({ committed, current: await toFirestore(next), publishedRev: 9, currentRev: 9, ...h }).mode, "pr", "the data rev is not after the published rev");
});

// ------------------------------------------------------------------------------------------- the workflows
test("publish.yml: every 15 minutes and by hand, on main, only while PUBLISH_ENABLED is true, never overlapping", () => {
  const w = workflow("publish.yml");
  assert.deepStrictEqual(w.on.schedule, [{ cron: "*/15 * * * *" }]);
  assert.ok("workflow_dispatch" in w.on);
  assert.deepStrictEqual(Object.keys(w.on).sort(), ["schedule", "workflow_dispatch"]);
  assert.deepStrictEqual(w.concurrency, { group: "publish", "cancel-in-progress": false });
  assert.deepStrictEqual(w.permissions, {}, "nothing by default; each job asks for its own");
  assert.match(w.jobs.check.if, /vars\.PUBLISH_ENABLED == 'true'/);
  assert.match(w.jobs.check.if, /github\.ref == 'refs\/heads\/main'/);
});

test("publish.yml: each job has only the permissions it needs", () => {
  const j = workflow("publish.yml").jobs;
  assert.deepStrictEqual(j.check.permissions, { contents: "read", "id-token": "write" });
  assert.deepStrictEqual(j.build.permissions, { contents: "read", "id-token": "write" });
  assert.deepStrictEqual(j.commit.permissions, { contents: "write", "pull-requests": "write" });
  assert.deepStrictEqual(j.deploy.permissions, { contents: "read", "id-token": "write" });
  assert.deepStrictEqual(j.pr.permissions, { contents: "write", "pull-requests": "write" });
  assert.deepStrictEqual(j.remember.permissions, {});
  for (const k of ["commit", "pr", "remember"]) assert.ok(!(j[k].permissions || {})["id-token"], k + " gets no Google sign-in");
  for (const k of ["check", "build"]) assert.ok(!/write/.test(JSON.stringify({ c: j[k].permissions.contents })), k + " can't write the repository");
});

test("publish.yml: the same rev ends at the cheap check; it needs no npm install", () => {
  const j = workflow("publish.yml").jobs;
  const steps = j.check.steps.map((s) => s.run || s.uses || "");
  assert.ok(!steps.some((s) => /npm (ci|install)/.test(s)), "no npm install in the check");
  assert.ok(j.check.steps.some((s) => /publish-plan\.mjs check/.test(s.run || "")));
  assert.strictEqual(j.build.needs, "check");
  assert.strictEqual(j.build.if, "needs.check.outputs.changed == 'true'");
  const auth = j.check.steps.find((s) => /google-github-actions\/auth/.test(s.uses || ""));
  assert.strictEqual(auth.with.service_account, "ghareeb-backup@ghareebalquran-d9ae5.iam.gserviceaccount.com", "read-only account");
  assert.strictEqual(auth.with.create_credentials_file, false, "no credential file in the check");
});

test("publish.yml: a failed check reaches neither the commit nor the deploy nor a pull request", () => {
  const j = workflow("publish.yml").jobs;
  const names = j.build.steps.map((s) => s.name);
  const at = (re) => { const i = j.build.steps.findIndex((s) => re.test(s.run || "")); assert.ok(i >= 0, "missing step " + re); return i; };
  const result = names.indexOf("Result");
  assert.strictEqual(result, names.length - 1, "the result is the last step");
  for (const re of [/^npm test$/, /^npm run rules:test$/, /csp-update\.mjs --check/, /scripts\/ci\/checks\.mjs/, /check-private\.ps1/, /publish-build\.mjs --publish/, /publish-plan\.mjs plan/]) assert.ok(at(re) < result, re + " runs before the result");
  const guard = names.indexOf("No Google credential is left");
  assert.ok(guard >= 0 && guard < at(/^npm test$/), "the credential guard runs before the tests");
  assert.ok(!j.build.steps[guard].if, "the credential guard always runs");
  assert.ok(names.indexOf("Remove the Google credential and the planned data") < guard);
  assert.ok(!j.build.steps[result].if, "the result step has no condition: it is reached only when every step before it passed");
  assert.ok(j.build.steps.every((s) => !s["continue-on-error"]) && !j.build["continue-on-error"], "no step may fail quietly");
  assert.strictEqual(j.commit.needs, "build");
  assert.strictEqual(j.commit.if, "needs.build.outputs.result == 'auto'");
  assert.strictEqual(j.pr.needs, "build");
  assert.strictEqual(j.pr.if, "needs.build.outputs.result == 'pr'");
  assert.strictEqual(j.deploy.needs, "commit");
  assert.strictEqual(j.deploy.if, "needs.commit.outputs.sha != ''");
  // the commit job pushes only the tested commit, on its base, never forced
  const push = j.commit.steps.find((s) => /git push/.test(s.run || "")).run;
  assert.ok(!/--force/.test(push), "the push to main is never forced");
  assert.match(push, /"\$\(git rev-parse origin\/main\)" != "\$BASE"/);
  assert.match(push, /git push origin "\$head:refs\/heads\/main"/);
});

test("publish.yml: an auto-publish is deployed by release.yml, the one deploy path", () => {
  const w = workflow("publish.yml");
  assert.strictEqual(w.jobs.deploy.uses, "./.github/workflows/release.yml");
  assert.deepStrictEqual(w.jobs.deploy.with, { sha: "${{ needs.commit.outputs.sha }}" });
  assert.strictEqual(w.jobs.deploy.secrets, "inherit");
  const text = JSON.stringify(w);
  assert.ok(!/firebase deploy/.test(text), "publish.yml never deploys by itself");
  const r = workflow("release.yml");
  assert.deepStrictEqual(r.on.push, { branches: ["main"] }, "Release still runs on a merge");
  assert.ok(r.on.workflow_call && r.on.workflow_call.inputs.sha.required, "Release can be called with the commit");
  const steps = r.jobs.release.steps;
  assert.strictEqual(steps.find((s) => /^Checkout/.test(s.name)).with.ref, "${{ inputs.sha || github.sha }}");
  const verify = steps.find((s) => /latest origin\/main/.test(s.name));
  assert.strictEqual(verify.env.TARGET, "${{ inputs.sha || github.sha }}");
  assert.match(verify.run, /git rev-parse origin\/main\)" != "\$TARGET"/);
  const order = steps.map((s) => s.name);
  assert.ok(order.indexOf("Run the full test suite (no deploy on any failure)") < order.indexOf("Deploy Hosting"));
});

test("publish.yml: a removal over the limits opens the pull request; the auto path closes one it replaces", () => {
  const j = workflow("publish.yml").jobs;
  const pr = j.pr.steps.find((s) => /gh pr create/.test(s.run || "")).run;
  assert.match(pr, /git push --force origin "refs\/publish\/new:refs\/heads\/publish\/next"/);
  assert.ok(!/refs\/heads\/main/.test(pr), "the PR job never pushes main");
  assert.ok(j.commit.steps.some((s) => /gh pr close/.test(s.run || "")));
});
