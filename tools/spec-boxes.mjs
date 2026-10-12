// Measure element boxes inside one design-spec frame (for parity triage).
// Usage: node spec-boxes.mjs <frameDataId> [selectors...]
//   e.g. node spec-boxes.mjs glass-def-night-m-sheet
// The frame is rendered at its own reference viewport (400/820/1440 wide) with
// animations frozen, and isolated the same way baseline.mjs does it, so the numbers
// are directly comparable to getBoundingClientRect() in the running app.
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';
import { SPEC_FIX } from './spec-fix.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const spec = path.resolve(here, '../design/design-spec.html');
const id = process.argv[2];
const extra = process.argv.slice(3);
if (!id) {
  console.error('usage: node spec-boxes.mjs <frameDataId> [selectors...]');
  process.exit(1);
}
const vp = id.split('-').slice(-2, -1)[0];
const VW = { m: [400, 840], t: [820, 1180], d: [1440, 900] };
const [vw, vh] = VW[vp] || [400, 840];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: vw, height: vh }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
const page = await context.newPage();
await page.goto('file://' + spec);
await page.addStyleTag({ content: SPEC_FIX });
await page.evaluate(() => document.fonts.ready);

const found = await page.evaluate((id) => {
  const target = document.querySelector('.frame[data-id="' + id + '"]');
  if (!target) return null;
  let node = target;
  while (node && node.parentElement) {
    node.hidden = false;
    node.removeAttribute && node.removeAttribute('hidden');
    node.style.display = '';
    const parent = node.parentElement;
    Array.prototype.forEach.call(parent.children, (c) => {
      if (c !== node) c.style.display = 'none';
    });
    node = parent;
  }
  return target.closest('section') ? target.closest('section').id : 'frame';
}, id);
if (!found) {
  console.error('frame not found:', id);
  process.exit(2);
}
await page.waitForTimeout(200);

const sels = extra.length
  ? extra
  : ['header', '.logo', '.sb', '.acts', '.strip', 'nav', '.ft', '.card', '.g', '.shx', '.shx .p', 'h1', '.cg', '.list', '.seg', '.sw', '.tg', '.day', '.wrap'];
const boxes = await page.evaluate(({ id, sels }) => {
  const frame = document.querySelector('.frame[data-id="' + id + '"]');
  const out = {};
  for (const s of sels) {
    const el = frame.querySelector(s);
    if (el) {
      const r = el.getBoundingClientRect();
      const fr = frame.getBoundingClientRect();
      out[s] = [Math.round(r.x - fr.x), Math.round(r.y - fr.y), Math.round(r.width), Math.round(r.height)];
    }
  }
  const fr = frame.getBoundingClientRect();
  out['__frame'] = [0, 0, Math.round(fr.width), Math.round(fr.height)];
  return out;
}, { id, sels });
console.log('spec frame', id, 'section', found);
for (const [k, v] of Object.entries(boxes)) console.log('  ', k, JSON.stringify(v));

await browser.close();
