#!/usr/bin/env node
/*
 * verify-client-firestore.mjs - proves the migrated client reads the migrated
 * data from the Firestore EMULATOR (not from JSON).
 *
 * Run inside `firebase emulators:exec --project demo-ghareeb --only firestore`
 * via `npm run client:verify`. The emulator has already been seeded by
 * scripts/seed-emulator.js.
 *
 * What it asserts:
 *   1. the SPA resolves its data through Firestore (window.__DATA_SRC__ == 'firestore')
 *   2. the surah list renders the 28 migrated surahs in Mushaf order with `no` 78..114
 *   3. the app shows all 73 words ("73 كلمة في 28 سورة")
 *   4. a word deep link works (word id derived from the migrated `no`)
 *   5. the challenge renders 30 day tiles and day 1 resolves its word refs
 *      (proves the Firestore {no,word} object refs normalize back to tuples)
 *   6. no uncaught page/console errors occurred
 *
 * The two Firebase CDN modules the client imports are fetched once by Node and
 * served to the browser through routing, so the test is hermetic and does not
 * depend on browser network access to gstatic (production still uses the CDN).
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve('public');
const PORT = 5179;
const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
const SDK_CACHE = path.join(os.tmpdir(), 'ghareeb-fb-sdk-10.14.1');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  let p;
  try {
    p = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (_) {
    p = '/';
  }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

async function ensureSdk(name) {
  fs.mkdirSync(SDK_CACHE, { recursive: true });
  const dest = path.join(SDK_CACHE, name);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1000) return dest;
  const res = await fetch(SDK_BASE + name);
  if (!res.ok) throw new Error(`failed to fetch ${name}: HTTP ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  return dest;
}

let browser;
const pageErrors = [];
const consoleErrors = [];

function die(msg) {
  console.error('CLIENT-VERIFY FAIL: ' + msg);
  if (pageErrors.length) console.error('  page errors: ' + pageErrors.join(' | '));
  if (consoleErrors.length) console.error('  console errors: ' + consoleErrors.join(' | '));
  process.exitCode = 1;
}

try {
  const [appJs, fsJs] = await Promise.all([ensureSdk('firebase-app.js'), ensureSdk('firebase-firestore.js')]);

  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 860 } });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  await page.route(/firebasejs\/10\.14\.1\/firebase-app\.js$/, (r) => r.fulfill({ path: appJs, contentType: 'text/javascript' }));
  await page.route(/firebasejs\/10\.14\.1\/firebase-firestore\.js$/, (r) => r.fulfill({ path: fsJs, contentType: 'text/javascript' }));

  await page.goto(`http://127.0.0.1:${PORT}/?emul=1`, { waitUntil: 'domcontentloaded' });
  // migrate.js sets __DATA_SRC__ = 'pending' synchronously, so wait for it to
  // leave 'pending' (it becomes 'firestore' or the offline 'json' fallback).
  await page.waitForFunction(() => typeof window.__DATA_SRC__ === 'string' && window.__DATA_SRC__ !== 'pending', { timeout: 30000 });

  const dataSrc = await page.evaluate(() => window.__DATA_SRC__);
  if (dataSrc !== 'firestore') {
    die(`expected window.__DATA_SRC__ === 'firestore', got '${dataSrc}'`);
  } else {
    console.log(`CLIENT-VERIFY: data source = ${dataSrc} (Firestore, emulator)`);
  }

  // Surah list: 28 rows, first no=78, last no=114
  await page.goto(`http://127.0.0.1:${PORT}/?emul=1#/surahs`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app .list.sl .row', { timeout: 15000 });
  const rows = await page.$$eval('#app .list.sl .row', (els) =>
    els.map((el) => ({
      no: parseInt(el.querySelector('.bd')?.textContent || '', 10),
      name: el.querySelector('.q')?.textContent || '',
    })),
  );
  if (rows.length !== 28) {
    die(`expected 28 surah rows, got ${rows.length}`);
  } else {
    console.log(`CLIENT-VERIFY: surah rows = ${rows.length}`);
  }
  if (rows[0].no !== 78 || rows[rows.length - 1].no !== 114) {
    die(`expected first no=78 and last no=114, got first=${rows[0].no} last=${rows[rows.length - 1].no}`);
  } else {
    console.log(`CLIENT-VERIFY: Mushaf order ok (first=${rows[0].no} "${rows[0].name}", last=${rows[rows.length - 1].no} "${rows[rows.length - 1].name}")`);
  }

  // Home summary: 73 words in 28 surahs
  await page.goto(`http://127.0.0.1:${PORT}/?emul=1#/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app .sub', { timeout: 15000 });
  const summary = await page.$eval('#app .sub', (el) => el.textContent || '');
  const m = summary.match(/(\d+)\s+كلمة في\s+(\d+)\s+سورة/);
  if (!m || m[1] !== '73' || m[2] !== '28') {
    die(`expected "73 كلمة في 28 سورة" summary, got "${summary.trim()}"`);
  } else {
    console.log(`CLIENT-VERIFY: word count ok ("${m[1]} كلمة في ${m[2]} سورة")`);
  }

  // Deep link into a migrated word page (an-nas word 0 => id 114-0)
  await page.goto(`http://127.0.0.1:${PORT}/?emul=1#/word/114-0`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app .wd.q', { timeout: 15000 });
  const word = await page.$eval('#app .wd.q', (el) => el.textContent || '');
  if (!word.trim()) {
    die('word deep link rendered an empty word');
  } else {
    console.log(`CLIENT-VERIFY: word deep link ok ("${word.trim()}")`);
  }

  // Challenge: object-form refs from Firestore must normalize back to tuples
  await page.goto(`http://127.0.0.1:${PORT}/?emul=1#/challenge`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app .cg .dy', { timeout: 15000 });
  const dayTiles = await page.$$eval('#app .cg .dy', (els) => els.length);
  if (dayTiles !== 30) {
    die(`expected 30 challenge day tiles, got ${dayTiles}`);
  } else {
    console.log(`CLIENT-VERIFY: challenge day tiles = ${dayTiles}`);
  }

  // Day 1 must resolve its word refs (proves {no,word} objects -> tuples works)
  await page.goto(`http://127.0.0.1:${PORT}/?emul=1#/day/1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#dw .list.g .row', { timeout: 15000 });
  const dayRows = await page.$$eval('#dw .list.g .row', (els) => els.length);
  if (dayRows < 1) {
    die('day 1 rendered no word rows (challenge refs did not resolve)');
  } else {
    console.log(`CLIENT-VERIFY: challenge day-1 word rows = ${dayRows}`);
  }

  if (pageErrors.length) die('page errors occurred');
  if (consoleErrors.length) die('console errors occurred');
  if (!process.exitCode) {
    console.log('CLIENT-VERIFY: no page/console errors');
    console.log('CLIENT-VERIFY PASS');
  }
} catch (e) {
  die(String((e && e.stack) || e));
} finally {
  if (browser) await browser.close().catch(() => {});
  server.close();
}