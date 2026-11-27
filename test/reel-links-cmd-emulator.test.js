"use strict";
/*
 * reel-links-cmd-emulator.test.js - scripts/reel-links.mjs writes only a day's empty link fields, never overwrites a set
 * link, refuses invalid links, missing days and a document that changed after it was read, and asks before writing
 * (scripts/checks/reel-links-cmd-emulator.mjs, in the Firestore emulator; no browser, no network).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const { ensureFirestoreEmulator } = require("../scripts/checks/emulator-setup.js");

const ROOT = path.resolve(__dirname, "..");

test("reel-links: only day N's empty link fields are written, in one checked transaction", { timeout: 300000 }, (t) => {
  const java = spawnSync("java", ["-version"], { encoding: "utf8" });
  if (java.error || java.status !== 0) { t.skip("java not available"); return; }
  ensureFirestoreEmulator(ROOT);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ghareeb-reel-"));
  fs.copyFileSync(path.join(ROOT, "firestore.rules"), path.join(dir, "firestore.rules"));
  fs.writeFileSync(path.join(dir, "firebase.json"), JSON.stringify({ firestore: { rules: "firestore.rules" }, emulators: { firestore: { port: 8981 }, hub: { port: 4481 }, logging: { port: 4581 }, ui: { enabled: false } } }));
  const script = path.join(ROOT, "scripts", "checks", "reel-links-cmd-emulator.mjs");
  try {
    const r = spawnSync(`npx firebase emulators:exec --config "${path.join(dir, "firebase.json")}" --project demo-ghareeb --only firestore "node \\"${script.replace(/\\/g, "/")}\\""`, { cwd: ROOT, encoding: "utf8", shell: true, timeout: 280000, maxBuffer: 1 << 26 });
    const out = (r.stdout || "") + (r.stderr || "");
    t.diagnostic(out.split("\n").filter((l) => /^(PASS|FAIL|[0-9]+ CHECKS)/.test(l)).join("\n"));
    assert.ok(out.includes("ALL CHECKS PASSED"), "the emulator check did not pass\n" + out.split("\n").filter((l) => /^(PASS|FAIL|ALL|[0-9]+ CHECKS)/.test(l)).join("\n"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
