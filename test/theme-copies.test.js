/*
 * theme-copies.test.js - the theme definitions (GQ_THEME: palette names, light/dark colours and swatch gradients, picker order, default,
 * glass default, migration of saved settings, continuous glass mapping) exist in three copies: inline in
 * public/index.html (the app may not load the static pages' bootstrap), public/theme-boot.js (static pages) and
 * public/theme.js (admin). This test fails if any copy differs from the others, as text and in behaviour.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const PUBLIC = path.resolve(__dirname, "..", "public");
const FILES = ["index.html", "theme-boot.js", "theme.js"];

// the block between the markers, with the indentation of its first line removed from every line
function block(file) {
  const s = fs.readFileSync(path.join(PUBLIC, file), "utf8");
  const a = s.indexOf("/* GQ_THEME:begin"), b = s.indexOf("/* GQ_THEME:end */");
  assert.ok(a >= 0 && b > a, file + " has the GQ_THEME block");
  assert.strictEqual(s.indexOf("/* GQ_THEME:begin", a + 1), -1, file + " has exactly one GQ_THEME block");
  const lineStart = s.lastIndexOf("\n", a) + 1, indent = s.slice(lineStart, a);
  assert.ok(/^\s*$/.test(indent), file + ": the block starts its own line");
  const text = s.slice(lineStart, b + "/* GQ_THEME:end */".length);
  return text.split("\n").map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l)).join("\n");
}
function load(file) {
  const ctx = {};
  vm.runInNewContext(block(file) + "\nthis.T = GQ_THEME;", ctx);
  return ctx.T;
}

test("theme definitions: the three copies are identical text and ASCII-only", () => {
  const [app, boot, admin] = FILES.map(block);
  assert.ok(!/[^\x00-\x7F]/.test(app), "the block is ASCII-only (names as escapes)");
  assert.strictEqual(boot, app, "theme-boot.js differs from index.html");
  assert.strictEqual(admin, app, "theme.js (admin) differs from index.html");
});

test("theme definitions: names, colours, order, default, migration and glass mapping agree in every copy", () => {
  const T = FILES.map(load);
  const ref = T[0];
  // the values themselves (so a change has to be made on purpose, in every copy)
  assert.strictEqual(JSON.stringify(ref.ORDER), JSON.stringify(["neo", "gold", "def", "lav", "sun"]));
  assert.strictEqual(ref.DEFAULT, "neo");
  assert.strictEqual(ref.SV, 2);
  assert.strictEqual(ref.GLASS_DEFAULT, 50);
  assert.strictEqual(JSON.stringify(ref.ORDER.map((k) => ref.PAL[k].n)), JSON.stringify(["فيروزي", "ذهبي", "زمردي", "بنفسجي", "غروب"]));
  assert.strictEqual(ref.PAL.sun.l[0], "#F6EFEA", "the sun light background is the app's value");
  // neo: light unchanged; night is the old site's default night (palette "def" in main d4405a7)
  assert.strictEqual(JSON.stringify(ref.PAL.neo.l), JSON.stringify(["#EEF3F6", "#0B6E8A", "#72CFF0", "#8FE6DA"]));
  assert.strictEqual(JSON.stringify(ref.PAL.neo.d), JSON.stringify(["#0A0E1F", "#9FB4FF", "#4B5BDB", "#2FB5A8"]));
  // the picker swatches: a 135deg gradient [start, end] per palette, the same in light and dark
  assert.strictEqual(JSON.stringify(ref.ORDER.map((k) => ref.PAL[k].sw)), JSON.stringify([["#0B6E8A", "#9FB4FF"], ["#B59045", "#F0CD78"], ["#56A882", "#8EE6B4"], ["#8177EC", "#B7B2FF"], ["#D47654", "#FFB38A"]]));
  const inputs = [];
  for (const pal of ["gold", "def", "lav", "sun", "neo", "min", "nope", undefined]) for (const sv of [undefined, 1, 2]) for (const [gl, gv] of [[undefined, undefined], [0, undefined], [1, undefined], [2, undefined], [1, 2], [3, 2], [5, 2], [9, 2], [37, 3], [101, 3]]) inputs.push({ pal, sv, gl, gv });
  const behaviour = (t) => ({
    pal: JSON.stringify(t.ORDER.map((k) => [k, t.PAL[k].n, t.PAL[k].l, t.PAL[k].d, t.PAL[k].sw])),
    keys: Object.keys(t.PAL).join(),
    order: t.ORDER.join(), def: t.DEFAULT, glassDefault: t.GLASS_DEFAULT, sv: t.SV,
    upgrade: JSON.stringify(inputs.concat([{}]).map((s) => t.upgrade(Object.assign({}, s)))),
    migrate: JSON.stringify(inputs.map((s) => t.migrate(Object.assign({}, s)))),
    glass: JSON.stringify([...Array(101).keys()].map((v) => [t.glass(v, false), t.glass(v, true)])),
  });
  const want = behaviour(ref);
  T.slice(1).forEach((t, i) => {
    const got = behaviour(t);
    for (const k of Object.keys(want)) assert.strictEqual(got[k], want[k], FILES[i + 1] + " differs from index.html in: " + k);
  });
  // the app uses the inline copy, and loads no bootstrap file for it (phase K, K1)
  const html = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");
  assert.ok(html.includes("const GQT=GQ_THEME,PAL="), "the app takes its palettes from the inline copy");
  assert.ok(fs.readFileSync(path.join(PUBLIC, "theme.js"), "utf8").includes("const GT=GQ_THEME,PAL="), "the admin takes its palettes from its copy");
});
