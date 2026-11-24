#!/usr/bin/env node
/*
 * gen-icons.mjs - every icon PNG (and favicon.ico) from one SVG source: public/favicon.svg (scripts/gen-favicon.py).
 *
 * The design is the day ("glass, emerald, day") tile: cream background, green and gold glows, the eight-pointed
 * star, the circle and the letter ghain in emerald #1E6B50. One identity everywhere: no dark variant.
 *
 * Three layouts, all made from the same SVG text (only the background corners and the content scale change):
 *   any       the favicon as it is: a rounded tile with transparent corners.
 *             favicon-32.png, favicon.ico (16, 32, 48), icon-192.png, icon-512.png (manifest "any"),
 *             icon_ultra_clean_transparent_1254px.png (an old URL, kept so it shows the current identity)
 *   full      full-bleed, opaque square, same scale: apple-touch-icon.png (180; iOS applies its own mask)
 *   maskable  full-bleed, opaque square, the star, circle and letter scaled to MASK_SCALE around the centre, so the
 *             whole drawing stays inside the central 80% safe zone (a circle of radius 40% of the side):
 *             icon-maskable-192.png, icon-maskable-512.png (manifest "maskable")
 *
 *   node scripts/gen-icons.mjs            write the files into public/
 *   node scripts/gen-icons.mjs --svg <layout>   print one layout's SVG (any | full | maskable)
 *
 * Rendering: headless Chromium (Playwright), GPU flag tried first (see the global GPU rule), the renderer printed.
 * ASCII-ONLY (see test/arabic-guard.test.js).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = path.join(ROOT, "public");
// The star's outer points sit 30*sqrt(2) = 42.43 from the centre, plus half the 4.2 stroke = 44.5 (of 100). The safe
// zone's radius is 40: 0.8 keeps every point at 35.6, with room to spare for masks that cut a little deeper.
export const MASK_SCALE = 0.8;

export function source() {
  return fs.readFileSync(path.join(PUBLIC, "favicon.svg"), "utf8");
}

// The SVG of one layout, from the source text.
export function layout(svg, kind) {
  if (kind === "any") return svg;
  const bleed = svg.replace(/<rect width="100" height="100" rx="[\d.]+"/g, '<rect width="100" height="100"');
  if (kind === "full") return bleed;
  if (kind !== "maskable") throw new Error("unknown layout " + kind);
  // everything after the three background rects is the drawing: wrap it in one scaled group
  const i = bleed.lastIndexOf('fill="url(#g2)"/>') + 'fill="url(#g2)"/>'.length;
  const j = bleed.lastIndexOf("</svg>");
  const k = MASK_SCALE, t = (50 * (1 - k)).toFixed(2);
  return bleed.slice(0, i) + '<g transform="translate(' + t + " " + t + ") scale(" + k + ')">' + bleed.slice(i, j) + "</g>" + bleed.slice(j);
}

export const OUTPUTS = [
  ["favicon-32.png", "any", 32],
  ["icon-192.png", "any", 192],
  ["icon-512.png", "any", 512],
  ["icon_ultra_clean_transparent_1254px.png", "any", 1254],
  ["apple-touch-icon.png", "full", 180],
  ["icon-maskable-192.png", "maskable", 192],
  ["icon-maskable-512.png", "maskable", 512],
];
export const ICO_SIZES = [16, 32, 48];

// favicon.ico with PNG entries (Windows Vista and later, every current browser and search engine).
export function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(({ size, data }, n) => {
    const e = 6 + 16 * n;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1);
    head.writeUInt8(0, e + 2); head.writeUInt8(0, e + 3);
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(off, e + 12);
    off += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

export async function launch() {
  const { chromium } = await import("playwright");
  const probe = async (br) => {
    const p = await br.newPage();
    const r = await p.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl");
      if (!gl) return "no webgl";
      const d = gl.getExtension("WEBGL_debug_renderer_info");
      return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    });
    await p.close();
    return r;
  };
  let br = await chromium.launch({ args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  let renderer = await probe(br);
  if (/swiftshader|no webgl/i.test(renderer)) {
    await br.close();
    br = await chromium.launch();
    renderer = (await probe(br)) + " (GPU path unavailable, default launch)";
  }
  return { br, renderer };
}

export async function render(br, svg, size, transparent) {
  const ctx = await br.newContext({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const src = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
  await page.setContent('<!doctype html><style>html,body{margin:0;background:transparent}img{display:block;width:' + size + "px;height:" + size + 'px}</style><img src="' + src + '">');
  await page.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0);
  const data = await page.screenshot({ omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  await ctx.close();
  return data;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args[0] === "--svg") {
    process.stdout.write(layout(source(), args[1] || "any"));
  } else {
    const svg = source();
    const { br, renderer } = await launch();
    try {
      for (const [file, kind, size] of OUTPUTS) {
        fs.writeFileSync(path.join(PUBLIC, file), await render(br, layout(svg, kind), size, kind === "any"));
        console.log("wrote " + file + " (" + kind + ", " + size + "px)");
      }
      const pngs = [];
      for (const size of ICO_SIZES) pngs.push({ size, data: await render(br, svg, size, true) });
      fs.writeFileSync(path.join(PUBLIC, "favicon.ico"), ico(pngs));
      console.log("wrote favicon.ico (" + ICO_SIZES.join(", ") + ")");
      console.log("renderer: " + renderer);
    } finally { await br.close(); }
  }
}
