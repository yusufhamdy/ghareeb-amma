"use strict";
/*
 * ci-speed.test.js - the faster CI and Release (handbook 7), without a weaker check:
 *   - scripts/ci/shard-tests.mjs: the file list is every file `npm test` runs; any number of shards covers each file
 *     exactly once, deterministically; merge fails on a missing, doubled, failed or other-commit shard;
 *   - ci.yml: 4 shards (2 files at a time), the checks job, the final Verify job that fails unless all passed, the
 *     Markdown-only path, the caches, and the verified-tree record Release reads;
 *   - release.yml: the decision to skip the suite, run in bash with a stub `gh`: it skips only for exactly the tested
 *     tree, from a passing ci.yml run in this repository for the merged pull request's head (or the Publish run's own
 *     checks); the CSP and smoke checks always run;
 *   - publish.yml: the tree it hands Release is recorded only when the commit holds the whole tested working tree.
 * ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");
const YAML = require("yaml");

const ROOT = path.resolve(__dirname, "..");
const workflow = (f) => YAML.parse(fs.readFileSync(path.join(ROOT, ".github", "workflows", f), "utf8"));
const shards = () => import(path.join(ROOT, "scripts", "ci", "shard-tests.mjs").replace(/\\/g, "/").replace(/^([A-Za-z]):/, "file:///$1:"));

test("shard-tests: the list is every test file npm test runs, and each shard plan covers each file exactly once", async () => {
  const m = await shards();
  const files = m.listTests();
  const tracked = execFileSync("git", ["ls-files", "test"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter((f) => /\.test\.js$/.test(f));
  assert.deepStrictEqual(files, tracked.sort(), "every tracked test/*.test.js file, and nothing else");
  assert.ok(files.includes("test/ci-speed.test.js") && files.length >= 60);
  assert.ok(!files.some((f) => /fixtures|node_modules/.test(f)));
  for (const of of [1, 2, 3, 4, 7]) {
    const p = m.plan(files, of), all = p.flatMap((s) => s.files);
    assert.strictEqual(p.length, of);
    assert.deepStrictEqual([...all].sort(), files, of + " shards: every file exactly once");
    assert.deepStrictEqual(JSON.stringify(m.plan(files, of)), JSON.stringify(p), of + " shards: the same plan every time");
  }
  // longest first onto the lightest shard
  const w = new Map([["a", 10], ["b", 9], ["c", 2], ["d", 1]]);
  assert.deepStrictEqual(m.plan(["a", "b", "c", "d"], 2, w).map((s) => s.files), [["a", "d"], ["b", "c"]]);
  const rec = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts", "ci", "shard-durations.json"), "utf8"));
  assert.ok(Object.values(rec).every((v) => typeof v === "number" && v >= 0), "the recorded durations are seconds");
});

test("shard-tests merge: fails on a missing, doubled, failed or other-commit shard; passes when all ran once", async () => {
  const m = await shards();
  const files = m.listTests(), plan = m.plan(files, 2), head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  const ok = (f) => ({ file: f, seconds: 1, exit: 0, ok: true, tests: 1, suites: 0, pass: 1, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  const merge = (reports) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shards-"));
    try {
      reports.forEach((r, i) => r && fs.writeFileSync(path.join(dir, "shard-" + (i + 1) + ".json"), JSON.stringify(r)));
      return spawnSync(process.execPath, [path.join(ROOT, "scripts", "ci", "shard-tests.mjs"), "merge", "--of", "2", "--dir", dir], { cwd: ROOT, encoding: "utf8" });
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  };
  const good = plan.map((s) => ({ shard: s.shard, of: 2, commit: head, files: s.files.map(ok) }));
  const r = merge(good);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp("files: " + files.length + " of " + files.length));
  assert.match(r.stdout, /every test file ran exactly once and passed/);
  const clone = () => JSON.parse(JSON.stringify(good));
  let c = clone(); c[1] = null;
  assert.match(merge(c).stdout, /shard 2 sent no report/);
  c = clone(); c[1].files.pop();
  assert.match(merge(c).stdout, /ran in no shard/);
  c = clone(); c[1].files.push(c[0].files[0]);
  assert.match(merge(c).stdout, /ran twice/);
  c = clone(); c[0].files[0].ok = false;
  assert.match(merge(c).stdout, /failed in shard 1/);
  c = clone(); c[0].commit = "0".repeat(40);
  assert.match(merge(c).stdout, /tested 0{40}/);
  for (const bad of [[null, good[1]], (() => { const x = clone(); x[0].files.push(ok("test/not-a-test.js")); return x; })()]) assert.notStrictEqual(merge(bad).status, 0);
});

test("ci.yml: four shards, the checks job, and Verify, which fails unless every job passed", () => {
  const w = workflow("ci.yml");
  assert.deepStrictEqual(w.on, { push: { branches: ["rebuild"] }, pull_request: null });
  assert.deepStrictEqual(w.permissions, { contents: "read" });
  const j = w.jobs;
  assert.deepStrictEqual(j.tests.strategy.matrix.shard, [1, 2, 3, 4]);
  assert.strictEqual(j.tests.strategy["fail-fast"], false, "a failing shard never hides another");
  const run = j.tests.steps.find((s) => /shard-tests\.mjs run/.test(s.run || "")).run;
  assert.match(run, /--shard \$\{\{ matrix\.shard \}\} --of 4 --jobs 2/, "2 files at a time on a 2-core runner");
  assert.strictEqual(j.tests.steps.find((s) => s.name === "Checkout").with["fetch-depth"], 0, "quran-text reads history");
  for (const k of ["tests", "checks"]) {
    assert.strictEqual(j[k].if, "needs.changes.outputs.code == 'true'");
    const names = j[k].steps.map((s) => s.uses || "");
    assert.ok(names.some((u) => /actions\/setup-java/.test(u)), k + ": Java for the emulators");
    const caches = j[k].steps.filter((s) => /actions\/cache@/.test(s.uses || ""));
    assert.deepStrictEqual(caches.map((s) => s.with.path), ["~/.cache/ms-playwright", "~/.cache/firebase/emulators"]);
    assert.match(caches[0].with.key, /steps\.v\.outputs\.playwright/);
    assert.match(caches[1].with.key, /steps\.v\.outputs\.firebase/);
    assert.strictEqual(j[k].steps.find((s) => /setup-node/.test(s.uses || "")).with.cache, "npm", k + ": the npm cache, keyed on package-lock.json");
  }
  const checks = j.checks.steps.map((s) => s.run || "").join("\n");
  for (const c of ["node scripts/ci/checks.mjs", "scripts/check-private.ps1", "npm run rules:test", "npm run client:verify"]) assert.ok(checks.includes(c), c);
  const v = j.verify;
  assert.strictEqual(v.name, "Verify");
  assert.deepStrictEqual(v.needs, ["changes", "tests", "checks"]);
  assert.strictEqual(v.if, "always()", "Verify reports a status for every outcome");
  const gate = v.steps.find((s) => s.name === "Every job passed");
  assert.match(gate.run, /\[ "\$TESTS" = success \] && \[ "\$CHECKS" = success \] \|\| \{ echo "::error::a test shard or the checks failed"; exit 1; \}/);
  assert.match(gate.run, /\[ "\$CHANGES" = success \] \|\|/);
  assert.match(v.steps.find((s) => /exactly once/.test(s.name)).run, /shard-tests\.mjs merge --of 4/);
  const rec = v.steps.find((s) => s.name === "Record the verified tree for Release");
  assert.strictEqual(rec.with.name, "ci-passed-tree-${{ steps.tree.outputs.tree }}");
  assert.strictEqual(rec.if, "needs.changes.outputs.code == 'true'", "no tree is recorded when the suite did not run");
  const order = v.steps.map((s) => s.name);
  assert.ok(order.indexOf("Every job passed") < order.indexOf("Record the verified tree for Release"));
});

test("ci.yml: a pull request that changes only *.md files runs no suite but still gets the static checks", () => {
  const w = workflow("ci.yml"), script = w.jobs.changes.steps.find((s) => s.id === "c").run;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdonly-"));
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" });
  try {
    git("init", "-q"); git("config", "user.email", "t@example.test"); git("config", "user.name", "t");
    fs.writeFileSync(path.join(dir, "a.js"), "1"); fs.writeFileSync(path.join(dir, "README.md"), "a"); git("add", "-A"); git("commit", "-qm", "base");
    const decide = (change, event = "pull_request") => {
      git("checkout", "-q", "--detach", "HEAD");
      change();
      git("add", "-A"); git("commit", "-q", "--allow-empty", "-m", "pr");
      // outside the repository, so the next change does not pick them up
      const out = dir + "-out.txt", sum = dir + "-sum.txt";
      const r = spawnSync("bash", ["-c", script], { cwd: dir, encoding: "utf8", env: Object.assign({}, process.env, { EVENT: event, GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: sum }) });
      assert.strictEqual(r.status, 0, r.stderr);
      const v = fs.readFileSync(out, "utf8"); fs.rmSync(out); fs.rmSync(sum, { force: true }); git("reset", "-q", "--hard", "HEAD~1");
      return v.trim();
    };
    assert.strictEqual(decide(() => fs.writeFileSync(path.join(dir, "README.md"), "b")), "code=false", "only Markdown");
    assert.strictEqual(decide(() => fs.writeFileSync(path.join(dir, "NEW.md"), "b")), "code=false", "a new Markdown file");
    assert.strictEqual(decide(() => fs.writeFileSync(path.join(dir, "a.js"), "2")), "code=true", "code");
    assert.strictEqual(decide(() => { fs.writeFileSync(path.join(dir, "README.md"), "c"); fs.writeFileSync(path.join(dir, "a.js"), "3"); }), "code=true", "Markdown and code");
    assert.strictEqual(decide(() => fs.writeFileSync(path.join(dir, "notes.md.txt"), "x")), "code=true", "a name that only contains .md");
    assert.strictEqual(decide(() => {}), "code=true", "an empty change runs the suite");
    assert.strictEqual(decide(() => fs.writeFileSync(path.join(dir, "README.md"), "d"), "push"), "code=true", "a push always runs the suite");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const v = w.jobs.verify.steps.find((s) => /Markdown-only/.test(s.name));
  assert.strictEqual(v.if, "needs.changes.outputs.code == 'false'");
  assert.match(v.run, /checks\.mjs/); assert.match(v.run, /check-private\.ps1/);
});

// Release's skip decision, run in bash with a stub gh that answers from a table (the --jq filters are gh's)
function releaseDecision(c) {
  const step = workflow("release.yml").jobs.release.steps.find((s) => s.id === "tested");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-"));
  const git = (...a) => execFileSync("git", a, { cwd: dir, encoding: "utf8" }).trim();
  try {
    git("init", "-q"); git("config", "user.email", "t@example.test"); git("config", "user.name", "t");
    fs.writeFileSync(path.join(dir, "f"), "x"); git("add", "-A"); git("commit", "-qm", "c");
    const sha = git("rev-parse", "HEAD"), tree = git("rev-parse", "HEAD^{tree}");
    const bin = path.join(dir, "bin"); fs.mkdirSync(bin);
    const answers = c.gh ? c.gh(tree) : {};
    const table = Object.entries(answers).map(([k, v]) => '  *"' + k + '"*) ' + (v === null ? "exit 1" : "printf '%s\\n' '" + v + "'") + ";;").join("\n");
    fs.writeFileSync(path.join(bin, "gh"), "#!/usr/bin/env bash\ncase \"$2\" in\n" + table + "\n  *) exit 1;;\nesac\n", { mode: 0o755 });
    const out = path.join(dir, "out.txt"), sum = path.join(dir, "sum.txt");
    const env = Object.assign({}, process.env, { PATH: bin + path.delimiter + process.env.PATH, REPO: "owner/repo", TARGET: sha, TESTED_TREE: c.testedTree === "TREE" ? tree : c.testedTree || "", EVENT: c.event || "push", GITHUB_OUTPUT: out, GITHUB_STEP_SUMMARY: sum, GH_TOKEN: "x" });
    const r = spawnSync("bash", ["-c", step.run], { cwd: dir, encoding: "utf8", env });
    assert.strictEqual(r.status, 0, r.stderr);
    return { skip: fs.readFileSync(out, "utf8").trim() === "skip=true", why: fs.readFileSync(sum, "utf8").trim() };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("release.yml: the suite is skipped only for exactly a tested tree", (t) => {
  if (spawnSync("bash", ["-c", "true"]).status !== 0) { t.skip("bash not available"); return; }
  const pulls = "repos/owner/repo/commits/";
  const good = (tree) => ({ [pulls]: "12 headsha", ["ci-passed-tree-" + tree]: "777", "repos/owner/repo/actions/runs/777": ".github/workflows/ci.yml completed success pull_request owner/repo headsha" });
  // Publish: its own checks passed on this tree
  assert.strictEqual(releaseDecision({ event: "workflow_call", testedTree: "TREE" }).skip, true, "Publish tested this tree");
  assert.strictEqual(releaseDecision({ event: "workflow_call", testedTree: "1".repeat(40) }).skip, false, "Publish tested another tree");
  assert.strictEqual(releaseDecision({ event: "workflow_call" }).skip, false, "Publish passed no tree");
  // a merge
  const r = releaseDecision({ gh: good });
  assert.strictEqual(r.skip, true, r.why);
  assert.match(r.why, /CI run 777 passed the full suite on tree [0-9a-f]{40} \(pull request #12\)/);
  const variant = (field, value) => (tree) => { const g = good(tree), k = "repos/owner/repo/actions/runs/777", p = g[k].split(" "); p[field] = value; g[k] = p.join(" "); return g; };
  for (const [what, gh] of [
    ["a failed CI run", variant(2, "failure")],
    ["a CI run still in progress", variant(1, "in_progress")],
    ["another workflow", variant(0, ".github/workflows/other.yml")],
    ["a fork", variant(4, "someone/fork")],
    ["another head of the pull request", variant(5, "oldhead")],
    ["a push run", variant(3, "push")],
    ["no recorded tree", (tree) => { const g = good(tree); delete g["ci-passed-tree-" + tree]; return g; }],
    ["no merged pull request", (tree) => { const g = good(tree); g[pulls] = ""; return g; }],
    ["the API failing", () => ({})],
  ]) assert.strictEqual(releaseDecision({ gh }).skip, false, what + ": the suite runs");
  // the gh answers above are keyed on the arguments the step sends; check they are what it really asks
  const run = workflow("release.yml").jobs.release.steps.find((s) => s.id === "tested").run;
  assert.ok(run.includes('"repos/$REPO/commits/$TARGET/pulls"') && run.includes('"repos/$REPO/actions/artifacts?name=ci-passed-tree-$tree&per_page=50"') && run.includes('"repos/$REPO/actions/runs/$id"'));
  assert.ok(run.includes('= ".github/workflows/ci.yml completed success pull_request $REPO $head"'));
});

test("release.yml: only the test suite and its tools depend on the skip; CSP and smoke checks always run, deploy last", () => {
  const r = workflow("release.yml"), steps = r.jobs.release.steps, by = (n) => steps.find((s) => s.name === n);
  assert.deepStrictEqual(r.permissions, { contents: "read", "id-token": "write", actions: "read", "pull-requests": "read" });
  assert.strictEqual(r.on.workflow_call.inputs.tested_tree.default, "");
  const gated = steps.filter((s) => s.if === "steps.tested.outputs.skip != 'true'").map((s) => s.name);
  assert.deepStrictEqual(gated, ["Setup Java 21 (Firestore emulator runtime)", "Install Chromium for the browser tests", "Run the full test suite (no deploy on any failure)"]);
  for (const n of ["Check the CSP hashes match the pages being deployed", "Deploy Hosting", "Smoke check the live site", "Install dependencies", "Verify this commit is the latest origin/main"]) assert.ok(by(n) && !by(n).if, n + " always runs");
  assert.strictEqual(by("Run the full test suite (no deploy on any failure)").run, "npm test");
  const order = steps.map((s) => s.name);
  assert.ok(order.indexOf("Verify this commit is the latest origin/main") < order.indexOf("Was this exact tree already tested?"));
  assert.ok(order.indexOf("Run the full test suite (no deploy on any failure)") < order.indexOf("Deploy Hosting"));
  assert.ok(order.indexOf("Check the CSP hashes match the pages being deployed") < order.indexOf("Deploy Hosting"));
  assert.ok(order.indexOf("Deploy Hosting") < order.indexOf("Smoke check the live site"));
});

test("publish.yml: the tree handed to Release is recorded only when the commit holds the whole tested working tree", () => {
  const j = workflow("publish.yml").jobs, step = j.build.steps.find((s) => s.id === "commit");
  assert.strictEqual(j.build.outputs.tree, "${{ steps.commit.outputs.tree }}");
  assert.match(step.run, /if \[ -z "\$\(git status --porcelain\)" \]; then echo "tree=\$\(git rev-parse 'HEAD\^\{tree\}'\)" >> "\$GITHUB_OUTPUT"/);
  const order = j.build.steps.map((s) => s.name);
  for (const n of ["Unit tests", "Firestore emulator rules tests", "CSP allows every inline script", "Static checks (fonts, redirects, sitemap, secrets)", "Privacy check (private notes never in public/)"]) assert.ok(order.indexOf(n) < order.indexOf(step.name), n + " runs before the tree is recorded");
  assert.deepStrictEqual(j.deploy.needs, ["build", "commit"]);
});
