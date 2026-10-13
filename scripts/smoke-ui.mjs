#!/usr/bin/env node
/*
 * smoke-ui.mjs - Phase 5B T7 local pre-flight smoke.
 *
 * Serves public/ over a static server, routes the two Firebase SDK modules to
 * locally cached copies, drives Chromium through the required product surfaces
 * at three viewports, and requires the application to read its data from the
 * Firestore EMULATOR (window.__DATA_SRC__ === 'firestore').
 *
 * Run inside the emulator (see PHASE-5B.md T7):
 *   npx firebase emulators:exec --project demo-ghareeb --only firestore \
 *     "node scripts/seed-emulator.js && node scripts/smoke-ui.mjs"
 *
 * Covers: home, search, surahs, surah, word, challenge, day, quiz, the settings
 * sheet, the four legal pages, and the custom 404. Fails on any page/console
 * error or any missing surface.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve('public');
const PORT = 5181;
const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
const SDK_CACHE = path.join(os.tmpdir(), 'ghareeb-fb-sdk-10.14.1');
const VIEWPORTS = [
  { name: '400', width: 400, height: 860 },
  { name: '820', width: 820, height: 1180 },
  { name: '1440', width: 1440, height: 900 },
];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml', '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent((req.url || '/').split('?')[0]); } catch { p = '/'; }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
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

const failures = [];
const log = (m) => console.log(m);

async function main() {
  const [appJs, fsJs] = await Promise.all([ensureSdk('firebase-app.js'), ensureSdk('firebase-firestore.js')]);
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch();
  const base = `http://127.0.0.1:${PORT}/?emul=1`;

  try {
    for (const vp of VIEWPORTS) {
      const prefix = `[${vp.name}] `;
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror: ' + String(e)));
      page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
      await page.route(/firebasejs\/10\.14\.1\/firebase-app\.js$/, (r) => r.fulfill({ path: appJs, contentType: 'text/javascript' }));
      await page.route(/firebasejs\/10\.14\.1\/firebase-firestore\.js$/, (r) => r.fulfill({ path: fsJs, contentType: 'text/javascript' }));

      await page.goto(base + '#/', { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => typeof window.__DATA_SRC__ === 'string' && window.__DATA_SRC__ !== 'pending', { timeout: 30000 });

      const src = await page.evaluate(() => window.__DATA_SRC__);
      if (src !== 'firestore') failures.push(prefix + `data source is '${src}', expected 'firestore'`);

      const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); };

      // home
      await page.waitForSelector('#app .sub', { timeout: 15000 });
      const homeSub = await page.$eval('#app .sub', (el) => el.textContent || '');
      if (!/\d+\s+\S+.*\d+/.test(homeSub) || !(await page.$('#q'))) failures.push(prefix + 'home: summary or search box missing');

      // surahs
      await go('#/surahs');
      await page.waitForSelector('#app .list.sl .row', { timeout: 15000 });
      const surahRows = await page.$$eval('#app .list.sl .row', (e) => e.length);
      if (surahRows < 1) failures.push(prefix + 'surahs: no rows');

      // surah detail
      await go('#/surah/114');
      await page.waitForSelector('#app .list.g .row', { timeout: 15000 });
      const wordRows = await page.$$eval('#app .list.g .row', (e) => e.length);
      if (wordRows < 1) failures.push(prefix + 'surah: no word rows');

      // word deep link
      await go('#/word/114-0');
      await page.waitForSelector('#app .wd.q', { timeout: 15000 });
      const wordTxt = await page.$eval('#app .wd.q', (el) => (el.textContent || '').trim());
      if (!wordTxt) failures.push(prefix + 'word: empty word');

      // challenge + day
      await go('#/challenge');
      await page.waitForSelector('#app .cg .dy', { timeout: 15000 });
      const dayTiles = await page.$$eval('#app .cg .dy', (e) => e.length);
      if (dayTiles !== 30) failures.push(prefix + `challenge: expected 30 day tiles, got ${dayTiles}`);
      await go('#/day/1');
      await page.waitForSelector('#dw .list.g .row', { timeout: 15000 });
      const dayRows = await page.$$eval('#dw .list.g .row', (e) => e.length);
      if (dayRows < 1) failures.push(prefix + 'day 1: no word rows');

      // quiz
      await go('#/quiz');
      await page.waitForSelector('#app .card', { timeout: 15000 });

      // settings sheet
      await go('#/');
      await page.waitForSelector('[data-a="set"]', { timeout: 15000 });
      await page.click('[data-a="set"]');
      await page.waitForSelector('#sh.open', { timeout: 8000 });
      await page.click('[data-a="close"]');

      // legal pages
      for (const p of ['about', 'privacy', 'terms', 'rights']) {
        await go('#/' + p);
        await page.waitForFunction(() => {
          const a = document.querySelector('#app');
          return a && (a.textContent || '').trim().length > 60;
        }, { timeout: 15000 });
      }

      // custom 404
      await go('#/definitely-not-a-route-xyz');
      await page.waitForSelector('#app .card', { timeout: 15000 });
      const has404 = await page.$eval('#app .card', (el) => (el.textContent || '').includes('404'));
      if (!has404) failures.push(prefix + '404: marker not found');

      // search (last: it mutates #q)
      await go('#/');
      await page.waitForSelector('#q', { timeout: 15000 });
      const term = await page.evaluate(() => {
        const w = (window.__WORDS__ || [])[0];
        return w && w.words && w.words[0];
      });
      if (!term) failures.push(prefix + 'search: no term available from migrated data');
      else {
        await page.fill('#q', term);
        await page.waitForSelector('#res .row', { timeout: 8000 });
      }

      if (errs.length) failures.push(prefix + 'page/console errors: ' + errs.slice(0, 5).join(' | '));
      else if (!failures.some((f) => f.startsWith(prefix))) log(prefix + 'OK (all surfaces rendered, 0 errors)');
      await page.close();
    }
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
}

main().then(() => {
  if (failures.length) {
    for (const f of failures) console.error('SMOKE FAIL: ' + f);
    console.error(`SMOKE-UI: FAILED (${failures.length})`);
    process.exitCode = 1;
  } else {
    log('SMOKE-UI PASS: 3 viewports x home/search/surahs/surah/word/challenge/day/quiz/settings/legal/404');
  }
}).catch((e) => {
  console.error('SMOKE FAIL: ' + String((e && e.stack) || e));
  process.exitCode = 1;
});
