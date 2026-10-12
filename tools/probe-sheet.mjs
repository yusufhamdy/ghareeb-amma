// Compare the settings-sheet panel structure between spec and app.
// Usage: node probe-sheet.mjs app
//        node probe-sheet.mjs spec glass-def-night-m-sheet
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { SPEC_FIX } from './spec-fix.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const spec = path.resolve(here, '../design/design-spec.html');
const VW = { m: [400, 840], t: [820, 1180], d: [1440, 900] };

const dumpTree = (root) => {
  const desc = (el) => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).trim().replace(/\s+/g, '.') : '');
  const out = [];
  const walk = (el, depth) => {
    const r = el.getBoundingClientRect();
    out.push({ d: depth, el: desc(el), y: Math.round(r.y), h: Math.round(r.height), text: (el.textContent || '').trim().slice(0, 16) });
    if (depth < 1) Array.prototype.forEach.call(el.children, (c) => walk(c, depth + 1));
  };
  Array.prototype.forEach.call(root.children, (c) => walk(c, 0));
  return out;
};

const browser = await chromium.launch();
const mode = process.argv[2];
if (mode === 'app') {
  const page = await browser.newPage({ viewport: { width: 400, height: 840 }, deviceScaleFactor: 2, locale: 'ar-EG' });
  await page.addInitScript(() => {
    localStorage.setItem('gq-set', JSON.stringify({ mode: 'dark', pal: 'def', style: 'glass', gl: 1, cm: true, snd: false }));
    localStorage.setItem('gq-ld', '1');
  });
  await page.goto('http://localhost:5173/#/');
  await page.waitForTimeout(700);
  await page.click('[data-a="set"]');
  await page.waitForTimeout(400);
  const box = await (await page.$('#sh .p')).boundingBox();
  const rows = await page.evaluate(dumpTree, await page.$('#sh .p'));
  console.log('APP #sh .p box', JSON.stringify(box));
  for (const r of rows) console.log('  '.repeat(r.d + 1) + r.el + ' y=' + r.y + ' h=' + r.h + ' | ' + r.text);
} else {
  const id = process.argv[3];
  const vp = id.split('-').slice(-2, -2 + 1)[0];
  const [vw, vh] = VW[vp] || [400, 840];
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2 });
  await page.goto('file://' + spec);
  await page.addStyleTag({ content: SPEC_FIX });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate((id) => {
    const target = document.querySelector('.frame[data-id="' + id + '"]');
    let node = target;
    while (node && node.parentElement) {
      node.style.display = '';
      const parent = node.parentElement;
      Array.prototype.forEach.call(parent.children, (c) => { if (c !== node) c.style.display = 'none'; });
      node = parent;
    }
  }, id);
  await page.waitForTimeout(150);
  const root = await page.$('.frame[data-id="' + id + '"] .shx .p');
  const box = await root.boundingBox();
  const frameBox = await (await page.$('.frame[data-id="' + id + '"]')).boundingBox();
  const rows = await page.evaluate(dumpTree, root);
  console.log('SPEC .shx .p box', JSON.stringify(box), 'frame', JSON.stringify(frameBox));
  for (const r of rows) console.log('  '.repeat(r.d + 1) + r.el + ' y=' + r.y + ' h=' + r.h + ' | ' + r.text);
}
await browser.close();
