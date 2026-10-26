// Glass sample (read-only): the sample card in the settings sheet must look like the site. For each palette/mode/width
// and glass strength 0, 50 and 100 (and once in shade), the sample card's average surface colour (its contents hidden,
// edges left out) is compared with the same-size centre patch of the real card it is aligned to on the home page (the first
// visible .card.g, contents hidden too), with motion off so the glows hold still. Pass: CIEDE2000 < 3. The whole real card's average is
// printed too, for reference.
// Usage: node glass-sample.js   -> OUT (default ./out/glass-sample): glass-sample.json and screenshots
const fs = require("fs");
const path = require("path");
const { chromium, serve, context } = require("./lib.js");
const OUT = process.env.OUT || path.join(__dirname, "out", "glass-sample");
fs.mkdirSync(OUT, { recursive: true });
const src = fs.readFileSync(path.join(__dirname, "palettes.js"), "utf8");
const { de2000 } = new Function(src.slice(src.indexOf("const lin ="), src.indexOf("const hue =")) + ";return { de2000 };")();
const hex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

(async () => {
  const { server, base } = await serve();
  const br = await chromium.launch();
  const ana = await br.newPage();
  const mean = (png) => ana.evaluate(async (a) => {
    const i = await new Promise((r) => { const im = new Image(); im.onload = () => r(im); im.src = "data:image/png;base64," + a; });
    const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const x = c.getContext("2d"); x.drawImage(i, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data; let r = 0, g = 0, b = 0, n = 0;
    for (let k = 0; k < d.length; k += 4) { r += d[k]; g += d[k + 1]; b += d[k + 2]; n++; }
    return [r / n, g / n, b / n];
  }, png.toString("base64"));
  const rows = [], fails = [];
  const cases = [];
  for (const w of [390, 1440]) for (const pal of ["gold", "neo"]) for (const mode of ["light", "dark"]) {
    for (const v of [0, 50, 100]) cases.push({ w, pal, mode, style: "glass", v });
    cases.push({ w, pal, mode, style: "shade", v: null });
  }
  for (const c of cases) {
    const ctx = await context(br, { style: c.style, mode: c.mode, pal: c.pal, w: c.w });
    await ctx.addInitScript(() => { const s = JSON.parse(localStorage.getItem("gq-set")); s.cm = true; localStorage.setItem("gq-set", JSON.stringify(s)); });
    const p = await ctx.newPage();
    await p.goto(base + "/#/"); await p.waitForSelector("#app .card.g"); await p.waitForTimeout(700);
    await p.click("#gear"); await p.waitForSelector("#sh.open .gsm .gsc"); await p.waitForTimeout(300);
    if (c.v !== null) await p.evaluate((v) => { const s = document.getElementById("gs"); s.value = v; s.dispatchEvent(new Event("input", { bubbles: true })); s.dispatchEvent(new Event("change", { bubbles: true })); }, c.v);
    await p.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await p.addStyleTag({ content: "#app .card.g *,#sh .gsc *{visibility:hidden!important}" });
    await p.waitForTimeout(250);
    const sc = await p.evaluate(() => { const r = document.querySelector("#sh .gsc").getBoundingClientRect(); return { x: r.left + 4, y: r.top + 4, width: r.width - 8, height: r.height - 8 }; });
    if (c.v === 50 || c.style === "shade") await p.screenshot({ path: path.join(OUT, `sheet-${c.w}-${c.pal}-${c.mode}-${c.style}${c.v === null ? "" : "-" + c.v}.png`) });
    const sMean = await mean(await p.screenshot({ clip: sc }));
    // the real card, with the sheet closed (same settings, same page, motion off)
    await p.keyboard.press("Escape"); await p.waitForTimeout(300);
    const ref = await p.evaluate(() => { const e = [...document.querySelectorAll("#app .card.g")].find((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight; }); const r = e.getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
    const cx = ref.left + ref.width / 2, cy = ref.top + ref.height / 2;
    const patch = { x: cx - sc.width / 2, y: cy - sc.height / 2, width: sc.width, height: sc.height };
    const rMean = await mean(await p.screenshot({ clip: patch }));
    const wMean = await mean(await p.screenshot({ clip: { x: ref.left + 4, y: ref.top + 4, width: ref.width - 8, height: ref.height - 8 } }));
    const d = de2000(sMean.map(Math.round), rMean.map(Math.round)), dw = de2000(sMean.map(Math.round), wMean.map(Math.round));
    const row = { ...c, sample: hex(sMean), realPatch: hex(rMean), realWhole: hex(wMean), dE: +d.toFixed(2), dEwhole: +dw.toFixed(2) };
    rows.push(row);
    if (!(d < 3)) fails.push(`${c.w} ${c.pal} ${c.mode} ${c.style} ${c.v ?? ""}: sample ${row.sample} vs real ${row.realPatch} dE ${row.dE}`);
    console.log(`  ${c.w}px ${c.pal} ${c.mode} ${c.style}${c.v === null ? "" : " " + c.v}: sample ${row.sample} real ${row.realPatch} dE ${row.dE} (whole card ${row.realWhole}, dE ${row.dEwhole})`);
    await ctx.close();
  }
  fs.writeFileSync(path.join(OUT, "glass-sample.json"), JSON.stringify(rows, null, 1));
  console.log(`max dE ${Math.max(...rows.map((r) => r.dE)).toFixed(2)} over ${rows.length} cases`);
  console.log(fails.length ? "FAILURES:\n" + fails.join("\n") : "ALL GLASS SAMPLE CHECKS PASSED");
  await br.close(); server.close();
  process.exit(fails.length ? 1 : 0);
})();
