// Palette audit (read-only): for each of the 5 palettes in light and dark, glass and shade, the colours the page really
// shows, measured from pixels (median of a region, text made transparent) or from the element that carries them:
//   bg        the page background (computed body background)
//   accent    the logo colour (the accent element both styles show)
//   button    the primary button fill (accent in glass, ink in shade)
//   glow1/2   the two background glows, sampled at their centres with the content hidden
//   card      the first card's surface on the home page
//   highlight an ayah highlight (mark), on a word page
//   swatch    the palette's circle in the settings sheet (median of its centre, plus its fill and ring colours)
// Then CIEDE2000 between every pair of palettes per mode and style, swatch-vs-applied differences, and one comparison
// image (5 palettes in columns; light/dark x glass/shade in rows; home page top with the swatch beside it).
// Usage: node palettes.js            -> OUT (default ./out/palettes): palettes.json, palettes-compare.png
const fs = require("fs");
const path = require("path");
const { chromium, serve, context, PALS } = require("./lib.js");
const OUT = process.env.OUT || path.join(__dirname, "out", "palettes");
fs.mkdirSync(OUT, { recursive: true });

// ---- colour maths: sRGB (D65) -> Lab, CIEDE2000, LCh hue
const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
function lab([r, g, b]) {
  const R = lin(r), G = lin(g), B = lin(b);
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, Y = R * 0.2126 + G * 0.7152 + B * 0.0722, Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
function de2000(c1, c2) {
  const [L1, a1, b1] = lab(c1), [L2, a2, b2] = lab(c2), rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2, G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2, C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (a, b) => { if (!a && !b) return 0; const x = Math.atan2(b, a) / rad; return x < 0 ? x + 360 : x; };
  const h1p = h(a1p, b1), h2p = h(a2p, b2), dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0; if (C1p * C2p) { dhp = h2p - h1p; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad), Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p; if (C1p * C2p) { if (Math.abs(h1p - h2p) > 180) hbp += h1p + h2p < 360 ? 360 : -360; hbp /= 2; }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) + 0.32 * Math.cos((3 * hbp + 6) * rad) - 0.2 * Math.cos((4 * hbp - 63) * rad);
  const dth = 30 * Math.exp(-(((hbp - 275) / 25) ** 2)), Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2), Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T, Rt = -Math.sin(2 * dth * rad) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}
const hue = (c) => { const [, a, b] = lab(c); const x = Math.atan2(b, a) * 180 / Math.PI; return x < 0 ? x + 360 : x; };
const chroma = (c) => { const [, a, b] = lab(c); return Math.hypot(a, b); };
const hueDiff = (x, y) => { const d = Math.abs(hue(x) - hue(y)) % 360; return d > 180 ? 360 - d : d; };
const hex = (c) => "#" + c.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
const parseRGB = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map((v) => Math.round(+v));
const HUES = [[0, "red"], [30, "orange"], [65, "yellow"], [110, "yellow-green"], [150, "green"], [190, "teal"], [235, "cyan-blue"], [275, "blue"], [305, "violet"], [335, "magenta"], [360, "red"]];
const hueName = (c) => { if (chroma(c) < 10) return "neutral"; const h = hue(c); for (let i = HUES.length - 1; i >= 0; i--) if (h >= HUES[i][0]) return HUES[i][1]; return "red"; };

