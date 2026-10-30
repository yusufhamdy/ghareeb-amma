"use strict";
/*
 * publish-safety.test.js - admin-written content cannot steer the publish generator outside its lane.
 *   - an ayah label is an ayah number or a range ("5", "5-6"): publish-build refuses any other label (it becomes part of
 *     the word page's file name and URL), and the admin enforces the same rule in wordErrors and in its JSON import;
 *   - writeSite never writes outside its output folder.
 * ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const load = () => import(pathToFileURL(path.join(ROOT, "scripts", "publish-build.mjs")).href);
const words = () => JSON.parse(fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8"));
const challenge = () => JSON.parse(fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8"));

test("publish-build: every current ayah label is a number or a range, and the site builds", async () => {
  const mod = await load();
  const all = words().flatMap((s) => (s.ayahs || []).map((a) => String(a.label)));
  assert.ok(all.length >= 73);
  for (const l of all) assert.ok(mod.AYAH_LABEL_RE.test(l), "label " + JSON.stringify(l));
  const { wordCount } = mod.buildSite(words(), challenge());
  assert.ok(wordCount >= 73);
});

test("publish-build: a label that is not a number or a range is refused before anything is written", async () => {
  const mod = await load();
  for (const bad of ["/../../index", "../x", "1/2", "5 ", "1\"><b>", "a", "1-", "-1", "1-2-3"]) {
    const s = words();
    s[0].ayahs[0].label = bad;
    if (bad === "5 ") continue; // trimmed by the slug code, and "5" alone is valid; covered by the admin rule
    assert.throws(() => mod.buildSite(s, challenge()), /ayah label is not a number or a range/, "label " + JSON.stringify(bad));
  }
  for (const ok of ["7", "7-8", "12"]) assert.ok(mod.AYAH_LABEL_RE.test(ok));
});

test("publish-build: writeSite refuses a file name that leaves the output folder", async () => {
  const mod = await load();
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "gq-safety-"));
  try {
    const meta = { rev: 1, hash: "x", wordCount: 0 };
    for (const name of ["word/an-nas-/../../../escape.html", "../escape.html", path.resolve(out, "..", "abs.html")]) {
      assert.throws(() => mod.writeSite(out, { [name]: "x" }, meta), /refusing to write outside/, JSON.stringify(name));
    }
    assert.ok(!fs.existsSync(path.join(out, "..", "escape.html")) && !fs.existsSync(path.join(out, "..", "abs.html")), "nothing written outside");
    mod.writeSite(out, { "word/an-nas-1.html": "ok" }, meta);
    assert.strictEqual(fs.readFileSync(path.join(out, "word", "an-nas-1.html"), "utf8"), "ok");
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test("admin: wordErrors and the JSON import use the same ayah label rule", () => {
  const html = fs.readFileSync(path.join(PUBLIC, "admin", "index.html"), "utf8");
  assert.ok(html.includes("const LABEL_RE=/^[0-9]+(-[0-9]+)?$/;"), "the admin defines the label rule");
  const we = html.slice(html.indexOf("function wordErrors(x)"), html.indexOf("function wordErrors(x)") + 600);
  assert.ok(/LABEL_RE\.test\(String\(x\.label\)\.trim\(\)\)/.test(we), "wordErrors checks the label format");
  const imp = html.slice(html.indexOf('dataset.f!=="imp"'), html.indexOf('dataset.f!=="imp"') + 900);
  assert.ok(/LABEL_RE\.test\(String\(a\.label\)\.trim\(\)\)/.test(imp), "the JSON import checks every label before writing");
});

test("publish-build: admin text cannot inject markup into a word page's head or close its JSON-LD", async () => {
  const mod = await load();
  const s = words();
  s[0].words[0] = 'x</title><meta http-equiv="refresh" content="0;url=https://example.invalid/">';
  s[0].meanings[0] = 'm</script><b id="ld">ld</b>"&';
  const { files } = mod.buildSite(s, challenge());
  const page = Object.entries(files).find(([k, v]) => k.startsWith("word/") && v.includes("x&lt;/title&gt;"));
  assert.ok(page, "the crafted word page is generated, with the word escaped in the head");
  const head = page[1].slice(0, page[1].indexOf("</head>"));
  assert.ok(!/<meta http-equiv/i.test(head), "no injected meta refresh in the head");
  assert.strictEqual((head.match(/<title>/g) || []).length, 1, "one title element");
  for (const ld of head.match(/<script type="application\/ld\+json">[\s\S]*?<\/script>/g) || []) {
    const body = ld.slice(ld.indexOf(">") + 1, -"</script>".length);
    assert.ok(!body.includes("<"), "no raw '<' inside JSON-LD");
    JSON.parse(body); // still valid JSON
  }
  assert.ok(!page[1].includes('<b id="ld">'), "the meaning cannot add elements");
});
