// Full-site interaction probe: 5 palettes x light/dark x glass/shade at 1440 and 390.
// Serves <repo>/public locally (the working tree), read-only.
const REPO = require("path").resolve(__dirname, "../..").split(require("path").sep).join("/");
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = REPO + "/public";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".webp": "image/webp" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p.endsWith("/")) p += "index.html";
  const f = path.join(ROOT, p);
  if (!f.startsWith(path.normalize(ROOT)) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});

const firstWord = fs.readdirSync(ROOT + "/word").find((n) => n.endsWith(".html"));
const firstSurah = fs.readdirSync(ROOT + "/surah").find((n) => n.endsWith(".html"));
// [label, url-suffix, optional setup action]
const PAGES = [
  ["home", "/#/"], ["surahs", "/#/surahs"], ["surah", "/#/surah/78"], ["word", "/#/word/79-3"],
  ["challenge", "/#/challenge"], ["day1-done", "/#/day/1"], ["day2", "/#/day/2"],
  ["quiz-answered", "/#/quiz", async (p) => { await p.click("#app .opt"); }],
  ["quiz-result", "/#/quiz", async (p) => { for (let i = 0; i < 40 && await p.$("#app .opt"); i++) { await p.click("#app .opt"); await p.click('#app [data-a="qn"]'); } }],
  ["settings-sheet", "/#/", async (p) => { await p.click("#gear"); }],
  ["save-sheet", "/#/word/79-3", async (p) => { await p.click('#app [data-a="card"]'); }],
  ["static-word", "/word/" + encodeURIComponent(firstWord)], ["static-surah", "/surah/" + encodeURIComponent(firstSurah)],
  ["404", "/404.html"],
];
const KILL = "*,*:before,*:after{transition:none!important;animation:none!important}";

