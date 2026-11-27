// scripts/reel-links.mjs against the Firestore emulator (run inside `firebase emulators:exec`, see
// test/reel-links-cmd-emulator.test.js). A synthetic challenge document; the command runs with --links-json, so no browser
// and no network. Prints PASS/FAIL lines and "ALL CHECKS PASSED". ASCII only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const C = require("../reel-links-core.js");
const { initializeApp } = await import("firebase-admin/app");
const { getFirestore } = await import("firebase-admin/firestore");

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.log("FAIL no emulator (FIRESTORE_EMULATOR_HOST)"); process.exit(1); }
const PROJECT = "demo-ghareeb";
const db = getFirestore(initializeApp({ projectId: PROJECT }));
const ref = db.collection("public").doc("challenge");
const SEED = {
  startDate: "2026-11-21",
  releasedUpTo: 3,
  days: [
    { d: 1, w: [{ no: 78, word: "w1" }], reel: "", reelIg: "https://www.instagram.com/reel/AAAAAAAAAAA/" },
    { d: 2, w: [{ no: 79, word: "w2" }, { no: 80, word: "w3" }], reel: "https://www.youtube.com/shorts/OLDOLDOLD00" },
    { d: 3, w: [{ no: 81, word: "w4" }], reel: "" },
  ],
};
const LINKS = { reelIg: "https://www.instagram.com/reel/BBBBBBBBBBB/", reelTt: "https://www.tiktok.com/@u/video/7712905769926003986", reelYt: "https://www.youtube.com/shorts/VBe6C_Ts9j0" };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ghareeb-reel-"));
const lf = path.join(tmp, "links.json"); fs.writeFileSync(lf, JSON.stringify(LINKS));
const run = (args) => spawnSync(process.execPath, [path.join(ROOT, "scripts", "reel-links.mjs"), ...args, "--project", PROJECT], { cwd: ROOT, encoding: "utf8", env: process.env, input: "" });
const read = async () => (await ref.get()).data();
let fails = 0, n = 0;
const check = (ok, name) => { n++; if (!ok) fails++; console.log((ok ? "PASS " : "FAIL ") + name); };

try {
  await ref.set(SEED);

  let r = run(["--day", "1", "--links-json", lf]);
  check(/Stopped: nothing written/.test(r.stdout) && C.canon(await read()) === C.canon(SEED), "without --yes and no terminal: asks, gets no yes, writes nothing");

  r = run(["--day", "1", "--links-json", lf, "--yes"]);
  let doc = await read();
  check(r.status === 0 && /Written: reelTt, reelYt/.test(r.stdout), "day 1: writes the two empty fields");
  check(doc.days[0].reelIg === SEED.days[0].reelIg && /already set, not changed: reelIg/.test(r.stdout), "day 1: the set Instagram link is kept and reported");
  check(doc.days[0].reelTt === LINKS.reelTt && doc.days[0].reelYt === LINKS.reelYt, "day 1: TikTok and YouTube links written");
  check(C.sameExcept(SEED, doc, 0, ["reelTt", "reelYt"]), "every other field of the document is unchanged");
  check(/Publish: not started \(emulator\)/.test(r.stdout), "no Publish against the emulator");

  const after1 = doc;
  r = run(["--day", "1", "--links-json", lf, "--yes"]);
  check(/Nothing to write/.test(r.stdout) && C.canon(await read()) === C.canon(after1), "a second run writes nothing");

  const bad = path.join(tmp, "bad.json"); fs.writeFileSync(bad, JSON.stringify({ reelYt: "https://www.youtube.com/watch?v=VBe6C_Ts9j0" }));
  r = run(["--day", "3", "--links-json", bad, "--yes"]);
  check(r.status !== 0 && C.canon(await read()) === C.canon(after1), "an invalid link is refused, nothing written");

  r = run(["--day", "9", "--links-json", lf, "--yes"]);
  check(r.status !== 0 && /not in the challenge/.test(r.stderr) && C.canon(await read()) === C.canon(after1), "a day that isn't in the challenge is refused");

  const stale = JSON.parse(JSON.stringify(after1)); stale.releasedUpTo = 2;
  let refused = false; try { await C.writeLinks(db, 3, LINKS, stale); } catch (e) { refused = /changed after it was read/.test(e.message); }
  check(refused && C.canon(await read()) === C.canon(after1), "a document that changed after it was read is refused, nothing written");

  r = run(["--day", "2", "--links-json", lf, "--yes"]);
  doc = await read();
  check(r.status === 0 && doc.days[1].reel === SEED.days[1].reel && doc.days[1].reelIg === LINKS.reelIg && C.sameExcept(after1, doc, 1, ["reelIg", "reelTt", "reelYt"]), "day 2: three links written; its old single link and the other days unchanged");
} catch (e) {
  check(false, "unexpected error: " + e.message.split("\n")[0]);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(n + " CHECKS, " + fails + " FAILED");
if (!fails) console.log("ALL CHECKS PASSED");
process.exit(fails ? 1 : 0);
