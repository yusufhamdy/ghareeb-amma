// KFGQPC component checks in Chromium and in WebKit with iPhone emulation, for the release (Safari line metrics).
//
// WARNING: Playwright's WebKit on Windows MISRENDERS the KFGQPC font (harakat dropped or misplaced, words lifted off
// the line; see out/release/webkit/before/webkit/word-83-0-*.png), so its ink measurements - divider gap, highlight
// ink - say nothing about Safari, which draws text with Apple's CoreText. Do NOT use the WebKit results from Windows to
// judge Safari or as a release gate; judge Safari on a real iPhone. Layout-only numbers (boxes, rows) are still usable.
//
//   node webkit.js [root|url] [outDir] [--configs chromium,webkit,webkit-noovr] [--widths 360,400] [--only rows]
//   node webkit.js --compare-rows <baselineOutDir> <currentOutDir>
// root defaults to the working tree's public/; an http(s) URL checks that site instead (read-only).
// --only rows measures only the surah rows (fast). --compare-rows compares the name boxes' offsets inside each row,
// per config, theme and width, between two runs (e.g. the pre-KFGQPC baseline d4405a7 and now): +-2px on every side.
// Configs:
//   chromium      Chromium, mobile, 3x
//   webkit        Playwright WebKit with the iPhone 13 profile (UA, touch, 3x), at the given widths
//   webkit-noovr  the same, with ascent-override / descent-override / line-gap-override removed from fonts.css
//                 (only size-adjust kept): a Safari that ignores those descriptors, the worst case
// For every word page at each width, in glass-dark-gold and shade-light-gold:
//   - every highlight pill contains all the ink of its mark, with equal top and bottom margins (+-2px)
//   - the divider gap (dashed line top minus the headword's lowest ink) is 20 +-1px
//   - no line of the ayah starts with U+FD3E or ends with U+FD3F; every mark starts and ends at a word boundary
//   - the headword's and the ayah's ink lies inside the card and the viewport (not clipped)
// plus the surah list rows (glass rows, shade tiles) and one surah page's rows (the name's box offsets inside its row
// on every side, and its ink offsets, recorded for --compare-rows),
// the static word pages (divider gap, brackets), and the save-image cards of 81-3 and 83-0.
// Writes outDir/<config>/metrics.json, word-card screenshots for a few words and the cards; prints failures.
const { serve } = require("./lib.js");
const { chromium, webkit, devices } = require("playwright");
const fs = require("fs"), path = require("path");

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf(k); return i < 0 ? d : args[i + 1]; };
const pos = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--")));
const SRC = pos[0] || path.resolve(__dirname, "../../public");
const OUT = pos[1] || path.join(__dirname, "out/release/webkit");
const CONFIGS = opt("--configs", "chromium,webkit,webkit-noovr").split(",");
const WIDTHS = opt("--widths", "360,400").split(",").map(Number);
const THEMES = [{ style: "glass", mode: "dark", pal: "gold" }, { style: "shade", mode: "light", pal: "gold" }];
const SHOTS = ["81-3", "83-0", "79-0", "98-0", "101-0", "113-3"];
const ROWS_ONLY = opt("--only", "") === "rows";
const DSF = 3;

