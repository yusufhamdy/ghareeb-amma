"use strict";
/*
 * legal-copies.test.js - the legal pages (about, privacy, terms, rights) say the same thing everywhere:
 *   - the app view (LEG in public/index.html, with the contact email as a mailto link),
 *   - functions/legal.js (the source the publish generator renders), and
 *   - the committed static pages /about/ /privacy/ /terms/ /rights/ (byte-identical to the generator's output).
 * Plus the shape of the 2026-10-27 text: privacy has eight paragraphs with the Sentry, hosting and external-links
 * paragraphs in place, terms has five, rights has five and names the interface fonts and their licence.
 *
 * ASCII-only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const { LEGAL } = require("../functions/legal.js");

const unlink = (s) => s.replace(/<a href="mailto:([^"]+)">\1<\/a>/g, "$1");
const unesc = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

function appLeg() {
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  const mail = (html.match(/const MAIL=('[^']*'|"[^"]*")/) || [])[1];
  const line = html.split("\n").find((l) => l.startsWith("const LEG={"));
  assert.ok(mail && line, "index.html defines MAIL and LEG");
  const ctx = {};
  vm.runInNewContext("var MAIL=" + mail + ";" + line.replace(/^const LEG=/, "LEG="), ctx);
  return JSON.parse(JSON.stringify(ctx.LEG)); // plain arrays of this realm
}

test("the app view, functions/legal.js and the static pages carry the same text", async () => {
  const leg = appLeg();
  assert.deepStrictEqual(Object.keys(leg).sort(), LEGAL.map((e) => e.slug).sort(), "same pages");
  const { renderLegalPage } = await import("../scripts/publish-build.mjs");
  for (const e of LEGAL) {
    assert.strictEqual(leg[e.slug][0], e.title, e.slug + ": title");
    assert.deepStrictEqual(leg[e.slug][1].map(unlink), e.paras, e.slug + ": app paragraphs");
    const html = fs.readFileSync(path.join(PUBLIC, e.slug, "index.html"), "utf8");
    const shown = [...html.matchAll(/<p class="para">([\s\S]*?)<\/p>/g)].map((m) => unesc(unlink(m[1])));
    assert.deepStrictEqual(shown, e.paras, e.slug + ": static page paragraphs");
    assert.strictEqual(html, renderLegalPage(e), e.slug + ": the static page is the generator's output");
  }
});

test("the 2026-10-27 legal text: privacy, terms and rights in their final order", () => {
  const by = Object.fromEntries(LEGAL.map((e) => [e.slug, e.paras]));
  assert.strictEqual(by.privacy.length, 8, "privacy: eight paragraphs");
  assert.ok(/Sentry/.test(by.privacy[3]) && !/Sentry/.test(by.privacy.filter((p, i) => i !== 3).join(" ")), "privacy 4 is the Sentry paragraph");
  assert.ok(/Firebase/.test(by.privacy[4]) && /Google/.test(by.privacy[4]), "privacy 5 names the hosting and database service");
  assert.ok(/@gmail\.com$/.test(by.privacy[7]), "privacy ends with the contact address");
  assert.strictEqual(by.terms.length, 5, "terms: five paragraphs");
  assert.strictEqual(by.rights.length, 5, "rights: five paragraphs");
  assert.ok(/Amiri Quran/.test(by.rights[3]) && /IBM Plex Sans Arabic/.test(by.rights[3]) && /IBM Plex Mono/.test(by.rights[3]) && /SIL/.test(by.rights[3]), "rights 4 names the interface fonts and the SIL licence");
  assert.ok(/@gmail\.com$/.test(by.rights[4]), "rights ends with the contact address");
});
