// The nav indicator's own layer during a drag (will-change: transform, ?nav=new, preview-only) against the nav as it is
// (default) at rest and mid-drag, glass and shade, light and dark, 390px, compared pixel by
// pixel. Mid-drag: a real touch drag from the home tab to between the 2nd and 3rd tabs, held still 600ms (the stretch
// settles), then the shot - the finger is still down.
//   node nav-identity.js [root] [outDir]
const { serve } = require("./lib.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const ROOT = process.argv[2] || path.resolve(__dirname, "../../public");
const OUT = process.argv[3] || path.join(__dirname, "out/nav-identity");
const LOOKS = [["glass", "light"], ["glass", "dark"], ["shade", "light"], ["shade", "dark"]];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { server, base } = await serve(ROOT);
  const br = await chromium.launch();
  const shot = async (style, mode, nav, state) => {
    const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: "no-preference" });
    await ctx.addInitScript((s) => { localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-set", JSON.stringify(s)); }, { style, mode, pal: "neo", gl: 50, gv: 3, sv: 2, cm: false, snd: false });
    const p = await ctx.newPage();
    await p.goto(base + "/" + (nav === "new" ? "?nav=new" : "") + "#/", { waitUntil: "load" });
    await p.waitForSelector("#nv a.t"); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(1500);
    // the page's own background blobs drift: stop them so two shots differ only by the nav
    await p.addStyleTag({ content: "#bg i{animation:none!important}" });
    const info = { wc: "" };
    const cdp = await ctx.newCDPSession(p);
    const tabs = await p.$$eval("#nv a.t", (as) => as.map((a) => { const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }));
    if (state === "drag") {
      const y = tabs[0].y, from = tabs[0].x, to = (tabs[1].x + tabs[2].x) / 2;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y, id: 1 }] });
      for (let i = 1; i <= 20; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from + ((to - from) * i) / 20, y, id: 1 }] }); await p.waitForTimeout(16); }
      await p.waitForTimeout(600);
    }
    info.wc = await p.$eval("#nv .ind", (e) => getComputedStyle(e).willChange);
    const nb = await p.$eval("#nv", (n) => { const r = n.getBoundingClientRect(); return { x: r.left - 24, y: r.top - 24, width: r.width + 48, height: r.height + 48 }; });
    const file = path.join(OUT, `${style}-${mode}-${state}-nav-${nav}.png`);
    await p.screenshot({ path: file, clip: nb });
    if (state === "drag") await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await ctx.close();
    return { file, info };
  };
  const cmp = await br.newPage();
  const diff = (a, b) => cmp.evaluate(async ([a, b]) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + s; });
    const [x, y] = await Promise.all([load(a), load(b)]);
    if (x.width !== y.width || x.height !== y.height) return { size: true };
    const c = document.createElement("canvas"); c.width = x.width; c.height = x.height; const g = c.getContext("2d");
    g.drawImage(x, 0, 0); const d1 = g.getImageData(0, 0, c.width, c.height).data; g.drawImage(y, 0, 0); const d2 = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0, max = 0; for (let i = 0; i < d1.length; i += 4) { const d = Math.max(Math.abs(d1[i] - d2[i]), Math.abs(d1[i + 1] - d2[i + 1]), Math.abs(d1[i + 2] - d2[i + 2])); if (d > 0) n++; if (d > max) max = d; }
    return { px: c.width * c.height, diff: n, maxDelta: max };
  }, [fs.readFileSync(a).toString("base64"), fs.readFileSync(b).toString("base64")]);
  let bad = 0;
  for (const [style, mode] of LOOKS) for (const state of ["rest", "drag"]) {
    const o = await shot(style, mode, "old", state), n = await shot(style, mode, process.env.SELF ? "old" : "new", state);
    const d = await diff(o.file, n.file);
    const ok = !d.size && d.diff === 0;
    if (!ok) bad++;
    console.log(`${ok ? "identical" : "DIFFERENT"}  ${style}-${mode} ${state}: ${d.size ? "size differs" : d.diff + " of " + d.px + " pixels differ (max channel delta " + d.maxDelta + ")"}  [old: will-change ${o.info.wc}; new: will-change ${n.info.wc}]`);
  }
  await br.close(); server.close();
  console.log(bad ? bad + " DIFFERENT" : "ALL IDENTICAL");
})();