// --compare-rows A B: the name box's offsets inside each row (glass rows, shade tiles, surah page rows), B against A
if (args[0] === "--compare-rows") {
  const [A, B] = args.slice(1);
  let fails = 0;
  for (const cfg of fs.readdirSync(B).filter((c) => fs.existsSync(path.join(A, c, "metrics.json")))) {
    const a = JSON.parse(fs.readFileSync(path.join(A, cfg, "metrics.json"), "utf8")), b = JSON.parse(fs.readFileSync(path.join(B, cfg, "metrics.json"), "utf8"));
    for (const tag of Object.keys(b.combos)) for (const route of Object.keys(b.combos[tag].rows)) {
      const ra = a.combos[tag].rows[route], rb = b.combos[tag].rows[route], d = { boxTop: 0, boxBottom: 0, boxLeft: 0, boxRight: 0 };
      if (!ra || ra.length !== rb.length) { console.log(`${cfg} ${tag} ${route}: row count ${ra && ra.length} -> ${rb.length}`); fails++; continue; }
      rb.forEach((r, i) => Object.keys(d).forEach((k) => { d[k] = Math.max(d[k], Math.abs(r[k] - ra[i][k])); }));
      const bad = Object.values(d).some((v) => v > 2);
      if (bad) fails++;
      const f = (r) => `t ${r.boxTop} b ${r.boxBottom} l ${r.boxLeft} r ${r.boxRight} (h ${r.h})`;
      console.log(`${bad ? "FAIL" : "ok  "} ${cfg} ${tag} ${route}: row 0 baseline ${f(ra[0])} -> now ${f(rb[0])}; max change over ${rb.length} rows: top ${d.boxTop.toFixed(2)} bottom ${d.boxBottom.toFixed(2)} left ${d.boxLeft.toFixed(2)} right ${d.boxRight.toFixed(2)}`);
    }
  }
  console.log(fails ? fails + " FAILURES" : "ALL ROWS WITHIN 2px OF THE BASELINE");
  process.exit(fails ? 1 : 0);
}
const IPHONE = devices["iPhone 13"];

async function ctxFor(br, cfg, t, w) {
  const base = cfg === "chromium" ? { isMobile: true, hasTouch: true } : { userAgent: IPHONE.userAgent, isMobile: true, hasTouch: true };
  const ctx = await br.newContext(Object.assign(base, { viewport: { width: w, height: 900 }, deviceScaleFactor: DSF, reducedMotion: "reduce" }));
  await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); },
    { style: t.style, mode: t.mode, pal: t.pal, gl: 50, gv: 3, snd: false, cm: true });
  if (cfg === "webkit-noovr") {
    await ctx.route("**/fonts/fonts.css", async (route) => {
      // whole descriptor lines, LF or CRLF; the file's comments mention the overrides, so only descriptors are checked
      const r = await route.fetch(), body = (await r.text()).replace(/^[ \t]*(?:ascent|descent|line-gap)-override[ \t]*:[^;\r\n]*;[ \t]*\r?\n/gm, "");
      if (/(?:ascent|descent|line-gap)-override[ \t]*:/.test(body)) throw new Error("override descriptors left in fonts.css");
      route.fulfill({ response: r, body });
    });
  }
  return ctx;
}

// ink bbox (CSS px, page coords) of what differs between two full-page screenshots of the same clip
async function inkBox(page, clip, show, hide) {
  await page.evaluate(hide); const a = await page.screenshot({ clip, fullPage: true, animations: "disabled" });
  await page.evaluate(show); const b = await page.screenshot({ clip, fullPage: true, animations: "disabled" });
  return page.evaluate(async ([a, b, clip, dsf]) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = "data:image/png;base64," + s; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    const c = document.createElement("canvas"); c.width = ia.width; c.height = ia.height; const x = c.getContext("2d");
    x.drawImage(ia, 0, 0); const da = x.getImageData(0, 0, c.width, c.height).data;
    x.clearRect(0, 0, c.width, c.height); x.drawImage(ib, 0, 0); const db = x.getImageData(0, 0, c.width, c.height).data;
    let l = c.width, r = -1, t = c.height, bt = -1;
    for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) {
      const i = (y * c.width + xx) * 4, d = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
      if (d > 24) { if (xx < l) l = xx; if (xx > r) r = xx; if (y < t) t = y; if (y > bt) bt = y; }
    }
    return r < 0 ? null : { l: clip.x + l / dsf, r: clip.x + (r + 1) / dsf, t: clip.y + t / dsf, b: clip.y + (bt + 1) / dsf };
  }, [a.toString("base64"), b.toString("base64"), clip, DSF]);
}
// style toggles: every text in #app transparent except the selector (black when on)
const only = (sel, on, extra = "") => `(() => { let s = document.getElementById("__k"); if (!s) { s = document.createElement("style"); s.id = "__k"; document.head.appendChild(s); }
  s.textContent = "mark::before{opacity:0!important} body *{color:transparent!important;text-shadow:none!important;border-color:transparent!important;${extra}} ${sel}{color:${on ? "#000" : "transparent"}!important}"; })()`;
