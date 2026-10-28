// Text overlap and clipping audit (N2): no text's ink may run into the next text element, and no container may clip it.
//   node text-overlap.js [root|url] [outDir] [--widths 320,360,400,768,1024,1440] [--looks glass-light,...] [--only name,...]
// root defaults to the working tree's public/ (served locally with an empty Firebase config); a URL audits that site.
//
// Pages: the app's home, surah list, surah 78, all word pages, challenge, an open day card, a quiz question and the quiz
// result, the settings sheet and the four legal pages; the static legal pages, 404, and every static word and surah page.
// Looks: glass and shade, light and dark, gold palette (palettes do not change layout). Widths as given.
//
// How: a "text element" is the nearest non-inline box (block, inline-block, flex/grid item...) around visible text.
// Each word's ink is computed from the canvas text metrics of its own font at its own place (Range rects give the
// advance box and the baseline sits fontBoundingBoxAscent below its top); in Chromium these match the rasterised ink.
// Candidates:
//   - overlap: ink of element A inside the text box of another element B (its line boxes: line-height around each
//     line's content area, not the font's taller content area), or inside B's ink; A and B not
//     nested, and both in the same layer (fixed/sticky content is compared only with its own layer);
//   - clipping: ink outside an ancestor that clips (overflow other than visible), past its padding box (or its
//     scrollable area for scroll containers).
// Every candidate is then verified with pixels: screenshots with only A's (and B's) text drawn give the real ink masks;
// a hit is reported only when the masks confirm it (overlap: pixels of A inside B's box or ink; clipping: pixels that
// appear when the container's clipping is switched off).
// Writes outDir/results.json and prints one row per hit: page, look, width, element, other element or container, px.
const { serve } = require("./lib.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const SRC = pos[0] || path.resolve(__dirname, "../../public");
const OUT = pos[1] || path.join(__dirname, "out/text-overlap");
const WIDTHS = opt("--widths", "320,360,400,768,1024,1440").split(",").map(Number);
const LOOKS = opt("--looks", "glass-light,glass-dark,shade-light,shade-dark").split(",");
const ONLY = opt("--only", "") ? opt("--only", "").split(",") : null;
const DSF = 2, TOL = 0.5; // px: smaller overlaps are anti-aliasing

// ---- in the page: text elements, their word ink (canvas metrics), line boxes, clipping ancestors and layer
function measure() {
  const cv = document.createElement("canvas").getContext("2d");
  const blocks = new Map(), out = [];
  const skip = (el) => el.closest("script,style,noscript,template,svg,title,textarea,select,option,[data-tov-skip]");
  const isInline = (cs) => cs.display === "inline" || cs.display === "contents";
  const blockOf = (el) => { while (el && el !== document.body && isInline(getComputedStyle(el))) el = el.parentElement; return el; };
  const layerOf = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === "fixed" || p === "sticky") return e; } return null; };
  const desc = (el) => { const id = el.id ? "#" + el.id : "", cl = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : ""; return el.tagName.toLowerCase() + id + cl; };
  const vw = innerWidth, vh = innerHeight;
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = tw.nextNode())) {
    if (!/\S/.test(n.data)) continue;
    const el = n.parentElement;
    if (!el || skip(el) || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const cs = getComputedStyle(el);
    if (parseFloat(cs.fontSize) < 1) continue;
    const blk = blockOf(el);
    const layer = layerOf(blk);
    if (layer) { const r = layer.getBoundingClientRect(); if (r.bottom <= 0 || r.top >= vh || r.right <= 0 || r.left >= vw) continue; }
    if (!blocks.has(blk)) {
      // clipping ancestors (from the text's own element up)
      const clips = [];
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const s = getComputedStyle(e);
        const clipX = s.overflowX !== "visible", clipY = s.overflowY !== "visible";
        if (!clipX && !clipY) continue;
        const r = e.getBoundingClientRect(), L = r.left + e.clientLeft + scrollX, T = r.top + e.clientTop + scrollY;
        const scroll = /auto|scroll/.test(s.overflowX + s.overflowY);
        clips.push({ el: e, desc: desc(e), x: clipX, y: clipY, scroll, ellipsis: s.textOverflow === "ellipsis",
          l: L - (scroll ? e.scrollLeft : 0), t: T - (scroll ? e.scrollTop : 0),
          r: L + (scroll ? e.scrollWidth - e.scrollLeft : e.clientWidth), b: T + (scroll ? e.scrollHeight - e.scrollTop : e.clientHeight) });
      }
      blocks.set(blk, { i: blocks.size, desc: desc(blk), text: "", font: "", fs: 0, inks: [], words: [], clips, layer: layer ? desc(layer) : "" });
      blk.setAttribute("data-tov", String(blocks.get(blk).i));
    }
    const b = blocks.get(blk);
    if (!b.font) { b.font = cs.fontFamily.split(",")[0].replace(/["']/g, ""); b.fs = parseFloat(cs.fontSize); }
    if (b.text.length < 40) b.text += n.data.replace(/\s+/g, " ");
    cv.font = cs.fontStyle + " " + cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
    cv.direction = cs.direction; cv.textAlign = "left";
    try { cv.letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing; } catch (e) {}
    const r = document.createRange();
    for (const m of n.data.matchAll(/\S+/g)) {
      r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
      let parts = [...r.getClientRects()].filter((x) => x.width > 0 && x.height > 0);
      if (!parts.length) continue;
      // a word in several boxes (over two lines, or mixed scripts in separate bidi runs): character by character
      let pieces = [{ t: m[0], rect: parts[0] }];
      if (parts.length > 1) {
        pieces = [];
        for (let k = 0; k < m[0].length; k++) {
          r.setStart(n, m.index + k); r.setEnd(n, m.index + k + 1);
          const q = r.getBoundingClientRect(); if (q.width) pieces.push({ t: m[0][k], rect: q });
        }
      }
      for (const p of pieces) {
        // a word that a clipping ancestor hides completely (a clamped line) is not visible
        if (b.clips.some((c) => (c.x && (p.rect.right + scrollX <= c.l || p.rect.left + scrollX >= c.r)) || (c.y && (p.rect.bottom + scrollY <= c.t || p.rect.top + scrollY >= c.b)))) continue;
        const k = cv.measureText(p.t), rw = p.rect.right - p.rect.left;
        let s = k.width > 0 && rw > 0 ? rw / k.width : 1;
        if (s < 0.9 || s > 1.1) s = 1; // only a transform scales text; anything else is shaping context
        const base = p.rect.top + k.fontBoundingBoxAscent * s;
        // the word's line box: line-height centred on its content area (half-leading on each side)
        const lh = cs.lineHeight === "normal" ? p.rect.bottom - p.rect.top : parseFloat(cs.lineHeight) * s, mid = (p.rect.top + p.rect.bottom) / 2;
        b.words.push({ l: p.rect.left + scrollX, r: p.rect.right + scrollX, t: mid - lh / 2 + scrollY, b: mid + lh / 2 + scrollY });
        b.inks.push({ l: p.rect.left - k.actualBoundingBoxLeft * s + scrollX, r: p.rect.left + k.actualBoundingBoxRight * s + scrollX, t: base - k.actualBoundingBoxAscent * s + scrollY, b: base + k.actualBoundingBoxDescent * s + scrollY });
      }
    }
  }
  const list = [...blocks.entries()];
  for (const [el, b] of list) {
    // line boxes: the words' boxes merged per line
    const lines = [];
    b.words.slice().sort((x, y) => x.t - y.t).forEach((w) => { const L = lines.find((x) => Math.abs(x.t - w.t) < 1 && Math.abs(x.b - w.b) < 1); if (L) { L.l = Math.min(L.l, w.l); L.r = Math.max(L.r, w.r); } else lines.push(Object.assign({}, w)); });
    b.lines = lines; delete b.words;
    b.inside = list.filter(([e2]) => e2 !== el && e2.contains(el)).map(([, b2]) => b2.i);
    b.clips = b.clips.map((c) => { c.el.setAttribute("data-tov-clip", (c.el.getAttribute("data-tov-clip") || "") + " c" + b.i); return Object.assign({}, c, { el: undefined }); });
    out.push(b);
  }
  return { blocks: out, pw: document.documentElement.scrollWidth, ph: document.documentElement.scrollHeight };
}

const ix = (a, b) => ({ w: Math.min(a.r, b.r) - Math.max(a.l, b.l), h: Math.min(a.b, b.b) - Math.max(a.t, b.t) });
function candidates(m) {
  const cand = [], B = m.blocks;
  for (const a of B) {
    for (const b of B) {
      if (a === b || a.layer !== b.layer || a.inside.includes(b.i) || b.inside.includes(a.i)) continue;
      let worst = null;
      for (const ia of a.inks) for (const L of b.lines.concat(b.inks)) { const o = ix(ia, L); if (o.w > TOL && o.h > TOL && (!worst || o.h * o.w > worst.h * worst.w)) worst = o; }
      if (worst) cand.push({ kind: "overlap", a: a.i, b: b.i });
    }
    for (const c of a.clips) for (const ia of a.inks) {
      const over = Math.max(c.x ? c.l - ia.l : 0, c.x ? ia.r - c.r : 0, c.y ? c.t - ia.t : 0, c.y ? ia.b - c.b : 0);
      if (over > TOL) { cand.push({ kind: "clip", a: a.i, clip: c }); break; }
    }
  }
  // one clip candidate per element and container
  const seen = new Set();
  return cand.filter((c) => { const k = c.kind + c.a + (c.kind === "clip" ? c.clip.desc : "/" + c.b); if (seen.has(k)) return false; seen.add(k); return true; });
}

// ---- pixel masks: what differs between "no text" and "only these elements' text"
const STYLE = (show, extra) => `(() => { let s = document.getElementById("__tov"); if (!s) { s = document.createElement("style"); s.id = "__tov"; document.head.appendChild(s); }
  s.textContent = "*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;transition:none!important;animation:none!important} mark::before{opacity:0!important}" +
  ${JSON.stringify(show)} + ${JSON.stringify(extra || "")}; })()`;
const showSel = (ids) => ids.map((i) => `[data-tov="${i}"],[data-tov="${i}"] *`).join(",") + "{color:#000!important;-webkit-text-fill-color:#000!important}";
async function mask(p, clip, ids, extra) {
  await p.evaluate(STYLE("", extra)); const a = await p.screenshot({ clip, fullPage: true, animations: "disabled" });
  await p.evaluate(STYLE(showSel(ids), extra)); const b = await p.screenshot({ clip, fullPage: true, animations: "disabled" });
  await p.evaluate(() => { const s = document.getElementById("__tov"); if (s) s.remove(); });
  return p.evaluate(async ([a, b, dsf]) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + s; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const c = document.createElement("canvas"); c.width = ia.width; c.height = ia.height; const x = c.getContext("2d");
    x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, c.width, c.height).data; x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, c.width, c.height).data;
    const on = [];
    for (let i = 0; i < da.length; i += 4) on.push(Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 60 ? 1 : 0);
    return { w: c.width, h: c.height, on };
  }, [a.toString("base64"), b.toString("base64"), DSF]);
}
const clipFor = (rects, m, pad) => {
  const l = Math.max(0, Math.min(...rects.map((r) => r.l)) - pad), t = Math.max(0, Math.min(...rects.map((r) => r.t)) - pad);
  const r = Math.min(m.pw, Math.max(...rects.map((x) => x.r)) + pad), b = Math.min(m.ph, Math.max(...rects.map((x) => x.b)) + pad);
  return { x: Math.floor(l), y: Math.floor(t), width: Math.ceil(r - Math.floor(l)), height: Math.ceil(b - Math.floor(t)) };
};
// pixels of a mask inside page rects; depth = vertical extent of those pixels (CSS px)
function inside(mk, clip, rects) {
  let n = 0, y0 = Infinity, y1 = -Infinity, x0 = Infinity, x1 = -Infinity;
  for (let y = 0; y < mk.h; y++) for (let x = 0; x < mk.w; x++) {
    if (!mk.on[y * mk.w + x]) continue;
    const px = clip.x + (x + 0.5) / DSF, py = clip.y + (y + 0.5) / DSF;
    if (rects.some((r) => px >= r.l && px <= r.r && py >= r.t && py <= r.b)) { n++; y0 = Math.min(y0, py); y1 = Math.max(y1, py); x0 = Math.min(x0, px); x1 = Math.max(x1, px); }
  }
  return n ? { n, h: +(y1 - y0 + 1 / DSF).toFixed(1), w: +(x1 - x0 + 1 / DSF).toFixed(1) } : null;
}

