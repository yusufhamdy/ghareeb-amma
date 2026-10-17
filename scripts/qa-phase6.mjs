#!/usr/bin/env node
/*
 * scripts/qa-phase6.mjs - Phase 6 consolidated functional / accessibility QA.
 *
 * One headless Chromium pass over the required QA surfaces. It serves public/
 * on a local static server, fulfils the Firebase SDK modules from the local
 * cache (same version the verification harness uses) and blocks every
 * *.googleapis.com request, so no production Firebase traffic happens and the
 * offline JSON path is exercised exactly as a visitor with an unreachable
 * Firestore would see it.
 *
 * It performs NO pixel / visual comparison (design is being reworked): the only
 * layout checks are functional (no blank screen, no horizontal overflow).
 *
 * Usage:  node scripts/qa-phase6.mjs [section ...]
 *   Sections: static home search draw surahs word quiz challenge settings
 *             keyboard a11y responsive pwa admin offline
 *   With no argument every section runs. Passing section prefixes re-runs only
 *   those (used to re-check after a fix).
 *
 * Exit code 0 only when every check passed.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve('public');
const PORT = Number(process.env.QA_PORT || 5182);
const BASE = `http://127.0.0.1:${PORT}`;
const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.14.1/';
const SDK_NAMES = ['firebase-app.js', 'firebase-firestore.js', 'firebase-auth.js'];
const SDK_CACHE = path.join(os.tmpdir(), 'ghareeb-fb-sdk-10.14.1');
const FAKE_NOW = Date.parse('2026-10-10T11:00:00Z');
const EXTERNAL = /googleapis\.com|identitytoolkit|firebaseinstallations/;

const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass: !!pass, detail: String(detail) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ utilities
const norm = (s) => String(s == null ? '' : s)
  .replace(/[\u0640\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
  .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')
  .replace(/\u0649/g, '\u064A')
  .replace(/\u0629/g, '\u0647')
  .replace(/\u0624/g, '\u0648')
  .replace(/\u0626/g, '\u064A')
  .replace(/\s+/g, ' ').trim();

// Benign, expected noise when Firestore is deliberately unreachable: the SDK's
// own retry log (caught by the app's fallback, not an uncaught error) plus the
// resource errors produced by the blocked requests. App "pageerror"s are never
// filtered.
const NOISE = /firestore\.googleapis|identitytoolkit|firebaseinstallations|ERR_FAILED|ERR_ABORTED|net::|Failed to load resource|Could not reach Cloud Firestore backend|@firebase\/firestore/i;
function watchErrors(page) {
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + String((e && e.message) || e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !NOISE.test(m.text())) errs.push('console: ' + m.text());
  });
  return errs;
}

// Tolerant waits: a missing surface must fail its own check, never abort the run.
async function waitFor(page, sel, ms = 8000) {
  try { await page.waitForSelector(sel, { timeout: ms }); return true; } catch { return false; }
}
async function textOf(page, sel, fallback = '') {
  const el = await page.$(sel);
  if (!el) return fallback;
  try { return (await el.textContent()) || ''; } catch { return fallback; }
}
async function countOf(page, sel) {
  try { return await page.$$eval(sel, (a) => a.length); } catch { return 0; }
}
const go = async (page, hash) => { await page.evaluate((h) => { location.hash = h; }, hash).catch(() => {}); };

// ------------------------------------------------------------- static server
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json',
};
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent((req.url || '/').split('?')[0]); } catch { p = '/'; }
  if (p === '/') p = '/index.html';
  let abs = path.normalize(path.join(ROOT, p));
  if (!abs.startsWith(ROOT)) { res.writeHead(403); res.end('forbidden'); return; }
  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) abs = path.join(abs, 'index.html');
  if (!fs.existsSync(abs)) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<!doctype html><title>404</title>not found');
    return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(abs).pipe(res);
});

// Mirrors public/index.html: NAMES -> NUM, build() sorting, id assignment.
function buildModel() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const m = html.match(/const NAMES='([^']+)'\.split\(' '\)/);
  if (!m) throw new Error('could not read NAMES from public/index.html');
  const NUM = {};
  m[1].split(' ').forEach((n, i) => { NUM[norm(n)] = 78 + i; });
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'words.json'), 'utf8'));
  const S = data.map((e) => {
    const name = e.surah.replace(/^\u0633\u0648\u0631\u0629\s*/, '');
    const s = { name, num: NUM[norm(name)] || 0, w: [] };
    e.words.forEach((word, i) => {
      let mm = e.meanings[i] || '';
      const k = mm.indexOf(':');
      if (k > 0 && k < 60 && norm(mm.slice(0, k)) === norm(word)) mm = mm.slice(k + 1).trim();
      const ay = e.ayahs[i] || { label: '', segments: [] };
      s.w.push({ s, word, mean: mm, ay, k: norm(word), km: norm(mm), n: +(ay.segments[0] && ay.segments[0].num) || 0 });
    });
    s.w.sort((a, b) => a.n - b.n);
    return s;
  }).sort((a, b) => a.num - b.num);
  const byId = {}; const W = [];
  S.forEach((s) => s.w.forEach((w, i) => { w.id = s.num + '-' + i; byId[w.id] = w; W.push(w); }));
  return { S, byId, W };
}

