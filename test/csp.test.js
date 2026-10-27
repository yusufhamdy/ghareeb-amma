"use strict";
/*
 * csp.test.js - the security headers in firebase.json.
 *
 *   - firebase.json is what `npm run csp:update` writes: the Content-Security-Policy carries the sha256 of every
 *     inline script that runs on any page (a stale hash fails here), and no 'unsafe-inline' for scripts;
 *   - the policy keeps frame-ancestors 'none', object-src 'none', base-uri 'self', form-action 'self';
 *   - nosniff, Referrer-Policy, X-Frame-Options DENY and the Permissions-Policy apply to every path, with
 *     clipboard-write and web-share left allowed; no COOP/COEP; HSTS is not set here (Hosting sends it);
 *   - no page has an inline event handler (on...="...") in its markup or in markup its scripts write, since the
 *     policy blocks them.
 *
 * ASCII-only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");

let mod;
async function csp() { if (!mod) mod = await import("../scripts/csp-update.mjs"); return mod; }

const headersFor = (j, source) => ((j.hosting.headers || []).find((h) => h.source === source) || { headers: [] }).headers;
const header = (list, key) => (list.find((h) => h.key.toLowerCase() === key.toLowerCase()) || {}).value;

test("firebase.json is current (inline-script hashes are not stale)", async () => {
  const m = await csp();
  assert.strictEqual(fs.readFileSync(path.join(ROOT, "firebase.json"), "utf8"), m.updatedFirebaseJson(), "run npm run csp:update");
  const all = headersFor(JSON.parse(fs.readFileSync(path.join(ROOT, "firebase.json"), "utf8")), "**");
  const policy = header(all, "Content-Security-Policy");
  const scriptSrc = policy.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src "));
  assert.ok(!/'unsafe-inline'|'unsafe-eval'/.test(scriptSrc), "scripts allow no inline code by default and no eval");
  for (const h of m.hashes()) assert.ok(scriptSrc.includes(h), "hash in the policy: " + h);
  // every inline script of every page is covered
  let n = 0;
  for (const f of m.htmlFiles()) n += m.inlineScripts(fs.readFileSync(f, "utf8")).length;
  assert.ok(n >= 3, "the SPA and the admin have inline scripts (" + n + ")");
});

test("a changed inline script makes the policy stale", async () => {
  const m = await csp();
  const html = "<script>var a=1</script><script type=\"application/ld+json\">{}</script><script src=\"/x.js\"></script><script type=\"module\">b()</script>";
  assert.deepStrictEqual(m.inlineScripts(html), ["var a=1", "b()"], "JSON-LD and external scripts are not hashed");
  // one byte more in the app's main inline script: its hash is not in the committed policy
  const app = m.inlineScripts(fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8")).sort((a, b) => b.length - a.length)[0];
  const h = "'sha256-" + require("crypto").createHash("sha256").update(app + ";", "utf8").digest("base64") + "'";
  const policy = header(headersFor(JSON.parse(fs.readFileSync(path.join(ROOT, "firebase.json"), "utf8")), "**"), "Content-Security-Policy");
  assert.ok(!policy.includes(h), "an edited script would be blocked until npm run csp:update");
});

test("the policy's fixed directives and the other headers, on every path", async () => {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, "firebase.json"), "utf8"));
  assert.strictEqual(j.hosting.headers[0].source, "**", "the security block applies to every path");
  const all = headersFor(j, "**");
  const policy = header(all, "Content-Security-Policy");
  for (const d of ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "default-src 'self'", "worker-src 'self'", "font-src 'self'"]) {
    assert.ok(policy.split("; ").includes(d), "CSP has " + d);
  }
  assert.strictEqual(header(all, "X-Content-Type-Options"), "nosniff");
  assert.strictEqual(header(all, "Referrer-Policy"), "strict-origin-when-cross-origin");
  assert.strictEqual(header(all, "X-Frame-Options"), "DENY");
  const pp = header(all, "Permissions-Policy");
  assert.strictEqual(pp, "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  assert.ok(!/clipboard|web-share/.test(pp), "clipboard-write and web-share stay allowed");
  const every = (j.hosting.headers || []).flatMap((h) => h.headers.map((x) => x.key.toLowerCase()));
  for (const k of ["cross-origin-opener-policy", "cross-origin-embedder-policy", "strict-transport-security"]) assert.ok(!every.includes(k), "no " + k + " header here");
  // the admin keeps its own rules too
  assert.strictEqual(header(headersFor(j, "/admin/**"), "Cache-Control"), "no-store");
});

test("no inline event handlers anywhere the policy applies", async () => {
  const m = await csp();
  const bad = [];
  const files = m.htmlFiles().concat(fs.readdirSync(PUBLIC).filter((f) => f.endsWith(".js")).map((f) => path.join(PUBLIC, f)), [path.join(PUBLIC, "admin", "challenge-logic.js"), path.join(PUBLIC, "admin", "ayah-check.js")].filter((f) => fs.existsSync(f)));
  for (const f of files) {
    const t = fs.readFileSync(f, "utf8");
    const re = /<[a-z][^<>]*\son[a-z]+\s*=\s*["']/gi;
    let x;
    while ((x = re.exec(t))) bad.push(path.relative(PUBLIC, f) + ": " + x[0].slice(0, 60));
  }
  assert.deepStrictEqual(bad, [], "inline handlers");
});
