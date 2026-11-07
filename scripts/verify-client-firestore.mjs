#!/usr/bin/env node
/*
 * verify-client-firestore.mjs - proves the public page runs on the published JSON
 * alone: it asks neither the Firebase SDK nor Firestore for anything, and the
 * public/ documents are refused to a signed-out reader by firestore.rules
 * (admin-only: nothing unpublished may reach a visitor).
 *
 * Emulator only: it refuses to run without a local Firestore emulator host. Run
 * inside `firebase emulators:exec --project demo-ghareeb --only firestore` via
 * `npm run client:verify`. The emulator has already been seeded by
 * scripts/seed-emulator.js; this script then replaces the words and challenge
 * documents with small unpublished canaries.
 *
 * What it asserts:
 *   1. window.__DATA_SRC__ is 'json', no request reaches gstatic/firebasejs or
 *      Firestore on any route, and a signed-out REST read of public/data,
 *      public/prev and public/challenge is refused by the emulator
 *   2. no canary reached the page: neither override global is set, no canary in the
 *      app's data or the document
 *   3. the surah list renders every surah of the data in Mushaf order (`no` ascending)
 *   4. the app shows every word ("N كلمة في M سورة")
 *   5. a word deep link works
 *   6. the challenge renders a tile per published day and day 1 resolves its word refs
 *   7. no page errors and no console errors
 */
import { chromium } from 'playwright';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve('public');
// What the app must show: counted from the published files the emulator is seeded from (scripts/seed-emulator.js),
// so a published removal (handbook 4.2) needs no change here.
const { deriveSurahNo } = createRequire(import.meta.url)('../src/utils/migrate.js');
const DATA = JSON.parse(fs.readFileSync(path.join(ROOT, 'words.json'), 'utf8'));
const EXPECT = {
  surahs: DATA.length,
  words: DATA.reduce((n, s) => n + s.words.length, 0),
  days: JSON.parse(fs.readFileSync(path.join(ROOT, 'challenge.json'), 'utf8')).days.length,
  firstNo: Math.min(...DATA.map((s) => deriveSurahNo(s.surah))),
  lastNo: Math.max(...DATA.map((s) => deriveSurahNo(s.surah))),
};
const PORT = 5179;
const CANARY = 'CANARY-UNPUBLISHED-DRAFT';
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

let browser;
const pageErrors = [];
const consoleErrors = [];
const forbidden = [];

function die(msg) {
  console.error('CLIENT-VERIFY FAIL: ' + msg);
  if (pageErrors.length) console.error('  page errors: ' + pageErrors.join(' | '));
  if (consoleErrors.length) console.error('  console errors: ' + consoleErrors.join(' | '));
  process.exitCode = 1;
}

