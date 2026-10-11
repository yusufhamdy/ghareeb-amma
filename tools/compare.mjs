// Compares the running site against design/baseline images.
// Usage: BASE_URL=http://localhost:5000 node compare.mjs [filter]   e.g. node compare.mjs glass-def-day-m
// Output: tools/report/report.json plus diff PNGs. Review diffs by eye; Quranic glyph shapes differ by font on purpose.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'screens.json'), 'utf8'));
const baseDir = path.resolve(here, '../design/baseline');
const outDir = path.join(here, 'report');
const base = process.env.BASE_URL || cfg.baseUrl;
const filter = process.argv[2] || '';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const report = [];
for (const look of cfg.looks) {
  for (const vp of cfg.viewports) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, locale: 'ar-EG', timezoneId: 'Africa/Cairo' });
    await ctx.clock.setFixedTime(new Date(cfg.fixtureNow));
    for (const sc of cfg.screens) {
      const id = `${look.id}-${vp.id}-${sc.id}`;
      if (filter && !id.includes(filter)) continue;
      const basePng = path.join(baseDir, id + '.png');
      if (!fs.existsSync(basePng)) continue;
      const page = await ctx.newPage();
      await page.addInitScript(({ look, clear }) => {
        localStorage.setItem('gq-set', JSON.stringify({ mode: look.mode === 'night' ? 'dark' : 'light', pal: look.pal, style: look.style, gl: 1, cm: true, snd: false }));
        localStorage.setItem('gq-prog', JSON.stringify({ done: [1, 2, 3, 4] }));
        localStorage.setItem('gq-seen', '99');
        if (clear) localStorage.removeItem('gq-ld'); else localStorage.setItem('gq-ld', '1');
      }, { look, clear: !!sc.clearLoaderFlag });
      await page.goto(base + '/' + sc.route);
      if (!sc.screenshotImmediately) await page.waitForTimeout(900);
      for (const st of sc.steps || []) {
        if (st.click) await page.click(st.click);
        if (st.fill) await page.fill(st.fill[0], st.fill[1]);
        await page.waitForTimeout(300);
      }
      const shot = PNG.sync.read(await page.screenshot({ fullPage: vp.id !== 'm' }));
      const ref = PNG.sync.read(fs.readFileSync(basePng));
      const w = Math.min(shot.width, ref.width), h = Math.min(shot.height, ref.height);
      const crop = (img) => { const o = new PNG({ width: w, height: h }); PNG.bitblt(img, o, 0, 0, w, h, 0, 0); return o; };
      const a = crop(shot), b = crop(ref), diff = new PNG({ width: w, height: h });
      const bad = pixelmatch(a.data, b.data, diff.data, w, h, { threshold: 0.12 });
      fs.writeFileSync(path.join(outDir, id + '.diff.png'), PNG.sync.write(diff));
      report.push({ id, mismatchPercent: +((bad / (w * h)) * 100).toFixed(2), compared: `${w}x${h}`, sizeDelta: { w: shot.width - ref.width, h: shot.height - ref.height } });
      await page.close();
    }
    await ctx.close();
  }
}
await browser.close();
report.sort((x, y) => y.mismatchPercent - x.mismatchPercent);
fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 1));
console.log('compared:', report.length, 'worst 10:\n', report.slice(0, 10).map((r) => `${r.mismatchPercent}%  ${r.id}`).join('\n'));
