#!/usr/bin/env node
/*
 * scripts/ci/checks.mjs - Phase 5B T6 static CI checks.
 *
 * Runs without network and without the emulator. Covers the static checks the
 * CI job needs:
 *   1. no Google Fonts references in public/ or functions/
 *   2. legacy redirects: data/redirects.json <-> firebase.json hosting.redirects
 *      (counts, 301 type, correct targets, target files exist)
 *   3. sitemap.xml word pages <-> public/word/*.html (exact set match)
 *   4. secrets scan over git-tracked files (google api keys, private key blocks,
 *      GitHub PATs, client secrets, service-account JSON, tracked .env files).
 *
 * Exits non-zero on any failure. Reports every finding.
 *
 * The public Firebase web config (public/firebase-config.js) legitimately holds
 * a public web API key; that one file is allowlisted for the google-api-key
 * pattern only and is reported as a NOTE, not a failure.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const failures = [];
const notes = [];
const ok = [];

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const readText = (p) => fs.readFileSync(p, 'utf8');

function walk(dir, out, filter) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name === 'node_modules' || e.name === '.git') continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) walk(abs, out, filter);
    else if (!filter || filter(abs)) out.push(abs);
  }
}

const TEXT_EXT = new Set(['.html', '.htm', '.js', '.mjs', '.cjs', '.json', '.css', '.xml', '.txt', '.md', '.rules', '.svg', '.webmanifest', '.yml', '.yaml', '.ps1']);

// ---------------------------------------------------------------- 1) fonts
function checkNoGoogleFonts() {
  const hits = [];
  for (const root of ['public', 'functions']) {
    const abs = path.join(ROOT, root);
    if (!fs.existsSync(abs)) continue;
    const files = [];
    walk(abs, files, (p) => TEXT_EXT.has(path.extname(p).toLowerCase()));
    for (const f of files) {
      const t = readText(f);
      if (t.includes('fonts.googleapis.com') || t.includes('fonts.gstatic.com')) hits.push(rel(f));
    }
  }
  if (hits.length) failures.push('google-fonts: references found in ' + hits.join(', '));
  else ok.push('google-fonts: 0 references in public/ and functions/');
}

// ------------------------------------------------------------ 2) redirects
function checkRedirects() {
  const fbPath = path.join(ROOT, 'firebase.json');
  const rjPath = path.join(ROOT, 'data', 'redirects.json');
  if (!fs.existsSync(fbPath) || !fs.existsSync(rjPath)) {
    failures.push('redirects: firebase.json or data/redirects.json missing');
    return;
  }
  const fb = JSON.parse(readText(fbPath));
  const rj = JSON.parse(readText(rjPath));
  const rules = (fb.hosting && fb.hosting.redirects) || [];
  const keys = Object.keys(rj);
  const bySource = new Map(rules.map((r) => [r.source, r]));
  const problems = [];
  for (const k of keys) {
    const expectedSource = '/word/' + k + '.html';
    const expectedDest = '/word/' + rj[k] + '.html';
    const r = bySource.get(expectedSource);
    if (!r) { problems.push('missing source ' + expectedSource); continue; }
    if (r.type !== 301) problems.push('not 301: ' + expectedSource + ' (type=' + r.type + ')');
    if (r.destination !== expectedDest) problems.push('bad destination for ' + expectedSource + ': ' + r.destination + ' != ' + expectedDest);
    const destFile = path.join(ROOT, 'public', r.destination.replace(/^\//, ''));
    if (!fs.existsSync(destFile)) problems.push('destination file missing: ' + r.destination);
  }
  if (rules.length !== keys.length) problems.push('rule count ' + rules.length + ' != redirects.json count ' + keys.length);
  if (problems.length) failures.push('redirects: ' + problems.length + ' problem(s): ' + problems.slice(0, 10).join('; '));
  else ok.push('redirects: ' + keys.length + ' legacy 301s verified against firebase.json + destination files');
}

// -------------------------------------------------------------- 3) sitemap
function checkSitemap() {
  const smPath = path.join(ROOT, 'public', 'sitemap.xml');
  const wordDir = path.join(ROOT, 'public', 'word');
  if (!fs.existsSync(smPath) || !fs.existsSync(wordDir)) {
    failures.push('sitemap: public/sitemap.xml or public/word/ missing');
    return;
  }
  const sm = readText(smPath);
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const wordLocs = locs.filter((u) => u.includes('/word/'));
  const locFiles = new Set(wordLocs.map((u) => {
    const i = u.indexOf('/word/');
    return u.slice(i + '/word/'.length);
  }));
  const files = fs.readdirSync(wordDir).filter((f) => f.toLowerCase().endsWith('.html'));
  const missingInSitemap = files.filter((f) => !locFiles.has(f));
  const missingOnDisk = [...locFiles].filter((f) => !files.includes(f));
  const problems = [];
  if (missingInSitemap.length) problems.push('word files not in sitemap: ' + missingInSitemap.slice(0, 5).join(', '));
  if (missingOnDisk.length) problems.push('sitemap word URLs without a file: ' + missingOnDisk.slice(0, 5).join(', '));
  if (problems.length) failures.push('sitemap: ' + problems.join('; '));
  else ok.push('sitemap: ' + files.length + ' word pages match sitemap exactly');
}

// -------------------------------------------------------------- 4) secrets
function trackedFiles() {
  try {
    const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString('utf8');
    return out.split('\u0000').filter(Boolean);
  } catch {
    const files = [];
    walk(ROOT, files);
    return files.map(rel);
  }
}

const SECRET_PATTERNS = [
  { name: 'google-api-key', re: /AIza[0-9A-Za-z_-]{20,}/, allow: new Set(['public/firebase-config.js']) },
  { name: 'private-key-block', re: /-----BEGIN (RSA|EC|OPENSSH) PRIVATE KEY-----/ },
  { name: 'github-pat', re: /ghp_[0-9A-Za-z]{20,}/ },
  { name: 'client-secret', re: /client_secret["']?\s*[:=]\s*["'][A-Za-z0-9_\-]{12,}/ },
  { name: 'service-account-json', re: /"type"\s*:\s*"service_account"/ },
];

function checkSecrets() {
  const files = trackedFiles();
  const problems = [];
  for (const f of files) {
    const base = path.basename(f);
    if (base === '.env' || base.endsWith('.env')) {
      problems.push('tracked env file: ' + f);
      continue;
    }
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) continue;
    if (!TEXT_EXT.has(path.extname(f).toLowerCase())) continue;
    let st; try { st = fs.statSync(abs); } catch { continue; }
    if (st.size > 2 * 1024 * 1024) continue;
    let t; try { t = readText(abs); } catch { continue; }
    for (const p of SECRET_PATTERNS) {
      if (p.re.test(t)) {
        if (p.allow && p.allow.has(f)) { notes.push('secrets: allowlisted public web key in ' + f + ' (' + p.name + ')'); continue; }
        problems.push('secret pattern ' + p.name + ' in ' + f);
      }
    }
  }
  if (problems.length) failures.push('secrets: ' + problems.join('; '));
  else ok.push('secrets: ' + files.length + ' tracked files scanned, no sensitive material');
}

checkNoGoogleFonts();
checkRedirects();
checkSitemap();
checkSecrets();

for (const n of notes) console.log('NOTE ' + n);
for (const o of ok) console.log('OK   ' + o);
for (const f of failures) console.log('FAIL ' + f);
console.log('checks.mjs: ' + (failures.length ? 'FAILED (' + failures.length + ')' : 'PASSED'));
process.exit(failures.length ? 1 : 0);