const unstyle = () => { const s = document.getElementById("__k"); if (s) s.remove(); };
const clipOf = (r, pad, pw) => { const x = Math.max(0, r.x - pad), y = Math.max(0, r.y - pad); return { x, y, width: Math.min(pw - x, r.w + 2 * pad), height: r.h + 2 * pad }; };

async function settle(p) {
  await p.waitForTimeout(250);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(1000);
}

// lines of the ayah (logical order, visible characters) and the marks' word boundaries
const AYAH = (sel) => `(() => {
  const ay = document.querySelector(${JSON.stringify(sel)});
  const fs = parseFloat(getComputedStyle(ay).fontSize), lines = [], r = document.createRange();
  let cur = null;
  const walk = (n) => n.childNodes.forEach((c) => {
    if (c.nodeType !== 3) return walk(c);
    for (let i = 0; i < c.data.length; i++) {
      const ch = c.data[i]; if (ch === " ") continue;
      r.setStart(c, i); r.setEnd(c, i + 1); const b = r.getBoundingClientRect();
      if (!b.width && !b.height) continue;
      const mid = b.top + b.height / 2;
      if (!cur || Math.abs(mid - cur.mid) > fs * 0.6) { cur = { mid, text: "" }; lines.push(cur); }
      cur.text += ch;
    }
  });
  walk(ay);
  const text = ay.textContent, split = [];
  let off = 0; const offs = new Map();
  const walk2 = (n) => n.childNodes.forEach((c) => { if (c.nodeName === "MARK") { offs.set(c, off); off += c.textContent.length; } else if (c.nodeType === 3) off += c.data.length; else walk2(c); });
  walk2(ay);
  const edge = (ch) => ch === undefined || /[\\s\\ufd3e\\ufd3f]/.test(ch);
  offs.forEach((o, m) => { const e = o + m.textContent.length; if (!edge(text[o - 1]) || !edge(text[e]) || /^\\s|\\s$/.test(m.textContent)) split.push(m.textContent); });
  return { lines: lines.map((l) => l.text), split };
})()`;
const orphan = (lines) => lines.filter((l) => l.startsWith("\ufd3e") || l.endsWith("\ufd3f"));

