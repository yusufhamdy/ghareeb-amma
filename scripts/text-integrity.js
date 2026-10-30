#!/usr/bin/env node
/*
 * text-integrity.js - a cheap guard against corrupted Arabic text in code and docs.
 *
 * Scans every tracked text file (git ls-files: .html .js .mjs .css .json .md) and reports:
 *   - fffd:        U+FFFD (a replacement character: bytes were lost somewhere);
 *   - mojibake:    UTF-8 Arabic read as Latin-1 (a lead byte shown as one of U+00D8-U+00DB followed by a
 *                  U+0080-U+00BF continuation byte, e.g. the D8/D9 pairs every Arabic letter turns into);
 *   - presentation: Arabic presentation forms (U+FB50-U+FDFF, U+FE70-U+FEFF) other than the ornate parentheses
 *                  U+FD3E/U+FD3F; the site's text is stored in logical letters, and the font shapes them;
 *   - bom:         a UTF-8 byte-order mark in a .js/.mjs/.html file not on the accepted list.
 * Exempt: data/quran/hafsData_v2-0.json (the Complex's official file, committed unmodified and hash-pinned; its
 * ayah-number glyphs are presentation forms by design).
 *
 *   node scripts/text-integrity.js        print every hit; exit 1 when there is one
 * ASCII-only.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const EXT = new Set([".html", ".js", ".mjs", ".css", ".json", ".md"]);
const EXEMPT = new Set(["data/quran/hafsData_v2-0.json"]);
// BOMs accepted where they already were before this guard (none in .js/.mjs/.html at the time it was added)
const BOM_OK = new Set([]);

function files() {
  const out = execFileSync("git", ["ls-files", "-z"], { cwd: ROOT }).toString("utf8").split("\0").filter(Boolean);
  return out.filter((f) => EXT.has(path.extname(f).toLowerCase()) && !EXEMPT.has(f) && fs.existsSync(path.join(ROOT, f)));
}

function scanText(rel, buf) {
  const hits = [];
  const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  if (bom && /\.(js|mjs|html)$/i.test(rel) && !BOM_OK.has(rel)) hits.push({ kind: "bom", line: 1, text: "UTF-8 BOM" });
  // a UTF-16LE file (BOM FF FE, some older reports) is a valid encoding, not corruption: read it as UTF-16
  const text = (buf[0] === 0xff && buf[1] === 0xfe ? buf.slice(2).toString("utf16le") : buf.toString("utf8")).replace(/^\ufeff/, "");
  const lines = text.split("\n");
  lines.forEach((l, i) => {
    const at = (re, kind) => { let m; re.lastIndex = 0; while ((m = re.exec(l))) hits.push({ kind, line: i + 1, col: m.index + 1, text: l.slice(Math.max(0, m.index - 20), m.index + 30) }); };
    at(/\ufffd/g, "fffd");
    at(/[\u00d8-\u00db][\u0080-\u00bf]/g, "mojibake");
    at(/[\ufb50-\ufd3d\ufd40-\ufdff\ufe70-\ufeff]/g, "presentation");
  });
  return hits;
}

function scan() {
  const out = [];
  for (const rel of files()) for (const h of scanText(rel, fs.readFileSync(path.join(ROOT, rel)))) out.push(Object.assign({ file: rel }, h));
  return out;
}

module.exports = { scan, scanText, files };

if (require.main === module) {
  const hits = scan();
  for (const h of hits) console.log(h.file + ":" + h.line + (h.col ? ":" + h.col : "") + "  " + h.kind + "  " + JSON.stringify(h.text) + "  [" + [...h.text].filter((c) => c.codePointAt(0) > 127).map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).slice(0, 8).join(" ") + "]");
  console.log(hits.length + " hit(s) in " + files().length + " files");
  process.exitCode = hits.length ? 1 : 0;
}
