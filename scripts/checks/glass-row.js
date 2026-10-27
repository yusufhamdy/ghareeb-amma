// The glass-strength row in the settings sheet (.gsx > .gsi > .gsw > .gs.g): no hard-edged rectangle around the pill.
//   node glass-row.js [publicRoot] [outDir]
// For every palette x light/dark x strength (0, 50, 100) x width (390, 768, 1440), in glass:
//   - at rest the row does not clip (.gsi overflow visible), and the row looks exactly as it does with nothing clipped:
//     a screenshot of the row (with 40px around it) against one taken with .gsi forced to overflow: visible differs in
//     no pixel by more than 8 levels (the old clip cut the pill's shadow and glass into a hard-edged rectangle);
//   - a screenshot of the row (outDir/<palette>-<mode>-<strength>-<width>.png).
// Then, at 390 in gold light: switching to shade collapses the row with the clip on (heights fall frame by frame,
// overflow hidden), switching back expands it clipped and ends unclipped; with motion off it switches at once and
// rests unclipped; in shade the row is closed, inert and clipped.
const { serve } = require("./lib.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const ROOT = process.argv[2] || path.resolve(__dirname, "../../public");
const OUT = process.argv[3] || path.join(__dirname, "out/kfgqpc/glass-row");
const PALS = ["gold", "def", "lav", "sun", "neo"], MODES = ["light", "dark"], GLS = [0, 50, 100], WIDTHS = [390, 768, 1440];

async function openSheet(br, base, s, w) {
  const ctx = await br.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2 });
  await ctx.addInitScript((x) => { localStorage.setItem("gq-set", JSON.stringify(x)); localStorage.setItem("gq-ld", "1"); }, s);
  const p = await ctx.newPage();
  await p.goto(base + "/#/"); await p.waitForTimeout(600);
  await p.click("#gear"); await p.waitForTimeout(900);
  return { ctx, p };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, base } = await serve(ROOT);
  const br = await chromium.launch();
  const fails = [], steps = [];
  for (const pal of PALS) for (const mode of MODES) for (const gl of GLS) for (const w of WIDTHS) {
    const tag = `${pal}-${mode}-${gl}-${w}`;
    const { ctx, p } = await openSheet(br, base, { style: "glass", mode, pal, gl, gv: 3, cm: false, snd: false }, w);
    const box = await p.evaluate(() => { const g = document.querySelector("#sh .gsi"); g.scrollIntoView({ block: "center" }); const r = g.getBoundingClientRect(), pr = document.querySelector("#sh .gs").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, pill: { x: pr.left, y: pr.top, w: pr.width, h: pr.height }, ov: getComputedStyle(g).overflow, rest: document.querySelector("#sh .gsx").classList.contains("rest") }; });
    await p.waitForTimeout(250);
    const b = await p.evaluate(() => { const r = document.querySelector("#sh .gsi").getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
    if (box.ov !== "visible" || !box.rest) fails.push(tag + ": at rest the row clips (" + box.ov + ")");
    const pad = 40, clip = { x: Math.max(0, b.x - pad), y: Math.max(0, b.y - pad), width: b.w + 2 * pad, height: b.h + 2 * pad };
    const png = await p.screenshot({ clip });
    fs.writeFileSync(path.join(OUT, tag + ".png"), png);
    // the same clip with nothing clipped
    await p.addStyleTag({ content: "#sh .gsi{overflow:visible!important}" });
    await p.waitForTimeout(150);
    const ref = await p.screenshot({ clip });
    const step = await p.evaluate(async ([s1, s2]) => {
      const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + s; });
      const [a, b] = await Promise.all([load(s1), load(s2)]);
      const c = document.createElement("canvas"); c.width = a.width; c.height = a.height; const x = c.getContext("2d");
      x.drawImage(a, 0, 0); const da = x.getImageData(0, 0, c.width, c.height).data;
      x.clearRect(0, 0, c.width, c.height); x.drawImage(b, 0, 0); const db = x.getImageData(0, 0, c.width, c.height).data;
      let n = 0, worst = 0;
      for (let i = 0; i < da.length; i += 4) { const d = Math.max(Math.abs(da[i] - db[i]), Math.abs(da[i + 1] - db[i + 1]), Math.abs(da[i + 2] - db[i + 2])); if (d > 8) n++; if (d > worst) worst = d; }
      return { n, worst };
    }, [png.toString("base64"), ref.toString("base64")]);
    steps.push({ tag, step });
    if (step.n > 0) fails.push(tag + ": the row is cut at rest (" + step.n + " pixels differ from the unclipped row, up to " + step.worst + " levels)");
    await ctx.close();
  }
  // motion: collapse and expand stay animated and clipped; motion off; shade
  {
    const { ctx, p } = await openSheet(br, base, { style: "glass", mode: "light", pal: "gold", gl: 50, gv: 3, cm: false, snd: false }, 390);
    const sample = (to) => p.evaluate(async (to) => {
      document.querySelector('#sh [data-st="' + to + '"]').click();
      const out = [];
      for (let i = 0; i < 14; i++) { await new Promise((r) => requestAnimationFrame(r)); const g = document.querySelector("#sh .gsx"), inr = document.querySelector("#sh .gsi"); out.push({ h: Math.round(g.getBoundingClientRect().height * 10) / 10, ov: getComputedStyle(inr).overflow, rest: g.classList.contains("rest") }); }
      await new Promise((r) => setTimeout(r, 450));
      const g = document.querySelector("#sh .gsx");
      return { frames: out, end: { h: Math.round(g.getBoundingClientRect().height), ov: getComputedStyle(document.querySelector("#sh .gsi")).overflow, rest: g.classList.contains("rest"), inert: g.inert } };
    }, to);
    const toShade = await sample("shade");
    const mid = toShade.frames.filter((f) => f.h > 0 && f.h < 80);
    if (mid.length < 3) fails.push("collapse: not animated (" + JSON.stringify(toShade.frames.map((f) => f.h)) + ")");
    if (toShade.frames.some((f) => f.ov !== "hidden")) fails.push("collapse: the row is not clipped while it closes");
    if (!(toShade.end.h === 0 && toShade.end.inert && toShade.end.ov === "hidden")) fails.push("shade: the row is not closed, inert and clipped " + JSON.stringify(toShade.end));
    const toGlass = await sample("glass");
    const mid2 = toGlass.frames.filter((f) => f.h > 0 && f.h < 80);
    if (mid2.length < 3) fails.push("expand: not animated (" + JSON.stringify(toGlass.frames.map((f) => f.h)) + ")");
    if (toGlass.frames.filter((f) => f.h < 80).some((f) => f.ov !== "hidden")) fails.push("expand: the row is not clipped while it opens");
    if (!(toGlass.end.rest && toGlass.end.ov === "visible")) fails.push("expand: the row does not rest unclipped " + JSON.stringify(toGlass.end));
    console.log("collapse heights:", toShade.frames.map((f) => f.h).join(" "), "| expand:", toGlass.frames.map((f) => f.h).join(" "));
    await ctx.close();
  }
  {
    const { ctx, p } = await openSheet(br, base, { style: "glass", mode: "dark", pal: "gold", gl: 50, gv: 3, cm: true, snd: false }, 390);
    const r = await p.evaluate(async () => {
      const pick = (v) => document.querySelector('#sh [data-st="' + v + '"]');
      pick("shade").click(); await new Promise((r) => requestAnimationFrame(r));
      const a = { h: Math.round(document.querySelector("#sh .gsx").getBoundingClientRect().height) };
      pick("glass").click(); await new Promise((r) => requestAnimationFrame(r)); await new Promise((r) => requestAnimationFrame(r));
      const g = document.querySelector("#sh .gsx");
      return { afterShade: a.h, afterGlass: Math.round(g.getBoundingClientRect().height), rest: g.classList.contains("rest"), ov: getComputedStyle(document.querySelector("#sh .gsi")).overflow };
    });
    if (!(r.afterShade === 0 && r.afterGlass > 60 && r.rest && r.ov === "visible")) fails.push("motion off: not immediate or not unclipped " + JSON.stringify(r));
    console.log("motion off:", JSON.stringify(r));
    await ctx.close();
  }
  await br.close(); server.close();
  const worst = steps.reduce((a, s) => (s.step.n > a.step.n ? s : a), { step: { n: -1 } });
  console.log(steps.length + " combinations; most pixels differing from the unclipped row: " + worst.step.n + " (" + worst.tag + ")");
  fs.writeFileSync(path.join(OUT, "steps.json"), JSON.stringify(steps, null, 1));
  if (fails.length) { console.log(fails.length + " FAILURES"); fails.slice(0, 40).forEach((f) => console.log("  " + f)); process.exitCode = 1; }
  else console.log("ALL CHECKS PASSED");
})();
