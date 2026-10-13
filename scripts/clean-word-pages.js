#!/usr/bin/env node
/*
 * clean-word-pages.js
 *
 * Word-page hygiene: public/word must contain exactly the 73 canonical pages
 * listed in public/sitemap.xml. All other files (legacy Arabic-named pages,
 * naming variants, mojibake leftovers) are moved (not deleted irrecoverably)
 * to the temp backup dir and removed from public/word so Hosting stops
 * serving them (legacy URLs now go through the 301 redirects generated from
 * data/redirects.json; AGENTS section 11).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const wordsDir = path.join(ROOT, 'public', 'word');
const sitemapPath = path.join(ROOT, 'public', 'sitemap.xml');

const sitemap = fs.readFileSync(sitemapPath, 'utf8');
const canonical = new Set(
  [...sitemap.matchAll(/<loc>https:\/\/ghareebalquran\.com\/word\/([^<]+)<\/loc>/g)].map((m) => m[1]),
);
if (canonical.size !== 73) throw new Error(`expected 73 canonical slugs, found ${canonical.size}`);

const files = fs.readdirSync(wordsDir).filter((f) => f.endsWith('.html'));
const stale = files.filter((f) => !canonical.has(f));

if (stale.length === 0) {
  console.log('clean-word-pages: nothing to clean (public/word already canonical).');
  process.exit(0);
}

const backupRoot = process.env.GHAREEB_STALE_BACKUP ||
  path.join(process.env.LOCALAPPDATA || process.env.TEMP, 'opencode', 'ghareeb-copy', 'stale-word-pages');
fs.mkdirSync(backupRoot, { recursive: true });
let moved = 0;
for (const f of stale) {
  fs.copyFileSync(path.join(wordsDir, f), path.join(backupRoot, f));
  fs.unlinkSync(path.join(wordsDir, f));
  moved += 1;
}
const remaining = fs.readdirSync(wordsDir).filter((f) => f.endsWith('.html')).length;
console.log(`clean-word-pages: moved ${moved} stale pages to ${backupRoot}; remaining canonical pages: ${remaining}`);
if (remaining !== 73) {
  console.error(`clean-word-pages: expected 73 remaining pages, got ${remaining}`);
  process.exit(1);
}