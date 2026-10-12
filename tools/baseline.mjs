// Renders every frame of design/design-spec.html to design/baseline/<data-id>.png (2x).
// Usage: node baseline.mjs [filter]   e.g. node baseline.mjs shade-lav-night
//
// Each frame is rendered at ITS OWN reference viewport (400 / 820 / 1440 wide) so that
// `vw`-based rules (clamp(26px,5vw,34px), etc.) resolve exactly as they do in the real
// site at that width. Rendering every frame in one fixed 1600px-wide page made every
// `vw` clamp max out, which produced baselines that did not match the intended design.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SPEC_FIX } from './spec-fix.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const spec = path.resolve(here, '../design/design-spec.html');
const out = path.resolve(here, '../design/baseline');
const filter = process.argv[2] || '';
fs.mkdirSync(out, { recursive: true });

const VW = { m: [400, 840], t: [820, 1180], d: [1440, 900] };

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 400, height: 840 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
const page = await context.newPage();
await page.goto('file://' + spec);
await page.addStyleTag({ content: SPEC_FIX });
await page.evaluate(() => document.fonts.ready);

const frames = await page.$$eval('.frame', (els) =>
  els.map((e) => {
    const id = e.getAttribute('data-id') || '';
    const parts = id.split('-');
    return { id, vp: parts[parts.length - 2] };
  })
);

let count = 0;
let failed = 0;
for (const f of frames) {
  if (filter && !f.id.includes(filter)) continue;
  try {
    const [w, h] = VW[f.vp] || [400, 840];
    await page.setViewportSize({ width: w, height: h });
    await page.evaluate((id) => {
      // Isolate the target frame: reveal its whole ancestor chain and hide every
      // sibling branch. The spec hides inactive theme/viewport sections with the
      // `hidden` attribute (section[hidden]{display:none}), which a plain
      // style.display='' cannot undo, so clear `hidden` as well. Hiding siblings
      // also removes the spec document's own fixed toolbar, which would otherwise
      // overlay the top of the frame in an element screenshot.
      const target = document.querySelector('.frame[data-id="' + id + '"]');
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
    }, f.id);
    await page.waitForTimeout(80);
    const el = await page.$('.frame[data-id="' + f.id + '"]');
    if (!el) {
      console.error('missing frame', f.id);
      failed++;
      continue;
    }
    const box = await el.boundingBox();
    if (!box || box.width < 1 || box.height < 1) {
      console.error('not visible', f.id, JSON.stringify(box));
      failed++;
      continue;
    }
    await el.screenshot({ path: path.join(out, f.id + '.png'), timeout: 20000 });
    count++;
  } catch (err) {
    failed++;
    console.error('FAILED', f.id, '-', err.message.split('\n')[0]);
  }
}
await browser.close();
console.log('baseline images written:', count, 'failed:', failed, '->', out);