(async () => {
  const { server, base } = await serve();
  const br = await chromium.launch();
  const median = async (p, png) => p.evaluate(async (a) => {
    const i = await new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = "data:image/png;base64," + a; });
    const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const x = c.getContext("2d"); x.drawImage(i, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data, R = [], G = [], B = [];
    for (let k = 0; k < d.length; k += 4) { R.push(d[k]); G.push(d[k + 1]); B.push(d[k + 2]); }
    const m = (v) => v.sort((a, b) => a - b)[v.length >> 1]; return [m(R), m(G), m(B)];
  }, png.toString("base64"));
  const ana = await br.newPage();
  const res = {}, tiles = {};
  for (const style of ["glass", "shade"]) for (const mode of ["light", "dark"]) for (const pal of PALS) {
    const id = `${mode}/${style}/${pal}`;
    const ctx = await context(br, { style, mode, pal, w: 390 });
    await ctx.addInitScript(() => { const s = JSON.parse(localStorage.getItem("gq-set")); s.cm = true; localStorage.setItem("gq-set", JSON.stringify(s)); });
    const p = await ctx.newPage();
    await p.goto(base + "/#/"); await p.waitForSelector("#app .card, #app .g", { timeout: 20000 }); await p.waitForTimeout(900);
    tiles[id] = await p.screenshot({ clip: { x: 0, y: 0, width: 390, height: 560 } });
    const r = {};
    r.bg = parseRGB(await p.evaluate(() => getComputedStyle(document.body).backgroundColor));
    // accent: the logo's colour (the one accent element both styles show; shade draws its buttons in ink, so a button
    // would compare ink with ink); the primary button's fill is kept separately as "button"
    const acc = await p.evaluate(() => { const l = document.querySelector("#app .logo"), b = [...document.querySelectorAll("#app .btn:not(.o)")].find((e) => e.getClientRects().length); return [l ? getComputedStyle(l).color : "", b ? getComputedStyle(b).backgroundColor : ""]; });
    r.accentFrom = "logo"; r.accent = parseRGB(acc[0]); r.button = parseRGB(acc[1]);
    // glows: content hidden, median around each glow's visible centre
    const glowRects = await p.evaluate(() => [...document.querySelectorAll("#bg i")].slice(0, 2).map((e) => { const r = e.getBoundingClientRect(); const cx = Math.min(Math.max(r.left + r.width / 2, 20), innerWidth - 20), cy = Math.min(Math.max(r.top + r.height / 2, 20), innerHeight - 20); return { x: cx - 20, y: cy - 20, width: 40, height: 40 }; }));
    await p.addStyleTag({ content: "#app,#gear,nav,#ld,.toast{visibility:hidden!important}" });
    await p.waitForTimeout(200);
    for (let i = 0; i < 2; i++) r["glow" + (i + 1)] = glowRects[i] ? await median(ana, await p.screenshot({ clip: glowRects[i] })) : null;
    await p.addStyleTag({ content: "#app,#gear,nav{visibility:visible!important}#app *{color:transparent!important;text-shadow:none!important}#app svg,#app img{visibility:hidden!important}" });
    await p.waitForTimeout(200);
    const card = await p.evaluate(() => { const e = [...document.querySelectorAll("#app .card")].find((x) => { const r = x.getBoundingClientRect(); return r.width > 150 && r.height > 60 && r.top < innerHeight - 60; }); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + 12, y: Math.max(r.top, 0) + 12, width: Math.min(r.width - 24, 200), height: Math.min(r.height - 24, 60) }; });
    r.card = card ? await median(ana, await p.screenshot({ clip: card })) : null;
    // highlight on a word page (text transparent: the median inside the mark is the highlight over the card)
    await p.goto(base + "/#/word/79-3"); await p.waitForSelector("#app mark", { timeout: 20000 }); await p.waitForTimeout(700);
    await p.addStyleTag({ content: "#app *{color:transparent!important;text-shadow:none!important}" }); await p.waitForTimeout(150);
    const mk = await p.evaluate(() => { const m = document.querySelector("#app mark"); m.scrollIntoView({ block: "center" }); const r = m.getBoundingClientRect(); return { x: r.left + 4, y: r.top + r.height * 0.3, width: Math.max(4, r.width - 8), height: Math.max(4, r.height * 0.4) }; });
    await p.waitForTimeout(150);
    r.highlight = await median(ana, await p.screenshot({ clip: mk }));
    // swatches as the settings sheet draws them in this mode
    await p.goto(base + "/#/"); await p.waitForSelector("#gear"); await p.click("#gear"); await p.waitForSelector('#sh.open .psw button[data-p]'); await p.waitForTimeout(300);
    r.swatches = {};
    for (const k of PALS) {
      const el = p.locator(`#sh .psw button[data-p="${k}"] i`);
      const bb = await el.boundingBox(), shot = await p.screenshot({ clip: { x: bb.x + bb.width * 0.2, y: bb.y + bb.height * 0.2, width: bb.width * 0.6, height: bb.height * 0.6 } });
      r.swatches[k] = { median: await median(ana, shot), ...(await el.evaluate((e) => ({ fill: getComputedStyle(e).backgroundColor, ring: getComputedStyle(e).borderTopColor }))) };
    }
    if (mode === "light" && style === "glass") tiles["sheet/" + pal] = await p.screenshot({ clip: await p.locator("#sh .p").boundingBox() });
    res[id] = r;
    console.log(`  ${id}: bg ${hex(r.bg)} accent ${hex(r.accent)} button ${hex(r.button)} glows ${r.glow1 && hex(r.glow1)} ${r.glow2 && hex(r.glow2)} card ${r.card && hex(r.card)} highlight ${hex(r.highlight)}`);
    await ctx.close();
  }
  // ---- pairwise CIEDE2000
  const COMP = ["bg", "accent", "button", "glow1", "glow2", "card", "highlight"];
  const pairs = [];
  for (const mode of ["light", "dark"]) for (const style of ["glass", "shade"]) for (let i = 0; i < PALS.length; i++) for (let j = i + 1; j < PALS.length; j++) {
    const a = res[`${mode}/${style}/${PALS[i]}`], b = res[`${mode}/${style}/${PALS[j]}`], d = {};
    COMP.forEach((k) => { d[k] = a[k] && b[k] ? +de2000(a[k], b[k]).toFixed(1) : null; });
    const overall = +(["accent", "glow1", "glow2", "card", "highlight"].reduce((s, k) => s + (d[k] || 0), 0) / 5).toFixed(1);
    const flags = [];
    if (d.accent < 15) flags.push("accent < 15");
    if (overall < 12) flags.push("overall < 12");
    pairs.push({ mode, style, pair: PALS[i] + "-" + PALS[j], ...d, overall, flags });
  }
  // ---- swatch vs applied (the circle is the same in every mode; compared with the colours each mode applies)
  const swatch = [];
  for (const pal of PALS) for (const mode of ["light", "dark"]) for (const style of ["glass", "shade"]) {
    const r = res[`${mode}/${style}/${pal}`], sw = res[`${mode}/${style}/${pal}`].swatches[pal].median;
    const dA = de2000(sw, r.accent), dG = Math.min(de2000(sw, r.glow1 || sw), de2000(sw, r.glow2 || sw)), hA = hueDiff(sw, r.accent);
    swatch.push({ pal, mode, style, swatch: hex(sw), swatchHue: hueName(sw), accent: hex(r.accent), accentHue: hueName(r.accent), glow1: r.glow1 && hex(r.glow1), glow2: r.glow2 && hex(r.glow2), dAccent: +dA.toFixed(1), hueAccent: Math.round(hA), dNearestGlow: +dG.toFixed(1), mismatch: hA > 45 && chroma(r.accent) > 15 });
  }
  const swSame = PALS.map((k) => ({ pal: k, light: hex(res[`light/glass/${k}`].swatches[k].median), dark: hex(res[`dark/glass/${k}`].swatches[k].median) }));
  fs.writeFileSync(path.join(OUT, "palettes.json"), JSON.stringify({ colours: Object.fromEntries(Object.entries(res).map(([k, v]) => [k, { ...Object.fromEntries(COMP.map((c) => [c, v[c] && hex(v[c])])), accentFrom: v.accentFrom }])), pairs, swatch, swatchSameInBothModes: swSame }, null, 1));

  // ---- comparison image: rows light/dark x glass/shade, columns the 5 palettes
  const rows = [["light", "glass"], ["light", "shade"], ["dark", "glass"], ["dark", "shade"]];
  const cell = (mode, style, pal) => { const r = res[`${mode}/${style}/${pal}`], s = r.swatches[pal]; return `<td><div class="c"><img src="data:image/png;base64,${tiles[`${mode}/${style}/${pal}`].toString("base64")}"><div class="side"><div class="sw" style="background:${s.fill};border:5px solid ${s.ring};box-sizing:border-box"></div><div class="lb">swatch</div>${[["accent", r.accent], ["glow 1", r.glow1], ["glow 2", r.glow2], ["card", r.card], ["highlight", r.highlight]].map(([n, c]) => `<div class="chip" style="background:${c ? hex(c) : "#0000"}"></div><div class="lb">${n}<br>${c ? hex(c) : "-"}</div>`).join("")}</div></div></td>`; };
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#fff;font:12px system-ui;color:#222}table{border-collapse:collapse}td,th{padding:8px;vertical-align:top}th{font-size:16px}.c{display:flex;gap:6px}.c img{width:260px;height:373px;border-radius:10px;box-shadow:0 0 0 1px #ccc}.side{width:70px;display:flex;flex-direction:column;align-items:center;gap:2px}.sw{width:48px;height:48px;border-radius:50%;box-shadow:0 0 0 1px #0002}.chip{width:40px;height:22px;border-radius:6px;box-shadow:0 0 0 1px #0003;margin-top:6px}.lb{font-size:10px;text-align:center;line-height:1.2}.rh{writing-mode:vertical-rl;transform:rotate(180deg);font-size:16px;font-weight:600}</style>
<table><tr><th></th>${PALS.map((k) => `<th>${k}</th>`).join("")}</tr>${rows.map(([m, s]) => `<tr><td class="rh">${m} · ${s}</td>${PALS.map((k) => cell(m, s, k)).join("")}</tr>`).join("")}</table>`;
  const cp = await br.newPage({ viewport: { width: 1900, height: 1000 } });
  await cp.setContent(html); await cp.waitForTimeout(300);
  const img = path.join(OUT, "palettes-compare.png");
  await cp.screenshot({ path: img, fullPage: true });
  const sheets = await br.newPage({ viewport: { width: 1200, height: 600 } });
  await sheets.setContent(`<body style="margin:0;display:flex;gap:8px;background:#fff">${PALS.map((k) => `<img style="width:230px" src="data:image/png;base64,${tiles["sheet/" + k].toString("base64")}">`).join("")}</body>`);
  await sheets.screenshot({ path: path.join(OUT, "palettes-sheet-swatches.png"), fullPage: true });

  console.log("\n== CIEDE2000 between palettes (accent / overall = mean of accent, glows, card, highlight)");
  console.log("pair     | light glass   | light shade   | dark glass    | dark shade");
  for (let i = 0; i < PALS.length; i++) for (let j = i + 1; j < PALS.length; j++) {
    const pr = PALS[i] + "-" + PALS[j];
    console.log(pr.padEnd(9) + "| " + rows.map(([m, s]) => { const x = pairs.find((q) => q.pair === pr && q.mode === m && q.style === s); return (x.accent.toFixed(1) + " / " + x.overall.toFixed(1) + (x.flags.length ? " !" : "")).padEnd(14); }).join("| "));
  }
  console.log("\nflagged:"); pairs.filter((x) => x.flags.length).forEach((x) => console.log(`  ${x.mode} ${x.style} ${x.pair}: ${x.flags.join(", ")} (bg ${x.bg}, accent ${x.accent}, button ${x.button}, glows ${x.glow1}/${x.glow2}, card ${x.card}, highlight ${x.highlight})`));
  console.log("\n== swatch vs applied");
  swatch.forEach((x) => console.log(`  ${x.pal} ${x.mode} ${x.style}: swatch ${x.swatch} (${x.swatchHue}) vs accent ${x.accent} (${x.accentHue}) dE ${x.dAccent}, hue ${x.hueAccent}deg; nearest glow dE ${x.dNearestGlow}${x.mismatch ? "  << MISMATCH" : ""}`));
  console.log("swatch identical in light and dark:", swSame.map((x) => x.pal + " " + (x.light === x.dark ? "same" : x.light + "/" + x.dark)).join(", "));
  console.log("\nimage: " + img);
  await br.close(); server.close();
})();
