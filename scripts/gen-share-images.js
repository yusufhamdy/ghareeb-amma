// Renders the favicon PNG and the share images from the real site pages, in the site's green palette:
//   public/favicon-32.png, public/og-2026-10.png (general), public/og/word/<slug>.png (one per word, 1200x630).
// The palette is set only in this renderer's own localStorage. Nothing here changes the site, its default palette or
// anyone's settings. Before each screenshot the computed fonts are checked, and the run fails if any differ or if a
// word's card does not fit between the header and the domain.
//   node scripts/gen-share-images.js [--only 79-6,83-0]
// Run scripts/gen-favicon.py first if the favicon design changed.
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { chromium, serve, ROOT } = require("./checks/lib.js");

const OG_WORD = path.join(ROOT, "og", "word");
const SET = { style: "glass", mode: "light", pal: "def", cm: true, sv: 2 };
const COLORS = { "--bg": "#F2F0E8", "--ac": "#1E6B50", "--b1": "#8FCBAE", "--b2": "#EBC98A", "--tx": "#1D2B25", "--mu": "#55645D" };
const VIEW = { width: 900, height: 473 }, DSF = 1.3334;
const DOMAIN = "ghareebalquran.com";
const AMIRI = "Amiri", PLEX = "IBM Plex Sans Arabic", KFGQPC = "KFGQPC";
const ONLY = (() => { const i = process.argv.indexOf("--only"); return i < 0 ? null : process.argv[i + 1].split(","); })();

// common to both kinds of image: no animation, no scrollbars, the domain line
const BASE_CSS = `
html,body{overflow:hidden!important}
#bg i{animation:none!important}
#gear,#nv,#sh{display:none!important}
.share-domain{font-family:'${PLEX}',sans-serif;font-size:17px;font-weight:500;color:var(--mu);direction:ltr;text-align:center}
`;
// only the word card, 640px wide and centred; the header at the top and the domain at the bottom
const WORD_CSS = BASE_CSS + `
#app{min-height:${VIEW.height}px!important;height:${VIEW.height}px;max-width:none!important;width:100%!important;margin:0!important;padding:16px 0 44px!important;gap:0!important;box-sizing:border-box;display:flex!important;flex-direction:column;align-items:center}
#app>header{width:640px;flex:none;margin:0 0 6px!important}
#app>a.pill{flex:none;align-self:center;margin:auto 0 12px!important}
#app>a.pill svg{display:none!important}
.pnb,.acts,#app>a.m,footer,.ft,.cols>.card:nth-child(2){display:none!important}
.cw{display:block!important;width:640px!important;margin:0 0 auto!important;padding:0!important;flex:none}
.cols{display:block!important;width:640px!important;margin:0!important;padding:0!important}
.cols>.card:first-child{width:640px!important;box-sizing:border-box;margin:0!important}
.share-domain{position:fixed;left:0;right:0;bottom:12px}
`;
const GENERAL_CSS = BASE_CSS + `
#app{display:none!important}
.share-general{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.share-general img{width:92px;height:92px;border-radius:21px;display:block;margin-bottom:10px}
.share-general .sn{font-size:84px;line-height:1.25;color:var(--ac)}
.share-general .share-sub{font-family:'${PLEX}',sans-serif;font-size:24px;color:var(--mu);margin-bottom:16px}
`;

