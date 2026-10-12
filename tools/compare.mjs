// Compares the running site against design/baseline images.
// Usage: BASE_URL=http://localhost:5000 node compare.mjs [filter]   e.g. node compare.mjs glass-def-day-m
// Output: tools/report/report.json plus diff PNGs. Review diffs by eye; Quranic glyph shapes differ by font on purpose.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { APP_FRAME_MODE } from './app-frame-mode.mjs';

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
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, locale: 'ar-EG', timezoneId: 'Africa/Cairo', reducedMotion: 'reduce', colorScheme: look.mode === 'night' ? 'dark' : 'light' });
    await ctx.clock.setFixedTime(new Date(cfg.fixtureNow));
    for (const sc of cfg.screens) {
      const id = `${look.id}-${vp.id}-${sc.id}`;
      if (filter && !id.includes(filter)) continue;
      const basePng = path.join(baseDir, id + '.png');
      if (!fs.existsSync(basePng)) continue;
      const page = await ctx.newPage();
      await page.addInitScript(
        ({ look, clear, prog }) => {
          // No service worker in parity runs: the app's network-first SW would serve
          // words.json from its cache when a route is aborted, defeating the loader
          // fixture and other deterministic data states.
          try { navigator.serviceWorker.register = () => Promise.resolve({ scope: '' }); } catch (e) {}
          localStorage.setItem('gq-set', JSON.stringify({ mode: 'auto', pal: look.pal, style: look.style, gl: 1, cm: false, snd: true }));
          localStorage.setItem('gq-prog', JSON.stringify({ done: prog }));
          localStorage.setItem('gq-seen', '99');
          if (clear) localStorage.removeItem('gq-ld'); else localStorage.setItem('gq-ld', '1');
        },
        { look, clear: !!sc.clearLoaderFlag, prog: sc.prog || [1, 2, 3, 4] }
      );
      if (sc.screenshotImmediately) {
        // Loader screen: hold the loading state by preventing the data fetch from
        // resolving (the app removes #ld ~450ms after data loads, so an immediate
        // screenshot would otherwise race and capture the page instead).
        await page.route('**/words.json', (r) => r.abort());
        await page.route('**/challenge.json', (r) => r.abort());
      }
      await page.goto(base + '/' + sc.route);
      if (sc.screenshotImmediately) {
        // Loader screen: it stays because the data fetch is aborted, but give the
        // browser a moment to paint `#ld` before shooting (accept rare missing it).
        await page.waitForSelector('#ld', { state: 'visible', timeout: 4000 }).catch(() => {});
        await page.waitForTimeout(150);
      } else {
        await page.waitForTimeout(900);
      }
      for (const st of sc.steps || []) {
        if (st.click) await page.click(st.click);
        if (st.fill) await page.fill(st.fill[0], st.fill[1]);
        await page.waitForTimeout(300);
      }
      // Tablets/desktop frames are full pages with the nav and background blobs anchored
      // to the frame; mirror that so fixed elements do not land at the wrong vertical
      // position in the full-page shot (see app-frame-mode.mjs).
      if (vp.id !== 'm') await page.addStyleTag({ content: APP_FRAME_MODE });
      const shot = PNG.sync.read(await page.screenshot({ fullPage: vp.id !== 'm' }));
      const ref = PNG.sync.read(fs.readFileSync(basePng));
      const w = Math.min(shot.width, ref.width), h = Math.min(shot.height, ref.height);
      const crop = (img) => { const o = new PNG({ width: w, height: h }); PNG.bitblt(img, o, 0, 0, w, h, 0, 0); return o; };
      const a = crop(shot), b = crop(ref), diff = new PNG({ width: w, height: h });
      const bad = pixelmatch(a.data, b.data, diff.data, w, h, { threshold: 0.12 });
      fs.writeFileSync(path.join(outDir, id + '.diff.png'), PNG.sync.write(diff));
      if (process.env.SAVE) fs.writeFileSync(path.join(outDir, id + '.app.png'), PNG.sync.write(shot));
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