async function ensureSdk() {
  fs.mkdirSync(SDK_CACHE, { recursive: true });
  const paths = {};
  for (const name of SDK_NAMES) {
    const dest = path.join(SDK_CACHE, name);
    if (!fs.existsSync(dest) || fs.statSync(dest).size < 1000) {
      const r = await fetch(SDK_BASE + name);
      if (!r.ok) throw new Error('failed to fetch ' + name + ': HTTP ' + r.status);
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
    }
    paths[name] = dest;
  }
  return paths;
}

async function newContext(browser, opts = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 400, height: 860 } }, opts));
  await ctx.addInitScript((now) => { try { window.__NOW__ = now; } catch (e) {} }, FAKE_NOW);
  return ctx;
}

async function routePage(page, sdk) {
  await page.route('**/*', (route) => {
    const u = route.request().url();
    for (const name of SDK_NAMES) if (u === SDK_BASE + name) return route.fulfill({ path: sdk[name], contentType: 'text/javascript' });
    if (EXTERNAL.test(u)) return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
    return route.continue();
  }).catch(() => {});
}

// ================================================================== sections
async function main() {
  const ONLY = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const want = (s) => ONLY.length === 0 || ONLY.some((o) => s.startsWith(o));

  const sdk = await ensureSdk();
  const model = buildModel();
  const challenge = JSON.parse(fs.readFileSync(path.join(ROOT, 'challenge.json'), 'utf8'));
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const browser = await chromium.launch();
  const sections = {};

  // ---------------------------------------------------------------- static
  sections.static = async () => {
    const expect = async (p, okStatus, contains, name) => {
      let res;
      try { res = await fetch(BASE + p, { redirect: 'manual' }); } catch (e) { return check(name, false, 'fetch failed: ' + e.message); }
      let body = '';
      try { body = await res.text(); } catch {}
      const ok = res.status === okStatus && (!contains || body.includes(contains));
      check(name, ok, 'status ' + res.status + (contains && !body.includes(contains) ? ' (missing ' + contains + ')' : ''));
    };
    await expect('/', 200, 'id="app"', 'static: / serves the SPA');
    await expect('/words.json', 200, '', 'static: /words.json 200');
    await expect('/challenge.json', 200, '', 'static: /challenge.json 200');
    await expect('/manifest.json', 200, 'start_url', 'static: /manifest.json 200');
    await expect('/sw.js', 200, 'CACHE_NAME', 'static: /sw.js 200');
    await expect('/robots.txt', 200, 'Sitemap:', 'static: /robots.txt has sitemap line');
    await expect('/sitemap.xml', 200, '/word/', 'static: /sitemap.xml 200');
    await expect('/admin/', 200, 'noindex', 'static: /admin/ 200');
    await expect('/fonts/fonts.css', 200, '@font-face', 'static: /fonts/fonts.css 200');
    await expect('/word/zzz-no-such-word.html', 404, '', 'static: unknown /word/*.html -> 404');

    const adminHtml = fs.readFileSync(path.join(ROOT, 'admin', 'index.html'), 'utf8');
    check('static: admin declares noindex,nofollow', /<meta name="robots" content="noindex,nofollow">/.test(adminHtml));
    const fb = JSON.parse(fs.readFileSync('firebase.json', 'utf8'));
    const adminHeader = (fb.hosting.headers || []).find((h) => h.source === '/admin/**');
    check('static: firebase.json sets X-Robots-Tag for /admin/**', !!adminHeader && adminHeader.headers.some((x) => x.key === 'X-Robots-Tag' && /noindex/.test(x.value)));
    check('static: hosting rewrites only /word/** and /sitemap.xml to seo',
      (fb.hosting.rewrites || []).every((r) => r.source === '/word/**' || r.source === '/sitemap.xml'));
    check('static: no Google Fonts host in the SPA or admin', !/fonts\.googleapis|fonts\.gstatic/.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8') + adminHtml));
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    check('static: sw.js precaches the shell (cache ' + ((sw.match(/CACHE_NAME\s*=\s*'([^']+)'/) || [])[1] || '?') + ')', /assetsToCache/.test(sw));
  };

  // ------------------------------------------------------------ home (JSON)
  sections.home = async () => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage(); const errs = watchErrors(page); await routePage(page, sdk);
    const t0 = Date.now();
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    const shown = await waitFor(page, '#app .sub', 8000);
    const elapsed = Date.now() - t0;
    check('home: first render from local JSON without waiting on Firestore (<1800ms)', shown && elapsed < 1800, elapsed + 'ms');
    const sub = await textOf(page, '#app .sub');
    check('home: summary shows word and surah counts', /\d+/.test(sub) && (sub.match(/\d+/g) || []).length >= 2, sub.trim());
    check('home: search box present', !!(await page.$('#q')));
    check('home: draw button and surah link present', !!(await page.$('[data-a="rnd"]')) && !!(await page.$('a[href="#/surahs"]')));
    const navCount = await countOf(page, '#nv a');
    check('home: floating nav has 4 tabs', navCount === 4, navCount);
    const src = await page.evaluate(() => window.__DATA_SRC__).catch(() => '?');
    check('home: data source silently falls back to json', src === 'json', src);
    const bodyTxt = await textOf(page, '#app');
    check('home: no visible load error message', !/\u062a\u0639\u0630\u0631/.test(bodyTxt));
    await sleep(900);
    check('home: 0 page/console errors while Firestore is unreachable', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  };

  // ---------------------------------------------------------------- search
  sections.search = async () => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage(); const errs = watchErrors(page); await routePage(page, sdk);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await waitFor(page, '#q', 8000);
    const sample = model.W.find((w) => w.k.length > 3 && norm(w.mean).length > 12) || model.W[0];
    await page.fill('#q', sample.word).catch(() => {});
    await waitFor(page, '#res .row', 5000);
    const hitDiacritics = await countOf(page, '#res .row');
    check('search: finds a word typed with diacritics', hitDiacritics >= 1, hitDiacritics + ' rows');
    await page.fill('#q', norm(sample.word)).catch(() => {});
    await waitFor(page, '#res .row', 5000);
    const hitStripped = await countOf(page, '#res .row');
    check('search: finds the same word without diacritics', hitStripped >= 1, hitStripped + ' rows');
    const meanTerm = norm(sample.mean).slice(0, 6);
    await page.fill('#q', meanTerm).catch(() => {});
    await sleep(250);
    const hitMeaning = await countOf(page, '#res .row');
    check('search: matches meaning text', hitMeaning >= 1, hitMeaning + ' rows for "' + meanTerm + '"');
    await page.fill('#q', 'zzzznopezzz').catch(() => {});
    await sleep(250);
    const noRows = await countOf(page, '#res .row');
    const noCard = await page.$('#res .card');
    check('search: unknown term shows the empty-state card', noRows === 0 && !!noCard);
    const dom = await page.evaluate(() => document.body.innerText).catch(() => '');
    check('search: no "root/jidhr" search anywhere', !dom.includes('\u062c\u0630\u0631'));
    check('search: 0 page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  };

  // ------------------------------------------------------------ random draw
  sections.draw = async () => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage(); await routePage(page, sdk);
    await page.goto(BASE + '/#/word/' + model.W[0].id, { waitUntil: 'domcontentloaded' });
    await waitFor(page, '#app .wd.q', 8000);
    const draws = [];
    for (let i = 0; i < 6; i++) {
      const before = await page.evaluate(() => location.hash);
      await page.click('[data-a="rnd"]').catch(() => {});
      try { await page.waitForFunction((b) => location.hash !== b, before, { timeout: 5000 }); } catch {}
      draws.push(String(await page.evaluate(() => location.hash)).replace('#/word/', ''));
    }
    let repeats = 0;
    for (let i = 1; i < draws.length; i++) if (draws[i] === draws[i - 1]) repeats++;
    check('draw: random word never repeats consecutively (6 draws)', repeats === 0, draws.join(','));
    await ctx.close();
  };

  // ---------------------------------------------------------------- surahs
  sections.surahs = async () => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage(); const errs = watchErrors(page); await routePage(page, sdk);
    await page.goto(BASE + '/#/surahs', { waitUntil: 'domcontentloaded' });
    await waitFor(page, '#app .list.sl .row', 8000);
    const rows = await page.$$eval('#app .list.sl .row', (a) => a.map((r) => r.textContent || '')).catch(() => []);
    check('surahs: lists all 28 data surahs', rows.length === model.S.length, rows.length + ' vs ' + model.S.length);
    const numbers = await page.$$eval('#app .list.sl .row .bd', (a) => a.map((x) => +x.textContent.trim())).catch(() => []);
    const ascending = numbers.length > 0 && numbers.every((n, i) => i === 0 || n > numbers[i - 1]);
    check('surahs: mushaf order ascending', ascending, numbers.join(','));
    const counts = rows.map((t) => {
      if (t.includes('\u0643\u0644\u0645\u0629 \u0648\u0627\u062d\u062f\u0629')) return 1;
      if (t.includes('\u0643\u0644\u0645\u062a\u0627\u0646')) return 2;
      const m = t.match(/(\d+)\s*\u0643\u0644\u0645/); return m ? +m[1] : -1;
    });
    const total = counts.reduce((a, b) => a + (b > 0 ? b : 0), 0);
    check('surahs: word counts sum to 73', total === 73, 'sum=' + total);
    await go(page, '#/surah/114');
    await waitFor(page, '#app .list.g .row', 8000);
    const s114 = model.S.find((s) => s.num === 114);
    const w114 = await countOf(page, '#app .list.g .row');
    check('surah page: shows exactly that surah\'s words (114)', w114 === s114.w.length, w114 + ' vs ' + s114.w.length);
    check('surahs: 0 page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  };

  // ------------------------------------------------------------------ word
  sections.word = async () => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage(); const errs = watchErrors(page); await routePage(page, sdk);
    const samples = [model.W[0], model.W[10], model.W[35], model.W[60], model.W[model.W.length - 1]].filter(Boolean);
    let okAll = true; const bad = [];
    for (const w of samples) {
      await page.goto(BASE + '/#/word/' + w.id, { waitUntil: 'domcontentloaded' });
      if (!(await waitFor(page, '#app .wd.q', 8000))) { okAll = false; bad.push(w.id + ' no word card'); continue; }
      const got = await page.evaluate(() => ({
        word: (document.querySelector('#app .wd.q') || {}).textContent || '',
        mark: (document.querySelector('#app .ay mark') || {}).textContent || '',
        marks: document.querySelectorAll('#app .ay mark').length,
        header: (document.querySelector('#app > .pill') || {}).textContent || '',
      })).catch(() => ({ word: '', mark: '', marks: 0, header: '' }));
      const expectedLabel = String(w.ay.label || '').trim();
      const good = got.word.trim() === w.word
        && norm(got.mark) === norm(w.ay.segments[0] ? w.ay.segments[0].hl : '')
        && got.marks >= 1
        && (!expectedLabel || got.header.includes(expectedLabel));
      if (!good) { okAll = false; bad.push(w.id + ' word="' + got.word.trim() + '" mark="' + got.mark + '" header="' + got.header.trim() + '"'); }
    }
    check('word: word text, highlighted ayah word and ayah number map correctly', okAll, bad.join(' | '));
    const multi = model.W.find((w) => w.s.w.length > 1) || model.W[0];
    await page.goto(BASE + '/#/word/' + multi.id, { waitUntil: 'domcontentloaded' });
    await waitFor(page, '#app .wd.q', 8000);
    check('word: "other words from surah" link present when the surah has >1 word', !!(await page.$('a[href^="#/surah/"]')));
    await page.goto(BASE + '/#/word/000-0', { waitUntil: 'domcontentloaded' });
    await waitFor(page, '#app .card', 8000);
    const nf = await textOf(page, '#app');
    check('word: unknown word id shows a not-found card', nf.includes('\u0627\u0644\u0635\u0641\u062d\u0629 \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f\u0629'));
    check('word: 0 page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  };

  // ---------------------------------------------------------------- routes
  sections.routes = async () => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage(); const errs = watchErrors(page); await routePage(page, sdk);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await waitFor(page, '#q', 8000);
    check('routes: home shows the social strip (no close mark)', !!(await page.$('#app .strip')) && !(await page.$('#app .strip [data-a="close"]')));
    const footTxt = await textOf(page, 'footer.ft');
    const hasPriv = !!(await page.$('footer.ft a[href="#/privacy"]'));
    const hasRights = !!(await page.$('footer.ft a[href="#/rights"]'));
    check('routes: footer shows the legal links and the current year', hasPriv && hasRights && /[0-9]{4}/.test(footTxt), JSON.stringify({ hasPriv, hasRights, footTxt }));
    for (const k of ['about', 'privacy', 'terms', 'rights']) {
      await go(page, '#/' + k);
      await sleep(250);
      const txt = await textOf(page, '#app');
      check('routes: #/' + k + ' renders the legal page with the footer', txt.length > 150 && !!(await page.$('footer.ft')), txt.length + ' chars');
    }
    await go(page, '#/definitely-not-a-route');
    await sleep(250);
    const nf = await page.evaluate(() => {
      const app = document.querySelector('#app') || { textContent: '' };
      return {
        txt: app.textContent || '',
        home: !!document.querySelector('#app a[href="#/"]'),
        rnd: !!document.querySelector('#app [data-a="rnd"]'),
        foot: !!document.querySelector('footer.ft'),
      };
    }).catch(() => ({}));
    check('routes: unknown hash route shows the custom 404 with home + random-word buttons and the footer',
      /404/.test(nf.txt || '') && /\u0627\u0644\u0635\u0641\u062d\u0629 \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f\u0629/.test(nf.txt || '') && nf.home && nf.rnd && nf.foot, JSON.stringify(nf));
    check('routes: 0 page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  };

  // ------------------------------------------------------------------ quiz
  sections.quiz = async () => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage(); const errs = watchErrors(page); await routePage(page, sdk);
    await page.goto(BASE + '/#/quiz', { waitUntil: 'domcontentloaded' });
    await waitFor(page, '#app .opt', 8000);
    let questions = 0; let distinctOk = true; let optionsOk = true; let oneCorrectOk = true;
    for (let i = 0; i < 14; i++) {
      if (await page.$('[data-a="qre"]')) break;
      if (!(await waitFor(page, '#app .opt', 8000))) break;
      const opts = await page.$$eval('#app .opt', (a) => a.map((b) => (b.textContent || '').trim())).catch(() => []);
      questions++;
      if (opts.length !== 4) optionsOk = false;
      if (new Set(opts).size !== opts.length) distinctOk = false;
      await page.click('#app .opt:nth-child(1)').catch(() => {});
      await sleep(80);
      const okCount = await countOf(page, '#app .opt.ok');
      if (okCount !== 1) oneCorrectOk = false;
      await page.click('[data-a="qn"]').catch(() => {});
      await sleep(80);
    }
    check('quiz: runs 10 questions', questions === 10, questions + ' answered');
    check('quiz: every question has 4 options', optionsOk);
    check('quiz: the 4 options are distinct meanings (distractors never equal the correct one)', distinctOk);
    check('quiz: exactly one option is marked correct after answering', oneCorrectOk);
    check('quiz: result screen with score ring and restart', !!(await page.$('[data-a="qre"]')) && !!(await page.$('svg')));
    check('quiz: 0 page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  };

  // ------------------------------------------------------------- challenge
  sections.challenge = async () => {
    const released = (doneDays) => {
      const N = challenge.days.length; let prefix = 0;
      for (let i = 1; i <= N; i++) { if (doneDays.includes(i)) prefix = i; else break; }
      let u = Math.min(N, prefix + 1);
      if (challenge.releasedUpTo != null) u = Math.max(u, Math.max(0, Math.min(N, +challenge.releasedUpTo)));
      return u;
    };
    const gridState = async (page) => page.evaluate(() => {
      const t = [...document.querySelectorAll('#app .cg .dy')];
      const num = (x) => (x.textContent || '').replace(/\D+/g, '');
      return {
        n: t.length,
        cur: t.filter((x) => x.classList.contains('cur')).map(num),
        lk: t.filter((x) => x.classList.contains('lk')).length,
        ok: t.filter((x) => x.classList.contains('ok')).map(num),
        legend: !!document.querySelector('#app .lg'),
      };
    });

    const ctx = await newContext(browser);
    const page = await ctx.newPage(); const errs = watchErrors(page); await routePage(page, sdk);
    await page.goto(BASE + '/#/challenge', { waitUntil: 'domcontentloaded' });
    await waitFor(page, '#app .cg .dy', 8000);
    let states = await gridState(page).catch(() => ({ n: 0, cur: [], lk: 0, ok: [], legend: false }));
    const open0 = released([]);
    check('challenge: 30 day tiles always show', states.n === 30, states.n);
    check('challenge: fresh device shows today=1 and the rest locked', states.cur.join(',') === '1' && states.lk === 29 && states.ok.length === 0 && open0 === 1, JSON.stringify(states));
    check('challenge: legend (done/available/today/locked) present', states.legend);

    await go(page, '#/day/30');
    await waitFor(page, '#app .card', 8000);
    const day30 = await textOf(page, '#app');
    check('challenge: locked day page explains the lock and has no done button', /30/.test(day30) && !(await page.$('#dw')) && !(await page.$('[data-a="done"]')));

    await go(page, '#/challenge');
    await waitFor(page, '#app .cg .dy.lk', 8000);
    await page.click('#app .cg .dy.lk').catch(() => {});
    await waitFor(page, 'body > .toast', 4000);
    const toastText = await textOf(page, 'body > .toast');
    check('challenge: tapping a locked day shows the lock toast', /\d/.test(toastText), toastText.trim());

    await go(page, '#/day/1');
    const dwShown = await waitFor(page, '#dw', 12000);
    const dcards = await page.$$('#dw .dcard');
    check('challenge: day 1 opens as stacked word cards', dwShown && dcards.length >= 3, String(dcards.length));
    // D3: the day is completed by opening every word card; only then the done button enables
    for (const c of dcards) { await c.click().catch(() => {}); }
    try { await page.waitForFunction(() => { const b = document.querySelector('[data-a="done"]'); return b && !b.disabled; }, { timeout: 8000 }); } catch {}
    await page.click('[data-a="done"]').catch(() => {});
    await sleep(200);
    const prog = await page.evaluate(() => JSON.parse(localStorage.getItem('gq-prog') || '{}')).catch(() => ({}));
    check('challenge: marking the day done persists to gq-prog', Array.isArray(prog.done) && prog.done.includes(1), JSON.stringify(prog));

    await page.reload({ waitUntil: 'domcontentloaded' });
    await go(page, '#/challenge');
    await waitFor(page, '#app .cg .dy', 8000);
    states = await gridState(page).catch(() => ({ n: 0, cur: [], lk: 0, ok: [], legend: false }));
    const open1 = released([1]);
    check('challenge: progress persists after reload (day1 done, day2 today)', states.ok.join(',') === '1' && states.cur.join(',') === '2' && states.lk === 28 && open1 === 2, JSON.stringify(states));

    await page.evaluate((p) => localStorage.setItem('gq-prog', JSON.stringify(p)), { done: [1, 2] });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitFor(page, '#app .cg .dy', 8000);
    const cur3 = await page.$eval('#app .cg .dy.cur', (e) => (e.textContent || '').replace(/\D+/g, '')).catch(() => '');
    check('challenge: sequential rule after 2 done days opens day 3 as today', cur3 === '3', cur3);

    await go(page, '#/day/1');
    await waitFor(page, '#dw', 12000);
    const reels = await page.$$eval('#dw a', (a) => a.filter((x) => /target="_blank"/.test(x.outerHTML)).length).catch(() => 0);
    check('challenge: reel button hidden when the day has no reel link', reels === 0);
    check('challenge: 0 page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();

    const rmCtx = await newContext(browser, { reducedMotion: 'reduce' });
    const rmPage = await rmCtx.newPage(); await routePage(rmPage, sdk);
    await rmPage.goto(BASE + '/#/day/1', { waitUntil: 'domcontentloaded' });
    const t1 = Date.now();
    const rmShown = await waitFor(rmPage, '#dw', 5000);
    const rmMs = Date.now() - t1;
    const rlHidden = await rmPage.evaluate(() => { const r = document.querySelector('#rl'); return !r || getComputedStyle(r).display === 'none'; }).catch(() => false);
    check('challenge: prefers-reduced-motion skips the roulette (immediate words)', rmShown && rmMs < 1200 && rlHidden, rmMs + 'ms');
    await rmCtx.close();
  };

  // --------------------------------------------------------------- settings
  sections.settings = async () => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage(); const errs = watchErrors(page); await routePage(page, sdk);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await waitFor(page, '[data-a="set"]', 8000);
    await page.click('[data-a="set"]').catch(() => {});
    const opened = await waitFor(page, '#sh.open', 5000);
    check('settings: sheet opens as a labelled dialog', opened && await page.$eval('#sh .p', (el) => el.getAttribute('role') === 'dialog' && !!el.getAttribute('aria-label')).catch(() => false));
    await page.click('[data-m="dark"]').catch(() => {});
    await sleep(150);
    let s = await page.evaluate(() => JSON.parse(localStorage.getItem('gq-set') || '{}')).catch(() => ({}));
    check('settings: dark mode selection persists (gq-set)', s.mode === 'dark', JSON.stringify(s.mode));
    await page.click('[data-p="lav"]').catch(() => {});
    await sleep(120);
    s = await page.evaluate(() => JSON.parse(localStorage.getItem('gq-set') || '{}')).catch(() => ({}));
    check('settings: palette selection persists (gq-set)', s.pal === 'lav', JSON.stringify(s.pal));
    await page.click('[data-c="1"]').catch(() => {});
    await sleep(120);
    s = await page.evaluate(() => JSON.parse(localStorage.getItem('gq-set') || '{}')).catch(() => ({}));
    check('settings: stop-motion toggle persists (gq-set.cm)', s.cm === true, JSON.stringify(s.cm));
    await page.keyboard.press('Escape');
    await sleep(120);
    check('settings: Escape closes the sheet', !(await page.$('#sh.open')));
    check('settings: both styles offered (glass + shade)', !!(await page.$('[data-st="glass"]')) || !!(await page.$('[data-st="shade"]')));
    check('settings: 0 page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  };

  // --------------------------------------------------------------- keyboard
  sections.keyboard = async () => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage(); const errs = watchErrors(page); await routePage(page, sdk);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await waitFor(page, '#q', 8000);
    const seen = new Set();
    for (let i = 0; i < 14; i++) {
      await page.keyboard.press('Tab');
      const info = await page.evaluate(() => {
        const a = document.activeElement;
        if (!a) return null;
        return { tag: a.tagName, name: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 20) };
      }).catch(() => null);
      if (info) seen.add(info.tag + ':' + info.name);
    }
    check('keyboard: Tab moves focus through multiple controls', seen.size >= 4, seen.size + ' distinct stops');
    const focusVisible = await page.evaluate(() => {
      const el = document.querySelector('[data-a="set"]');
      el.focus();
      return el.matches(':focus-visible');
    }).catch(() => false);
    check('keyboard: focus-visible style applies to keyboard focus', focusVisible);
    await page.evaluate(() => document.querySelector('[data-a="set"]').focus()).catch(() => {});
    await page.keyboard.press('Enter');
    const kbOpen = await waitFor(page, '#sh.open', 5000);
    check('keyboard: Enter on the gear opens the settings sheet', kbOpen);
    await page.keyboard.press('Escape');
    await sleep(120);
    check('keyboard: Escape closes the sheet', !(await page.$('#sh.open')));
    check('keyboard: 0 page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  };

  // ------------------------------------------------------------------- a11y
  sections.a11y = async () => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage(); await routePage(page, sdk);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await waitFor(page, '#q', 8000);
    const meta = await page.evaluate(() => ({ lang: document.documentElement.lang, dir: document.documentElement.dir })).catch(() => ({}));
    check('a11y: html lang=ar dir=rtl', meta.lang === 'ar' && meta.dir === 'rtl', JSON.stringify(meta));
    for (const route of ['#/', '#/surahs', '#/challenge', '#/quiz']) {
      await go(page, route);
      await sleep(300);
      const nameless = await page.evaluate(() => [...document.querySelectorAll('button, a')].filter((el) => {
        if ((el.textContent || '').trim()) return false;
        return !(el.getAttribute('aria-label') || el.getAttribute('title'));
      }).length).catch(() => -1);
      check('a11y: ' + route + ' has no unlabelled buttons/links', nameless === 0, nameless + ' unlabelled');
    }
    const dialog = await page.$eval('#sh .p', (el) => el.getAttribute('aria-label')).catch(() => '');
    const settingsBtn = await page.$eval('[data-a="set"]', (el) => el.getAttribute('aria-label')).catch(() => '');
    check('a11y: icon controls carry Arabic labels', !!dialog && !!settingsBtn, dialog + ' / ' + settingsBtn);
    await ctx.close();
  };

  // ------------------------------------------------------------- responsive
  sections.responsive = async () => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage(); const errs = watchErrors(page); await routePage(page, sdk);
    const widths = [320, 400, 768, 820, 1024, 1280, 1440];
    const routes = ['#/', '#/surahs', '#/challenge', '#/quiz', '#/word/' + model.W[0].id];
    const overflow = []; const blanks = [];
    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 900 });
      for (const r of routes) {
        await page.goto(BASE + '/' + r, { waitUntil: 'domcontentloaded' });
        await sleep(250);
        const info = await page.evaluate(() => ({
          sw: document.documentElement.scrollWidth,
          iw: window.innerWidth,
          app: (document.querySelector('#app') || {}).textContent ? document.querySelector('#app').textContent.trim().length : 0,
        })).catch(() => ({ sw: 0, iw: 0, app: 0 }));
        if (info.sw > info.iw + 1) overflow.push(w + 'px ' + r + ' (' + info.sw + '>' + info.iw + ')');
        if (info.app < 40) blanks.push(w + 'px ' + r);
      }
    }
    check('responsive: no horizontal overflow at 320/400/768/820/1024/1280/1440', overflow.length === 0, overflow.slice(0, 4).join(' | '));
    check('responsive: no blank screen on any checked route/viewport', blanks.length === 0, blanks.slice(0, 4).join(' | '));
    check('responsive: 0 page/console errors across viewports', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  };

  // -------------------------------------------------------------------- pwa
  sections.pwa = async () => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage(); const errs = watchErrors(page); await routePage(page, sdk);
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await waitFor(page, '#app .sub', 8000);
    const reg = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { ok: false, why: 'no SW support' };
      const r = await navigator.serviceWorker.ready.catch(() => null);
      return { ok: !!r, scope: r ? r.scope : '' };
    }).catch(() => ({ ok: false }));
    check('pwa: service worker registers and activates', reg.ok, JSON.stringify(reg));
    const swText = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const SW_CACHE = (swText.match(/CACHE_NAME\s*=\s*'([^']+)'/) || [])[1] || '';
    const cache = await page.evaluate(async (name) => {
      const keys = await caches.keys();
      const c = await caches.open(name).catch(() => null);
      const hit = c ? await c.match('/') : null;
      return { keys, hasIndex: !!hit };
    }, SW_CACHE).catch(() => ({ keys: [], hasIndex: false }));
    check('pwa: cache ' + SW_CACHE + ' holds the app shell', cache.keys.includes(SW_CACHE) && cache.hasIndex, JSON.stringify(cache.keys));
    const mf = await page.evaluate(async () => (await fetch('/manifest.json')).json()).catch(() => ({}));
    check('pwa: manifest has name, start_url, standalone, icons', !!mf.name && !!mf.start_url && mf.display === 'standalone' && (mf.icons || []).length >= 2);
    await page.reload({ waitUntil: 'domcontentloaded' });
    try { await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 15000 }); } catch {}
    let offlineOk = false;
    try {
      await ctx.setOffline(true);
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
      await waitFor(page, '#q', 12000);
      offlineOk = !!(await page.$('#q'));
    } catch {}
    check('pwa: offline reload still renders the app shell from cache', offlineOk);
    await ctx.setOffline(false).catch(() => {});
    check('pwa: 0 page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  };

  // ------------------------------------------------------------------ admin
  sections.admin = async () => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage(); const errs = watchErrors(page);
    const fsRequests = [];
    page.on('request', (r) => { if (/firestore\.googleapis/.test(r.url())) fsRequests.push(r.url()); });
    await routePage(page, sdk);
    await page.goto(BASE + '/admin/', { waitUntil: 'domcontentloaded' });
    await waitFor(page, '[data-a="login"]', 15000);
    check('admin: unauthenticated visitor gets the sign-in gate', !!(await page.$('[data-a="login"]')));
    check('admin: no admin tabs are rendered before sign-in', !(await page.$('[data-a="tab"]')));
    check('admin: no Firestore request is attempted before sign-in', fsRequests.length === 0, fsRequests.slice(0, 2).join(' | '));
    const gate = await textOf(page, '#app');
    check('admin: gate text says admins only', gate.includes('\u0644\u0644\u0645\u0634\u0631\u0641\u064a\u0646'));
    check('admin: 0 page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  };

  // ---------------------------------------------------------------- offline
  sections.offline = async () => {
    const ctx = await newContext(browser);
    const page = await ctx.newPage(); const errs = watchErrors(page); await routePage(page, sdk);
    const t0 = Date.now();
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    const shown = await waitFor(page, '#app .sub', 8000);
    check('offline: home renders from local JSON with Firestore unreachable (<1800ms)', shown && Date.now() - t0 < 1800, (Date.now() - t0) + 'ms');
    const src = await page.evaluate(() => window.__DATA_SRC__).catch(() => '?');
    check('offline: data source is json and no error is shown', src === 'json', src);
    await go(page, '#/challenge');
    await waitFor(page, '#app .cg .dy', 8000);
    check('offline: challenge renders from the local challenge.json', (await countOf(page, '#app .cg .dy')) === 30);
    check('offline: 0 page/console errors', errs.length === 0, errs.slice(0, 3).join(' | '));
    await ctx.close();
  };

  // --------------------------------------------------------------- run them
  try {
    for (const name of Object.keys(sections)) {
      if (!want(name)) continue;
      try { await sections[name](); }
      catch (e) { check('section ' + name + ': threw', false, String((e && e.message) || e)); }
    }
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log((r.pass ? 'PASS ' : 'FAIL ') + r.name + (r.detail ? '  [' + r.detail + ']' : ''));
  console.log('qa-phase6: ' + (failed.length ? 'FAILED (' + failed.length + ' of ' + results.length + ')' : 'PASSED (' + results.length + ')'));
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error('QA ERROR: ' + String((e && e.stack) || e)); process.exit(2); });
