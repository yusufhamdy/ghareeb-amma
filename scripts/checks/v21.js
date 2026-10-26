// Checks for items 1 (nav animation), 4 (day pills), 6 (landscape nav), 7 (icon motion), 320/390/1440, glass + shade.
const pw = require("playwright");
const { serve } = require("./lib.js");
const R = {}; const fails = [];
const ok = (it, c, m) => { R[it] = R[it] || { n: 0, f: 0 }; R[it].n++; if (!c) { R[it].f++; fails.push(it + ": " + m); } };
(async () => {
  const { server, base } = await serve(); const br = await pw.chromium.launch();
  const mk = async (w, style, o = {}) => {
    const ctx = await br.newContext({ viewport: o.vp || { width: w, height: 900 }, hasTouch: !!o.touch, isMobile: !!o.touch, reducedMotion: o.rm ? "reduce" : "no-preference" });
    await ctx.addInitScript((a) => { localStorage.setItem("gq-set", JSON.stringify(a.s)); localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-prog", JSON.stringify(a.prog)); }, { s: { style, mode: "light", pal: "def", gl: 3, gv: 2, snd: false, cm: !!o.cm }, prog: o.prog || { done: [] } });
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.errs = errs; p.ctx = ctx;
    await p.goto(base + "/", { waitUntil: "load" }); await p.waitForSelector("#app h1"); await p.evaluate(() => document.fonts.ready); return p;
  };
  const go = async (p, h) => { await p.evaluate((h) => { location.hash = h; }, h); await p.waitForTimeout(200); };
  try {
    for (const w of [320, 390, 1440]) for (const style of ["glass", "shade"]) {
      const tag = w + "/" + style;
      // ---- 1. nav animates only when the active tab changes ----
      { const p = await mk(w, style, { prog: { done: [] } });
        await p.evaluate(() => { window.__nv = { anim: 0, mut: 0 }; const nv = document.getElementById("nv"); nv.addEventListener("animationstart", () => window.__nv.anim++, true); new MutationObserver((l) => { for (const m of l) { if (m.target === nv && m.type === "attributes" && m.oldValue.replace(/ ?hide/, "") === nv.className.replace(/ ?hide/, "")) continue; window.__nv.mut++; } }).observe(nv, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class"] }); /* the nav hiding on scroll is not a re-render */ });
        const reset = () => p.evaluate(() => { window.__nv.anim = 0; window.__nv.mut = 0; });
        const got = () => p.evaluate(() => window.__nv);
        await go(p, "#/quiz"); await p.waitForTimeout(500); await reset();
        await p.click("#app .opt >> nth=0"); await p.waitForTimeout(450); let g = await got(); ok("1", g.anim === 0 && g.mut === 0, `${tag} quiz answer ${JSON.stringify(g)}`);
        await p.click('#app [data-a="qn"]'); await p.waitForTimeout(450); g = await got(); ok("1", g.anim === 0 && g.mut === 0, `${tag} quiz next ${JSON.stringify(g)}`);
        await go(p, "#/day/1"); await p.waitForTimeout(500); await reset();
        for (const c of await p.$$("#app .dcard")) { await c.click(); await p.waitForTimeout(80); }
        g = await got(); ok("1", g.anim === 0 && g.mut === 0, `${tag} day cards ${JSON.stringify(g)}`);
        await p.click('#app [data-a="done"]'); await p.waitForTimeout(300); await p.click('#app [data-a="done"]'); await p.waitForTimeout(450); g = await got(); ok("1", g.anim === 0 && g.mut === 0, `${tag} done/undo ${JSON.stringify(g)}`);
        await go(p, "#/word/80-0"); await p.waitForTimeout(500); await reset(); await go(p, "#/word/80-1"); await p.waitForTimeout(450); g = await got(); ok("1", g.anim === 0 && g.mut === 0, `${tag} same-tab route ${JSON.stringify(g)}`);
        await go(p, "#/"); await p.waitForTimeout(500); await reset(); await p.fill("#q", "قضب"); await p.waitForTimeout(400); await p.fill("#q", ""); await p.waitForTimeout(300); g = await got(); ok("1", g.anim === 0 && g.mut === 0, `${tag} search typing ${JSON.stringify(g)}`);
        await p.click("#gear"); await p.waitForTimeout(200); await reset(); await p.click('#sh [data-m="dark"]'); await p.waitForTimeout(150); await p.click('#sh [data-m="light"]'); await p.click('#sh [data-c]'); await p.click('#sh [data-c]'); await p.waitForTimeout(450); g = await got(); ok("1", g.anim === 0 && g.mut === 0, `${tag} settings ${JSON.stringify(g)}`);
        await p.keyboard.press("Escape"); await reset(); await go(p, "#/surahs"); await p.waitForTimeout(500); g = await got();
        ok("1", g.anim >= 1, `${tag} tab change animates (${JSON.stringify(g)})`);
        await p.ctx.close(); ok("errors", p.errs.length === 0, tag + " " + p.errs); }
      // ---- 4. day pills ----
      { const p = await mk(w, style, { prog: { done: [1] }, cm: true });
        const D = await p.evaluate(() => CH.length);
        const pills = () => p.evaluate(() => [...document.querySelectorAll("#app .cw.dnav > .pnb")].map((e) => { const r = e.getBoundingClientRect(), pl = e.querySelector(".pl"), vis = [...e.childNodes].filter((n) => !(n.nodeType === 1 && (n.tagName.toLowerCase() === "svg" || n.classList.contains("ps") || (n === pl && parseFloat(getComputedStyle(pl).fontSize) === 0)))).map((n) => n.textContent).join("").trim(); return { tag: e.tagName, cls: e.className, href: e.getAttribute("href"), dis: e.getAttribute("aria-disabled"), vis, full: [...e.childNodes].filter((n) => !(n.nodeType === 1 && (n.tagName.toLowerCase() === "svg" || n.classList.contains("ps")))).map((n) => n.textContent).join("").trim(), ps: e.querySelector(".ps") && e.querySelector(".ps").textContent.trim(), lock: !!(e.querySelector(".ps svg rect")), chev: e.querySelector(":scope>svg path").getAttribute("d"), h: r.height, top: r.top, dwb: document.getElementById("dw").getBoundingClientRect().bottom, hdr: document.querySelectorAll(".dh .btn, .dh .pnb").length }; }));
        const short = w <= 340;
        await go(p, "#/day/1"); let P = await pills();
        ok("4", P.length === 2 && P[0].tag === "SPAN" && P[0].dis === "true" && P[1].tag === "A" && P[1].href === "#/day/2", `${tag} day1 ${JSON.stringify(P)}`);
        ok("4", P.every((x) => x.h === 58 && x.top > x.dwb && x.hdr === 0), `${tag} day1 layout ${JSON.stringify(P.map((x) => [x.h, x.top, x.dwb, x.hdr]))}`);
        ok("4", P[0].vis === (short ? "السابق" : "اليوم السابق") && P[1].vis === (short ? "التالي" : "اليوم التالي") && P[0].full === "اليوم السابق" && P[1].full === "اليوم التالي", `${tag} labels ${P.map((x) => x.vis + "/" + x.full)}`);
        ok("4", P[0].chev === "M9 5l7 7-7 7" && P[1].chev === "M15 5l-7 7 7 7", `${tag} chevrons`);
        await go(p, "#/day/2"); P = await pills();
        ok("4", P[1].tag === "SPAN" && P[1].dis === "true" && P[1].ps === "بعد إتمام اليوم" && P[1].lock && P[0].tag === "A" && P[0].href === "#/day/1", `${tag} day2 locked next ${JSON.stringify(P[1])}`);
        for (const c of await p.$$("#app .dcard:not(.open)")) await c.click();
        await p.click('#app [data-a="done"]'); await p.waitForTimeout(150); P = await pills();
        ok("4", P[1].tag === "A" && P[1].href === "#/day/3" && !P[1].ps, `${tag} done unlocks next ${JSON.stringify(P[1])}`);
        await p.click('#app [data-a="done"]'); await p.waitForTimeout(150); P = await pills();
        ok("4", P[1].tag === "SPAN" && P[1].ps === "بعد إتمام اليوم", `${tag} undo locks next again`);
        await p.evaluate((d) => { localStorage.setItem("gq-prog", JSON.stringify({ done: Array.from({ length: d }, (_, i) => i + 1) })); }, D);
        await go(p, "#/"); await go(p, "#/day/" + D); P = await pills();
        ok("4", P[0].tag === "A" && P[1].tag === "SPAN" && P[1].dis === "true" && !P[1].ps, `${tag} last day ${JSON.stringify(P)}`);
        await p.ctx.close(); }
      if (w === 1440) { // nudge on hover, same as the word page
        const p = await mk(w, style, { prog: { done: [1, 2] } }); await go(p, "#/day/2"); await p.waitForTimeout(400);
        for (const [sel, want] of [["#app .cw.dnav a.pv", "matrix(1, 0, 0, 1, 3, 0)"], ["#app .cw.dnav a.nx", "matrix(1, 0, 0, 1, -3, 0)"]]) { await p.hover(sel); await p.waitForTimeout(300); const t = await p.$eval(sel, (e) => getComputedStyle(e.querySelector(":scope>svg")).transform); ok("4", t === want, `${tag} ${sel} nudge ${t}`); }
        await p.ctx.close(); }
      // ---- 7. icon motion ----
      { const p = await mk(w, style, { prog: { done: [] } });
        const T = [["#/", '#app [data-a="rnd"]', "rot"], ["#/word/80-0", '#app [data-a="rnd"]', "rot"], ["#/word/80-0", '#app [data-a="card"]', "dl"], ["#/word/80-0", '#app [data-a="share"]', "sr"], ["#/word/80-0", "#app a.mib", "bk"], ["#/surah/80", "#app a.mib", "bk"], ["#/surah/80", '#app [data-a="share"]', "sr"], ["#/nope", '#app [data-a="rnd"]', "rot"]];
        const WANT = { rot: "matrix(0.965926, 0.258819, -0.258819, 0.965926, 0, 0)", dl: "matrix(1, 0, 0, 1, 0, 2)", sr: "matrix(1, 0, 0, 1, 2, -2)", bk: "matrix(1, 0, 0, 1, 0, -2)" };
        for (const [h, sel, k] of T) {
          await go(p, h); await p.mouse.move(1, 1); await p.waitForTimeout(250);
          const tr = () => p.$eval(sel, (e) => getComputedStyle(e.querySelector(":scope>svg")).transform);
          const rest = await tr(), dur = await p.$eval(sel, (e) => getComputedStyle(e.querySelector(":scope>svg")).transitionDuration);
          ok("7", rest === "none" && dur.split(",")[0].trim() === "0.2s", `${tag} ${h} ${sel} rest ${rest} dur ${dur}`);
          if (w === 1440) { await p.hover(sel); await p.waitForTimeout(300); const t = await tr(); ok("7", t === WANT[k], `${tag} ${h} ${sel} hover ${t}`); await p.mouse.move(1, 1); await p.waitForTimeout(300); }
          await p.keyboard.press("Shift"); await p.$eval(sel, (e) => e.focus()); await p.waitForTimeout(300); const f = await tr(); ok("7", f === WANT[k], `${tag} ${h} ${sel} focus-visible ${f}`);
          await p.$eval(sel, (e) => e.blur()); await p.waitForTimeout(300);
          const box = await p.$eval(sel, (e) => { e.scrollIntoView({ block: "center" }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
          await p.mouse.move(box.x, box.y); await p.mouse.down(); await p.waitForTimeout(300); const pr = await tr(); await p.mouse.move(1, 1); await p.mouse.up(); await p.waitForTimeout(250);
          ok("7", pr === WANT[k], `${tag} ${h} ${sel} press ${pr}`);
          await go(p, h);
        }
        // nothing else moves: bottom nav, gear, social icons, other buttons' icons
        await go(p, "#/"); await p.waitForTimeout(250);
        if (w === 1440) for (const sel of ["#nv a.t >> nth=1", ".strip .so >> nth=0", '#app a[href="#/surahs"].btn']) { await p.hover(sel); await p.waitForTimeout(300); const t = await p.$eval(sel, (e) => { const s = e.querySelector("svg"); return getComputedStyle(s).transform; }); ok("7", t === "none", `${tag} ${sel} icon stays (${t})`); await p.mouse.move(1, 1); }
        await p.ctx.close(); }
      for (const mode of ["cm", "rm"]) { // motion off and reduced motion: no icon moves
        const p = await mk(w, style, mode === "cm" ? { cm: true } : { rm: true }); await go(p, "#/word/80-0");
        for (const sel of ['#app [data-a="rnd"]', '#app [data-a="card"]', '#app [data-a="share"]', "#app a.mib"]) { await p.$eval(sel, (e) => e.focus()); await p.keyboard.press("Shift"); await p.$eval(sel, (e) => e.focus()); await p.waitForTimeout(250); const t = await p.$eval(sel, (e) => getComputedStyle(e.querySelector(":scope>svg")).transform); ok("7", t === "none", `${tag} ${mode} ${sel} ${t}`); }
        await p.ctx.close(); }
    }
    // static "كل السور" lifts too
    { const ctx = await br.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage(); await p.goto(base + "/surah/abasa.html", { waitUntil: "load" }); await p.hover("a.mib"); await p.waitForTimeout(300); const t = await p.$eval("a.mib", (e) => getComputedStyle(e.querySelector("svg")).transform); ok("7", t === "matrix(1, 0, 0, 1, 0, -2)", "static surah كل السور hover " + t); await ctx.close(); }
    // ---- 6. landscape nav: compact on short landscape phones, portrait unchanged ----
    for (const [vw, vh] of [[844, 390], [667, 375], [568, 320], [932, 430]]) for (const style of ["glass", "shade"]) {
      const p = await mk(vw, style, { vp: { width: vw, height: vh }, touch: true }); await go(p, "#/word/80-0");
      const n = await p.evaluate(() => { const nv = document.getElementById("nv"), r = nv.getBoundingClientRect(), sp = nv.querySelector(".t span"), sr = sp.getBoundingClientRect(); return { cover: innerHeight - r.top, h: r.height, labelW: sr.width, labels: [...nv.querySelectorAll(".t span")].map((s) => s.textContent).join(","), H: innerHeight }; });
      ok("6", n.cover / n.H <= 0.15 + 1e-9 && n.h === 40 && n.labelW <= 1 && n.labels === "الرئيسية,السور,التحدي,اختبر نفسك", `${vw}x${vh}/${style} ${JSON.stringify(n)} ${(100 * n.cover / n.H).toFixed(1)}%`);
      await p.ctx.close();
    }
    for (const [vw, vh] of [[390, 844], [320, 640]]) { const p = await mk(vw, "glass", { vp: { width: vw, height: vh }, touch: true }); const n = await p.evaluate(() => { const nv = document.getElementById("nv"), r = nv.getBoundingClientRect(); return { h: r.height, bottom: innerHeight - r.bottom, lw: nv.querySelector(".t span").getBoundingClientRect().width }; }); ok("6", n.h === 64 && n.bottom === 20 && n.lw > 10, `portrait ${vw}x${vh} ${JSON.stringify(n)}`); await p.ctx.close(); }
  } finally { await br.close(); server.close(); }
  console.log(JSON.stringify(R)); console.log(fails.length ? "FAIL (" + fails.length + ")\n" + fails.slice(0, 40).join("\n") : "ALL PASS");
})();
