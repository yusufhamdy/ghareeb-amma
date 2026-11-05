"use strict";
/*
 * publish-emulator.test.js - Phase 5, test T-36: runs scripts/checks/publish-emulator.mjs (the publish command end to
 * end, reading the Firestore emulator with the Firestore client, then the share images in Chromium) inside the Firestore
 * emulator. Its own config and ports, so it can run next to the other suites. Skipped when Java is not available.
 * ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { ensureFirestoreEmulator } = require("../scripts/checks/emulator-setup.js");

const ROOT = path.resolve(__dirname, "..");

test("T-36: the publish command end to end against the emulator", { timeout: 540000 }, (t) => {
  const java = spawnSync("java", ["-version"], { encoding: "utf8" });
  if (java.error || java.status !== 0) { t.skip("java not available"); return; }
  ensureFirestoreEmulator(ROOT);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghareeb-publish-emu-"));
  fs.writeFileSync(path.join(dir, "firebase.json"), JSON.stringify({ emulators: { firestore: { port: 8680 }, hub: { port: 4450 }, logging: { port: 4550 }, ui: { enabled: false } } }));
  const script = path.join(ROOT, "scripts", "checks", "publish-emulator.mjs");
  try {
    const r = spawnSync(`npx firebase emulators:exec --config "${path.join(dir, "firebase.json")}" --project demo-ghareeb --only firestore "node \\"${script.replace(/\\/g, "/")}\\""`, { cwd: ROOT, encoding: "utf8", shell: true, timeout: 520000, maxBuffer: 1 << 26 });
    const out = (r.stdout || "") + (r.stderr || "");
    t.diagnostic(out.split("\n").filter((l) => /^(ok |FAIL|ALL CHECKS|\d+ FAILED)/.test(l)).join("\n"));
    assert.ok(out.includes("ALL CHECKS PASSED"), "the emulator check did not pass\n" + out.split("\n").filter((l) => /^(ok |FAIL|\d+ FAILED|Error|publish-)/.test(l)).join("\n").slice(-4000));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
