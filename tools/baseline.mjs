// Renders every frame of design/design-spec.html to design/baseline/<data-id>.png (2x).
// Usage: node baseline.mjs [filter]   e.g. node baseline.mjs shade-lav-night
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const spec = path.resolve(here, '../design/design-spec.html');
const out = path.resolve(here, '../design/baseline');
const filter = process.argv[2] || '';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 2 });
await page.goto('file://' + spec);
await page.evaluate(() => document.fonts.ready);
const ids = await page.$$eval('section', (s) => s.map((x) => x.id));
let count = 0;
for (const id of ids) {
  if (filter && !id.includes(filter)) continue;
  await page.evaluate((i) => document.querySelectorAll('section').forEach((s) => (s.hidden = s.id !== i)), id);
  await page.waitForTimeout(150);
  for (const frame of await page.$$('section:not([hidden]) .frame')) {
    const fid = await frame.getAttribute('data-id');
    await frame.screenshot({ path: path.join(out, fid + '.png') });
    count++;
  }
}
await browser.close();
console.log('baseline images written:', count, '->', out);
