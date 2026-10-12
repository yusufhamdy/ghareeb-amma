// Print rect + computed style of a selector inside one spec frame.
// Usage: node probe-el.mjs <frameDataId> <selector>
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { SPEC_FIX } from './spec-fix.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const spec = path.resolve(here, '../design/design-spec.html');
const id = process.argv[2];
const sel = process.argv[3];
const vp = id.split('-').slice(-2, -1)[0];
const VW = { m: [400, 840], t: [820, 1180], d: [1440, 900] };
const [vw, vh] = VW[vp] || [400, 840];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
const page = await context.newPage();
await page.goto('file://' + spec);
await page.addStyleTag({ content: SPEC_FIX });
await page.evaluate(() => document.fonts.ready);
await page.evaluate((id) => {
  const target = document.querySelector('.frame[data-id="' + id + '"]');
  let node = target;
  while (node && node.parentElement) {
    node.hidden = false;
    node.removeAttribute && node.removeAttribute('hidden');
    node.style.display = '';
    const parent = node.parentElement;
    Array.prototype.forEach.call(parent.children, (c) => { if (c !== node) c.style.display = 'none'; });
    node = parent;
  }
}, id);
await page.waitForTimeout(200);
const out = await page.evaluate(({ id, sel }) => {
  const frame = document.querySelector('.frame[data-id="' + id + '"]');
  const el = frame.querySelector(sel);
  if (!el) return { error: 'not found' };
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const props = ['display', 'height', 'minHeight', 'padding', 'margin', 'gap', 'fontSize', 'lineHeight', 'flexDirection', 'alignItems', 'boxSizing'];
  const style = {};
  for (const p of props) style[p] = cs[p];
  const ancestors = [];
  let cur = el;
  while (cur && cur !== document.body) {
    ancestors.push(cur.tagName.toLowerCase() + (cur.className ? '.' + String(cur.className).trim().replace(/\s+/g, '.') : ''));
    cur = cur.parentElement;
  }
  const sec = frame.closest('section');
  const styles = sec ? Array.from(sec.querySelectorAll('style')).map((s) => s.textContent.slice(0, 400)) : [];
  return { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], text: (el.textContent || '').trim().slice(0, 24), style, ancestors, styles, outer: el.outerHTML.slice(0, 200) };
}, { id, sel });
console.log(id, sel, JSON.stringify(out, null, 1));
await browser.close();