async function verify(p, m, c) {
  const A = m.blocks[c.a];
  if (c.kind === "overlap") {
    const B = m.blocks[c.b];
    const clip = clipFor(A.inks.concat(B.lines, B.inks), m, 4);
    const ma = await mask(p, clip, [A.i]), mb = await mask(p, clip, [B.i]);
    const both = { w: ma.w, h: ma.h, on: ma.on.map((v, i) => v & mb.on[i]) };
    // ink on ink is counted once per pair (on the pair's first element)
    const box = inside(ma, clip, B.lines), ink = A.i < B.i ? inside(both, clip, [{ l: -1e9, r: 1e9, t: -1e9, b: 1e9 }]) : null;
    if (!box && !ink) return null;
    return { kind: "overlap", a: A, b: B, intoBox: box, intoInk: ink };
  }
  // clipping: the element's pixels with the container's clipping switched off, outside the clip rect
  const C = c.clip;
  const sel = `[data-tov-clip~="c${A.i}"]`;
  const off = `${sel}{overflow:visible!important;contain:none!important;clip-path:none!important}`;
  const area = A.inks.concat([{ l: C.l, r: C.r, t: C.t, b: C.b }]);
  const clip = clipFor(area, m, 4);
  const mo = await mask(p, clip, [A.i], off);
  const outside = [];
  if (C.x) outside.push({ l: -1e9, r: C.l - 0.01, t: -1e9, b: 1e9 }, { l: C.r + 0.01, r: 1e9, t: -1e9, b: 1e9 });
  if (C.y) outside.push({ l: -1e9, r: 1e9, t: -1e9, b: C.t - 0.01 }, { l: -1e9, r: 1e9, t: C.b + 0.01, b: 1e9 });
  const o = inside(mo, clip, outside);
  if (!o) return null;
  return { kind: "clip", a: A, clip: C, out: o };
}