(async () => {
  await new Promise((r) => server.listen(0, r));
  const BASE = "http://127.0.0.1:" + server.address().port;
  const br = await chromium.launch();
  const fails = [];
  const n = { btnGlass: 0, btnShade: 0, rowsPressed: 0, slRows: 0, pills: 0, nudges: 0, motion: 0 };
  for (const style of ["glass", "shade"]) for (const pal of ["gold", "def", "lav", "sun", "neo"]) for (const mode of ["light", "dark"]) for (const w of [1440, 390]) {
    const tag = `${style}/${pal}/${mode}/${w}`;
    const ctx = await br.newContext({ viewport: { width: w, height: 900 }, reducedMotion: "no-preference" });
    await ctx.addInitScript((s) => {
      localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1");
      localStorage.setItem("gq-prog", JSON.stringify({ done: [1] }));
    }, { style, mode, pal, gl: 3, gv: 2, snd: false, cm: false });
    const page = await ctx.newPage();
    for (const [label, url, setup] of PAGES) {
      await page.goto("about:blank"); await page.goto(BASE + url, { waitUntil: "load" });
      await page.waitForSelector(label.startsWith("static") || label === "404" ? "main" : "#app header", { timeout: 20000 });
      await page.waitForTimeout(250);
      if (setup) { await setup(page); await page.waitForTimeout(400); }
      await page.addStyleTag({ content: KILL });
      const where = `${tag} ${label}`;
      // --- buttons ---
      const btnCount = await page.$$eval(".btn", (els) => els.length);
      for (let i = 0; i < btnCount; i++) {
        const info = await page.evaluate((i) => {
          const e = document.querySelectorAll(".btn")[i];
          const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
          const sheetOpen = document.querySelector("#sh.open");
          const inSheet = !!e.closest("#sh");
          const usable = r.width > 0 && cs.visibility !== "hidden" && cs.pointerEvents !== "none" && !e.closest('[style*="visibility:hidden"]') && (sheetOpen ? inSheet : !inSheet) && !e.closest(".searching .acts");
          return { usable, text: (e.textContent || "").trim().slice(0, 24), o: e.classList.contains("o") };
        }, i);
        if (!info.usable) continue;
        const handle = (await page.$$(".btn"))[i];
        await handle.evaluate((e) => e.scrollIntoView({ block: "center" }));
        const snap = () => handle.evaluate((e) => { const c = getComputedStyle(e), r = e.getBoundingClientRect(); return { bg: c.backgroundColor, c: c.color, w: r.width.toFixed(2), h: r.height.toFixed(2) }; });
        const vars = await page.evaluate(() => { const d = document.createElement("div"); document.body.appendChild(d); const g = (v) => { d.style.background = "var(" + v + ")"; return getComputedStyle(d).backgroundColor; }; const o = { tx: g("--tx"), bg: g("--bg") }; d.remove(); return o; });
        await page.mouse.move(1, 1); const rest = await snap();
        await handle.hover({ force: true }); const hov = await snap();
        await page.mouse.move(1, 1);
        // A .btn inside a clickable card (the home challenge card's span) is not
        // focusable; its focus style comes from a.card:focus-visible, so focus the card.
        await page.keyboard.press("Shift"); await handle.evaluate((e) => (e.closest("a.card") || e).focus({ preventScroll: true })); const foc = await snap();
        await handle.evaluate((e) => (e.closest("a.card") || e).blur());
        const id = `${where} btn "${info.text}"${info.o ? " (o)" : ""}`;
        for (const [state, s] of [["hover", hov], ["focus", foc]]) {
          if (style === "glass") {
            n.btnGlass++;
            if (s.bg !== rest.bg || s.c !== rest.c) fails.push(`${id} ${state}: glass colour changed bg ${rest.bg}->${s.bg} color ${rest.c}->${s.c}`);
          } else {
            n.btnShade++;
            const ok = info.o ? s.bg === vars.tx && s.c === vars.bg : s.bg === "rgba(0, 0, 0, 0)" && s.c === vars.tx;
            if (!ok) fails.push(`${id} ${state}: shade did not invert bg ${rest.bg}->${s.bg} color ${rest.c}->${s.c} (tx ${vars.tx}, bg ${vars.bg})`);
            if (s.w !== rest.w || s.h !== rest.h) fails.push(`${id} ${state}: shade size changed ${rest.w}x${rest.h} -> ${s.w}x${s.h}`);
          }
        }
      }
      // --- word-page pills (Tier 2 outlined buttons) ---
      if (!label.endsWith("sheet")) for (const h of await page.$$(".cw a.pnb")) {
        await h.evaluate((e) => e.scrollIntoView({ block: "center" }));
        const snap = () => h.evaluate((e) => { const c = getComputedStyle(e), r = e.getBoundingClientRect(); return { bg: c.backgroundColor, c: c.color, w: r.width.toFixed(2), h: r.height.toFixed(2), sh: c.boxShadow, tr: c.transform, op: c.opacity, ol: c.outlineStyle + " " + c.outlineWidth, ch: getComputedStyle(e.querySelector(":scope>svg")).transform }; });
        const vars = await page.evaluate(() => { const d = document.createElement("div"); document.body.appendChild(d); const g = (v) => { d.style.background = "var(" + v + ")"; return getComputedStyle(d).backgroundColor; }; const o = { tx: g("--tx"), bg: g("--bg") }; d.remove(); return o; });
        await page.mouse.move(1, 1); const rest = await snap();
        await h.hover({ force: true }); const hov = await snap();
        const box = await h.boundingBox(); await page.mouse.down(); const prs = await snap(); await page.mouse.move(1, 1); await page.mouse.up();
        await page.keyboard.press("Shift"); await h.evaluate((e) => e.focus({ preventScroll: true })); const foc = await snap(); await h.evaluate((e) => e.blur());
        const id = where + " pill " + (await h.evaluate((e) => e.className));
        n.pills++;
        if (!/2px/.test(foc.ol) || foc.ol.startsWith("none")) fails.push(id + " focus ring missing (" + foc.ol + ")");
        if (prs.op !== "1") fails.push(id + " press changes opacity (" + prs.op + ")");
        if (!/^matrix\(0\.9[68]/.test(prs.tr)) fails.push(id + " press does not scale (" + prs.tr + ")");
        // chevron nudge: 3px in its own direction (previous -> right, next -> left), none at rest
        const want = "matrix(1, 0, 0, 1, " + (/\bpv\b/.test(id) ? 3 : -3) + ", 0)";
        n.nudges++;
        if (rest.ch !== "none") fails.push(id + " chevron moved at rest (" + rest.ch + ")");
        for (const [st, x] of [["hover", hov], ["focus", foc], ["press", prs]]) if (x.ch !== want) fails.push(id + " " + st + ": chevron nudge " + x.ch + " want " + want);
        if (style === "glass") {
          for (const [st, x] of [["hover", hov], ["focus", foc]]) if (x.bg !== rest.bg || x.c !== rest.c) fails.push(id + " " + st + ": glass colour changed");
          if (hov.sh === rest.sh) fails.push(id + " glass hover shadow missing");
        } else {
          for (const [st, x] of [["hover", hov], ["focus", foc]]) {
            if (!(x.bg === vars.tx && x.c === vars.bg)) fails.push(id + " " + st + ": shade did not invert bg " + x.bg + " color " + x.c);
            if (x.w !== rest.w || x.h !== rest.h) fails.push(id + " " + st + ": shade size changed");
          }
        }
      }
      if (label.endsWith("sheet")) continue;
      // --- rows and cards: press feedback (sample up to 2 of each kind) ---
      for (const sel of ["a.row", "a.dy", "button.dy", ".dcard", "a.card"]) {
        const hs = (await page.$$(sel)).slice(0, 2);
        for (const h of hs) {
          const vis = await h.evaluate((e) => e.getBoundingClientRect().width > 0 && !e.closest(".searching"));
          if (!vis) continue;
          await h.evaluate((e) => e.scrollIntoView({ block: "center" }));
          const box = await h.boundingBox();
          await page.mouse.move(1, 1);
          const op0 = await h.evaluate((e) => +getComputedStyle(e).opacity);
          const tr0 = await h.evaluate((e) => getComputedStyle(e).transform);
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
          const op1 = await h.evaluate((e) => +getComputedStyle(e).opacity);
          await page.mouse.move(1, 1); await page.mouse.up();
          n.rowsPressed++;
          if (!(op1 < op0)) fails.push(`${where} ${sel}: no press feedback (opacity ${op0} -> ${op1})`);
          void tr0;
        }
      }
      // --- glass surah rows react on hover ---
      if (label === "surahs") {
        const hs = (await page.$$("#app .list.sl a.row")).slice(0, 3);
        for (const h of hs) {
          await h.evaluate((e) => e.scrollIntoView({ block: "center" }));
          await page.mouse.move(1, 1);
          const r0 = await h.evaluate((e) => ({ op: getComputedStyle(e, "::before").opacity, tr: getComputedStyle(e).transform }));
          await h.hover({ force: true });
          const r1 = await h.evaluate((e) => ({ op: getComputedStyle(e, "::before").opacity, bgc: getComputedStyle(e, "::before").backgroundColor, tr: getComputedStyle(e).transform, sh: getComputedStyle(e).boxShadow }));
          n.slRows++;
          if (style === "glass") {
            if (!(r0.op === "0" && r1.op === "1")) fails.push(`${where} sl row: glass hover tint missing (${r0.op} -> ${r1.op})`);
            if (r1.tr !== "none") fails.push(`${where} sl row: glass hover moves (${r1.tr})`);
          } else if (r1.tr === "none" && r1.sh === "none") fails.push(`${where} sl row: shade hover lost`);
        }
      }
    }
    await ctx.close();
    process.stdout.write(".");
  }
  // --- chevron nudge timing and motion-off: 200ms return normally; no movement with motion off (class or OS setting) ---
  for (const [mode, cm, rm] of [["normal", false, "no-preference"], ["cm", true, "no-preference"], ["reduced", false, "reduce"]]) for (const style of ["glass", "shade"]) for (const w of [1440, 390]) {
    const ctx = await br.newContext({ viewport: { width: w, height: 900 }, reducedMotion: rm });
    await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); }, { style, mode: "light", pal: "def", gl: 3, gv: 2, snd: false, cm });
    const page = await ctx.newPage();
    for (const url of ["/#/word/79-3", "/#/surah/90", "/word/" + encodeURIComponent(firstWord), "/surah/" + encodeURIComponent(firstSurah)]) {
      await page.goto("about:blank"); await page.goto(BASE + url, { waitUntil: "load" }); await page.waitForSelector(".cw .pnb"); await page.waitForTimeout(300);
      for (const h of await page.$$(".cw a.pnb")) {
        const id = `motion/${mode}/${style}/${w} ${url} ${await h.evaluate((e) => e.className)}`;
        const ch = () => h.evaluate((e) => { const c = getComputedStyle(e.querySelector(":scope>svg")); return { tr: c.transform, dur: c.transitionDuration, prop: c.transitionProperty }; });
        await page.mouse.move(1, 1); await page.waitForTimeout(250); const r0 = await ch();
        await h.hover({ force: true }); await page.waitForTimeout(260); const r1 = await ch();
        await page.mouse.move(1, 1); await page.waitForTimeout(260); const r2 = await ch();
        await page.keyboard.press("Shift"); await h.evaluate((e) => e.focus({ preventScroll: true })); await page.waitForTimeout(260); const r3 = await ch(); await h.evaluate((e) => e.blur());
        n.motion++;
        if (mode === "normal") {
          if (!(r0.prop.includes("transform") && r0.dur === "0.2s")) fails.push(id + " chevron transition " + r0.prop + " " + r0.dur);
          if (!/^matrix\(1, 0, 0, 1, -?3, 0\)$/.test(r1.tr) || r2.tr !== "none") fails.push(id + " nudge/return " + r1.tr + " -> " + r2.tr);
        } else for (const [st, x] of [["rest", r0], ["hover", r1], ["focus", r3]]) if (x.tr !== "none") fails.push(id + " " + st + ": chevron moved with motion off (" + x.tr + ")");
      }
      // disabled pills are spans: never nudged
      for (const h of await page.$$(".cw span.pnb")) { const t = await h.evaluate((e) => getComputedStyle(e.querySelector(":scope>svg")).transform); if (t !== "none") fails.push(`motion/${mode} ${url} disabled chevron moved (${t})`); }
    }
    await ctx.close();
  }
  // Shadow rule: no at-rest drop shadow may reach a button or pill below it (gap >= offset-y + blur + spread).
  // Every page, app and static, at 320/390/1440 in glass and shade (shadowrule.js holds the measurement).
  const { shadowViolations } = require("./shadowrule.js");
  n.shadowPages = 0;
  const wfiles = fs.readdirSync(ROOT + "/word"), sfiles = fs.readdirSync(ROOT + "/surah");
  for (const w of [320, 390, 1440]) for (const style of ["glass", "shade"]) {
    const ctx = await br.newContext({ viewport: { width: w, height: 900 } });
    await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-prog", JSON.stringify({ done: [1, 2] })); }, { style, mode: "light", pal: "def", gl: 3, gv: 2, snd: false, cm: true });
    const page = await ctx.newPage(); await page.goto(BASE + "/", { waitUntil: "load" }); await page.waitForSelector("#app h1"); await page.evaluate(() => document.fonts.ready);
    const D = await page.evaluate(() => ({ W: W.map((x) => "#/word/" + x.id), S: S.map((s) => "#/surah/" + s.num), C: CH.map((c) => "#/day/" + c.d) }));
    const check = async (where) => { await page.mouse.move(1, 1); const v = await page.evaluate(() => shadowViolations()); n.shadowPages++; for (const x of v) fails.push(`shadow ${w}/${style} ${where}: ${x.a} -> ${x.b} gap ${x.gap} < reach ${x.reach}`); };
    await page.addScriptTag({ content: shadowViolations.toString() });
    for (const r of ["#/", "#/surahs", "#/challenge", "#/quiz", "#/about", "#/privacy", "#/terms", "#/rights", "#/nope", ...D.W, ...D.S, ...D.C]) {
      await page.evaluate((h) => { location.hash = h; }, r); await page.waitForTimeout(80); await check(r);
      if (r === "#/quiz") { await page.click("#app .opt >> nth=0"); await page.waitForTimeout(80); await check("#/quiz answered"); }
    }
    await page.evaluate(() => { location.hash = "#/"; }); await page.waitForTimeout(100);
    await page.fill("#q", "ا"); await page.waitForTimeout(250); await check("#/ search results");
    await page.fill("#q", "زززز"); await page.waitForTimeout(250); await check("#/ no results");
    for (const f of [...wfiles.map((x) => "/word/" + x), ...sfiles.map((x) => "/surah/" + x), "/about/", "/404.html"]) {
      await page.goto(BASE + f, { waitUntil: "load" }); await page.evaluate(() => document.fonts.ready);
      await page.addScriptTag({ content: shadowViolations.toString() }); await check(f);
    }
    await ctx.close();
  }
  await br.close(); server.close();
  console.log("\ncounts", JSON.stringify(n));
  console.log(fails.length ? "FAILURES (" + fails.length + "):\n" + fails.join("\n") : "ALL CHECKS PASSED");
})().catch((e) => { console.error(e); process.exit(1); });
