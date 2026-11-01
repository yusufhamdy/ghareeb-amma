#!/usr/bin/env node
/*
 * verify-client-firestore.mjs - proves the public page keeps working from the
 * published JSON when firestore.rules refuses its read of the public/ documents
 * (those are admin-only: nothing unpublished may reach a visitor).
 *
 * Emulator only: it refuses to run without a local Firestore emulator host. Run
 * inside `firebase emulators:exec --project demo-ghareeb --only firestore` via
 * `npm run client:verify`. The emulator has already been seeded by
 * scripts/seed-emulator.js; this script then replaces the words and challenge
 * documents with small unpublished canaries.
 *
 * What it asserts:
 *   1. the page's own Firestore client is refused public/data, public/prev and
 *      public/challenge, and the page settles on window.__DATA_SRC__ == 'json'
 *   2. no canary reached the page: neither override global is set, no canary in the
 *      app's data or the document
 *   3. the surah list renders the 28 surahs in Mushaf order with `no` 78..114
 *   4. the app shows all 73 words ("73 كلمة في 28 سورة")
 *   5. a word deep link works
 *   6. the challenge renders 30 day tiles and day 1 resolves its word refs
 *   7. no page errors, and no console errors other than the refused read
 *
 * The two Firebase CDN modules the client imports are fetched once by Node and
 * served to the browser through routing, so the test is hermetic and does not
 * depend on browser network access to gstatic (production still uses the CDN).
 */
import { chromium } from 'playwright';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve('public');
const PORT = 5179;
const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
const SDK_CACHE = path.join(os.tmpdir(), 'ghareeb-fb-sdk-10.14.1');
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
  const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST || '';
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(EMULATOR)) {
    throw new Error('no local Firestore emulator host set; refusing to run (use npm run client:verify)');
  }
  // unpublished drafts, each visibly different from the published files
  const admin = getFirestore(initializeApp({ projectId: 'demo-ghareeb' }));
  await admin.doc('public/data').set({ rev: 2, surahs: [{ surah: CANARY, no: 114, words: [CANARY], meanings: [CANARY], ayahs: [], source: CANARY }] });
  await admin.doc('public/prev').set({ rev: 1, surahs: [{ surah: CANARY, no: 114, words: [CANARY], meanings: [CANARY], ayahs: [], source: CANARY }] });
  await admin.doc('public/challenge').set({ startDate: null, releasedUpTo: null, days: [{ d: 1, w: [{ no: 114, word: CANARY }], reel: '', reelIg: `https://www.instagram.com/p/${CANARY}/` }] });

  const [appJs, fsJs] = await Promise.all([ensureSdk('firebase-app.js'), ensureSdk('firebase-firestore.js')]);

  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 860 } });
  page.on('pageerror', (e) => pageErrors.push(String(e)));
  page.on('console', (m) => {
    // the only error a visitor's browser may log: the refused read of the admin-only documents
    if (m.type() === 'error' && !/permission-denied|Missing or insufficient permissions/i.test(m.text())) consoleErrors.push(m.text());
  });
  await page.route(/firebasejs\/10\.14\.1\/firebase-app\.js$/, (r) => r.fulfill({ path: appJs, contentType: 'text/javascript' }));
  await page.route(/firebasejs\/10\.14\.1\/firebase-firestore\.js$/, (r) => r.fulfill({ path: fsJs, contentType: 'text/javascript' }));

  await page.goto(`http://127.0.0.1:${PORT}/?emul=1`, { waitUntil: 'domcontentloaded' });
  // migrate.js starts at 'pending' and settles on 'json' once its read is refused
  const SETTLE_MS = 15000;
  const settled = await page
    .waitForFunction(() => window.__DATA_SRC__ && window.__DATA_SRC__ !== 'pending', null, { timeout: SETTLE_MS })
    .then(() => true, () => false);

  const dataSrc = await page.evaluate(() => window.__DATA_SRC__);
  if (!settled || dataSrc !== 'json') {
    die(`expected window.__DATA_SRC__ to settle on 'json' within ${SETTLE_MS}ms, got '${dataSrc}'`);
  } else {
    console.log(`CLIENT-VERIFY: data source = ${dataSrc} (published files, emulator refused the read)`);
  }

  // The page's own Firestore client is refused every public/ document, by the rules in this repository.
  await page.waitForFunction(() => typeof W !== 'undefined' && W.length > 0, null, { timeout: 15000 });
  const refused = await page.evaluate(async (sdk) => {
    const [a, f] = await Promise.all([import(sdk + 'firebase-app.js'), import(sdk + 'firebase-firestore.js')]);
    // migrate.js sets up its app and the emulator connection once its own imports have finished
    for (let i = 0; i < 100 && !a.getApps().length; i++) await new Promise((r) => setTimeout(r, 100));
    const db = f.getFirestore(a.getApp());
    const out = {};
    for (const id of ['data', 'prev', 'challenge']) {
      out[id] = await f.getDoc(f.doc(db, 'public', id)).then(() => 'READ', (e) => e.code);
    }
    return out;
  }, SDK_BASE);
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

  // Challenge: the 30 published days
  await page.goto(`http://127.0.0.1:${PORT}/?emul=1#/challenge`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#app .cg .dy', { timeout: 15000 });
  const dayTiles = await page.$$eval('#app .cg .dy', (els) => els.length);
  if (dayTiles !== 30) {
    die(`expected 30 challenge day tiles, got ${dayTiles}`);
  } else {
    console.log(`CLIENT-VERIFY: challenge day tiles = ${dayTiles}`);
  }

  // Day 1 must resolve its word refs. Since Phase D the day screen is collapsible cards, not list rows.
  await page.goto(`http://127.0.0.1:${PORT}/?emul=1#/day/1`, { waitUntil: 'domcontentloaded' });
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