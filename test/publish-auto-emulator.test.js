"use strict";
/*
 * publish-auto-emulator.test.js - runs scripts/checks/publish-auto-emulator.mjs (the automatic publish's commands, in
 * the workflow's order, against the Firestore emulator, case by case) inside the emulator. Its own config and ports,
 * so it can run next to the other suites. Skipped when Java is not available. ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { ensureFirestoreEmulator } = require("../scripts/checks/emulator-setup.js");

const ROOT = path.resolve(__dirname, "..");

test("the automatic publish against the emulator: no-op, edit, delete with redirect, limits, import, restore, failing check", { timeout: 540000 }, (t) => {
  const java = spawnSync("java", ["-version"], { encoding: "utf8" });
  if (java.error || java.status !== 0) { t.skip("java not available"); return; }
  ensureFirestoreEmulator(ROOT);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghareeb-auto-emu-"));
  fs.writeFileSync(path.join(dir, "firebase.json"), JSON.stringify({ emulators: { firestore: { port: 8880 }, hub: { port: 4470 }, logging: { port: 4570 }, ui: { enabled: false } } }));
  const script = path.join(ROOT, "scripts", "checks", "publish-auto-emulator.mjs");
  try {
    const r = spawnSync(`npx firebase emulators:exec --config "${path.join(dir, "firebase.json")}" --project demo-ghareeb --only firestore "node \\"${script.replace(/\\/g, "/")}\\""`, { cwd: ROOT, encoding: "utf8", shell: true, timeout: 520000, maxBuffer: 1 << 26 });
    const out = (r.stdout || "") + (r.stderr || "");
    const lines = out.split("\n").filter((l) => /^(ok |FAIL|==|ALL CHECKS|\d+ FAILED)/.test(l));
    t.diagnostic(lines.join("\n"));
    assert.ok(out.includes("ALL CHECKS PASSED"), "the emulator check did not pass\n" + lines.join("\n"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
