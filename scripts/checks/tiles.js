// Shade tiles generator: recolours an existing palette's six tiles for a new palette, in CIE Lab, so the new tiles keep
// the same shapes, blur and shading. Each pixel is placed on the source line background -> glow (t), keeps its
// lightness offset from that line (the soft dark shape), and is rebuilt on the target line background -> glow.
// Usage: node tiles.js <srcPrefix> <srcBg> <srcGlow> <dstPrefix> <dstBg> <dstGlow>
//   e.g. node tiles.js def-day "#F2F0E8" "#8FCBAE" gold-day "#F5EEDF" "#E6C068"
// The ذهبي tiles (gold-day from def-day, gold-night from the former def-night) and the green palette's dark tiles
// (grn-night, from the former blue def-night, removed after) were made with it.
// Reads public/assets/tiles/<srcPrefix>-1..6.webp, writes public/assets/tiles/<dstPrefix>-1..6.webp (webp, q 0.86).
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const DIR = path.join(__dirname, "../../public/assets/tiles");
const [srcP, srcBg, srcGl, dstP, dstBg, dstGl] = process.argv.slice(2);
if (!dstGl) { console.error("usage: node tiles.js <srcPrefix> <srcBg> <srcGlow> <dstPrefix> <dstBg> <dstGlow>"); process.exit(1); }
(async () => {
  const br = await chromium.launch();
  const p = await br.newPage();
  for (let n = 1; n <= 6; n++) {
    const src = fs.readFileSync(path.join(DIR, `${srcP}-${n}.webp`)).toString("base64");
    const out = await p.evaluate(async ([src, a]) => {
      const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
      const gam = (v) => { v = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; return Math.max(0, Math.min(255, Math.round(v * 255))); };
      const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116), fi = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
      const lab = (r, g, b) => { const R = lin(r), G = lin(g), B = lin(b); const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883; return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]; };
      const rgb = ([L, A, Bb]) => { const fy = (L + 16) / 116, fx = fy + A / 500, fz = fy - Bb / 200; const X = fi(fx) * 0.95047, Y = fi(fy), Z = fi(fz) * 1.08883; return [gam(3.2406 * X - 1.5372 * Y - 0.4986 * Z), gam(-0.9689 * X + 1.8758 * Y + 0.0415 * Z), gam(0.0557 * X - 0.204 * Y + 1.057 * Z)]; };
      const hex = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
      const [sb, sg, db, dg] = a.map((h) => lab(...hex(h)));
      const sd = sg.map((v, i) => v - sb[i]), dd = dg.map((v, i) => v - db[i]), sl = sd.reduce((s, v) => s + v * v, 0);
      const img = await new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/webp;base64," + src; });
      const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const x = c.getContext("2d"); x.drawImage(img, 0, 0);
      const d = x.getImageData(0, 0, c.width, c.height), px = d.data;
      for (let k = 0; k < px.length; k += 4) {
        const P = lab(px[k], px[k + 1], px[k + 2]);
        const t = Math.max(-0.2, Math.min(1.4, ((P[0] - sb[0]) * sd[0] + (P[1] - sb[1]) * sd[1] + (P[2] - sb[2]) * sd[2]) / sl));
        const on = sb.map((v, i) => v + sd[i] * t), dL = P[0] - on[0];
        // the pixel's saturation relative to the line (the dark shape is greyer than the glow) carries over too
        const cOn = Math.hypot(on[1], on[2]), kC = cOn > 2 ? Math.min(1.5, Math.hypot(P[1], P[2]) / cOn) : 1;
        const q = rgb([db[0] + dd[0] * t + dL, (db[1] + dd[1] * t) * kC, (db[2] + dd[2] * t) * kC]);
        px[k] = q[0]; px[k + 1] = q[1]; px[k + 2] = q[2];
      }
      x.putImageData(d, 0, 0);
      return c.toDataURL("image/webp", 0.86).split(",")[1];
    }, [src, [srcBg, srcGl, dstBg, dstGl]]);
    const fOut = path.join(DIR, `${dstP}-${n}.webp`);
    fs.writeFileSync(fOut, Buffer.from(out, "base64"));
    console.log(`${srcP}-${n} -> ${path.basename(fOut)} (${fs.statSync(fOut).size} bytes)`);
  }
  await br.close();
})();