const family = (s) => s.split(",")[0].replace(/["']/g, "").trim();

// runs in the page: each expected font must be the element's first family and actually loaded
async function checkFonts(page, expected, tag) {
  const got = await page.evaluate(async (exp) => {
    await document.fonts.ready;
    return exp.map(([sel, fam, weight]) => {
      const el = document.querySelector(sel);
      if (!el) return { sel, missing: true };
      const c = getComputedStyle(el), text = el.textContent.trim();
      const spec = c.fontWeight + " " + c.fontSize + " '" + c.fontFamily.split(",")[0].replace(/["']/g, "").trim() + "'";
      return { sel, family: c.fontFamily, weight: c.fontWeight, wantFam: fam, wantWeight: weight, loaded: document.fonts.check(spec, text) };
    });
  }, expected);
  for (const g of got) {
    if (g.missing) throw new Error(tag + ": no element " + g.sel);
    if (family(g.family).indexOf(g.wantFam) !== 0) throw new Error(tag + ": " + g.sel + " font is " + g.family + ", not " + g.wantFam);
    if (g.wantWeight && g.weight !== g.wantWeight) throw new Error(tag + ": " + g.sel + " weight is " + g.weight + ", not " + g.wantWeight);
    if (!g.loaded) throw new Error(tag + ": " + g.sel + " font " + g.wantFam + " is not loaded");
  }
}
async function checkColors(page, tag) {
  const got = await page.evaluate((keys) => { const c = getComputedStyle(document.documentElement); return keys.map((k) => c.getPropertyValue(k).trim().toUpperCase()); }, Object.keys(COLORS));
  Object.keys(COLORS).forEach((k, i) => { if (got[i] !== COLORS[k].toUpperCase()) throw new Error(tag + ": " + k + " is " + got[i] + ", not " + COLORS[k]); });
}
function pngSize(file) { const b = fs.readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; }
function assert1200x630(file) { const [w, h] = pngSize(file); if (w !== 1200 || h !== 630) throw new Error(file + " is " + w + "x" + h + ", not 1200x630"); }

// 473 * 1.3334 rounds up to 631 device pixels, and a screenshot clip is rounded to whole CSS pixels (629 or 631). So the
// whole viewport is captured and the last row, which is empty background, is cropped on a canvas.
async function shot(page, out) {
  const png = await page.screenshot();
  const crop = await page.context().newPage();
  const rgba = await crop.evaluate(async (src) => {
    const i = new Image(); i.src = src; await i.decode();
    const c = document.createElement("canvas"); c.width = 1200; c.height = 630;
    const g = c.getContext("2d"); g.drawImage(i, 0, 0);
    const d = g.getImageData(0, 0, 1200, 630).data; let s = "";
    for (let k = 0; k < d.length; k += 32768) s += String.fromCharCode.apply(null, d.subarray(k, k + 32768));
    return btoa(s);
  }, "data:image/png;base64," + png.toString("base64"));
  await crop.close();
  fs.writeFileSync(out, encodePng(1200, 630, Buffer.from(rgba, "base64")));
  assert1200x630(out);
}

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

// PNG, 8-bit RGB (these images are opaque): each row with the filter that leaves the smallest residuals, best deflate.
// Lossless, and about half the size of a canvas PNG.
function encodePng(w, h, rgba) {
  const stride = w * 3, raw = Buffer.alloc((stride + 1) * h), prev = Buffer.alloc(stride), row = Buffer.alloc(stride);
  const paeth = (a, b, c) => { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; };
  const cand = [0, 1, 2, 3, 4].map(() => Buffer.alloc(stride));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; if (rgba[i + 3] !== 255) throw new Error("not opaque"); row[x * 3] = rgba[i]; row[x * 3 + 1] = rgba[i + 1]; row[x * 3 + 2] = rgba[i + 2]; }
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 3 ? row[i - 3] : 0, b = prev[i], c = i >= 3 ? prev[i - 3] : 0;
        const pred = f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c);
        const v = (row[i] - pred) & 255;
        cand[f][i] = v; sum += v < 128 ? v : 256 - v;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    raw[y * (stride + 1)] = best; cand[best].copy(raw, y * (stride + 1) + 1);
    row.copy(prev);
  }
  const chunk = (type, data) => { const t = Buffer.from(type, "latin1"), n = Buffer.alloc(4), c = Buffer.alloc(4); n.writeUInt32BE(data.length); c.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([n, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9, memLevel: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

async function openSite(br, base) {
  const ctx = await br.newContext({ viewport: VIEW, deviceScaleFactor: DSF, colorScheme: "light" });
  await ctx.addInitScript((set) => { localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-set", JSON.stringify(set)); }, SET);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { throw e; });
  await page.goto(base + "/#/", { waitUntil: "load" });
  await page.waitForSelector("#app header .sn");
  await page.evaluate(() => document.fonts.ready);
  return { ctx, page };
}

async function favicon(br, base) {
  const ctx = await br.newContext({ viewport: { width: 32, height: 32 }, deviceScaleFactor: 1, colorScheme: "light" });
  const page = await ctx.newPage();
  await page.setContent(`<!doctype html><style>html,body{margin:0}img{display:block;width:32px;height:32px}</style><img src="${base}/favicon.svg">`);
  await page.waitForFunction(() => document.images[0].complete && document.images[0].naturalWidth > 0);
  await page.screenshot({ path: path.join(ROOT, "favicon-32.png"), omitBackground: true }); // transparent corners
  const [w, h] = pngSize(path.join(ROOT, "favicon-32.png"));
  if (w !== 32 || h !== 32) throw new Error("favicon-32.png is " + w + "x" + h);
  await ctx.close();
}

async function general(br, base) {
  const { ctx, page } = await openSite(br, base);
  await page.addStyleTag({ content: GENERAL_CSS });
  await page.evaluate((domain) => {
    const d = document.createElement("div"); d.className = "share-general";
    d.innerHTML = '<img src="/favicon.svg" alt=""><div class="sn" id="s-name">غريب القرآن</div><div class="share-sub" id="s-sub">معاني الكلمات الغريبة في جزء عمّ، بأسلوب مبسّط</div><div class="share-domain" id="s-domain">' + domain + "</div>";
    document.body.appendChild(d);
  }, DOMAIN);
  await page.waitForFunction(() => document.querySelector(".share-general img").complete && document.querySelector(".share-general img").naturalWidth > 0);
  await page.evaluate(async () => { await Promise.all([document.fonts.load("700 84px Amiri", "غريب"), document.fonts.load("400 24px 'IBM Plex Sans Arabic'", "معاني"), document.fonts.load("500 17px 'IBM Plex Sans Arabic'", "ghareebalquran.com")]); });
  await checkColors(page, "general");
  await checkFonts(page, [["#s-name", AMIRI, "700"], ["#s-sub", PLEX, null], ["#s-domain", PLEX, "500"]], "general");
  const out = path.join(ROOT, "og-2026-10.png");
  await shot(page, out);
  await ctx.close();
}

async function words(br, base) {
  fs.mkdirSync(OG_WORD, { recursive: true });
  const { ctx, page } = await openSite(br, base);
  await page.addStyleTag({ content: WORD_CSS });
  await page.evaluate((domain) => { const d = document.createElement("div"); d.className = "share-domain"; d.id = "s-domain"; d.textContent = domain; document.body.appendChild(d); }, DOMAIN);
  const list = await page.evaluate(() => W.map((w) => [w.id, w.slug]));
  if (list.length !== 73) throw new Error("expected 73 words, found " + list.length);
  const bad = [], tall = [];
  for (const [id, slug] of list) {
    if (ONLY && !ONLY.includes(id)) continue;
    if (!fs.existsSync(path.join(ROOT, "word", slug + ".html"))) { bad.push(id + ": no static page " + slug); continue; }
    // the styles are in place before this word renders, so the highlight is measured in its final layout
    await page.evaluate((id) => { location.hash = "#/word/" + id; }, id);
    await page.waitForFunction((id) => { const a = document.querySelector("#app a.pill"), b = document.querySelector('[data-id]'); return a && b && b.dataset.id === id && document.querySelector("#app .cols .wd"); }, id);
    await page.evaluate(async () => { await document.fonts.ready; window.scrollTo(0, 0); });
    await page.waitForTimeout(250);
    await page.waitForFunction(() => [...document.querySelectorAll("#app .cols mark")].every((m) => m.style.getPropertyValue("--hl-w")), null, { timeout: 15000 });
    try {
      await checkColors(page, id);
      await checkFonts(page, [["#app header .sn", AMIRI, "700"], ["#app>a.pill", PLEX, null], ["#s-domain", PLEX, "500"], ["#app .cols .wd", KFGQPC, null], ["#app .cols .ay", KFGQPC, null]], id);
      const m = await page.evaluate(() => {
        const r = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
        const shown = (s) => [...document.querySelectorAll(s)].filter((e) => e.getClientRects().length).length;
        const c = r("#app .cols .card"), d = r("#s-domain"), h = r("#app>header");
        const ink = document.querySelector("#app .cols .ay"), wd = document.querySelector("#app .cols .wd");
        return { w: c.width, cx: c.left + c.width / 2, top: c.top, bottom: c.bottom, dTop: d.top, hBottom: h.bottom, vw: innerWidth, fb: document.documentElement.classList.contains("qf"),
          overflow: ink.scrollWidth > ink.clientWidth + 1 || wd.scrollWidth > wd.clientWidth + 1,
          hidden: { meaning: shown(".cols>.card:nth-child(2)"), buttons: shown(".acts"), nav: shown("#nv"), prevNext: shown(".pnb"), report: shown("#app>a.m"), arrow: shown("#app>a.pill svg"), gear: shown("#gear"), footer: shown("#app footer") }, cards: shown("#app .card"), bodyText: document.querySelector("#app .cols .wd").textContent };
      });
      if (m.fb) throw new Error(id + ": the page fell back from the KFGQPC font");
      if (Math.abs(m.w - 640) > 0.5) throw new Error(id + ": card width " + m.w);
      if (Math.abs(m.cx - m.vw / 2) > 0.5) throw new Error(id + ": card not centred (" + m.cx + ")");
      if (m.overflow) throw new Error(id + ": text overflows its box");
      const shownBad = Object.entries(m.hidden).filter(([, n]) => n).map(([k]) => k);
      if (shownBad.length) throw new Error(id + ": should be hidden: " + shownBad.join(","));
      if (m.cards !== 1) throw new Error(id + ": " + m.cards + " cards shown");
      if (m.top < m.hBottom) throw new Error(id + ": the card overlaps the header");
      if (m.bottom > m.dTop - 4) { tall.push(id + " (" + slug + "): card bottom " + m.bottom.toFixed(1) + " past " + (m.dTop - 4).toFixed(1)); continue; }
      const out = path.join(OG_WORD, slug + ".png");
      await shot(page, out);
    } catch (e) { bad.push(e.message); }
  }
  await ctx.close();
  return { bad, tall };
}

(async () => {
  const { server, base } = await serve();
  const br = await chromium.launch();
  try {
    if (!ONLY) { await favicon(br, base); await general(br, base); }
    const { bad, tall } = await words(br, base);
    if (tall.length) console.log("does not fit:\n  " + tall.join("\n  "));
    if (bad.length) console.log("failed:\n  " + bad.join("\n  "));
    if (bad.length || tall.length) process.exitCode = 1;
    else console.log("share images written" + (ONLY ? " (" + ONLY.join(",") + ")" : ": favicon-32.png, og-2026-10.png, og/word/ x 73"));
  } finally {
    await br.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
