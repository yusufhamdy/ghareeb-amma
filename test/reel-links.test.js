/*
 * reel-links.test.js - scripts/reel-links-core.js (day matching, link checks, the write plan) and the YouTube Shorts
 * links everywhere a link is checked: the admin (linkOk), the publish build (reelLinkOk) and the site's buttons (pfOf).
 * ASCII only: the Arabic phrases are built from code points.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const C = require("../scripts/reel-links-core.js");
const ROOT = path.resolve(__dirname, "..");

const DAY = "\u0627\u0644\u064A\u0648\u0645";
const arabicDigits = (n) => String(n).replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)));
const forms = (n) => [DAY + " " + n, "#" + DAY + "_" + n, DAY + " " + arabicDigits(n), DAY + "_" + n].concat(C.ordinals(n).map((w) => DAY + " " + w.join(" ")), C.ordinals(n).map((w) => "#" + DAY + "_" + w.join("_")));

test("every form of day n names day n and no other day (1-30)", () => {
  let cases = 0;
  for (let n = 1; n <= 30; n++) {
    for (const f of forms(n)) {
      for (let k = 1; k <= 30; k++) {
        cases++;
        assert.strictEqual(C.dayMatches("a " + f + " b", k), k === n, "form of day " + n + " tested as day " + k);
      }
    }
  }
  assert.ok(cases > 5000);
});

test("diacritics, hamza forms, tatweel and a following word don't change the match", () => {
  const awwal = "\u0627\u0644\u0623\u064E\u0648\u0651\u064E\u0644\u064F"; // al-awwal with hamza and diacritics
  assert.ok(C.dayMatches(DAY.replace("\u064A", "\u064A\u064E") + " " + awwal, 1));
  assert.ok(C.dayMatches(DAY + "\u0640 7", 7));
  const thamin = C.ordinals(8)[0][0];
  assert.ok(C.dayMatches(DAY + " " + thamin + " \u0648\u0646\u062A\u0639\u0644\u0645", 8), "a word starting with wa after the ordinal");
  assert.ok(C.dayMatches(DAY + " 7 | \u062A\u062D\u062F\u064A", 7));
  assert.ok(!C.dayMatches(DAY + " 17", 7) && !C.dayMatches(DAY + " 70", 7) && !C.dayMatches("7", 7) && !C.dayMatches(DAY, 7));
  assert.ok(!C.dayMatches(DAY + " " + C.ordinals(2)[0][0] + " \u0639\u0634\u0631", 2), "al-thani ashar is day 12");
  assert.ok(!C.dayMatches(DAY + " " + C.ordinals(2)[0][0] + " \u0648\u0627\u0644\u0639\u0634\u0631\u0648\u0646", 2), "al-thani wa-l-ishrun is day 22");
  assert.ok(!C.dayMatches("", 1) && !C.dayMatches(null, 1) && !C.dayMatches(DAY + " 1", 0));
});

test("links: https on the platform's host and one post's path; YouTube only as a Short", () => {
  assert.ok(C.linkOk("reelYt", "https://www.youtube.com/shorts/VBe6C_Ts9j0"));
  assert.ok(C.linkOk("reelYt", "https://youtube.com/shorts/VBe6C_Ts9j0/"));
  assert.ok(!C.linkOk("reelYt", "https://www.youtube.com/watch?v=VBe6C_Ts9j0"));
  assert.ok(!C.linkOk("reelYt", "http://www.youtube.com/shorts/VBe6C_Ts9j0"));
  assert.ok(!C.linkOk("reelYt", "https://www.youtube.com.evil.example/shorts/VBe6C_Ts9j0"));
  assert.ok(C.linkOk("reelIg", "https://www.instagram.com/reel/DdlXTOJzRkI/"));
  assert.ok(!C.linkOk("reelIg", "https://www.instagram.com/someone/"));
  assert.ok(C.linkOk("reelTt", "https://www.tiktok.com/@user.name/video/7712905769926003986"));
  assert.ok(!C.linkOk("reelTt", "https://www.tiktok.com/@user.name"));
  assert.ok(!C.linkOk("reelTt", "https://www.instagram.com/reel/DdlXTOJzRkI/"));
  assert.ok(!C.linkOk("reel", "https://www.instagram.com/reel/DdlXTOJzRkI/"));
});

test("post times from ids order posts newest first; pickLatest takes the newest match", () => {
  assert.ok(C.ttTime("7712943869779840264") > C.ttTime("7712905769926003986"));
  assert.ok(C.igTime("DdlXTOJzRkI") > C.igTime("DczFiQZoFD3"));
  const hit = C.pickLatest([
    { url: "u1", text: DAY + " 3", time: 100 },
    { url: "u2", text: DAY + " 3", time: 300 },
    { url: "u3", text: DAY + " 4", time: 900 },
  ], 3);
  assert.strictEqual(hit.url, "u2");
  assert.strictEqual(C.pickLatest([{ url: "a", text: DAY + " 5", order: 1 }, { url: "b", text: DAY + " 5", order: 0 }], 5).url, "b");
  assert.strictEqual(C.pickLatest([{ url: "a", text: DAY + " 5" }], 6), null);
});

const doc = () => ({
  startDate: "2026-11-21",
  releasedUpTo: 6,
  days: [
    { d: 1, w: [{ no: 78, word: "x" }], reel: "", reelIg: "https://www.instagram.com/reel/AAAAAAAAAAA/" },
    { d: 2, w: [{ no: 79, word: "y" }], reel: "" },
  ],
});
const L = { reelIg: "https://www.instagram.com/reel/BBBBBBBBBBB/", reelTt: "https://www.tiktok.com/@u/video/7712905769926003986", reelYt: "https://www.youtube.com/shorts/VBe6C_Ts9j0" };

test("planWrite sets only the day's empty link fields and never overwrites a set link", () => {
  const a = doc();
  const p = C.planWrite(a, 1, L);
  assert.deepStrictEqual(p.written, ["reelTt", "reelYt"]);
  assert.deepStrictEqual(p.skipped, [{ key: "reelIg", same: false }]);
  assert.strictEqual(p.next.days[0].reelIg, a.days[0].reelIg);
  assert.ok(C.sameExcept(a, p.next, 0, p.written));
  assert.ok(!C.sameExcept(a, p.next, 0, ["reelTt"]), "a field outside the list counts as a change");
  assert.deepStrictEqual(a, doc(), "the input is not modified");
  const q = C.planWrite(doc(), 2, { reelYt: L.reelYt });
  assert.deepStrictEqual(q.written, ["reelYt"]);
  assert.deepStrictEqual(q.notFound, ["reelIg", "reelTt"]);
  assert.deepStrictEqual(q.next.days[0], doc().days[0], "other days are untouched");
});

test("planWrite refuses an invalid link, a missing or repeated day, and an unexpected document", () => {
  assert.throws(() => C.planWrite(doc(), 2, { reelYt: "https://www.youtube.com/watch?v=VBe6C_Ts9j0" }), /invalid YouTube/);
  assert.throws(() => C.planWrite(doc(), 9, L), /not in the challenge/);
  const twice = doc(); twice.days.push({ d: 2, w: [], reel: "" });
  assert.throws(() => C.planWrite(twice, 2, L), /listed 2 times/);
  assert.throws(() => C.planWrite(Object.assign(doc(), { extra: 1 }), 2, L), /unexpected fields/);
});

test("YouTube Shorts links pass the admin, the publish build and the site's buttons", async () => {
  const shorts = "https://www.youtube.com/shorts/VBe6C_Ts9j0";
  const { reelLinkOk, REEL_LINKS } = await import("../scripts/publish-build.mjs");
  assert.ok(reelLinkOk(shorts, REEL_LINKS.find((r) => r[0] === "reelYt")[1]), "publish build");

  const admin = fs.readFileSync(path.join(ROOT, "public", "admin", "index.html"), "utf8");
  const rl = admin.match(/const RL=\[[\s\S]*?\]\];/), lh = admin.match(/function linkHost\(u\)\{[\s\S]*?\n/), lo = admin.match(/function linkOk\(u,r\)\{[\s\S]*?\n/);
  assert.ok(rl && lh && lo, "the admin's link check is where the test expects it");
  const a = {}; vm.runInNewContext(rl[0] + lh[0] + lo[0] + "out.ok=linkOk(" + JSON.stringify(shorts) + ",RL.find(r=>r[0]==='reelYt'));", Object.assign(a, { out: a, URL }));
  assert.strictEqual(a.ok, true, "admin");

  const site = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  const pf = site.match(/const PF=\[[\s\S]*?\]\];/), po = site.match(/const pfOf=u=>\{[\s\S]*?\}catch\(e\)\{return null\}\};/);
  assert.ok(pf && po, "the site's link check is where the test expects it");
  const s = {}; vm.runInNewContext(pf[0] + po[0] + "out.k=pfOf(" + JSON.stringify(shorts) + ");", Object.assign(s, { out: s, URL }));
  assert.strictEqual(s.k, "yt", "site");
});
