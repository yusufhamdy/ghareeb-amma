// Analyze the difference between a baseline and an app screenshot: bounding box of
// mismatched pixels plus coarse row/column density profiles. Use when you cannot view
// the images. Usage: node diffbbox.mjs report/<id>.app.png design/baseline/<id>.png
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const here = path.dirname(fileURLToPath(import.meta.url));
const appPath = process.argv[2];
const refPath = process.argv[3];
const A = PNG.sync.read(fs.readFileSync(path.resolve(here, appPath)));
const R = PNG.sync.read(fs.readFileSync(path.resolve(here, refPath)));
const w = Math.min(A.width, R.width);
const h = Math.min(A.height, R.height);
const crop = (img) => { const o = new PNG({ width: w, height: h }); PNG.bitblt(img, o, 0, 0, w, h, 0, 0); return o; };
const a = crop(A), b = crop(R);
const diff = new PNG({ width: w, height: h });
pixelmatch(a.data, b.data, diff.data, w, h, { threshold: 0.12 });
let minX = w, minY = h, maxX = -1, maxY = -1, count = 0;
const bands = 20;
const byRow = new Array(bands).fill(0);
const byCol = new Array(bands).fill(0);
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (diff.data[i] === 255 && diff.data[i + 1] === 0) {
      count++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      byRow[Math.min(bands - 1, Math.floor((y / h) * bands))]++;
      byCol[Math.min(bands - 1, Math.floor((x / w) * bands))]++;
    }
  }
}
console.log('app', A.width + 'x' + A.height, 'ref', R.width + 'x' + R.height, 'compared', w + 'x' + h);
console.log('mismatch', ((count / (w * h)) * 100).toFixed(2) + '%', 'bbox x[' + minX + '..' + maxX + '] y[' + minY + '..' + maxY + ']');
console.log('row bands (image y ranges, 2x -> css/2):');
for (let i = 0; i < bands; i++) if (byRow[i]) console.log('  y ' + Math.floor((i * h) / bands) + '-' + Math.floor(((i + 1) * h) / bands) + ' (' + Math.round(Math.floor((i * h) / bands) / 2) + '-' + Math.round(Math.floor(((i + 1) * h) / bands) / 2) + ' css): ' + byRow[i]);
console.log('col bands (image x ranges -> css/2):');
for (let i = 0; i < bands; i++) if (byCol[i]) console.log('  x ' + Math.floor((i * w) / bands) + '-' + Math.floor(((i + 1) * w) / bands) + ' (' + Math.round(Math.floor((i * w) / bands) / 2) + '-' + Math.round(Math.floor(((i + 1) * w) / bands) / 2) + ' css): ' + byCol[i]);