async function runConfig(cfg, base) {
  const dir = path.join(OUT, cfg); fs.mkdirSync(dir, { recursive: true });
  const br = await (cfg === "chromium" ? chromium : webkit).launch();
  const out = { engine: br.browserType().name(), version: br.version(), widths: WIDTHS, combos: {} }, fails = [];
  const F = (s) => fails.push(s);
  for (const t of THEMES) for (const w of WIDTHS) {
    const tag = `${t.style}-${t.mode}-${t.pal}/${w}`, rec = (out.combos[tag] = { words: {}, rows: {}, statics: {} });
    const ctx = await ctxFor(br, cfg, t, w), p = await ctx.newPage();
    await p.goto(base + "/#/"); await settle(p);
    const words = await p.evaluate(() => W.map((x) => [x.id, x.slug]));
    for (const [id] of ROWS_ONLY ? [] : words) {
      await p.goto(base + "/#/word/" + id); await settle(p);
      await p.evaluate(() => { scrollTo(0, 0); document.querySelectorAll("#app .cols .card mark").forEach((m, k) => m.setAttribute("data-kq", "k" + k)); });
      const m = await p.evaluate(() => {
        const card = document.querySelector(".cols .card"), wd = card.querySelector(".wd"), ay = card.querySelector(".ay"), vr = card.querySelector(".vr");
        const R = (e) => { const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }; };
        const marks = [...card.querySelectorAll("mark")].map((mk) => {
          const r = mk.getBoundingClientRect(), v = (k) => parseFloat(mk.style.getPropertyValue(k));
          return { text: mk.textContent, pill: isFinite(v("--hl-t")) ? { l: r.left + scrollX + v("--hl-l"), t: r.top + scrollY + v("--hl-t"), w: v("--hl-w"), h: v("--hl-h") } : null };
        });
        const fallback = document.documentElement.classList.contains("qf") ? "qf" : "";
        return { font: getComputedStyle(wd).fontFamily, fallback, card: R(card), wd: R(wd), ay: R(ay), vrTop: vr.getBoundingClientRect().top + scrollY, pw: document.documentElement.scrollWidth, vw: innerWidth, marks };
      });
      const tg = `${tag} ${id}`;
      // highlights
      for (let i = 0; i < m.marks.length; i++) {
        const mk = m.marks[i]; if (!mk.pill) { F(`${tg}: mark ${i} not measured`); continue; }
        const ink = await inkBox(p, clipOf({ x: mk.pill.l, y: mk.pill.t, w: mk.pill.w, h: mk.pill.h }, 30, m.pw), only(`#app .cols .card mark[data-kq=k${i}]`, true), only(`#app .cols .card mark[data-kq=k${i}]`, false));
        await p.evaluate(unstyle);
        if (!ink) { F(`${tg}: no ink for mark ${i}`); continue; }
        const P = mk.pill, mg = { top: +(ink.t - P.t).toFixed(2), bottom: +(P.t + P.h - ink.b).toFixed(2), left: +(ink.l - P.l).toFixed(2), right: +(P.l + P.w - ink.r).toFixed(2) };
        mk.margin = mg;
        if (Math.min(mg.top, mg.bottom, mg.left, mg.right) < -0.5) F(`${tg}: ink outside the pill of mark ${i} ${JSON.stringify(mg)}`);
        if (Math.abs(mg.top - mg.bottom) > 2) F(`${tg}: pill margins unequal, mark ${i} ${JSON.stringify(mg)}`);
      }
      // divider gap, and the headword's ink inside the card and viewport
      const wdInk = await inkBox(p, clipOf(m.card, 20, m.pw), only("#app .cols .card .wd", true), only("#app .cols .card .wd", false));
      const ayInk = await inkBox(p, clipOf(m.card, 20, m.pw), only("#app .cols .card .ay, #app .cols .card .ay *", true), only("#app .cols .card .ay, #app .cols .card .ay *", false));
      await p.evaluate(unstyle);
      m.gap = wdInk ? +(m.vrTop - wdInk.b).toFixed(2) : null;
      if (m.gap == null || Math.abs(m.gap - 20) > 1) F(`${tg}: divider gap ${m.gap}`);
      const inside = (ink, what) => {
        if (!ink) return F(`${tg}: no ink for ${what}`);
        const c = m.card, mg = { top: ink.t - c.y, bottom: c.y + c.h - ink.b, left: ink.l - c.x, right: c.x + c.w - ink.r };
        if (Math.min(mg.top, mg.bottom, mg.left, mg.right) < 1 || ink.l < 0 || ink.r > m.vw) F(`${tg}: ${what} ink at or past the card/viewport edge ${JSON.stringify(mg)}`);
        return { t: +mg.top.toFixed(2), b: +mg.bottom.toFixed(2), l: +mg.left.toFixed(2), r: +mg.right.toFixed(2) };
      };
      m.wdInCard = inside(wdInk, "headword"); m.ayInCard = inside(ayInk, "ayah");
      if (m.fallback || !/KFGQPC/.test(m.font)) F(`${tg}: not the KFGQPC face (${m.font} ${m.fallback})`);
      const a = await p.evaluate(AYAH(".cols .card .ay"));
      m.lines = a.lines.length;
      orphan(a.lines).forEach(() => F(`${tg}: orphaned bracket ${JSON.stringify(a.lines)}`));
      a.split.forEach((s) => F(`${tg}: mark splits a word: ${s}`));
      if (SHOTS.includes(id)) { await p.evaluate(() => scrollTo(0, 0)); await (await p.$(".cols .card")).screenshot({ path: path.join(dir, `word-${id}-${w}-${t.style}-${t.mode}-${t.pal}.png`) }); }
      rec.words[id] = m;
    }
    // surah list (glass rows / shade tiles) and one surah page: the name's box and ink offsets inside its row
    for (const [route, sel, name] of [["/#/surahs", ".list.sl .row", ".q"], ["/#/surah/78", ".list.rs .row", ".w"]]) {
      await p.goto(base + route); await settle(p);
      const rows = await p.evaluate(([sel, name]) => { scrollTo(0, 0); return [...document.querySelectorAll(sel)].map((r, i) => { r.setAttribute("data-kr", "r" + i); const b = r.getBoundingClientRect(), n = r.querySelector(name).getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, w: b.width, h: b.height, boxTop: n.top - b.top, boxBottom: b.bottom - n.bottom, boxLeft: n.left - b.left, boxRight: b.right - n.right }; }); }, [sel, name]);
      const pw = await p.evaluate(() => document.documentElement.scrollWidth);
      const res = [];
      for (let i = 0; i < rows.length; i++) {
        const s = `#app [data-kr=r${i}] ${name}`;
        const ink = await inkBox(p, clipOf(rows[i], 0, pw), only(s, true, "background-image:none!important"), only(s, false, "background-image:none!important"));
        await p.evaluate(unstyle);
        if (!ink) { F(`${tag} ${route} row ${i}: no ink`); continue; }
        const top = ink.t - rows[i].y, bottom = rows[i].y + rows[i].h - ink.b;
        const r = rows[i];
        res.push({ h: +r.h.toFixed(2), boxTop: +r.boxTop.toFixed(2), boxBottom: +r.boxBottom.toFixed(2), boxLeft: +r.boxLeft.toFixed(2), boxRight: +r.boxRight.toFixed(2), inkTop: +top.toFixed(2), inkBottom: +bottom.toFixed(2) });
        if (top < 0 || bottom < 0) F(`${tag} ${route} row ${i}: name ink outside the row`);
      }
      rec.rows[route] = res;
    }
    // static word pages: divider gap and brackets
    for (const [id, slug] of ROWS_ONLY ? [] : words) {
      await p.goto(base + "/word/" + slug + ".html"); await settle(p);
      const g = await p.evaluate(() => { scrollTo(0, 0); const c = document.querySelector(".cols .card"), r = c.getBoundingClientRect(); return { card: { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height }, vrTop: c.querySelector(".vr").getBoundingClientRect().top + scrollY, pw: document.documentElement.scrollWidth }; });
      const ink = await inkBox(p, clipOf(g.card, 20, g.pw), only(".cols .card .wd", true), only(".cols .card .wd", false));
      await p.evaluate(unstyle);
      const gap = ink ? +(g.vrTop - ink.b).toFixed(2) : null;
      if (gap == null || Math.abs(gap - 20) > 1) F(`${tag} static ${slug}: divider gap ${gap}`);
      const a = await p.evaluate(AYAH(".cols .card .ay"));
      orphan(a.lines).forEach(() => F(`${tag} static ${slug}: orphaned bracket ${JSON.stringify(a.lines)}`));
      a.split.forEach((s) => F(`${tag} static ${slug}: mark splits a word: ${s}`));
      rec.statics[id] = { gap, lines: a.lines.length };
    }
    await ctx.close();
    console.log(cfg, tag, "done");
  }
  // save-image cards
  if (!ROWS_ONLY) {
    const ctx = await ctxFor(br, cfg, THEMES[0], 400), p = await ctx.newPage();
    await p.goto(base + "/#/"); await settle(p); await p.evaluate(() => cardFonts());
    await p.waitForTimeout(800);
    for (const id of ["81-3", "83-0"]) for (const size of ["n", "s"]) {
      const data = await p.evaluate(([id, size]) => renderCard(byId(id), size).toDataURL("image/png"), [id, size]);
      fs.writeFileSync(path.join(dir, `card-${id}-${size === "s" ? "story" : "regular"}.png`), Buffer.from(data.split(",")[1], "base64"));
    }
    await ctx.close();
  }
  await br.close();
  fs.writeFileSync(path.join(dir, "metrics.json"), JSON.stringify(out, null, 1));
  return fails;
}

(async () => {
  let server = null, base = SRC;
  if (!/^https?:/.test(SRC)) ({ server, base } = await serve(SRC));
  let total = 0;
  for (const cfg of CONFIGS) {
    const fails = await runConfig(cfg, base);
    total += fails.length;
    console.log(`${cfg}: ${fails.length ? fails.length + " FAILURES" : "ALL CHECKS PASSED"}`);
    fails.slice(0, 60).forEach((f) => console.log("  " + f));
  }
  if (server) server.close();
  if (total) process.exitCode = 1;
})();
