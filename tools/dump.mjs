// Dump normalized DOM for structural diffing between the spec frames and the app.
// Usage:
//   node dump.mjs spec <frameDataId>              e.g. node dump.mjs spec glass-def-night-m-sheet
//   node dump.mjs app  <hashRoute> [look] [stepsJson]
//        e.g. node dump.mjs app '#/search' glass-def-night '[{"fill":["#q","خناس"]}]'
// Writes tools/report/<name>.html and prints a short summary.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SPEC_FIX } from './spec-fix.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, 'report');
fs.mkdirSync(outDir, { recursive: true });
const mode = process.argv[2];

const norm = (s) => s.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();

const browser = await chromium.launch();

if (mode === 'spec') {
  const frameId = process.argv[3];
  const vpId = frameId.split('-').slice(-2, -1)[0];
  const VW = { m: [400, 840], t: [820, 1180], d: [1440, 900] };
  const [vw, vh] = VW[vpId] || [400, 840];
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.goto('file://' + path.resolve(here, '../design/design-spec.html'));
  await page.addStyleTag({ content: SPEC_FIX });
  await page.evaluate(() => document.fonts.ready);
  const html = await page.$$eval('.frame', (els, fid) => {
    const el = els.find((e) => e.getAttribute('data-id') === fid);
    return el ? el.outerHTML : '';
  }, frameId);
  fs.writeFileSync(path.join(outDir, frameId + '.spec.html'), norm(html));
  console.log('spec frame', frameId, 'len', html.length);
} else {
  const cfg = JSON.parse((await import('fs')).readFileSync(path.join(here, 'screens.json'), 'utf8'));
  const route = process.argv[3];
  const look = process.argv[4] || 'glass-def-night';
  const sc = (cfg.screens || []).find((s) => s.route === route) || {};
  const steps = (cfg.screens || []).filter((s) => s.route === route && s.steps).flatMap((s) => s.steps);
  const [style, pal, mode2] = look.split('-');
  const ctx = await browser.newContext({ viewport: { width: 400, height: 840 }, deviceScaleFactor: 2, locale: 'ar-EG', timezoneId: 'Africa/Cairo', reducedMotion: 'reduce', colorScheme: mode2 === 'night' ? 'dark' : 'light' });
  await ctx.clock.setFixedTime(new Date('2026-10-10T11:00:00Z'));
  const page = await ctx.newPage();
    await page.addInitScript(
    ({ style, pal, prog }) => {
      localStorage.setItem('gq-set', JSON.stringify({ mode: 'auto', pal, style, gl: 1, cm: false, snd: true }));
      localStorage.setItem('gq-prog', JSON.stringify({ done: prog }));
      localStorage.setItem('gq-seen', '99');
      localStorage.setItem('gq-ld', '1');
    },
    { style, pal, prog: sc.prog || [1, 2, 3, 4] }
  );
  await page.goto('http://localhost:5173/' + route);
  await page.waitForTimeout(900);
  for (const st of steps) {
    if (st.click) await page.click(st.click);
    if (st.fill) await page.fill(st.fill[0], st.fill[1]);
    await page.waitForTimeout(300);
  }
  const html = await page.evaluate(() => (document.querySelector('#app') ? document.querySelector('#app').outerHTML : document.body.innerHTML));
  fs.writeFileSync(path.join(outDir, 'app' + route.replace(/[#/]+/g, '_') + '.html'), norm(html));
  console.log('app', route, 'look', look, 'len', html.length);
}

await browser.close();
