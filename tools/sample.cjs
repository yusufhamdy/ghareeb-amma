// Sample a PNG: print size, and average RGB per coarse row band.
// usage: node sample.cjs <file.png> [bands]
const fs = require('fs');
const { PNG } = require(process.argv[4] || 'pngjs');
const file = process.argv[2];
const bands = Number(process.argv[3] || 12);
const png = PNG.sync.read(fs.readFileSync(file));
const { width: w, height: h, data } = png;
console.log(file, w + 'x' + h);
const step = Math.floor(h / bands) || 1;
for (let b = 0; b < bands; b++) {
  let r = 0, g = 0, bl = 0, n = 0;
  for (let y = b * step; y < Math.min(h, (b + 1) * step); y += 2) {
    for (let x = 0; x < w; x += 4) {
      const i = (y * w + x) * 4;
      r += data[i]; g += data[i + 1]; bl += data[i + 2]; n++;
    }
  }
  console.log('y ' + String(b * step).padStart(5) + '-' + String(Math.min(h, (b + 1) * step)).padStart(5), 'avg', ((r / n) | 0) + ',' + ((g / n) | 0) + ',' + ((bl / n) | 0));
}