// ---- pages
function pageList(words, surahSlugs) {
  const L = [
    { name: "app home", hash: "#/" }, { name: "app surah list", hash: "#/surahs" }, { name: "app surah 78", hash: "#/surah/78" },
    ...words.map((w) => ({ name: "app word " + w.id, hash: "#/word/" + w.id })),
    { name: "app challenge", hash: "#/challenge" }, { name: "app day 1 (card open)", hash: "#/day/1", act: "day" },
    { name: "app quiz question", hash: "#/quiz", act: "quiz" }, { name: "app quiz result", hash: "#/quiz", act: "result" },
    { name: "app settings sheet", hash: "#/", act: "settings" },
    ...["about", "privacy", "terms", "rights"].map((k) => ({ name: "app " + k, hash: "#/" + k })),
    ...["about", "privacy", "terms", "rights"].map((k) => ({ name: "static " + k, url: "/" + k + "/" })),
    { name: "static 404", url: "/404.html" },
    ...words.map((w) => ({ name: "static word " + w.slug, url: "/word/" + w.slug + ".html" })),
    ...surahSlugs.map((s) => ({ name: "static surah " + s, url: "/surah/" + s + ".html" })),
  ];
  return ONLY ? L.filter((x) => ONLY.some((o) => x.name === o || x.name.startsWith(o + " ") || x.name.includes(o))) : L;
}
async function settle(p) { await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(700); }

