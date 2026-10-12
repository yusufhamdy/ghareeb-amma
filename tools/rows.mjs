// Row-by-row structural comparison of the app vs the spec frame for a screen.
// Usage: BASE_URL=http://localhost:5173 node rows.mjs <screen> <selector> [look]
// Example: node rows.mjs surahs ".row" glass-def-night
//
// Prints, per index, the normalized text and the box (viewport px) from the spec
// frame and from the app, so text/content or position drift is obvious without
// viewing images.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SPEC_FIX } from './spec-fix.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'screens.json'), 'utf8'));
const spec = path.resolve(here, '../design/design-spec.html');
const base = process.env.BASE_URL || cfg.baseUrl;
const screenId = process.argv[2] || 'surahs';
const selector = process.argv[3] || '.row';
const lookId = process.argv[4] || 'glass-def-night';

const look = cfg.looks.find((l) => l.id === lookId) || cfg.looks[0];
const sc = cfg.screens.find((s) => s.id === screenId);
const vp = cfg.viewports.find((v) => v.id === 't');

const norm = (s) => (s || '').replace(/\s+/g, '').trim();
const box = (r) => [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, reducedMotion: 'reduce', colorScheme: look.mode === 'night' ? 'dark' : 'light' });
const page = await ctx.newPage();

// ----- app -----
await page.addInitScript((s) => {
  localStorage.setItem('gq-set', JSON.stringify(s.set));
  localStorage.setItem('gq-ld', '1');
  if (s.prog) localStorage.setItem('gq-prog', JSON.stringify({ done: s.prog }));
}, { set: { mode: 'auto', pal: look.pal, gl: 1, cm: false, snd: true, style: look.style }, prog: sc.prog || [1, 2, 3, 4] });
await page.goto(base + '/' + sc.route);
if (sc.steps) for (const st of sc.steps) { if (st.click) await page.click(st.click); }
await page.waitForTimeout(900);
const appRows = await page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).map((e) => ({ t: e.innerText, r: e.getBoundingClientRect().toJSON() })), selector);

// ----- spec -----
const sp = await ctx.newPage();
await sp.goto('file://' + spec);
await sp.addStyleTag({ content: SPEC_FIX });
await sp.evaluate(() => document.fonts.ready);
const frameId = `${look.style}-${look.pal}-${look.mode}-${vp.id}-${screenId}`;
await sp.evaluate((id) => {
  const target = document.querySelector('.frame[data-id="' + id + '"]');
  let node = target;
  while (node && node.parentElement) {
    node.hidden = false;
    if (node.removeAttribute) node.removeAttribute('hidden');
    node.style.display = '';
    const parent = node.parentElement;
    Array.prototype.forEach.call(parent.children, (c) => { if (c !== node) c.style.display = 'none'; });
    node = parent;
  }
}, frameId);
await sp.waitForTimeout(120);
const specFrame = await sp.$('.frame[data-id="' + frameId + '"]');
const frameBox = await specFrame.boundingBox();
console.log('spec frame box:', frameBox && box(frameBox));
const specRows = await specFrame.evaluate((el, sel) => Array.from(el.querySelectorAll(sel)).map((e) => ({ t: e.innerText, r: e.getBoundingClientRect().toJSON() })), selector);
await browser.close();

console.log('app rows:', appRows.length, ' spec rows:', specRows.length);
const n = Math.max(appRows.length, specRows.length);
let textDiff = 0;
let boxDiff = 0;
for (let i = 0; i < n; i++) {
  const a = appRows[i];
  const s = specRows[i];
  const at = a ? norm(a.t) : '<none>';
  const st = s ? norm(s.t) : '<none>';
  const ab = a ? box(a.r) : null;
  const sb = s ? box(s.r) : null;
  const same = at === st;
  const sameBox = ab && sb && ab.join(',') === sb.join(',');
  if (!same) textDiff++;
  if (!sameBox) boxDiff++;
  if (!same || !sameBox) {
    console.log(String(i).padStart(2), same ? '   ' : 'TXT', sameBox ? '      ' : 'BOX', 'app', ab ? ab.join(',') : '-', '| spec', sb ? sb.join(',') : '-');
    if (!same) { console.log('      app  :', at.slice(0, 90)); console.log('      spec :', st.slice(0, 90)); }
  }
}
console.log('text diffs:', textDiff, ' box diffs:', boxDiff);