try {
  const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST || '';
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(EMULATOR)) {
    throw new Error('no local Firestore emulator host set; refusing to run (use npm run client:verify)');
  }
  // unpublished drafts, each visibly different from the published files
  const admin = getFirestore(initializeApp({ projectId: 'demo-ghareeb' }));
  await admin.doc('public/data').set({ rev: 2, surahs: [{ surah: CANARY, no: 114, words: [CANARY], meanings: [CANARY], ayahs: [], source: CANARY }] });
  await admin.doc('public/prev').set({ rev: 1, surahs: [{ surah: CANARY, no: 114, words: [CANARY], meanings: [CANARY], ayahs: [], source: CANARY }] });
  await admin.doc('public/challenge').set({ startDate: null, releasedUpTo: null, days: [{ d: 1, w: [{ no: 114, word: CANARY }], reel: '', reelIg: `https://www.instagram.com/p/${CANARY}/` }] });

  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 860 } });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('request', (q) => { if (/gstatic\.com\/firebasejs|firestore\.googleapis\.com|\/migrate\.js|\/firebase-config\.js|google\.firestore/.test(q.url()) || q.url().includes(EMULATOR)) forbidden.push(new URL(q.url()).pathname); });

  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });
  const SETTLE_MS = 15000;
  const settled = await page
    .waitForFunction(() => window.__DATA_SRC__ && window.__DATA_SRC__ !== 'pending', null, { timeout: SETTLE_MS })
    .then(() => true, () => false);

  const dataSrc = await page.evaluate(() => window.__DATA_SRC__);
  if (!settled || dataSrc !== 'json') {
    die(`expected window.__DATA_SRC__ to settle on 'json' within ${SETTLE_MS}ms, got '${dataSrc}'`);
  } else {
    console.log(`CLIENT-VERIFY: data source = ${dataSrc} (published files)`);
  }

  // A signed-out reader is refused every public/ document, by the rules in this repository.
  await page.waitForFunction(() => typeof W !== 'undefined' && W.length > 0, null, { timeout: 15000 });
  const refused = {};
  for (const id of ['data', 'prev', 'challenge']) {
    const r = await fetch(`http://${EMULATOR}/v1/projects/demo-ghareeb/databases/(default)/documents/public/${id}`);
    refused[id] = r.status === 403 ? 'permission-denied' : String(r.status);
  }
  if (Object.values(refused).some((c) => c !== 'permission-denied')) {
    die(`expected every public/ read to be refused, got ${JSON.stringify(refused)}`);
  } else {
    console.log(`CLIENT-VERIFY: public/data, public/prev and public/challenge refused`);
  }

  // Nothing unpublished reached the page.
  const leak = await page.evaluate((c) => ({
    words: window.__WORDS__ !== undefined,
    challenge: window.__CH__ !== undefined,
    inApp: JSON.stringify(W, (k, x) => (k === 's' ? x && x.surah : x)).includes(c) || JSON.stringify(CH).includes(c),
    inPage: document.documentElement.outerHTML.includes(c),
  }), CANARY);
  if (Object.values(leak).some(Boolean)) {
    die(`an unpublished canary reached the page: ${JSON.stringify(leak)}`);
  } else {
    console.log('CLIENT-VERIFY: no canary in the page');
  }

  // Surah list: one row per surah, in Mushaf order
  await page.goto(`http://127.0.0.1:${PORT}/#/surahs`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app .list.sl .row', { timeout: 15000 });
  const rows = await page.$$eval('#app .list.sl .row', (els) =>
    els.map((el) => ({
      no: parseInt(el.querySelector('.bd')?.textContent || '', 10),
      name: el.querySelector('.q')?.textContent || '',
    })),
  );
  if (rows.length !== EXPECT.surahs) {
    die(`expected ${EXPECT.surahs} surah rows, got ${rows.length}`);
  } else {
    console.log(`CLIENT-VERIFY: surah rows = ${rows.length}`);
  }
  if (rows[0].no !== EXPECT.firstNo || rows[rows.length - 1].no !== EXPECT.lastNo) {
    die(`expected first no=${EXPECT.firstNo} and last no=${EXPECT.lastNo}, got first=${rows[0].no} last=${rows[rows.length - 1].no}`);
  } else {
    console.log(`CLIENT-VERIFY: Mushaf order ok (first=${rows[0].no} "${rows[0].name}", last=${rows[rows.length - 1].no} "${rows[rows.length - 1].name}")`);
  }

  // Home summary: the word and surah counts
  await page.goto(`http://127.0.0.1:${PORT}/#/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app .sub', { timeout: 15000 });
  const summary = await page.$eval('#app .sub', (el) => el.textContent || '');
  const m = summary.match(/(\d+)\s+كلمة في\s+(\d+)\s+سورة/);
  if (!m || m[1] !== String(EXPECT.words) || m[2] !== String(EXPECT.surahs)) {
    die(`expected "${EXPECT.words} كلمة في ${EXPECT.surahs} سورة" summary, got "${summary.trim()}"`);
  } else {
    console.log(`CLIENT-VERIFY: word count ok ("${m[1]} كلمة في ${m[2]} سورة")`);
  }

  // Deep link into a migrated word page (an-nas word 0 => id 114-0)
  await page.goto(`http://127.0.0.1:${PORT}/#/word/114-0`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app .wd.q', { timeout: 15000 });
  const word = await page.$eval('#app .wd.q', (el) => el.textContent || '');
  if (!word.trim()) {
    die('word deep link rendered an empty word');
  } else {
    console.log(`CLIENT-VERIFY: word deep link ok ("${word.trim()}")`);
  }

  // Challenge: every published day
  await page.goto(`http://127.0.0.1:${PORT}/#/challenge`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app .cg .dy', { timeout: 15000 });
  const dayTiles = await page.$$eval('#app .cg .dy', (els) => els.length);
  if (dayTiles !== EXPECT.days) {
    die(`expected ${EXPECT.days} challenge day tiles, got ${dayTiles}`);
  } else {
    console.log(`CLIENT-VERIFY: challenge day tiles = ${dayTiles}`);
  }

  // Day 1 must resolve its word refs. Since Phase D the day screen is collapsible cards, not list rows.
  await page.goto(`http://127.0.0.1:${PORT}/#/day/1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#dw .dcard', { timeout: 15000 });
  const dayCards = await page.$$eval('#dw .dcard', (els) => els.length);
  if (dayCards < 1) {
    die('day 1 rendered no word cards');
  } else {
    console.log(`CLIENT-VERIFY: challenge day-1 word cards = ${dayCards}`);
  }
  // open every card, as scripts/qa-phase6.mjs does, so the resolved words show
  for (const c of await page.$$('#dw .dcard')) {
    await c.click().catch(() => {});
  }

  // The source must still be the published files at the end, after every reload above.
  await page.waitForFunction(() => window.__DATA_SRC__ !== 'pending', null, { timeout: SETTLE_MS }).catch(() => {});
  const finalSrc = await page.evaluate(() => window.__DATA_SRC__);
  if (finalSrc !== 'json') die(`window.__DATA_SRC__ ended as '${finalSrc}', expected 'json'`);

  if (forbidden.length) die(`the page asked for Firebase: ${JSON.stringify(forbidden.slice(0, 3))}`);
  else console.log('CLIENT-VERIFY: 0 requests to gstatic/firebasejs or Firestore');
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