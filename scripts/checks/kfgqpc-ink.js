// Letter size of the Quran face against Amiri Quran, with the real fonts.css (size-adjust and the metric overrides).
//   node kfgqpc-ink.js
// Reference string: the site's own ayah text (every segment, before + hl + after) without marks or tatweel, drawn one
// ayah at a time at 400px; its ink height is the highest ink above the baseline plus the lowest below it, over all
// ayat. Passes when KFGQPC's height is within +-3% of Amiri Quran's. Also prints the same with marks, the advance
// width, and the line metrics both faces report (they must be equal: same baseline, same line box).
const { serve } = require("./lib.js");
const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
const ROOT = path.resolve(__dirname, "../../public");
const W = JSON.parse(fs.readFileSync(ROOT + "/words.json", "utf8"));
const MARKS = /[ؐ-ًؚ-ٰٟۖ-ࣰۭ-ࣲـ]/g;
const ayat = [...new Set(W.flatMap((e) => e.ayahs.flatMap((a) => a.segments.map((g) => g.before + g.hl + g.after))))];
const rasm = ayat.map((s) => s.normalize("NFD").replace(MARKS, ""));

(async () => {
  const { server, base } = await serve();
  const br = await chromium.launch(), p = await br.newPage();
  await p.goto(base + "/about/");
  const r = await p.evaluate(async ({ rasm, ayat }) => {
    await document.fonts.load('400px "KFGQPC Uthmanic Hafs"', "ب"); await document.fonts.load('400px "Amiri Quran"', "ب");
    const c = document.createElement("canvas"), x = c.getContext("2d");
    const ink = (font, s) => {
      x.font = font; const w = Math.ceil(x.measureText(s).width + 800); c.width = w; c.height = 2000;
      x.font = font; x.direction = "rtl"; x.textAlign = "right"; x.fillText(s, w - 400, 1200);
      const d = x.getImageData(0, 0, w, 2000).data; let t = 2000, b = -1;
      for (let y = 0; y < 2000; y++) for (let xx = 0; xx < w; xx++) if (d[(y * w + xx) * 4 + 3] > 8) { if (y < t) t = y; if (y > b) b = y; break; }
      return { asc: 1200 - t, desc: b + 1 - 1200 };
    };
    const agg = (font, list) => { let a = 0, d = 0, wd = 0; for (const s of list) { const k = ink(font, s); a = Math.max(a, k.asc); d = Math.max(d, k.desc); x.font = font; wd += x.measureText(s).width; } x.font = font; const m = x.measureText("ب"); return { asc: a, desc: d, h: a + d, width: Math.round(wd), fontAsc: m.fontBoundingBoxAscent, fontDesc: m.fontBoundingBoxDescent }; };
    const AQ = '400px "Amiri Quran"', KF = '400px "KFGQPC Uthmanic Hafs"';
    return { rasm: { amiri: agg(AQ, rasm), kfgqpc: agg(KF, rasm) }, full: { amiri: agg(AQ, ayat), kfgqpc: agg(KF, ayat) } };
  }, { rasm, ayat });
  const ratio = r.rasm.kfgqpc.h / r.rasm.amiri.h;
  console.log(JSON.stringify(r));
  console.log("letters (no marks): KFGQPC/Amiri ink height " + ratio.toFixed(4) + " (" + ((ratio - 1) * 100).toFixed(2) + "%)");
  console.log("with marks: " + (r.full.kfgqpc.h / r.full.amiri.h).toFixed(4) + "; advance width " + (r.rasm.kfgqpc.width / r.rasm.amiri.width).toFixed(4));
  console.log("line metrics (400px): Amiri " + r.rasm.amiri.fontAsc + "/" + r.rasm.amiri.fontDesc + ", KFGQPC " + r.rasm.kfgqpc.fontAsc + "/" + r.rasm.kfgqpc.fontDesc);
  const ok = Math.abs(ratio - 1) <= 0.03 && Math.abs(r.rasm.amiri.fontAsc - r.rasm.kfgqpc.fontAsc) <= 1 && Math.abs(r.rasm.amiri.fontDesc - r.rasm.kfgqpc.fontDesc) <= 1;
  console.log(ok ? "ALL CHECKS PASSED" : "FAILED");
  if (!ok) process.exitCode = 1;
  await br.close(); server.close();
})();
