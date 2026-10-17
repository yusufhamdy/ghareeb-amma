"use strict";
/*
 * phase-h.test.js - Phase H acceptance (one section added per step):
 *   H1 the CI harness matches the current UI (day screen = collapsible cards,
 *      not list rows) and every __DATA_SRC__ read waits for it to leave
 *      'pending'; the edited scripts parse; client:verify passes when the
 *      Firestore emulator and Java are available locally.
 *
 * Files here are ASCII only (Arabic only as \uXXXX escapes).
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// every harness/config file under scripts/ and tools/ (docs are not harness)
function harnessFiles() {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(mjs|js|json)$/.test(e.name)) out.push(f);
    }
  };
  walk(path.join(ROOT, "scripts"));
  walk(path.join(ROOT, "tools"));
  return out;
}

test("H1: no harness still targets the removed day list rows", () => {
  const stale = [];
  for (const f of harnessFiles()) {
    const s = fs.readFileSync(f, "utf8");
    if (/#dw[^"'`]*\.list/.test(s)) stale.push(path.relative(ROOT, f));
  }
  assert.deepEqual(stale, [], "stale '#dw .list...' selectors found");

  const vcf = read("scripts/verify-client-firestore.mjs");
  assert.ok(vcf.includes("'#dw .dcard'"), "verify-client-firestore waits for the day cards");
  assert.ok(vcf.includes("page.$$('#dw .dcard')"), "verify-client-firestore opens every day card");
  const sui = read("scripts/smoke-ui.mjs");
  assert.ok(sui.includes("'#dw .dcard'"), "smoke-ui waits for the day cards");
  // the assertions that describe still-existing UI stay byte-identical
  assert.ok(vcf.includes("'#app .list.sl .row'"), "surah-row assertion kept");
  assert.ok(sui.includes("'#app .list.g .row'"), "surah word-row assertion kept");
});

test("H1: every __DATA_SRC__ read is preceded by a wait for 'pending' to clear", () => {
  const qa = read("scripts/qa-phase6.mjs");
  const reads = (qa.match(/page\.evaluate\(\(\) => window\.__DATA_SRC__\)/g) || []).length;
  const waits = (qa.match(/waitForFunction\(\(\) => window\.__DATA_SRC__/g) || []).length;
  assert.ok(reads >= 2, "both reads are present (found " + reads + ")");
  assert.equal(waits, reads, "one wait per read (waits=" + waits + ", reads=" + reads + ")");
  for (const f of ["scripts/smoke-ui.mjs", "scripts/verify-client-firestore.mjs"]) {
    // both existing guards are of the shape "() => typeof window.__DATA_SRC__ === ..."
    assert.ok(
      /waitForFunction\(\(\) => (?:typeof )?window\.__DATA_SRC__/.test(read(f)),
      f + " waits for __DATA_SRC__"
    );
  }
});

test("H1: the edited harness scripts parse", () => {
  for (const f of [
    "scripts/verify-client-firestore.mjs",
    "scripts/smoke-ui.mjs",
    "scripts/qa-phase6.mjs",
  ]) {
    const r = spawnSync(process.execPath, ["--check", path.join(ROOT, f)], { encoding: "utf8" });
    assert.equal(r.status, 0, f + " --check failed: " + (r.stderr || "").trim());
  }
});

test("H1: npm run client:verify passes against the Firestore emulator", { timeout: 420000 }, (t) => {
  if (process.env.CI) { t.skip("CI runs client:verify in its own workflow"); return; }
  const fb = path.join(ROOT, "firebase.json");
  if (!fs.existsSync(fb) || !/"emulators"/.test(read("firebase.json"))) {
    t.skip("no emulators configured in firebase.json"); return;
  }
  const java = spawnSync("java", ["-version"], { encoding: "utf8" });
  if (java.error || java.status !== 0) { t.skip("java not available locally"); return; }
  // one shell string, no args array: runs on win32 too, no shell/args warning
  const r = spawnSync("npm run client:verify", {
    cwd: ROOT, encoding: "utf8", shell: true, timeout: 400000,
    env: Object.assign({}, process.env),
  });
  if (r.error) { t.skip("npm not runnable here: " + r.error.code); return; }
  const out = (r.stdout || "") + (r.stderr || "");
  assert.equal(
    r.status, 0,
    "client:verify failed:\n" + out.split(/\r?\n/).filter(Boolean).slice(-25).join("\n")
  );
  assert.ok(out.includes("CLIENT-VERIFY PASS"), "client:verify printed CLIENT-VERIFY PASS");
});
