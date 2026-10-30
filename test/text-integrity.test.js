"use strict";
/*
 * text-integrity.test.js - no corrupted Arabic text in any tracked html/js/mjs/css/json/md file
 * (scripts/text-integrity.js): no U+FFFD, no UTF-8-read-as-Latin-1 mojibake, no Arabic presentation forms except
 * the ornate parentheses, no UTF-8 BOM in JS/HTML. The synthetic cases prove each rule fires.
 *
 * ASCII only: the synthetic strings are built from code points.
 */
const test = require("node:test");
const assert = require("node:assert");
const T = require("../scripts/text-integrity.js");

const ch = (...cps) => String.fromCharCode(...cps);
const kinds = (rel, s) => T.scanText(rel, Buffer.isBuffer(s) ? s : Buffer.from(s, "utf8")).map((h) => h.kind);

test("every tracked text file is clean", () => {
  const hits = T.scan();
  assert.deepStrictEqual(hits.map((h) => h.file + ":" + h.line + " " + h.kind), []);
  assert.ok(T.files().length > 300, "files scanned: " + T.files().length);
});

test("each rule fires", () => {
  assert.deepStrictEqual(kinds("a.md", "x" + ch(0xfffd) + "y"), ["fffd"]);
  // "kalima" written in UTF-8 and read as Windows-1252: U+00D9 U+0192 U+00D9 U+201E ...
  assert.ok(kinds("a.md", ch(0xd9, 0x83, 0xd9, 0x84, 0xd9, 0x85)).includes("mojibake"));
  assert.deepStrictEqual(kinds("a.js", "s=" + ch(0xfe8d)), ["presentation"]);
  assert.deepStrictEqual(kinds("a.html", ch(0xfd3f) + ch(0x0628) + ch(0xfd3e)), [], "the ornate parentheses are allowed");
  assert.deepStrictEqual(kinds("a.js", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("x=1")])), ["bom"]);
  assert.deepStrictEqual(kinds("a.css", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("a{}")])), [], "a BOM in CSS is not flagged");
  assert.deepStrictEqual(kinds("a.md", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("# ok " + ch(0x0628), "utf16le")])), [], "UTF-16 files are read as UTF-16");
  assert.deepStrictEqual(kinds("a.js", "s='" + ch(0x0628, 0x0650) + "'"), [], "ordinary Arabic is fine");
});
