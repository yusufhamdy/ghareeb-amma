// Print app and ref RGB at given image coordinates.
// Usage: node px.mjs report/<id>.app.png design/baseline/<id>.png "x,y" "x,y" ...
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const A = PNG.sync.read(fs.readFileSync(path.resolve(here, process.argv[2])));
const R = PNG.sync.read(fs.readFileSync(path.resolve(here, process.argv[3])));
const at = (img, x, y) => { const i = (y * img.width + x) * 4; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
for (const arg of process.argv.slice(4)) {
  const [x, y] = arg.split(',').map(Number);
  const a = at(A, x, y), r = at(R, x, y);
  const d = Math.abs(a[0] - r[0]) + Math.abs(a[1] - r[1]) + Math.abs(a[2] - r[2]);
  console.log(`(${x},${y}) css(${x / 2},${y / 2})  app rgb(${a})  ref rgb(${r})  d=${d}`);
}
