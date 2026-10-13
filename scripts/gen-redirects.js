#!/usr/bin/env node
/*
 * gen-redirects.js
 *
 * Generates the Firebase Hosting `redirects` block in firebase.json from the
 * single source of truth data/redirects.json (71 legacy Arabic URLs -> new
 * slug URLs, HTTP 301). Run after changing data/redirects.json.
 *
 * Old URLs on the old site were /word/<arabic-name>.html; the old Arabic
 * names are the keys of data/redirects.json and their values are the new
 * canonical slugs served by static pages.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const firebaseJsonPath = path.join(ROOT, 'firebase.json');
const redirectsPath = path.join(ROOT, 'data', 'redirects.json');

const config = JSON.parse(fs.readFileSync(firebaseJsonPath, 'utf8'));
const redirects = JSON.parse(fs.readFileSync(redirectsPath, 'utf8'));

const entries = Object.keys(redirects).map((from) => {
  const to = redirects[from];
  if (!/^[a-z0-9-]+$/.test(to)) {
    throw new Error(`redirect destination must be an ASCII slug: "${from}" -> "${to}"`);
  }
  return { source: `/word/${from}.html`, destination: `/word/${to}.html`, type: 301 };
});

if (!config.hosting) throw new Error('firebase.json has no hosting block');
config.hosting.redirects = entries;
fs.writeFileSync(firebaseJsonPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
console.log(`gen-redirects: wrote ${entries.length} hosting 301 entries into firebase.json.`);
for (const e of entries.slice(0, 3)) {
  console.log(`  ${e.source} -> ${e.destination} (${e.type})`);
}