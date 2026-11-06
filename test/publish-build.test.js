"use strict";
/*
 * publish-build.test.js - Phase 5, the publish generator's safeguards (tests T-30 to T-35, T-37, T-38; T-36 runs in the
 * emulator, test/publish-emulator.test.js).
 *   T-30 the committed data, and the same data in Firestore's shape (a "no" field, other key orders, surahs from 78 up,
 *        challenge references as {no, word}), rebuild the committed site byte for byte: the publish finds no change;
 *   T-31 a malformed field of any kind is refused, and nothing is written;
 *   T-32 the removal guard: the count must equal --allow-removals exactly, never more than 10%, a removed surah only
 *        when listed;
 *   T-33 a removed word's page, share image and sitemap entry go, a 301 to its surah page is added (D-4), and a removed
 *        surah's page goes to the home page; a word that comes back drops its redirect;
 *   T-34 challenge integrity: a reference to a missing word is refused with its day named, and so are a changed number of
 *        days and a bad date;
 *   T-35 private notes in the challenge document never reach any written file;
 *   T-37 two publishes of the same input give identical bytes, rev.json included;
 *   T-38 the Firestore read uses the Firestore client (no initializeApp, which fails under Workload Identity) and reads
 *        only public/data and public/challenge;
 *   and the generator's copy of the site's word key is the site's own.
 * Content comparisons use assert.ok, so a failure never prints document text. ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const load = () => import(pathToFileURL(path.join(ROOT, "scripts", "publish-build.mjs")).href);
const loadReport = () => import(pathToFileURL(path.join(ROOT, "scripts", "publish-report.mjs")).href);
const words = () => JSON.parse(fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8"));
const challenge = () => JSON.parse(fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8"));
const LEGAL = ["about", "privacy", "terms", "rights"];

// A copy of the generated part of the site (share images as empty placeholders: only their names matter here).
function siteCopy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gq-publish-"));
  const site = path.join(dir, "site");
  fs.mkdirSync(site);
  for (const f of ["words.json", "challenge.json", "sitemap.xml"]) fs.copyFileSync(path.join(PUBLIC, f), path.join(site, f));
  for (const d of ["word", "surah", "css", ...LEGAL]) fs.cpSync(path.join(PUBLIC, d), path.join(site, d), { recursive: true });
  fs.mkdirSync(path.join(site, "og", "word"), { recursive: true });
  for (const f of fs.readdirSync(path.join(PUBLIC, "og", "word"))) fs.writeFileSync(path.join(site, "og", "word", f), "");
  fs.copyFileSync(path.join(ROOT, "firebase.json"), path.join(dir, "firebase.json"));
  return { dir, site, fb: path.join(dir, "firebase.json"), opt: (o = {}) => ({ site, firebaseJson: path.join(dir, "firebase.json"), noImages: true, ...o }) };
}
function treeHash(dir) {
  const h = crypto.createHash("sha256");
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else h.update(path.relative(dir, p) + "\0").update(fs.readFileSync(p)).update("\0");
    }
  };
  walk(dir);
  return h.digest("hex");
}
const cleanup = (c) => fs.rmSync(c.dir, { recursive: true, force: true });

// Firestore's shape of the same data: surahs from 78 up with a "no" field, every map's keys in another order, and the
// challenge references as {no, word} maps (Firestore can't hold a list inside a list).
function firestoreShape(mod, list, ch) {
  const rev = (o) => Object.fromEntries(Object.entries(o).reverse());
  const surahs = list
    .map((s) => rev({ ...s, no: mod.surahNumber(s.surah), ayahs: s.ayahs.map((a) => rev({ ...a, segments: a.segments.map(rev) })) }))
    .sort((a, b) => a.no - b.no);
  const challengeDoc = { days: ch.days.map((d) => rev({ ...d, w: d.w.map(([no, word]) => ({ word, no })) })), releasedUpTo: ch.releasedUpTo, startDate: ch.startDate };
  return { surahs, challengeDoc };
}

test("T-30: the committed data and its Firestore shape rebuild the committed site byte for byte", async () => {
  const mod = await load();
  const committedText = fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8");
  assert.ok(JSON.stringify(mod.normaliseSurahs(words()), null, 2) === committedText, "normalising the committed file changes nothing");
  const fsData = firestoreShape(mod, words(), challenge());
  assert.ok(fsData.surahs.every((s) => "no" in s) && fsData.surahs[0].no < fsData.surahs[1].no, "the fixture really is in Firestore's shape");
  assert.ok(JSON.stringify(mod.normaliseSurahs(fsData.surahs), null, 2) === committedText, "the Firestore shape normalises to the committed file");
  const pubCh = JSON.stringify(mod.publicChallenge(fsData.challengeDoc), null, 1);
  assert.ok(pubCh === fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8"), "{no, word} references publish as the committed [no, word]");
  for (const input of [{ surahs: words(), challenge: challenge() }, { surahs: fsData.surahs, challenge: fsData.challengeDoc }]) {
    const c = siteCopy();
    try {
      const before = treeHash(c.dir);
      const { summary } = mod.publishToTree({ ...input, rev: 7 }, c.opt());
      assert.strictEqual(summary.changed, false, "no change: " + JSON.stringify({ write: summary.write, remove: summary.remove, images: summary.images }));
      assert.strictEqual(treeHash(c.dir), before, "nothing written");
    } finally { cleanup(c); }
  }
});

test("T-31: every malformed field is refused, and nothing is written", async () => {
  const mod = await load();
  const cases = [
    ["empty list", () => []],
    ["not a list", () => ({})],
    ["unknown surah key", (s) => { s[0].extra = 1; }],
    ["unknown ayah key", (s) => { s[0].ayahs[0].extra = 1; }],
    ["unknown segment key", (s) => { s[0].ayahs[0].segments[0].extra = 1; }],
    ["missing words", (s) => { delete s[0].words; }],
    ["meanings not a list", (s) => { s[0].meanings = "x"; }],
    ["length mismatch", (s) => { s[0].meanings.push("x"); }],
    ["empty word", (s) => { s[0].words[0] = " "; }],
    ["word not a string", (s) => { s[0].words[0] = 5; }],
    ["empty meaning", (s) => { s[0].meanings[0] = ""; }],
    ["unknown surah name", (s) => { s[0].surah = "x"; }],
    ["surah twice", (s) => { s[1].surah = s[0].surah; }],
    ["no does not match the name", (s) => { s[0].no = 1; }],
    ["no out of range", (s) => { s[0].no = 115; }],
    ["source not a string", (s) => { s[0].source = null; }],
    ["label not a string", (s) => { s[0].ayahs[0].label = 5; }],
    ["bad label", (s) => { s[0].ayahs[0].label = "../x"; }],
    ["no segments", (s) => { s[0].ayahs[0].segments = []; }],
    ["empty hl", (s) => { s[0].ayahs[0].segments[0].hl = ""; }],
    ["num not whole", (s) => { s[0].ayahs[0].segments[0].num = 1.5; }],
    ["before not a string", (s) => { s[0].ayahs[0].segments[0].before = null; }],
    ["segment not an object", (s) => { s[0].ayahs[0].segments[0] = "x"; }],
  ];
  const c = siteCopy();
  try {
    const before = treeHash(c.dir);
    for (const [name, change] of cases) {
      const s = words();
      const r = change(s);
      const input = r === undefined ? s : r;
      let err = null;
      try { mod.publishToTree({ surahs: input, challenge: challenge(), rev: 1 }, c.opt()); } catch (e) { err = e; }
      assert.ok(err, name + ": refused");
      assert.ok(/refusing to publish|no surah data/.test(err.message), name + ": refused by the shape check");
      assert.strictEqual(treeHash(c.dir), before, name + ": nothing written");
    }
  } finally { cleanup(c); }
});

// Remove one word everywhere it appears: the surah lists and its challenge reference.
function removeWord(mod, list, ch, sIndex, wIndex) {
  const s = list[sIndex], no = mod.surahNumber(s.surah), key = mod.siteWordKey(s.words[wIndex]);
  for (const k of ["words", "meanings", "ayahs"]) s[k].splice(wIndex, 1);
  for (const d of ch.days) d.w = d.w.filter((r) => !(r[0] === no && r[1] === key));
  return { list, ch };
}

test("T-32: the removal guard", async () => {
  const mod = await load();
  const committed = words();
  const total = committed.reduce((n, s) => n + s.words.length, 0);
  const ceiling = Math.floor(total * mod.MAX_REMOVAL_SHARE);
  assert.strictEqual(ceiling, 7, "the ceiling today is 7 words (10% of 73)");
  const big = committed.findIndex((s) => s.words.length >= 2);
  const one = removeWord(mod, words(), challenge(), big, 0).list;
  assert.throws(() => mod.guardRemovals(committed, one, { allowRemovals: 0 }), /1 words would be removed .* allow-removals is 0/);
  assert.throws(() => mod.guardRemovals(committed, one, { allowRemovals: 2 }), /must match exactly/);
  assert.strictEqual(mod.guardRemovals(committed, one, { allowRemovals: 1 }).removed.length, 1);
  // more than the ceiling is refused whatever the count allows
  let many = words(), n = 0;
  for (let i = 0; i < many.length && n < ceiling + 1; i++) while (many[i].words.length > 1 && n < ceiling + 1) { for (const k of ["words", "meanings", "ayahs"]) many[i][k].pop(); n++; }
  assert.strictEqual(n, ceiling + 1);
  assert.throws(() => mod.guardRemovals(committed, many, { allowRemovals: ceiling + 1 }), /more than the ceiling of 7/);
  // a whole surah: refused unless its number is listed (and the word count matches)
  const small = committed.findIndex((s) => s.words.length === 1);
  const no = mod.surahNumber(committed[small].surah);
  const gone = words().filter((_, i) => i !== small);
  assert.throws(() => mod.guardRemovals(committed, gone, { allowRemovals: 1 }), new RegExp("surahs " + no + " would be removed"));
  assert.strictEqual(mod.guardRemovals(committed, gone, { allowRemovals: 1, allowSurahRemovals: [no] }).removedSurahs[0], no);
  assert.throws(() => mod.guardRemovals(committed, [], {}), /no words|removal guard/);
  assert.throws(() => mod.guardRemovals(committed, committed, { allowRemovals: -1 }), /whole number/);
});

test("T-33: a removed word's page, image and sitemap entry go, with a 301 to its surah page; a returning word drops it", async () => {
  const mod = await load();
  const big = words().findIndex((s) => s.words.length >= 2);
  const idx = mod.wordIndex(words());
  const slug = [...idx.values()].find((w) => w.no === mod.surahNumber(words()[big].surah) && w.i === 0).slug;
  const c = siteCopy();
  try {
    const { list, ch } = removeWord(mod, words(), challenge(), big, 0);
    assert.throws(() => mod.publishToTree({ surahs: list, challenge: ch, rev: 2 }, c.opt()), /removal guard/, "refused without allow-removals");
    const { summary } = mod.publishToTree({ surahs: list, challenge: ch, rev: 2 }, c.opt({ allowRemovals: 1 }));
    assert.deepStrictEqual(summary.words.removed, [slug]);
    assert.ok(summary.remove.includes("word/" + slug + ".html") && summary.remove.includes("og/word/" + slug + ".png"), "page and image removed");
    assert.ok(!fs.existsSync(path.join(c.site, "word", slug + ".html")) && !fs.existsSync(path.join(c.site, "og", "word", slug + ".png")));
    const sitemap = fs.readFileSync(path.join(c.site, "sitemap.xml"), "utf8");
    assert.ok(!sitemap.includes("/word/" + slug + ".html"), "not in the sitemap");
    const pages = fs.readdirSync(path.join(c.site, "word")).filter((f) => f.endsWith(".html"));
    const now = JSON.parse(fs.readFileSync(path.join(c.site, "words.json"), "utf8")).reduce((n, s) => n + s.words.length, 0);
    assert.strictEqual(pages.length, now, "one page per word");
    assert.strictEqual(fs.readdirSync(path.join(c.site, "og", "word")).length, now, "one image per word");
    assert.strictEqual((sitemap.match(/\/word\//g) || []).length, now, "one sitemap entry per word");
    const fb = JSON.parse(fs.readFileSync(c.fb, "utf8"));
    const r = fb.hosting.redirects.find((x) => x.source === "/word/" + slug + ".html");
    const surahSlug = slug.replace(/-\d+(-\d+)?$/, "");
    assert.deepStrictEqual(r, { source: "/word/" + slug + ".html", destination: "/surah/" + surahSlug + ".html", type: 301 });
    assert.ok(fs.existsSync(path.join(c.site, "surah", surahSlug + ".html")), "the destination exists");
    // an older redirect that pointed at the removed page now points at the new destination (no chains)
    for (const x of fb.hosting.redirects) assert.notStrictEqual(x.destination, "/word/" + slug + ".html", "no redirect into a removed page");
    // the word comes back: its redirect goes, its page is back
    const back = mod.publishToTree({ surahs: words(), challenge: challenge(), rev: 3 }, c.opt({ allowRemovals: 0 }));
    assert.ok(back.summary.write.includes("word/" + slug + ".html"));
    assert.ok(back.summary.images.includes(slug), "its share image is made again");
    const fb2 = JSON.parse(fs.readFileSync(c.fb, "utf8"));
    assert.ok(!fb2.hosting.redirects.some((x) => x.source === "/word/" + slug + ".html"), "redirect dropped");
  } finally { cleanup(c); }
  // a whole surah: its words go to the home page, and so does its page
  const c2 = siteCopy();
  try {
    const small = words().findIndex((s) => s.words.length === 1);
    const no = mod.surahNumber(words()[small].surah);
    const wslug = [...idx.values()].find((w) => w.no === no).slug;
    const { list, ch } = removeWord(mod, words(), challenge(), small, 0);
    const rest = list.filter((s) => s.words.length);
    const { summary } = mod.publishToTree({ surahs: rest, challenge: ch, rev: 2 }, c2.opt({ allowRemovals: 1, allowSurahRemovals: [no] }));
    assert.deepStrictEqual(summary.surahs.removed, [no]);
    const fb = JSON.parse(fs.readFileSync(c2.fb, "utf8"));
    const sp = summary.remove.find((f) => f.startsWith("surah/"));
    assert.ok(sp, "the surah page is removed");
    assert.strictEqual(fb.hosting.redirects.find((x) => x.source === "/" + sp).destination, "/");
    assert.strictEqual(fb.hosting.redirects.find((x) => x.source === "/word/" + wslug + ".html").destination, "/");
  } finally { cleanup(c2); }
});

test("T-34: challenge integrity", async () => {
  const mod = await load();
  const s = words();
  const bad = challenge();
  bad.days[4].w[0] = [bad.days[4].w[0][0], "x"];
  assert.throws(() => mod.checkChallenge(mod.publicChallenge(bad), s, challenge()), /day 5: word reference 1 \(surah \d+\) is not a word of the new data/);
  const wrongSurah = challenge();
  wrongSurah.days[0].w[0] = [1, wrongSurah.days[0].w[0][1]];
  assert.throws(() => mod.checkChallenge(mod.publicChallenge(wrongSurah), s, challenge()), /day 1: word reference 1 \(surah 1\)/);
  const fewer = challenge();
  fewer.days.pop();
  const n = challenge().days.length;
  assert.throws(() => mod.checkChallenge(mod.publicChallenge(fewer), s, challenge()), new RegExp("the challenge has " + (n - 1) + " days, the site has " + n + "$", "m"));
  const date = challenge();
  date.startDate = "2026-13-45x";
  assert.throws(() => mod.checkChallenge(mod.publicChallenge(date), s, challenge()), /startDate is not a date/);
  const rel = challenge();
  rel.releasedUpTo = 31;
  assert.throws(() => mod.checkChallenge(mod.publicChallenge(rel), s, challenge()), /releasedUpTo is not a day number/);
  mod.checkChallenge(mod.publicChallenge(challenge()), s, challenge()); // the committed challenge passes
  // the same through publishToTree, with nothing written
  const c = siteCopy();
  try {
    const before = treeHash(c.dir);
    assert.throws(() => mod.publishToTree({ surahs: s, challenge: bad, rev: 2 }, c.opt()), /day 5/);
    assert.strictEqual(treeHash(c.dir), before);
  } finally { cleanup(c); }
});

test("T-35: private notes in the challenge document never reach a written file", async () => {
  const mod = await load();
  const MARK = "PRIVATE-NOTE-MARKER-7f3a";
  const ch = challenge();
  ch.notes = { 1: MARK };
  ch.days[0].note = MARK;
  ch.days[1].notes = MARK;
  ch.days[0].reel = "https://www.instagram.com/" + MARK; // the old single link field is public; a marker in it is fine
  const s = words();
  s[0].meanings[0] = s[0].meanings[0] + " (edited)"; // force a write
  const c = siteCopy();
  try {
    mod.publishToTree({ surahs: s, challenge: ch, rev: 2 }, c.opt());
    const leaks = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (fs.readFileSync(p, "utf8").replace("https://www.instagram.com/" + MARK, "").includes(MARK)) leaks.push(path.relative(c.dir, p)); } };
    walk(c.dir);
    assert.deepStrictEqual(leaks, [], "a note reached a file");
    const pub = JSON.parse(fs.readFileSync(path.join(c.site, "challenge.json"), "utf8"));
    assert.ok(!("notes" in pub) && pub.days.every((d) => Object.keys(d).every((k) => ["d", "w", "reel", "reelIg", "reelTt", "reelYt"].includes(k))), "only public fields");
  } finally { cleanup(c); }
});

test("T-37: two publishes of the same input give identical bytes", async () => {
  const mod = await load();
  const s = words();
  s[1].meanings[0] = s[1].meanings[0] + " (edited)";
  const fsData = firestoreShape(mod, s, challenge());
  const a = siteCopy(), b = siteCopy();
  try {
    mod.publishToTree({ surahs: fsData.surahs, challenge: fsData.challengeDoc, rev: 9 }, a.opt());
    mod.publishToTree({ surahs: firestoreShape(mod, s, challenge()).surahs, challenge: challenge(), rev: 9 }, b.opt());
    assert.strictEqual(treeHash(a.site), treeHash(b.site), "same site");
    assert.strictEqual(fs.readFileSync(a.fb, "utf8"), fs.readFileSync(b.fb, "utf8"), "same redirects");
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(a.site, "rev.json"), "utf8"))), ["rev", "hash", "words"], "rev.json has no time in it");
  } finally { cleanup(a); cleanup(b); }
});

test("T-38: the Firestore read uses the Firestore client and only the two public documents", async () => {
  const mod = await load();
  const src = fs.readFileSync(path.join(ROOT, "scripts", "publish-build.mjs"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/initializeApp\s*\(/.test(code), "no admin.initializeApp() call (it refuses the Workload Identity credential)");
  assert.ok(!/admin\.firestore\s*\(/.test(code), "no admin.firestore() app instance");
  assert.ok(/new Firestore\(/.test(code), "the Firestore client");
  assert.deepStrictEqual(mod.READ_DOCS, ["public/data", "public/challenge"]);
  const docs = [...code.matchAll(/\.(doc|collection)\(\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[2]);
  assert.deepStrictEqual(docs, [], "every read goes through READ_DOCS");
  assert.ok(!/admin\/challengeNotes|challengeNotes/.test(code), "the notes document is never named");
  assert.ok(!/\.(set|update|delete|add|create)\(/.test(code.slice(code.indexOf("export async function loadFromFirestore"), code.indexOf("async function fetchRev"))), "the loader only reads");
});

test("the generator's word key is the site's own (public/index.html)", async () => {
  const mod = await load();
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  const m = html.match(/const norm=(s=>[^;]*);/);
  assert.ok(m, "the site's norm function is found");
  const norm = new Function("return " + m[1])();
  const sample = words().flatMap((s) => s.words.concat(s.meanings, [s.surah]));
  const extra = ["\u0623\u0625\u0622\u0671", "\u0649\u0629\u0624\u0626", "a  b\u0640\u064B", " x "];
  let bad = 0;
  for (const t of sample.concat(extra)) if (mod.siteWordKey(t) !== norm(t)) bad++;
  assert.strictEqual(bad, 0, "the two keys differ on " + bad + " strings");
  // and every committed reference resolves exactly the way the site resolves it
  mod.checkChallenge(challenge(), words(), challenge());
});

test("the review report names exactly the changed word and fields, with Markdown made inert", async () => {
  const mod = await load();
  const rep = await loadReport();
  const s = words();
  s[2].meanings[0] = s[2].meanings[0] + " *x* <b>|";
  const slug = [...mod.wordIndex(s).values()].find((w) => w.no === mod.surahNumber(s[2].surah) && w.i === 0).slug;
  const d = rep.diffWords(words(), s);
  assert.deepStrictEqual([d.added.length, d.removed.length, d.changed.length], [0, 0, 1]);
  assert.strictEqual(d.changed[0].slug, slug);
  assert.deepStrictEqual(d.changed[0].fields.map((f) => f.name), ["meaning"]);
  const summary = { rev: 8, surahs: { before: 28, after: 28, removed: [] }, words: { before: 73, after: 73 }, write: ["words.json", "word/" + slug + ".html", "rev.json"], remove: [], images: [], redirects: { added: [] } };
  const md = rep.buildReport({ before: words(), after: s, beforeChallenge: challenge(), afterChallenge: challenge(), summary });
  assert.ok(md.startsWith("## Publish: Firestore rev 8"));
  assert.strictEqual((md.match(/\*\*Changed\*\*/g) || []).length, 1);
  assert.ok(md.includes("**Changed** `" + slug + "`: meaning"));
  assert.ok(!md.includes("<b>") && !md.includes("*x*"), "values cannot add Markdown or HTML");
  assert.ok(md.includes("(0 added, 0 removed, 1 changed)"));
});
