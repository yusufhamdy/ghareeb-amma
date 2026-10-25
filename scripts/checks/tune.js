// For glass combos: per element, background with the glow (a=0) and without it (a=1); find the smallest veil per mode.
const L = require("./lib.js"); const { PAGES } = require("./contrast.js"); const fs = require("fs");
const HIDE = "[data-hide],[data-hide] *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}[data-hide] svg{visibility:hidden!important}[data-hide]::placeholder{color:transparent!important}";
const lum = (c) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
const ratio = (t, b) => { const a = lum(t), c = lum(b); return (Math.max(a, c) + .05) / (Math.min(a, c) + .05); };
(async () => {
  const { server, base } = await L.serve(); const br = await L.chromium.launch(); const A = await L.analyzer(br);
  const rows = [];
  for (const c of L.combos().filter((c) => c.style === "glass")) {
    for (const hideGlow of [false, true]) {
      const ctx = await L.context(br, c, { prog: { done: [1] } }); const p = await ctx.newPage();
      for (const [url, setup, els] of PAGES) {
        await p.goto("about:blank"); await p.goto(base + url, { waitUntil: "load" }); await p.waitForTimeout(450);
        if (setup) { try { await setup(p); } catch (e) {} }
        await p.addStyleTag({ content: "*,*:before,*:after{transition:none!important;animation:none!important;caret-color:transparent!important}" + HIDE + (hideGlow ? "#bg i{visibility:hidden!important}" : "") });
        await p.mouse.move(1, 1);
        for (const [name, sel, mode] of els) {
          const h = await p.$(sel); if (!h) continue;
          const info = await h.evaluate((e, ph) => { e.scrollIntoView({ block: "center" }); const s = getComputedStyle(e); const col = ph ? getComputedStyle(e, "::placeholder").color : s.color;
            const cv = document.createElement("canvas").getContext("2d"); cv.fillStyle = "#000"; cv.fillStyle = col; cv.fillRect(0, 0, 1, 1); const px = cv.getImageData(0, 0, 1, 1).data;
            let op = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) op *= +getComputedStyle(n).opacity;
            return { fs: parseFloat(s.fontSize), fw: +s.fontWeight, rgb: [px[0], px[1], px[2]], a: (px[3] / 255) * op }; }, mode === "ph");
          if (url === "/#/" && !setup) await p.evaluate(() => document.getElementById("nv").classList.remove("hide"));
          await p.waitForTimeout(40);
          const b = await h.boundingBox(); if (!b || b.width < 2) continue;
          const clip = { x: Math.max(0, b.x), y: Math.max(0, b.y), width: Math.min(b.width, c.w - Math.max(0, b.x)), height: b.height };
          if (mode === "ph") await p.$eval(sel, (e) => { e.value = ""; });
          await h.evaluate((e) => e.setAttribute("data-hide", "")); const bg = await A.medianRGB(await p.screenshot({ clip })); await h.evaluate((e) => e.removeAttribute("data-hide"));
          const key = c.tag + "|" + name; let r = rows.find((x) => x.key === key);
          if (!r) rows.push(r = { key, tag: c.tag, mode: c.mode, name, large: info.fs >= 24 || (info.fs >= 18.66 && info.fw >= 700), info });
          r[hideGlow ? "bg1" : "bg0"] = bg;
        }
      }
      await ctx.close(); process.stdout.write(".");
    }
  }
  await br.close(); server.close();
  fs.writeFileSync("tune.json", JSON.stringify(rows));
  const at = (r, a) => { const bg = r.bg0.map((v, i) => v * (1 - a) + r.bg1[i] * a); const t = r.info.rgb.map((v, i) => v * r.info.a + bg[i] * (1 - r.info.a)); return ratio(t, bg); };
  for (const mode of ["light", "dark"]) {
    const rs = rows.filter((r) => r.mode === mode && r.bg0 && r.bg1);
    const need = (r) => (r.large ? 3 : 4.5);
    const hopeless = rs.filter((r) => at(r, 1) < need(r));
    let best = null;
    for (let a = 0; a <= 1.0001; a += 0.01) { if (rs.filter((r) => !hopeless.includes(r)).every((r) => at(r, a) >= need(r) + 0.08)) { best = +a.toFixed(2); break; } }
    console.log(`\n${mode}: smallest veil with all fixable elements >= AA (+0.08 margin): ${best}`);
    const lim = rs.filter((r) => !hopeless.includes(r)).map((r) => ({ r, a: (() => { for (let a = 0; a <= 1.0001; a += 0.01) if (at(r, a) >= need(r) + 0.08) return +a.toFixed(2); return 9; })() })).sort((x, y) => y.a - x.a).slice(0, 8);
    lim.forEach((x) => console.log("   needs", x.a, x.r.key, "now", at(x.r, 0).toFixed(2), "no-glow", at(x.r, 1).toFixed(2)));
    hopeless.forEach((r) => console.log("   NOT FIXABLE BY GLOW:", r.key, "no-glow", at(r, 1).toFixed(2)));
  }
})();
