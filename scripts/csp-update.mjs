#!/usr/bin/env node
/*
 * csp-update.mjs - writes the security headers, with the Content-Security-Policy, into firebase.json.
 *
 *   npm run csp:update        recompute the inline-script hashes and write firebase.json
 *   node scripts/csp-update.mjs --check    exit 1 if firebase.json is not what this script would write
 *
 * The policy allows only what the pages load, as observed on the preview with scripts/checks/csp.js (2026-10-27):
 *   - scripts: the site itself, the inline scripts by their sha256 hash (no 'unsafe-inline'), the Sentry loader
 *     (js-de.sentry-cdn.com) and the Sentry SDK it loads (browser.sentry-cdn.com), the Firebase SDK
 *     (www.gstatic.com/firebasejs, used by migrate.js and the admin) and, for the admin's Google sign-in,
 *     apis.google.com;
 *   - connections: the site, Firestore, Firebase Auth (identitytoolkit, and securetoken for token refresh) and the
 *     Sentry ingest host of this project;
 *   - frames: the Firebase Auth domain (the admin's sign-in helper frame); nothing may frame the site
 *     (frame-ancestors 'none', plus X-Frame-Options: DENY). The Google sign-in itself (accounts.google.com) opens
 *     in its own window or by redirect, which this policy does not govern;
 *   - images: the site, data: and blob: (the save-image card), and www.google.com (the Firestore connection's
 *     connectivity check image);
 *   - fonts, the service worker and the manifest: the site only; styles: the site plus inline styles.
 * An inline script is any <script> without a src whose type is empty, text/javascript or module, in any HTML file
 * under public/. JSON-LD blocks are data, never run, and need no hash.
 *
 * ASCII-only.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
const FIREBASE_JSON = path.join(ROOT, "firebase.json");

const SENTRY_INGEST = "https://o4512305775443968.ingest.de.sentry.io";
const AUTH_DOMAIN = "https://ghareebalquran-d9ae5.firebaseapp.com";

// HTML files that can run inline scripts (every page Hosting serves)
export function htmlFiles(dir = PUBLIC) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...htmlFiles(p));
    else if (e.name.endsWith(".html")) out.push(p);
  }
  return out.sort();
}

// the exact text of every inline script that runs, per file
export function inlineScripts(html) {
  const out = [], re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || "";
    if (/\ssrc\s*=/.test(attrs)) continue;
    const type = (attrs.match(/\stype\s*=\s*"([^"]*)"/i) || [])[1];
    if (type && !/^(text\/javascript|module)$/i.test(type.trim())) continue;
    out.push(m[2]);
  }
  return out;
}

export function hashes() {
  const set = new Map();
  for (const f of htmlFiles()) {
    for (const s of inlineScripts(fs.readFileSync(f, "utf8"))) {
      const h = "'sha256-" + crypto.createHash("sha256").update(s, "utf8").digest("base64") + "'";
      if (!set.has(h)) set.set(h, path.relative(PUBLIC, f).split(path.sep).join("/"));
    }
  }
  return [...set.keys()].sort();
}

export function policy() {
  return [
    "default-src 'self'",
    "script-src 'self' " + hashes().join(" ") + " https://js-de.sentry-cdn.com https://browser.sentry-cdn.com https://www.gstatic.com/firebasejs/ https://apis.google.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://www.google.com",
    "font-src 'self'",
    "connect-src 'self' https://firestore.googleapis.com https://identitytoolkit.googleapis.com https://securetoken.googleapis.com " + SENTRY_INGEST,
    "frame-src " + AUTH_DOMAIN,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function securityHeaders() {
  return [
    { key: "Content-Security-Policy", value: policy() },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ];
}

// firebase.json with the "**" security-header block set (added first, so per-path rules after it still apply)
export function updatedFirebaseJson() {
  const text = fs.readFileSync(FIREBASE_JSON, "utf8");
  const j = JSON.parse(text);
  const list = j.hosting.headers || [];
  const rest = list.filter((h) => h.source !== "**");
  j.hosting.headers = [{ source: "**", headers: securityHeaders() }].concat(rest);
  return JSON.stringify(j, null, 2) + "\n";
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const next = updatedFirebaseJson();
  const cur = fs.readFileSync(FIREBASE_JSON, "utf8");
  if (process.argv.includes("--check")) {
    if (cur !== next) { console.error("csp-update: firebase.json is stale; run npm run csp:update"); process.exit(1); }
    console.log("csp-update: firebase.json is current");
  } else {
    fs.writeFileSync(FIREBASE_JSON, next);
    console.log("csp-update: " + (cur === next ? "no change" : "firebase.json updated") + " (" + hashes().length + " inline script hashes)");
  }
}
