// Pixel-measured text contrast across all 40 combinations (read-only).
const L = require("./lib.js"); const fs = require("fs");
const PAGES = [
  ["/#/", null, [["home h1", "#app h1"], ["home subtitle (.sub)", "#app .sub"], ["search placeholder", "#q", "ph"], ["filled btn text", '#app .acts [data-a="rnd"]'], ["outlined btn text", "#app .acts .btn.o"],
    ["social strip text", "#app .strip>span"], ["challenge card muted", "#app a.card .m"], ["nav tab (inactive)", "#nv a.t:not(.on) span"], ["nav tab (active)", "#nv a.t.on span"], ["footer link", "#app .fl a"], ["footer copyright", "#app .ft>.m"], ["logo", "#app .logo"]]],
  ["/#/word/79-3", null, [["pill (surah/ayah)", "#app a.pill"], ["Quran word (.wd)", "#app .wd"], ["ayah text (.ay)", "#app .ay"], ["highlighted word (mark)", "#app .ay mark"], ["meaning label (.m)", "#app .cols .card:last-child>.m:first-child"],
    ["meaning text (.mn)", "#app .mn"], ["source line (.m)", "#app .cols .card:last-child>.m:last-child"], ["prev/next (.pnb)", "#app a.pnb"], ["report link", '#app a.m[href^="mailto"]']]],
  ["/#/surah/78", null, [["row word (.w)", "#app .row .w"], ["row meaning", "#app .row .t>div:first-child"], ["row meta (.m)", "#app .row .t .m"]]],
  ["/#/surahs", null, [["surah number badge", "#app .list.sl .bd"], ["surah row count (.m)", "#app .list.sl .row .m"]]],
  ["/#/challenge", null, [["day dot done", "#app .dy.ok:not(.sw)"], ["day dot today", "#app .dy.cur:not(.sw)"], ["day dot locked", "#app .dy.lk:not(.sw)"], ["legend text", "#app .lg .li"]]],
  ["/#/quiz", async (p) => { await p.click("#app .opt"); }, [["quiz option", "#app .opt:not(.ok):not(.bad)"], ["quiz option correct", "#app .opt.ok"], ["quiz option wrong", "#app .opt.bad"], ["quiz counter (.m)", "#app>div>span.m"]]],
  ["/#/day/2", null, [["day word (.dword)", "#app .dword"], ["day count", "#app .dcount"], ["day h1 'من 30'", "#app .dh h1 .m"]]],
  ["/#/", async (p) => { await p.click("#gear"); await p.waitForTimeout(500); }, [["settings label (.m)", "#sh .m"], ["segmented (unselected)", "#sh .seg button:not(.on)"], ["segmented (selected)", "#sh .seg button.on"], ["palette name", "#sh .sw button:not(.on)"], ["sheet 'تم' button", '#sh [data-a="close"]']]],
  ["/privacy/", null, [["legal paragraph", "main .para"], ["legal home link", "main a.b"]]],
];
module.exports.PAGES = PAGES;
const HIDE = "[data-hide],[data-hide] *{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important}[data-hide] svg{visibility:hidden!important}[data-hide]::placeholder{color:transparent!important}";
if (require.main === module) (async () => {
  const { server, base } = await L.serve(); const br = await L.chromium.launch(); const A = await L.analyzer(br);
  const res = []; const cs = L.combos();
  for (const c of cs) {
    const ctx = await L.context(br, c, { prog: { done: [1] } }); const p = await ctx.newPage();
    for (const [url, setup, els] of PAGES) {
      if (process.env.ONLY && !els.some((e) => e[0] === process.env.ONLY)) continue;
      await p.goto("about:blank"); await p.goto(base + url, { waitUntil: "load" }); await p.waitForTimeout(500);
      if (setup) { try { await setup(p); } catch (e) {} }
      await p.addStyleTag({ content: "*,*:before,*:after{transition:none!important;animation:none!important;caret-color:transparent!important}" + HIDE });
      await p.mouse.move(1, 1);
      for (const [name, sel, mode] of els) {
        if (process.env.ONLY && name !== process.env.ONLY) continue;
        const h = await p.$(sel); if (!h) { res.push({ tag: c.tag, name, ratio: null, note: "missing" }); continue; }
        const info = await h.evaluate((e, ph) => {
          e.scrollIntoView({ block: "center" }); const s = getComputedStyle(e);
          const col = ph ? getComputedStyle(e, "::placeholder").color : s.color;
          const cv = document.createElement("canvas").getContext("2d"); cv.fillStyle = "#000"; cv.fillStyle = col; cv.fillRect(0, 0, 1, 1);
          const px = cv.getImageData(0, 0, 1, 1).data; let op = 1; for (let n = e; n && n.nodeType === 1; n = n.parentElement) op *= +getComputedStyle(n).opacity;
          return { fs: parseFloat(s.fontSize), fw: +s.fontWeight, rgb: [px[0], px[1], px[2]], a: (px[3] / 255) * op };
        }, mode === "ph");
        if (url === "/#/" && !setup) await p.evaluate(() => document.getElementById("nv").classList.remove("hide"));
        await p.waitForTimeout(60);
        const b = await h.boundingBox(); if (!b || b.width < 2) { res.push({ tag: c.tag, name, ratio: null, note: "hidden" }); continue; }
        const clip = { x: Math.max(0, b.x), y: Math.max(0, b.y), width: Math.min(b.width, c.w - Math.max(0, b.x)), height: b.height };
        if (mode === "ph") await p.$eval(sel, (e) => { e.value = ""; });
        const a = await p.screenshot({ clip });
        await h.evaluate((e) => e.setAttribute("data-hide", ""));
        const n = await p.screenshot({ clip });
        await h.evaluate((e) => e.removeAttribute("data-hide"));
        const pix = await A.contrast(a, n);
        const bgc = await A.medianRGB(n);
        const lum = (c) => { const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
        const tc = info.rgb.map((v, i) => v * info.a + bgc[i] * (1 - info.a));
        const l1 = lum(tc), l2 = lum(bgc); const r = +((Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05)).toFixed(2);
        const large = info.fs >= 24 || (info.fs >= 18.66 && info.fw >= 700);
        res.push({ tag: c.tag, name, ratio: r, pix, large, fs: info.fs, bg: bgc });
      }
    }
    await ctx.close(); process.stdout.write(".");
  }
  await br.close(); server.close();
  fs.writeFileSync(process.env.ONLY ? "contrast-only.json" : "contrast.json", JSON.stringify(res, null, 1));
  // summary: per element, min ratio and the failing combos
  const by = {};
  for (const r of res) (by[r.name] ||= []).push(r);
  console.log("");
  for (const [name, arr] of Object.entries(by)) {
    const ok = arr.filter((r) => r.ratio != null); if (!ok.length) { console.log(name, "n/a", arr[0].note); continue; }
    const need = ok[0].large ? 3 : 4.5;
    const min = ok.reduce((m, r) => (r.ratio < m.ratio ? r : m));
    const fails = ok.filter((r) => r.ratio < need);
    const failSet = [...new Set(fails.map((r) => r.tag.replace(/\/(1440|390)$/, "")))];
    console.log(`${name} | ${ok[0].large ? "large" : "normal"} ${ok[0].fs}px | min ${min.ratio} @ ${min.tag} | fails ${fails.length}/${ok.length}${failSet.length ? " : " + failSet.join(" ") : ""}`);
  }
})();
