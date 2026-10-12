// Find the vertical (and horizontal) shift that best aligns an app screenshot with a
// baseline, and report the residual mismatch, to distinguish a real layout difference
// from a uniform offset. Usage: node shift.mjs report/<id>.app.png design/baseline/<id>.png [yMinCss]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const here = path.dirname(fileURLToPath(import.meta.url));
const A = PNG.sync.read(fs.readFileSync(path.resolve(here, process.argv[2])));
const R = PNG.sync.read(fs.readFileSync(path.resolve(here, process.argv[3])));
const yMin = process.argv[4] ? parseInt(process.argv[4], 10) * 2 : 0;
const w = Math.min(A.width, R.width);
const h = Math.min(A.height, R.height);

const region = (img, x0, y0, ww, hh) => {
  const o = new PNG({ width: ww, height: hh });
  for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) {
    const si = ((y0 + y) * img.width + (x0 + x)) * 4;
    const di = (y * ww + x) * 4;
    o.data[di] = img.data[si]; o.data[di + 1] = img.data[si + 1]; o.data[di + 2] = img.data[si + 2]; o.data[di + 3] = 255;
  }
  return o;
};

const test = (dy, dx) => {
  const y0 = Math.max(0, yMin + dy), y1 = Math.min(h, h - Math.abs(dy));
  const x0 = Math.max(0, dx), x1 = Math.min(w, w - Math.abs(dx));
  const rw = x1 - x0, rh = y1 - y0;
  if (rw <= 0 || rh <= 0) return 999;
  const a = region(A, x0, yMin + dy < 0 ? 0 : yMin + dy, rw, rh);
  const b = region(R, x0 + dx < 0 ? 0 : x0 + dx, yMin, rw, rh);
  const d = new PNG({ width: rw, height: rh });
  const bad = pixelmatch(a.data, b.data, d.data, rw, rh, { threshold: 0.12 });
  return (bad / (rw * rh)) * 100;
};

let best = { m: 1e9 };
for (let dy = -32; dy <= 32; dy++) {
  const m = test(dy, 0);
  if (m < best.m) best = { dy, dx: 0, m };
}
for (const dx of [-8, -4, 0, 4, 8]) {
  const m = test(best.dy, dx);
  if (m < best.m) best = { dy: best.dy, dx, m };
}
console.log('region y>=' + yMin / 2 + 'css  base(0,0) mismatch=' + test(0, 0).toFixed(2) + '%');
console.log('best shift dy=' + best.dy + 'px(dcss) dx=' + best.dx + 'px(dcss) -> ' + best.m.toFixed(2) + '%');
for (let dy = -8; dy <= 8; dy += 2) console.log('  dy ' + (dy / 2) + 'css: ' + test(dy, 0).toFixed(2) + '%');
