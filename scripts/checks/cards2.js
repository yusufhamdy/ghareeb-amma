// Generate "حفظ كصورة" PNGs through the real save flow (button -> sheet -> size -> save),
// capturing the browser download. Read-only against public/.
const { chromium, serve, PALS } = (() => { const l = require("./lib.js"); return { chromium: require("playwright").chromium, serve: l.serve, PALS: l.PALS }; })();
const fs = require("fs"), path = require("path");
const OUT = path.join(__dirname, "cards2"); fs.mkdirSync(OUT, { recursive: true });
const WORDS = { short: "سَجَى", long: "الْخُنَّسِ الْجَوَارِ الْكُنَّسِ" };

(async () => {
  const { server, base } = await serve();
  const br = await chromium.launch();
  const meta = [];
  try {
    for (const style of ["glass", "shade"]) for (const pal of PALS) for (const mode of ["light", "dark"]) {
      const ctx = await br.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1, acceptDownloads: true });
      await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); },
        { style, mode, pal, gl: 3, gv: 2, snd: false, cm: true });
      const page = await ctx.newPage();
      const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
      await page.goto(base + "/", { waitUntil: "load" });
      await page.waitForFunction(() => typeof W !== "undefined" && W.length > 0, null, { timeout: 15000 });
      for (const [kind, word] of Object.entries(WORDS)) {
        const id = await page.evaluate((wd) => W.find((w) => w.word === wd).id, word);
        await page.evaluate((id) => { location.hash = "#/word/" + id }, id);
        for (const size of ["n", "s"]) {
          await page.click('#app [data-a="card"]');
          await page.waitForFunction(() => document.querySelectorAll("#sh .artw img").length === 2, null, { timeout: 20000 });
          await page.click(`#sh [data-sc="${size}"]`);
          const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.click('#sh [data-a="savepng"]')]);
          const file = path.join(OUT, `${kind}-${size === "s" ? "story" : "regular"}-${style}-${pal}-${mode}.png`);
          await dl.saveAs(file);

          const buf = fs.readFileSync(file), pw = buf.readUInt32BE(16), ph = buf.readUInt32BE(20);
          const chk = await page.evaluate(([id, size]) => {
            const w = W.find((x) => x.id === id), c = renderCard(w, size), b = c.__card, H = c.height, fails = [];
            const o = document.createElement("canvas"); o.width = c.width; o.height = H; const x = o.getContext("2d"); x.direction = "rtl";
            const ink = (op) => { x.clearRect(0, 0, o.width, H); x.font = op.font; x.textAlign = op.al; x.fillStyle = "#000"; x.fillText(op.t, op.x, op.y);
              const X0 = Math.max(0, Math.floor(op.box.l) - 60), Y0 = Math.max(0, Math.floor(op.box.t) - 60), X1 = Math.min(o.width, Math.ceil(op.box.r) + 60), Y1 = Math.min(H, Math.ceil(op.box.b) + 60);
              const d = x.getImageData(X0, Y0, X1 - X0, Y1 - Y0).data, ww = X1 - X0; let l = 1e9, r = -1, t = 1e9, bb = -1;
              for (let i = 3; i < d.length; i += 4) if (d[i] > 8) { const p = (i - 3) / 4, px = p % ww + X0, py = Math.floor(p / ww) + Y0; if (px < l) l = px; if (px > r) r = px; if (py < t) t = py; if (py > bb) bb = py; }
              return { l, r: r + 1, t, b: bb + 1 }; };
            const R = (r) => ({ l: r.x, r: r.x + r.w, t: r.y, b: r.y + r.h }), inside = (p, r) => p.l >= r.x && p.r <= r.x + r.w && p.t >= r.y && p.b <= r.y + r.h;
            const pix = b.ops.map((op) => ({ op, p: ink(op) }));
            if (c.width !== 1080 || H !== (size === "s" ? 1920 : 1350)) fails.push("canvas " + c.width + "x" + H);
            for (const { op, p } of pix) { const r = op.card ? b.cards[op.card] : { x: 0, y: 0, w: c.width, h: H }; if (!inside(p, r)) fails.push(op.role + " outside " + (op.card || "canvas")); }
            for (const m of b.marks) if (!inside(R(m), b.cards.word)) fails.push("mark outside word card");
            const un = (a) => ({ l: Math.min(...a.map((q) => q.l)), r: Math.max(...a.map((q) => q.r)), t: Math.min(...a.map((q) => q.t)), b: Math.max(...a.map((q) => q.b)) });
            const wp = un(pix.filter((q) => q.op.role === "word").map((q) => q.p)), ap = un(pix.filter((q) => q.op.role === "ayah").map((q) => q.p).concat(b.marks.map(R)));
            const gap = b.divider - wp.b; if (!(gap >= 24)) fails.push("word/divider gap " + gap);
            if (!(b.divider + 1 < ap.t)) fails.push("divider touches ayah (" + b.divider + " vs " + ap.t + ")");
            if (size === "s") for (const p of pix.map((q) => q.p).concat([b.cards.word, b.cards.mean, b.cards.pill].map(R))) if (p.t < 250 || p.b > H - 360) { fails.push("story safe zone " + JSON.stringify(p)); break; }
            return { fails, gap, f: b.f, divToAyah: ap.t - b.divider };
          }, [id, size]);
          if (pw !== 1080 || ph !== (size === "s" ? 1920 : 1350)) chk.fails.push("png " + pw + "x" + ph);
          // Layout boxes from the same renderer, for the report.
          const info = await page.evaluate(([id, size]) => {
            const w = W.find((x) => x.id === id), c = renderCard(w, size);
            return { w: c.width, h: c.height, fonts: { amiri: document.fonts.check('120px "Amiri Quran"'), plex: document.fonts.check('28px "IBM Plex Sans Arabic"') } };
          }, [id, size]);
          meta.push({ kind, size, style, pal, mode, id, file, suggested: dl.suggestedFilename(), png: [pw, ph], chk, w: info.w, h: info.h, fonts: info.fonts });
          await page.waitForTimeout(150);
        }
      }
      if (errs.length) meta.push({ style, pal, mode, errs });
      await ctx.close();
      process.stdout.write(".");
    }
  } finally { await br.close(); server.close(); }
  fs.writeFileSync(path.join(OUT, "meta.json"), JSON.stringify(meta, null, 1));
  console.log("\n" + meta.length + " entries");
})();
