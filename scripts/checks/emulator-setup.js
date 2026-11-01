"use strict";
/*
 * emulator-setup.js - gets the Firestore emulator onto this machine before an emulator suite starts it, one suite at a
 * time. `npm test` runs test files side by side: on a machine with no cached emulator (every CI run), two suites would
 * download the same file at once and one could start from an incomplete copy. The lock is a directory, because creating
 * one is atomic. ASCII only.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const LOCK = path.join(os.tmpdir(), "ghareeb-emulator-setup.lock");
const STALE_MS = 10 * 60 * 1000;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// The setup command always downloads, and copies over the cached jar in place: done while another suite's emulator is
// running from that jar, it can fail or damage it. So it runs only when this version's complete jar is not there yet.
function hasCompleteJar() {
  try {
    const d = require("firebase-tools/lib/emulator/downloadableEmulators").getDownloadDetails("firestore");
    return fs.statSync(d.downloadPath).size === d.opts.expectedSize;
  } catch (_) { return false; }
}

function ensureFirestoreEmulator(cwd) {
  for (;;) {
    try { fs.mkdirSync(LOCK); break; } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let age = 0;
      try { age = Date.now() - fs.statSync(LOCK).mtimeMs; } catch (_) { continue; } // released just now
      if (age > STALE_MS) { try { fs.rmdirSync(LOCK); } catch (_) { /* another suite took it */ } continue; } // left by a killed run
      sleep(500);
    }
  }
  try {
    if (hasCompleteJar()) return;
    const r = spawnSync("npx firebase setup:emulators:firestore", { cwd, encoding: "utf8", shell: true, timeout: STALE_MS - 60000 });
    if (r.status !== 0) throw new Error("could not set up the Firestore emulator\n" + (r.stdout || "") + (r.stderr || ""));
  } finally {
    try { fs.rmdirSync(LOCK); } catch (_) { /* already gone */ }
  }
}

module.exports = { ensureFirestoreEmulator };
