"use strict";
/*
 * admin-concurrent-emulator.test.js - runs scripts/checks/admin-concurrent-emulator.mjs (the real admin page, the real
 * rules, two tabs saving at the same moment) inside the auth + Firestore emulators. Its own config and ports, so it can
 * run next to the other suites. Skipped when Java is not available. ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { ensureFirestoreEmulator } = require("../scripts/checks/emulator-setup.js");

const ROOT = path.resolve(__dirname, "..");

test("two tabs saving at the same moment: different words both survive, the same field opens the picker, other refusals fail at once", { timeout: 300000 }, (t) => {
  const java = spawnSync("java", ["-version"], { encoding: "utf8" });
  if (java.error || java.status !== 0) { t.skip("java not available"); return; }
  ensureFirestoreEmulator(ROOT);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghareeb-concurrent-"));
  fs.copyFileSync(path.join(ROOT, "firestore.rules"), path.join(dir, "firestore.rules"));
  fs.writeFileSync(path.join(dir, "firebase.json"), JSON.stringify({ firestore: { rules: "firestore.rules" }, emulators: { auth: { port: 9299 }, firestore: { port: 8280 }, hub: { port: 4420 }, logging: { port: 4520 }, ui: { enabled: false } } }));
  const script = path.join(ROOT, "scripts", "checks", "admin-concurrent-emulator.mjs");
  try {
    const r = spawnSync(`npx firebase emulators:exec --config "${path.join(dir, "firebase.json")}" --project demo-ghareeb --only auth,firestore "node \\"${script.replace(/\\/g, "/")}\\""`, { cwd: ROOT, encoding: "utf8", shell: true, timeout: 280000, maxBuffer: 1 << 26 });
    const out = (r.stdout || "") + (r.stderr || "");
    t.diagnostic(out.split("\n").filter((l) => /^(PASS|FAIL|==)/.test(l)).join("\n"));
    assert.ok(out.includes("ALL CHECKS PASSED"), "the emulator check did not pass\n" + out.split("\n").filter((l) => /^(PASS|FAIL|==|ALL|[0-9]+ CHECKS)/.test(l)).join("\n"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
