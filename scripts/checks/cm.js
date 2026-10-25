// S8 contrast in all 20 combinations (style x palette x mode), 390px: pill second line, locked day numbers, static
// word chips. Background = pixels under the text with the text hidden (glass, blobs and all); text = computed colour
// with the element's opacity chain, composited over that background. Ratio uses the background's mean colour.
const pw = require("playwright");
const { PNG } = require("playwright-core/lib/utilsBundle");
const { serve } = require("./lib.js");
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const L = (r) => 0.2126 * lin(r[0]) + 0.7152 * lin(r[1]) + 0.0722 * lin(r[2]);
const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
(async () => {
  const { server, base } = await serve(); const br = await pw.chromium.launch(); const rows = []; const fails = [];
  const W = +(process.argv[2] || 390);
  for (const style of ["glass", "shade"]) for (const pal of ["def", "lav", "sun", "neo", "min"]) for (const mode of ["light", "dark"]) {
    const ctx = await br.newContext({ viewport: { width: W, height: 900 }, deviceScaleFactor: 2 });
    await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-prog", JSON.stringify({ done: [1] })); }, { style, mode, pal, gl: 3, gv: 2, snd: false, cm: true });
    const p = await ctx.newPage(); await p.goto(base + "/", { waitUntil: "load" }); await p.waitForSelector("#app h1"); await p.evaluate(() => document.fonts.ready);
    const targets = [["#/word/80-0", ".cw .pnb .ps", "pill line"], ["#/surah/80", ".cw a.pnb .ps", "pill line"], ["#/challenge", ".cg .dy.lk", "locked day"], ["/word/abasa-28.html", ".chips .chip", "static chip"], ["/word/abasa-28.html", ".cw a.pnb .ps", "pill line (static)"]];
    for (const [where, sel, kind] of targets) {
      if (where.startsWith("#")) { if (!p.url().includes("127.0.0.1") || p.url().includes(".html")) { await p.goto(base + "/", { waitUntil: "load" }); await p.waitForSelector("#app h1"); } await p.evaluate((h) => { location.hash = h; }, where); await p.waitForTimeout(250); }
      else { await p.goto(base + where, { waitUntil: "load" }); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(200); }
      await p.mouse.move(0, 0);
      const n = await p.evaluate((sel) => document.querySelectorAll(sel).length, sel);
      let worst = null;
      for (let i = 0; i < Math.min(n, 4); i++) {
        const info = await p.evaluate(({ sel, i }) => {
          const e = document.querySelectorAll(sel)[i]; e.scrollIntoView({ block: "center" });
          const t = [...e.childNodes].find((x) => x.nodeType === 3 && x.textContent.trim()); if (!t) return null;
          const r = document.createRange(); r.selectNodeContents(t); const b = r.getBoundingClientRect();
          let op = 1; for (let x = e; x; x = x.parentElement) op *= parseFloat(getComputedStyle(x).opacity);
          const cs0 = getComputedStyle(e).color, nums = cs0.match(/[\d.]+/g).map(Number);
          const c = /^color\(srgb/.test(cs0) ? [nums[0] * 255, nums[1] * 255, nums[2] * 255].concat(nums.length > 3 ? [nums[3]] : []) : nums;
          return { clip: { x: b.x, y: b.y + 2, width: b.width, height: Math.max(2, b.height - 4) }, color: c, op, fs: parseFloat(getComputedStyle(e).fontSize), fw: +getComputedStyle(e).fontWeight, text: t.textContent.trim() };
        }, { sel, i });
        if (!info) continue;
        await p.addStyleTag({ content: sel + "{color:transparent!important}" });
        const png = PNG.sync.read(await p.screenshot({ clip: info.clip }));
        await p.evaluate(() => { const s = [...document.querySelectorAll("style")].pop(); s.remove(); });
        let sum = [0, 0, 0], k = 0; for (let j = 0; j < png.data.length; j += 4) { sum[0] += png.data[j]; sum[1] += png.data[j + 1]; sum[2] += png.data[j + 2]; k++; }
        const bg = sum.map((v) => v / k), a = (info.color[3] === undefined ? 1 : info.color[3]) * info.op;
        const fg = [0, 1, 2].map((j) => info.color[j] * a + bg[j] * (1 - a));
        const cr = ratio(fg, bg);
        if (!worst || cr < worst.cr) worst = { cr, text: info.text, fs: info.fs };
      }
      if (!worst) continue;
      const tag = `${style}/${pal}/${mode}`; rows.push({ tag, kind, where, cr: +worst.cr.toFixed(2), fs: worst.fs });
      if (worst.cr < 4.5) fails.push(`${tag} ${kind} ${where} ${worst.cr.toFixed(2)} «${worst.text}» ${worst.fs}px`);
    }
    await ctx.close();
  }
  const byKind = {}; for (const r of rows) { byKind[r.kind] = byKind[r.kind] || []; byKind[r.kind].push(r.cr); }
  for (const [k, v] of Object.entries(byKind)) console.log(k.padEnd(20), "n", v.length, "min", Math.min(...v).toFixed(2), "max", Math.max(...v).toFixed(2));
  console.log("contrast checks", rows.length, fails.length ? "FAIL (" + fails.length + ")\n" + fails.join("\n") : "ALL PASS");
  require("fs").writeFileSync(__dirname + "/cm.json", JSON.stringify(rows, null, 1));
  await br.close(); server.close();
})();
