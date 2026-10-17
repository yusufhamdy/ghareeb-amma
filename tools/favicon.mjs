/* Phase D6: favicon + icon generator.
 *
 * Produces a rounded-square tile in the default palette accent colour carrying
 * the letter Ghayn (U+063A) in the button-foreground colour. The glyph outline
 * is derived from the project's own Amiri Quran font: the .woff2 shipped in
 * public/fonts is rasterised through the browser at high resolution and then
 * vectorised (crack-following + Douglas-Peucker) into an SVG path.
 *
 * Outputs (all committed under public/):
 *   favicon.svg, favicon-32.png, apple-touch-icon.png,
 *   icon-192.png, icon-512.png
 *
 * Run: node tools/favicon.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FONT = path.join(ROOT, 'public/fonts/amiri-quran-arabic-400-normal.woff2');
const OUT = path.join(ROOT, 'public');

// Default palette (PAL.def) accent + button foreground (light default).
const ACCENT = '#1E6B50';
const FG = '#FFFFFF';
const BOX = 1024;          // SVG viewBox
const RADIUS = Math.round(BOX * 0.22);

const CONTENT = 0.62;      // glyph height as a fraction of the tile
const STROKE = 40;         // small fattening stroke (1024 units) for 16px legibility
const ALPHA = 128;         // raster threshold
const EPS = 0.9;           // Douglas-Peucker epsilon, in source pixels
const SIZE = 900;          // raster canvas edge

// ---------------------------------------------------------------- rasterise
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } });
const fontB64 = fs.readFileSync(FONT).toString('base64');
await page.setContent(`<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:'AmiriQ';src:url(data:font/woff2;base64,${fontB64}) format('woff2');font-weight:400;font-style:normal}
html,body{margin:0;background:#fff}
</style><canvas id="c" width="${SIZE}" height="${SIZE}"></canvas>`);
await page.evaluate(async (sz) => {
  await document.fonts.load(`${Math.round(sz * 0.78)}px AmiriQ`, '\u063A');
  await document.fonts.ready;
}, SIZE);
const mask = await page.evaluate(({ sz, alpha }) => {
  const c = document.getElementById('c');
  const x = c.getContext('2d');
  x.clearRect(0, 0, sz, sz);
  x.fillStyle = '#000';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = `${Math.round(sz * 0.78)}px AmiriQ`;
  x.fillText('\u063A', sz / 2, sz / 2);
  const d = x.getImageData(0, 0, sz, sz).data;
  let minx = sz, miny = sz, maxx = -1, maxy = -1;
  const g = new Uint8Array(sz * sz);
  for (let i = 0; i < sz * sz; i++) {
    if (d[i * 4 + 3] > alpha) {
      g[i] = 1;
      const px = i % sz, py = (i / sz) | 0;
      if (px < minx) minx = px;
      if (px > maxx) maxx = px;
      if (py < miny) miny = py;
      if (py > maxy) maxy = py;
    }
  }
  if (maxx < 0) throw new Error('glyph rasterised empty');
  const w = maxx - minx + 1, h = maxy - miny + 1;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) out[y * w + x] = g[(y + miny) * sz + (x + minx)];
  return { w, h, data: Array.from(out) };
}, { sz: SIZE, alpha: ALPHA });
await page.close();

const { w, h, data } = mask;
const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : data[y * w + x]);

// ------------------------------------------------------ crack-follow contours
// Directed unit cracks between filled/empty pixels, filled region on the left.
const adj = new Map();
const push = (ax, ay, bx, by) => {
  const k = ay * (w + 1) + ax;
  if (!adj.has(k)) adj.set(k, []);
  adj.get(k).push({ to: [bx, by], used: false });
};
for (let y = 0; y < h; y++)
  for (let x = 0; x < w; x++) {
    if (!at(x, y)) continue;
    if (!at(x, y - 1)) push(x + 1, y, x, y);
    if (!at(x + 1, y)) push(x + 1, y + 1, x + 1, y);
    if (!at(x, y + 1)) push(x, y + 1, x + 1, y + 1);
    if (!at(x - 1, y)) push(x, y, x, y + 1);
  }

const angle = (dx, dy) => Math.atan2(dy, dx);
const turn = (ix, iy, ox, oy) => {
  let d = angle(ox, oy) - angle(ix, iy);
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  return d; // positive = left / counter-clockwise (keeps the region on the left)
};

const loops = [];
for (const key of adj.keys()) {
  for (const first of adj.get(key)) {
    if (first.used) continue;
    const loop = [];
    let cx = key % (w + 1), cy = (key / (w + 1)) | 0;
    let cur = first;
    while (true) {
      cur.used = true;
      loop.push([cx, cy]);
      const [nx, ny] = cur.to;
      const inD = [nx - cx, ny - cy];
      cx = nx; cy = ny;
      const outs = (adj.get(cy * (w + 1) + cx) || []).filter((o) => !o.used);
      if (!outs.length) break;
      let next = outs[0];
      if (outs.length > 1) {
        let best = -Infinity;
        for (const o of outs) {
          const s = turn(inD[0], inD[1], o.to[0] - cx, o.to[1] - cy);
          if (s > best) { best = s; next = o; }
        }
      }
      cur = next;
    }
    if (loop.length > 2) loops.push(loop);
  }
}

// --------------------------------------------------------- simplify polygons
const rdp = (pts, eps) => {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    if (b - a < 2) continue;
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let best = -1, bestD = eps;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = pts[i];
      const dist = Math.abs((px - ax) * dy - (py - ay) * dx) / len;
      if (dist > bestD) { bestD = dist; best = i; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
};

const simplified = loops.map((l) => rdp(l, EPS));
const signedArea = simplified.reduce((sum, l) => {
  let a = 0;
  for (let i = 0; i < l.length; i++) {
    const [x1, y1] = l[i], [x2, y2] = l[(i + 1) % l.length];
    a += x1 * y2 - x2 * y1;
  }
  return sum + a / 2;
}, 0);
const filled = data.reduce((n, v) => n + v, 0);
const err = Math.abs(Math.abs(signedArea) - filled) / filled;
if (err > 0.03) throw new Error(`trace area mismatch: area=${Math.abs(signedArea).toFixed(0)} filled=${filled} (${(err * 100).toFixed(2)}%)`);

// ------------------------------------------------------------------- compose
const scale = (BOX * CONTENT) / h;
const gw = w * scale, gh = h * scale;
const ox = (BOX - gw) / 2, oy = (BOX - gh) / 2;
const d = simplified
  .map((l) => 'M' + l.map(([x, y]) => `${(x * scale + ox).toFixed(1)},${(y * scale + oy).toFixed(1)}`).join('L') + 'Z')
  .join('');
const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${BOX}" height="${BOX}" viewBox="0 0 ${BOX} ${BOX}">` +
  `<rect width="${BOX}" height="${BOX}" rx="${RADIUS}" fill="${ACCENT}"/>` +
  `<path d="${d}" fill="${FG}" fill-rule="evenodd" stroke="${FG}" stroke-width="${STROKE}" stroke-linejoin="round" stroke-linecap="round"/></svg>\n`;
fs.writeFileSync(path.join(OUT, 'favicon.svg'), svg);

// Rasterise the vector at each target size so the PNGs match the SVG exactly.
for (const [name, size] of [['favicon-32.png', 32], ['apple-touch-icon.png', 180], ['icon-192.png', 192], ['icon-512.png', 512]]) {
  const p = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await p.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style>${svg.replace(`width="${BOX}" height="${BOX}"`, `width="${size}" height="${size}"`)}`);
  await p.screenshot({ path: path.join(OUT, name), clip: { x: 0, y: 0, width: size, height: size }, omitBackground: true });
  await p.close();
}
await browser.close();
console.log(`favicon: glyph ${w}x${h}, ${simplified.length} contours, trace error ${(err * 100).toFixed(2)}%`);
console.log('wrote favicon.svg, favicon-32.png, apple-touch-icon.png, icon-192.png, icon-512.png');
