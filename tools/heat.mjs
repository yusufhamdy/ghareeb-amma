// Locate where a screen differs from its design baseline, as an ASCII heatmap.
// Usage: BASE_URL=http://localhost:5173 node heat.mjs <screenId> [cols] [rows]
//   e.g. node heat.mjs glass-def-night-m-sheet
// Prints mismatch density per cell plus bounding boxes of key elements, so the
// difference can be triaged without viewing images.
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import { APP_FRAME_MODE } from './app-frame-mode.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(here, 'screens.json'), 'utf8'));
const baseDir = path.resolve(here, '../design/baseline');
const base = process.env.BASE_URL || cfg.baseUrl;

const id = process.argv[2];
const COLS = Number(process.argv[3] || 14);
const ROWS = Number(process.argv[4] || 24);
if (!id) {
  console.error('usage: node heat.mjs <screenId> [cols] [rows]');
  process.exit(1);
}
const parts = id.split('-');
const vp = cfg.looks && cfg.viewports.find((v) => v.id === parts[parts.length - 2]);
const sc = cfg.screens.find((s) => id.endsWith('-' + s.id));
const look = cfg.looks.find((l) => id.startsWith(l.id + '-'));
if (!vp || !sc || !look) {
  console.error('could not parse id', { vp, sc, look });
  process.exit(2);
}
const basePng = path.join(baseDir, id + '.png');
if (!fs.existsSync(basePng)) {
  console.error('no baseline for', id);
  process.exit(3);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 2, locale: 'ar-EG', timezoneId: 'Africa/Cairo', reducedMotion: 'reduce', colorScheme: look.mode === 'night' ? 'dark' : 'light' });
await ctx.clock.setFixedTime(new Date(cfg.fixtureNow));
const page = await ctx.newPage();
await page.addInitScript(({ look, clear, prog }) => {
  // No service worker in parity runs (see compare.mjs).
  try { navigator.serviceWorker.register = () => Promise.resolve({ scope: '' }); } catch (e) {}
  localStorage.setItem('gq-set', JSON.stringify({ mode: 'auto', pal: look.pal, style: look.style, gl: 1, cm: false, snd: true }));
  localStorage.setItem('gq-prog', JSON.stringify({ done: prog }));
  localStorage.setItem('gq-seen', '99');
  if (clear) localStorage.removeItem('gq-ld'); else localStorage.setItem('gq-ld', '1');
}, { look, clear: !!sc.clearLoaderFlag, prog: sc.prog || [1, 2, 3, 4] });
if (sc.screenshotImmediately) {
  await page.route('**/words.json', (r) => r.abort());
  await page.route('**/challenge.json', (r) => r.abort());
}
await page.goto(base + '/' + sc.route);
if (sc.screenshotImmediately) {
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

// Tablet/desktop frames are full pages with fixed elements anchored to the frame;
// mirror that so the nav and background blobs are compared in the depicted position.
if (vp.id !== 'm') await page.addStyleTag({ content: APP_FRAME_MODE });

const sels = ['header', '.logo', '.sb', '.acts', '.strip', 'nav', '#nv', '.ft', '.card', '.g', '#bg', '#sh', '#sh .p', 'h1', '.day', '.cg', '.list', '#res', '.rs', '.row', '.seg', '.sw', '.tg', '.lg'];
const boxes = await page.evaluate((sels) => {
  const out = {};
  for (const s of sels) {
    const el = document.querySelector(s);
    if (el) {
      const r = el.getBoundingClientRect();
      out[s] = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
    }
  }
  return out;
}, sels);

const shot = PNG.sync.read(await page.screenshot({ fullPage: vp.id !== 'm' }));
const ref = PNG.sync.read(fs.readFileSync(basePng));
const saveDir = path.join(here, 'report');
fs.mkdirSync(saveDir, { recursive: true });
if (process.env.SAVE) fs.writeFileSync(path.join(saveDir, id + '.app.png'), PNG.sync.write(shot));
const w = Math.min(shot.width, ref.width), h = Math.min(shot.height, ref.height);
const cell = (x) => {
  const a = shot.data, b = ref.data, i = (y * w + x) * 4;
  return Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
};
const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
const rowBad = new Array(h).fill(0);
const colBad = new Array(w).fill(0);
let total = 0;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const d = Math.max(Math.abs(shot.data[i] - ref.data[i]), Math.abs(shot.data[i + 1] - ref.data[i + 1]), Math.abs(shot.data[i + 2] - ref.data[i + 2]));
    if (d > 30) {
      const gy = Math.min(ROWS - 1, Math.floor((y / h) * ROWS));
      const gx = Math.min(COLS - 1, Math.floor((x / w) * COLS));
      grid[gy][gx]++;
      rowBad[y]++;
      colBad[x]++;
      total++;
    }
  }
}

console.log('screen', id, 'size', shot.width + 'x' + shot.height, 'ref', ref.width + 'x' + ref.height, 'mismatch', ((total / (w * h)) * 100).toFixed(2) + '%');
console.log('image scale: 2x; cell =', Math.round(w / COLS), 'x', Math.round(h / ROWS), 'px (image), RTL so col0 is rightmost');
const chars = ' .:-=+*#%@';
console.log('   ' + Array.from({ length: COLS }, (_, i) => String((i + 1) % 10)).join(' '));
for (let r = 0; r < ROWS; r++) {
  const cells = grid[r].map((c) => {
    const pct = c / ((w / COLS) * (h / ROWS));
    return chars[Math.min(9, Math.round(pct * 12))];
  });
  console.log(String(r + 1).padStart(2, ' ') + ' ' + cells.join(' '));
}
// band profile: rows with the most mismatches (coarse)
const bands = [];
const BAND = Math.round(h / 20) || 1;
for (let y = 0; y < h; y += BAND) {
  let s = 0;
  for (let k = y; k < Math.min(h, y + BAND); k++) s += rowBad[k];
  bands.push({ y, pct: +((s / (BAND * w)) * 100).toFixed(1) });
}
bands.sort((a, b) => b.pct - a.pct);
console.log('worst row bands (image y, mismatch%):', bands.slice(0, 8).map((b) => `${b.y}:${b.pct}`).join(' '));
console.log('element boxes (viewport px, [x,y,w,h]):');
for (const [k, v] of Object.entries(boxes)) console.log('  ', k, JSON.stringify(v));

await browser.close();
