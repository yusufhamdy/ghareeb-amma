"use strict";
/*
 * backup-rehearsal-emulator.test.js - T-41: runs scripts/checks/backup-e2e.mjs (fake data, a throwaway key, the real export,
 * seal, upload and rehearsal scripts) inside the Firestore emulator. Its own config and ports, so it can run next to the
 * other suites. Skipped when Java is not available. ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { ensureFirestoreEmulator } = require("../scripts/checks/emulator-setup.js");

const ROOT = path.resolve(__dirname, "..");

test("T-41: a backup restores into the emulator, and the rules still hold", { timeout: 300000 }, (t) => {
  const java = spawnSync("java", ["-version"], { encoding: "utf8" });
  if (java.error || java.status !== 0) { t.skip("java not available"); return; }
  ensureFirestoreEmulator(ROOT);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghareeb-backup-"));
  fs.copyFileSync(path.join(ROOT, "firestore.rules"), path.join(dir, "firestore.rules"));
  fs.writeFileSync(path.join(dir, "firebase.json"), JSON.stringify({ firestore: { rules: "firestore.rules" }, emulators: { firestore: { port: 8580 }, hub: { port: 4440 }, logging: { port: 4540 }, ui: { enabled: false } } }));
  const script = path.join(ROOT, "scripts", "checks", "backup-e2e.mjs");
  try {
    const r = spawnSync(`npx firebase emulators:exec --config "${path.join(dir, "firebase.json")}" --project demo-ghareeb --only firestore "node \\"${script.replace(/\\/g, "/")}\\""`, { cwd: ROOT, encoding: "utf8", shell: true, timeout: 280000, maxBuffer: 1 << 26 });
    const out = (r.stdout || "") + (r.stderr || "");
    t.diagnostic(out.split("\n").filter((l) => /^(FAIL|==|\d+ passed)/.test(l)).join("\n"));
    assert.ok(out.includes("ALL CHECKS PASSED"), "the check did not pass\n" + out.slice(-3000));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