(async () => {
  let server = null, base = SRC;
  if (!/^https?:/.test(SRC)) ({ server, base } = await serve(SRC));
  fs.mkdirSync(OUT, { recursive: true });
  const br = await chromium.launch();
  const hits = [], stats = { pages: 0, elements: 0, candidates: 0 };
  for (const look of LOOKS) for (const w of WIDTHS) {
    const [style, mode] = look.split("-");
    const ctx = await br.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: DSF, reducedMotion: "reduce" });
    await ctx.addInitScript((s) => { try { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); } catch (e) {} }, { style, mode, pal: "gold", gl: 50, gv: 3, snd: false, cm: true });
    await ctx.addInitScript(() => { let s = 12345; Math.random = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); });
    const p = await ctx.newPage();
    await p.goto(base + "/#/"); await settle(p);
    const words = await p.evaluate(() => W.map((x) => ({ id: x.id, slug: x.slug })));
    const surahs = await p.evaluate(() => S.map((s) => s.slug));
    for (const pg of pageList(words, surahs)) {
      if (pg.url) await p.goto(base + pg.url);
      else { await p.goto(base + "/" + pg.hash); }
      await settle(p);
      if (pg.act === "day") { await p.evaluate(() => { const c = document.querySelector(".dcard"); if (c && !c.classList.contains("open")) c.click(); }); await p.waitForTimeout(700); }
      if (pg.act === "result") { for (let k = 0; k < 12; k++) { const o = await p.$("#app .opt"); if (!o) break; await o.click(); await p.waitForTimeout(150); const nx = await p.$('#app [data-a="qn"]'); if (nx) await nx.click(); await p.waitForTimeout(250); } await settle(p); }
      if (pg.act === "settings") { await p.click("#gear"); await p.waitForTimeout(900); }
      await p.evaluate(() => scrollTo(0, 0));
      const m = await p.evaluate(measure);
      stats.pages++; stats.elements += m.blocks.length;
      const cs = candidates(m); stats.candidates += cs.length;
      for (const c of cs) {
        const v = await verify(p, m, c);
        if (!v) continue;
        const row = { page: pg.name, look, width: w, element: `${v.a.desc} "${v.a.text.trim().slice(0, 30)}" (${v.a.font} ${v.a.fs}px)` };
        if (v.kind === "overlap") Object.assign(row, { kind: "overlap", other: `${v.b.desc} "${v.b.text.trim().slice(0, 30)}"`, intoBoxPx: v.intoBox ? v.intoBox.h : 0, intoBoxW: v.intoBox ? v.intoBox.w : 0, intoInkPx: v.intoInk ? v.intoInk.h : 0, inkPixels: v.intoInk ? v.intoInk.n : 0 });
        else Object.assign(row, { kind: "clip", other: v.clip.desc + (v.clip.ellipsis ? " (text-overflow: ellipsis)" : ""), clippedPx: Math.max(v.out.h, v.out.w > 0 && v.clip.x && !v.clip.y ? v.out.w : 0), clippedW: v.out.w, clippedH: v.out.h });
        hits.push(row);
      }
    }
    await ctx.close();
    console.log(look + "/" + w + " done (" + hits.length + " hits so far)");
  }
  await br.close(); if (server) server.close();
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ src: SRC, widths: WIDTHS, looks: LOOKS, stats, hits }, null, 1));
  console.log(`${stats.pages} page views, ${stats.elements} text elements, ${stats.candidates} candidates, ${hits.length} verified hits`);
  for (const h of hits) console.log(`${h.page} | ${h.look} | ${h.width} | ${h.element} | ${h.kind === "overlap" ? "into " + h.other + ": box " + h.intoBoxPx + "px (w " + h.intoBoxW + "), ink " + h.intoInkPx + "px" : "clipped by " + h.other + ": " + h.clippedH + "px tall x " + h.clippedW + "px wide"}`);
})();
