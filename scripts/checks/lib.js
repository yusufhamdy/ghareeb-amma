// Shared helpers for the audit scripts (read-only against public/).
const REPO = require("path").resolve(__dirname, "../..").split(require("path").sep).join("/");
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = REPO + "/public";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".webp": "image/webp" };

// Pages get an empty Firebase config, so they run on the local JSON and never read production Firestore; pass
// { liveFirebase: true } to serve the real config (only for the emulator checks, which point it at the emulator).
function serve(root = ROOT, opts = {}) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/firebase-config.js" && !opts.liveFirebase) { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end("window.FIREBASE_CONFIG={};"); }
    if (p.endsWith("/")) p += "index.html";
    const f = path.join(root, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("nf"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(0, () => r({ server, base: "http://127.0.0.1:" + server.address().port })));
}

const PALS = ["gold", "def", "lav", "sun", "neo"];
function combos(widths = [1440, 390]) {
  const out = [];
  for (const style of ["glass", "shade"]) for (const pal of PALS) for (const mode of ["light", "dark"]) for (const w of widths) out.push({ style, pal, mode, w, tag: `${style}/${pal}/${mode}/${w}` });
  return out;
}
async function context(br, c, extra = {}) {
  const ctx = await br.newContext({ viewport: { width: c.w, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript((s) => {
    localStorage.setItem("gq-set", JSON.stringify(s.set)); localStorage.setItem("gq-ld", "1");
    if (s.prog) localStorage.setItem("gq-prog", JSON.stringify(s.prog));
  }, { set: { style: c.style, mode: c.mode, pal: c.pal, gl: 50, gv: 3, sv: 2, snd: false, cm: false }, prog: extra.prog });
  return ctx;
}

// Pixel analysis: decode PNGs in a blank page with a canvas.
async function analyzer(br) {
  const p = await br.newPage();
  await p.setContent("<canvas id=c></canvas>");
  const lum = `var L=(r,g,b)=>{const f=v=>{v/=255;return v<=.03928?v/12.92:Math.pow((v+.055)/1.055,2.4)};return .2126*f(r)+.7152*f(g)+.0722*f(b)};`;
  return {
    // withText/noText: PNG buffers of the same clip. Returns contrast of text vs background.
    async contrast(withText, noText) {
      return p.evaluate(async ([a, b, lum]) => {
        eval(lum);
        const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + s; });
        const [ia, ib] = await Promise.all([load(a), load(b)]);
        const c = document.getElementById("c"); c.width = ia.width; c.height = ia.height;
        const x = c.getContext("2d");
        x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, c.width, c.height).data;
        x.clearRect(0, 0, c.width, c.height); x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, c.width, c.height).data;
        const bgL = [], diff = [];
        for (let i = 0; i < da.length; i += 4) {
          const lb = L(db[i], db[i + 1], db[i + 2]); bgL.push(lb);
          const d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
          if (d > 30) diff.push({ d, l: L(da[i], da[i + 1], da[i + 2]), lb });
        }
        if (diff.length < 8) return null;
        bgL.sort((m, n) => m - n);
        const bg = bgL[Math.floor(bgL.length / 2)];
        diff.sort((m, n) => n.d - m.d);
        const top = diff.slice(0, Math.max(5, Math.floor(diff.length * 0.15)));
        const tl = top.reduce((s, t) => s + t.l, 0) / top.length;
        const hi = Math.max(tl, bg), lo = Math.min(tl, bg);
        return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
      }, [withText.toString("base64"), noText.toString("base64"), lum]);
    },
    async medianRGB(png) {
      return p.evaluate(async (a) => {
        const i = await new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = "data:image/png;base64," + a; });
        const c = document.getElementById("c"); c.width = i.width; c.height = i.height; const x = c.getContext("2d"); x.drawImage(i, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data; const R = [], G = [], B = [];
        for (let k = 0; k < d.length; k += 4) { R.push(d[k]); G.push(d[k + 1]); B.push(d[k + 2]); }
        const m = (v) => v.sort((a, b) => a - b)[v.length >> 1]; return [m(R), m(G), m(B)];
      }, png.toString("base64"));
    },
    async meanRGB(png) {
      return p.evaluate(async (a) => {
        const i = await new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = "data:image/png;base64," + a; });
        const c = document.getElementById("c"); c.width = i.width; c.height = i.height; const x = c.getContext("2d"); x.drawImage(i, 0, 0);
        const d = x.getImageData(0, 0, c.width, c.height).data; let r = 0, g = 0, b = 0, n = 0;
        for (let k = 0; k < d.length; k += 4) { r += d[k]; g += d[k + 1]; b += d[k + 2]; n++; }
        return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
      }, png.toString("base64"));
    },
  };
}

module.exports = { chromium, serve, combos, context, analyzer, PALS, ROOT };
