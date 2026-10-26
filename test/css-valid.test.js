/*
 * css-valid.test.js - every stylesheet the site ships must parse cleanly: no rule or selector that a browser would drop.
 *
 * Sources: the <style> blocks of public/index.html, public/css/app.css, and the <style> blocks and style="" attributes
 * of every static page (404, legal pages, word and surah pages, admin).
 * 1. Structure (Node): a tokenizer walks each stylesheet (comments, strings, nesting inside @media/@supports/...) and
 *    fails on an unbalanced brace, an unterminated comment or string, a comment that swallows rules (one opened and
 *    closed only by a later comment holds a brace), or stray text outside a rule.
 * 2. Browser parse (Chromium): every style rule, every at-rule prelude and every self-contained at-rule (@keyframes,
 *    @font-face) is parsed on its own with CSSStyleSheet.replaceSync; a rule the browser drops (bad selector, stray
 *    comment text, ...) fails the test with its file and text. Rules aimed only at Firefox (::-moz-...) are dropped by
 *    Chromium by design and are allowed. style="" attributes must keep every declaration.
 * The browser part skips cleanly when Chromium is unavailable.
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const PUBLIC = path.resolve(__dirname, "..", "public");

function sources() {
  const out = [];
  const html = (rel) => {
    const s = fs.readFileSync(path.join(PUBLIC, rel), "utf8");
    [...s.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].forEach((m, i) => out.push({ file: rel + " <style> #" + (i + 1), css: m[1] }));
    return s;
  };
  html("index.html");
  out.push({ file: "css/app.css", css: fs.readFileSync(path.join(PUBLIC, "css/app.css"), "utf8") });
  const pages = ["404.html", "admin/index.html", ...["about", "privacy", "terms", "rights"].map((d) => d + "/index.html").filter((f) => fs.existsSync(path.join(PUBLIC, f))),
    ...fs.readdirSync(path.join(PUBLIC, "word")).filter((f) => f.endsWith(".html")).map((f) => "word/" + f),
    ...fs.readdirSync(path.join(PUBLIC, "surah")).filter((f) => f.endsWith(".html")).map((f) => "surah/" + f)];
  const attrs = [];
  for (const rel of pages) {
    const s = html(rel);
    for (const m of s.matchAll(/\sstyle="([^"]*)"/g)) attrs.push({ file: rel, decl: m[1] });
  }
  return { sheets: out, attrs };
}

// Splits a stylesheet into units: { kind: "rule", text } for style rules, { kind: "prelude", text } for the condition of
// a grouping at-rule (@media/@supports/@container/@layer/@scope/@document), { kind: "atrule", text } for self-contained
// at-rules (@keyframes, @font-face, @page, @import, ...). Throws on broken structure.
const GROUPING = /^@(media|supports|container|layer|scope|document)\b/i;
function units(css, where) {
  const out = [];
  let i = 0;
  const n = css.length;
  const fail = (msg, at) => { throw new Error(where + ": " + msg + " near: " + JSON.stringify(css.slice(Math.max(0, at - 60), at + 60))); };
  // skip a comment or string starting at j; returns the index after it
  const skip = (j) => {
    if (css[j] === "/" && css[j + 1] === "*") {
      const e = css.indexOf("*/", j + 2); if (e < 0) fail("unterminated comment", j);
      // a comment opened and closed only by a later comment silently swallows the rules in between: no comment in
      // these stylesheets holds a brace, so one that does is swallowed CSS
      if (/[{}]/.test(css.slice(j + 2, e))) fail("a comment that swallows rules (it contains { or })", j);
      return e + 2;
    }
    const q = css[j]; let k = j + 1;
    while (k < n && css[k] !== q) { if (css[k] === "\\") k++; if (css[k] === "\n") fail("unterminated string", j); k++; }
    if (k >= n) fail("unterminated string", j);
    return k + 1;
  };
  // the block that starts at "{" (index j): returns the index of its matching "}"
  const blockEnd = (j) => {
    let d = 0, k = j;
    while (k < n) {
      const c = css[k];
      if ((c === "/" && css[k + 1] === "*") || c === '"' || c === "'") { k = skip(k); continue; }
      if (c === "{") d++;
      else if (c === "}") { d--; if (d === 0) return k; }
      k++;
    }
    fail("unbalanced brace (no closing })", j);
  };
  const walk = (from, to, depthLabel) => {
    let k = from, start = from;
    while (k < to) {
      const c = css[k];
      if ((c === "/" && css[k + 1] === "*") || c === '"' || c === "'") { k = skip(k); continue; }
      if (c === "}") fail("unbalanced brace (stray })", k);
      if (c === ";") {
        const stmt = css.slice(start, k).replace(/\/\*[\s\S]*?\*\//g, "").trim();
        if (!stmt.startsWith("@")) fail("stray text outside a rule: " + JSON.stringify(stmt.slice(0, 80)), k);
        out.push({ kind: "atrule", text: stmt + ";", where: depthLabel });
        start = k + 1; k++; continue;
      }
      if (c === "{") {
        const e = blockEnd(k);
        const head = css.slice(start, k).replace(/\/\*[\s\S]*?\*\//g, "").trim();
        if (!head) fail("a block without a selector", k);
        if (GROUPING.test(head)) { out.push({ kind: "prelude", text: head + "{}", where: depthLabel }); walk(k + 1, e, head); }
        else if (head.startsWith("@")) out.push({ kind: "atrule", text: head + css.slice(k, e + 1), where: depthLabel });
        else out.push({ kind: "rule", text: head + css.slice(k, e + 1), selector: head, where: depthLabel });
        k = e + 1; start = k; continue;
      }
      k++;
    }
    const rest = css.slice(start, to).replace(/\/\*[\s\S]*?\*\//g, "").trim();
    if (rest) fail("stray text outside a rule: " + JSON.stringify(rest.slice(0, 80)), start);
  };
  walk(0, n, "top level");
  return out;
}

test("CSS structure: balanced braces, closed comments and strings, no stray text (every stylesheet the site ships)", () => {
  const { sheets } = sources();
  assert.ok(sheets.length >= 3, "found the stylesheets");
  let total = 0;
  for (const s of sheets) total += units(s.css, s.file).length;
  assert.ok(total > 500, "parsed the rules (" + total + ")");
});

test("CSS parse: no rule, selector or at-rule condition a browser would drop", { timeout: 180000 }, async (t) => {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let browser;
  try { browser = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return; }
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><head></head><body><div id=x></div></body></html>");
    const { sheets, attrs } = sources();
    // the same unit text appears in many pages: parse each distinct one once
    const seen = new Map();
    for (const s of sheets) for (const u of units(s.css, s.file)) { if (!seen.has(u.text)) seen.set(u.text, { ...u, files: new Set() }); seen.get(u.text).files.add(s.file); }
    const list = [...seen.values()];
    const verdict = await page.evaluate((texts) => texts.map((txt) => {
      const sh = new CSSStyleSheet();
      try { sh.replaceSync(txt); } catch (e) { return { n: -1, err: String(e) }; }
      return { n: sh.cssRules.length, sel: sh.cssRules[0] && sh.cssRules[0].selectorText };
    }), list.map((u) => u.text));
    const firefoxOnly = (u) => u.kind === "rule" && u.selector.split(",").every((p) => /::?-moz-/.test(p));
    const dropped = list.filter((u, i) => verdict[i].n !== 1 && !firefoxOnly(u));
    assert.deepStrictEqual(dropped.map((u) => [...u.files][0] + " (" + u.where + "): " + u.text.slice(0, 160)), [], "rules the browser would drop");
    // style="" attributes: every declaration is kept
    const lostDecls = await page.evaluate((items) => {
      const el = document.getElementById("x"), bad = [];
      for (const it of items) {
        el.setAttribute("style", it.decl);
        const want = it.decl.split(";").map((d) => d.trim()).filter(Boolean).length;
        if (el.style.length < want) bad.push(it.file + ': style="' + it.decl + '" keeps ' + el.style.length + " of " + want);
      }
      return bad;
    }, attrs);
    assert.deepStrictEqual(lostDecls, [], "style attributes with dropped declarations");
    assert.ok(list.length > 300 && verdict.every((v) => v.n !== -1 || true), "checked " + list.length + " distinct rules");
  } finally {
    await browser.close();
  }
});
