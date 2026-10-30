// One-pass checks for this task's items, app + static, 390 and 1440 (Chromium), plus M5 on WebKit iPhone.
const REPO = require("path").resolve(__dirname, "../..").split(require("path").sep).join("/");
const pw = require("playwright");
const fs = require("fs"); const { serve } = require("./lib.js");
const PUB = REPO + "/public";
const R = {}; let checks = 0; const fails = [];
const ok = (item, c, m) => { checks++; R[item] = R[item] || { n: 0, f: 0 }; R[item].n++; if (!c) { R[item].f++; fails.push(item + ": " + m); } };
const title = (h) => (h.match(/<title>([^<]*)<\/title>/) || [])[1];
const wordFiles = fs.readdirSync(PUB + "/word"), surahFiles = fs.readdirSync(PUB + "/surah");
const W2F = {}, S2F = {};
for (const f of wordFiles) { const h = fs.readFileSync(PUB + "/word/" + f, "utf8"); W2F[/href="\/#\/word\/([\d-]+)"/.exec(h)[1]] = { f, title: title(h), src: (h.match(/<div class="mn">[^<]*<\/div><div class="m">([^<]*)<\/div>/) || [])[1], pill: /<a class="pill" href="\/#\/word\/[\d-]+">[\s\S]*?<\/svg>([^<]*)<\/a>/.exec(h)[1] }; }
for (const f of surahFiles) { const h = fs.readFileSync(PUB + "/surah/" + f, "utf8"); S2F[/href="\/#\/surah\/(\d+)"/.exec(h)[1]] = { f, title: title(h), pill: /<a class="pill" href="\/#\/surah\/\d+">[\s\S]*?<\/svg>([^<]*)<\/a>/.exec(h)[1] }; }
const legalT = {}; for (const k of ["about", "privacy", "terms", "rights"]) legalT[k] = title(fs.readFileSync(PUB + "/" + k + "/index.html", "utf8"));

(async () => {
  const { server, base } = await serve(); const cr = await pw.chromium.launch(), wk = await pw.webkit.launch();
  const mk = async (br, w, extra = {}, prog) => {
    const ctx = await br.newContext({ viewport: { width: w, height: w < 800 ? 844 : 900 }, ...(w < 800 ? { hasTouch: true, isMobile: br === cr } : {}), ...extra });
    await ctx.addInitScript((pg) => { localStorage.setItem("gq-set", JSON.stringify({ style: "glass", mode: "light", pal: "def", gl: 3, gv: 2, snd: false, cm: true })); localStorage.setItem("gq-ld", "1"); if (pg) localStorage.setItem("gq-prog", JSON.stringify(pg)); window.confirm = () => { window.__confirmCalled = true; return true; }; }, prog || null);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.errs = errs; p.ctx = ctx; return p;
  };
  const app = async (p) => { await p.goto(base + "/", { waitUntil: "load" }); await p.waitForSelector("#app h1"); await p.evaluate(() => document.fonts.ready); };
  const go = async (p, h) => { await p.evaluate((h) => { location.hash = h; }, h); await p.waitForTimeout(160); };
  try {
    for (const w of [390, 1440]) {
      const p = await mk(cr, w); await app(p);
      const D = await p.evaluate(() => ({ W: W.map((x) => ({ id: x.id, slug: x.slug, src: x.src })), S: S.map((s) => ({ num: s.num, slug: s.slug })) }));
      // ---- M2 sharing: slugs, layout, share payload, copy fallback ----
      for (const x of D.W) ok("M2", W2F[x.id] && W2F[x.id].f === x.slug + ".html", `${w} word ${x.id} slug ${x.slug} vs ${W2F[x.id] && W2F[x.id].f}`);
      for (const s of D.S) ok("M2", S2F[s.num] && S2F[s.num].f === s.slug + ".html", `${w} surah ${s.num} slug ${s.slug}`);
      for (const [h, kind] of [["#/word/80-0", "word"], ["#/word/114-0", "word"], ["#/surah/80", "surah"], ["#/surah/78", "surah"]]) {
        await go(p, h);
        const L = await p.evaluate(() => { const pr = document.querySelector("#app .acts.v3 .pr"); const b = [...pr.querySelectorAll(".btn")].map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim(), o: e.classList.contains("o"), w: r.width, y: r.top, svg: !!e.querySelector("svg") }; }); return b; });
        const want = kind === "word" ? ["حفظ كصورة", "مشاركة"] : ["كل السور", "مشاركة"];
        ok("M2", L.length === 2 && L[0].t === want[0] && L[1].t === want[1], `${w} ${h} pair ${JSON.stringify(L.map((x) => x.t))}`);
        ok("M2", L.every((x) => x.o && x.svg) && Math.abs(L[0].w - L[1].w) < 0.5 && Math.abs(L[0].y - L[1].y) < 0.5, `${w} ${h} equal outlined row ${JSON.stringify(L)}`);
        // share sheet available
        await p.evaluate(() => { window.__sh = null; Object.defineProperty(navigator, "share", { value: (d) => { window.__sh = d; return Promise.resolve(); }, configurable: true, writable: true }); });
        await p.click('#app [data-a="share"]'); await p.waitForTimeout(80);
        const sh = await p.evaluate(() => window.__sh);
        const id = h.split("/").pop(), exp = kind === "word" ? W2F[id] : S2F[id];
        ok("M2", sh && sh.url === base + "/" + kind + "/" + exp.f && sh.title === exp.title, `${w} ${h} share ${JSON.stringify(sh)} want ${exp.f} / ${exp.title}`);
        const st = await p.request.get(sh.url); ok("M2", st.status() === 200, `${w} ${h} shared url status ${st.status()}`);
        // no share sheet: copy + toast
        await p.evaluate(() => { Object.defineProperty(navigator, "share", { value: undefined, configurable: true, writable: true }); window.__cp = null; Object.defineProperty(navigator, "clipboard", { value: { writeText: (t) => { window.__cp = t; return Promise.resolve(); } }, configurable: true }); });
        await p.click('#app [data-a="share"]'); await p.waitForTimeout(120);
        const cp = await p.evaluate(() => ({ cp: window.__cp, toast: (document.querySelector(".toast") || {}).textContent }));
        ok("M2", cp.cp === base + "/" + kind + "/" + exp.f && cp.toast && cp.toast.trim() === "تم نسخ الرابط", `${w} ${h} copy ${JSON.stringify(cp)}`);
        await p.evaluate(() => document.querySelectorAll(".toast").forEach((t) => t.remove()));
      }
      // ---- M3 titles ----
      for (const x of D.W) { await p.evaluate((h) => { location.hash = h; }, "#/word/" + x.id); const t = await p.evaluate(() => document.title); ok("M3", t === W2F[x.id].title, `${w} word ${x.id} title ${t} vs ${W2F[x.id].title}`); }
      for (const s of D.S) { await p.evaluate((h) => { location.hash = h; }, "#/surah/" + s.num); const t = await p.evaluate(() => document.title); ok("M3", t === S2F[s.num].title, `${w} surah ${s.num} title ${t}`); }
      const TT = { "#/": "غريب القرآن - معاني كلمات جزء عم", "#/surahs": "السور | غريب القرآن", "#/challenge": "تحدي غريب عمّ | غريب القرآن", "#/day/1": "اليوم 1 | غريب القرآن", "#/day/7": "اليوم 7 | غريب القرآن", "#/quiz": "اختبر نفسك | غريب القرآن", "#/nope": "404 | غريب القرآن", "#/word/999-9": "404 | غريب القرآن" };
      for (const k of ["about", "privacy", "terms", "rights"]) TT["#/" + k] = legalT[k];
      for (const [h, t] of Object.entries(TT)) { await go(p, h); const got = await p.evaluate(() => document.title); ok("M3", got === t, `${w} ${h} title ${got} want ${t}`); }
      // ---- S3 shell, S13 h1 ----
      await go(p, "#/surahs"); await p.click("#nv a.t >> nth=2"); await p.waitForTimeout(200);
      const s3 = await p.evaluate(() => ({ mains: document.querySelectorAll("main").length, app: document.querySelector("main#app.wrap") ? 1 : 0, nv: document.querySelector("#nv").getAttribute("aria-label"), cur: [...document.querySelectorAll("#nv [aria-current]")].map((a) => a.getAttribute("href") + "=" + a.getAttribute("aria-current")), act: document.activeElement.tagName + ":" + document.activeElement.textContent.trim().slice(0, 12), y: scrollY }));
      ok("S3", s3.mains === 1 && s3.app === 1 && s3.nv === "التنقل الرئيسي", `${w} shell ${JSON.stringify(s3)}`);
      ok("S3", s3.cur.length === 1 && s3.cur[0] === "#/challenge=page", `${w} aria-current ${s3.cur}`);
      ok("S3", s3.act.startsWith("H1:") && s3.y === 0, `${w} focus to heading ${s3.act} y=${s3.y}`);
      for (const h of ["#/", "#/word/80-0", "#/surah/80", "#/day/1", "#/quiz", "#/about"]) { await go(p, h); const a = await p.evaluate(() => ({ t: document.activeElement.tagName, ring: getComputedStyle(document.activeElement).outlineStyle })); ok("S3", a.t === "H1" && a.ring === "none", `${w} ${h} focus ${JSON.stringify(a)}`); }
      await go(p, "#/word/80-0"); const s13 = await p.evaluate(() => { const h = document.querySelector("#app .cols .card h1.wd.q"); return h && h.textContent; }); ok("S13", !!s13, `${w} word h1 ${s13}`);
      // ---- L5 gear before content in tab order; footer clear of the nav at scroll end ----
      const l5 = await p.evaluate(() => { const g = document.getElementById("gear"), a = document.getElementById("app"); return !!(g.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING); }); ok("L5", l5, `${w} gear precedes #app`);
      await p.reload(); await p.waitForSelector("#app h1"); await p.keyboard.press("Tab"); const ft = await p.evaluate(() => document.activeElement.id); ok("L5", ft === "gear", `${w} first Tab lands on ${ft}`);
      if (w < 800) for (const h of ["#/", "#/surahs", "#/word/80-0", "#/surah/80", "#/challenge", "#/day/1", "#/quiz", "#/about"]) { await go(p, h); await p.evaluate(() => scrollTo(0, 1e6)); await p.waitForTimeout(80); const c = await p.evaluate(() => { const f = document.querySelector("#app footer").getBoundingClientRect(), n = document.querySelector("#nv").getBoundingClientRect(); return { fb: f.bottom, nt: n.top }; }); ok("L5", c.fb <= c.nt - 20, `${w} ${h} footer ${c.fb} vs nav ${c.nt}`); }
      // ---- S2 sheets ----
      await go(p, "#/word/80-0");
      await p.focus("#gear"); await p.keyboard.press("Enter"); await p.waitForTimeout(150);
      let s2 = await p.evaluate(() => { const pn = document.querySelector("#sh .p"); return { open: document.querySelector("#sh").classList.contains("open"), role: pn.getAttribute("role"), modal: pn.getAttribute("aria-modal"), label: pn.getAttribute("aria-label"), focus: document.activeElement === pn }; });
      ok("S2", s2.open && s2.role === "dialog" && s2.modal === "true" && s2.label === "الإعدادات" && s2.focus, `${w} settings open ${JSON.stringify(s2)}`);
      let inside = true; for (let i = 0; i < 40; i++) { await p.keyboard.press(i % 7 === 6 ? "Shift+Tab" : "Tab"); inside = inside && (await p.evaluate(() => document.querySelector("#sh .p").contains(document.activeElement))); } ok("S2", inside, `${w} Tab stays inside settings`);
      await p.evaluate(() => document.querySelector('#sh [data-m="dark"]').focus()); await p.keyboard.press("Enter"); await p.waitForTimeout(80);
      ok("S2", await p.evaluate(() => document.activeElement.getAttribute("data-m") === "dark"), `${w} focus kept after a setting change`);
      await p.evaluate(() => document.querySelector('#sh [data-m="light"]').click());
      await p.keyboard.press("Escape"); await p.waitForTimeout(80);
      s2 = await p.evaluate(() => ({ open: document.querySelector("#sh").classList.contains("open"), act: document.activeElement.id })); ok("S2", !s2.open && s2.act === "gear", `${w} Esc closes settings, focus back ${JSON.stringify(s2)}`);
      await p.click('#app [data-a="card"]'); await p.waitForTimeout(200);
      s2 = await p.evaluate(() => { const pn = document.querySelector("#sh .p"); return { label: pn.getAttribute("aria-label"), modal: pn.getAttribute("aria-modal"), focus: document.activeElement === pn }; });
      ok("S2", s2.label === "حفظ كصورة" && s2.modal === "true" && s2.focus, `${w} save sheet ${JSON.stringify(s2)}`);
      // ---- L6 size text direction ----
      const l6 = await p.evaluate(() => [...document.querySelectorAll("#sh .opt2 bdi")].map((b) => { const r = document.createRange(), t = b.firstChild, s = t.textContent, i = s.indexOf("×"); r.setStart(t, 0); r.setEnd(t, i); const a = r.getBoundingClientRect(); r.setStart(t, i + 1); r.setEnd(t, s.length); const c = r.getBoundingClientRect(); return { s, firstLeft: a.left < c.left, dir: getComputedStyle(b).direction }; }));
      ok("L6", l6.length === 2 && l6.every((x) => x.firstLeft && x.dir === "ltr") && l6[0].s === "1080×1350", `${w} size text ${JSON.stringify(l6)}`);
      await p.click('#sh [data-a="close"]'); await p.waitForTimeout(80);
      ok("S2", await p.evaluate(() => !document.querySelector("#sh").classList.contains("open") && document.activeElement.getAttribute("data-a") === "card"), `${w} close returns focus to the save button`);
      // ---- S6/S7 search ----
      await go(p, "#/");
      const s6 = await p.evaluate(() => { const q = document.getElementById("q"); return { type: q.type, ek: q.getAttribute("enterkeyhint") }; }); ok("S6", s6.type === "search" && s6.ek === "search", `${w} input ${JSON.stringify(s6)}`);
      await p.fill("#q", "قضب"); await p.press("#q", "Enter"); await p.waitForTimeout(200);
      const top = await p.evaluate(() => rank("قضب")[0].id), hNow = await p.evaluate(() => location.hash); ok("S6", hNow === "#/word/" + top, `${w} Enter opens top result ${hNow}`);
      await go(p, "#/"); await p.fill("#q", "زززز"); await p.press("#q", "Enter"); await p.waitForTimeout(200);
      const s6b = await p.evaluate(() => ({ h: location.hash, act: document.activeElement.id, link: (() => { const a = document.querySelector("#res .card a"); return a && a.getAttribute("href") + "|" + a.textContent; })() }));
      ok("S6", s6b.h === "#/" && s6b.act !== "q", `${w} Enter without results blurs ${JSON.stringify(s6b)}`);
      ok("S7", s6b.link === "#/surahs|تصفّح بالسورة", `${w} no-results link ${s6b.link}`);
      const s7 = await p.evaluate(() => { const bad = []; let n = 0; const strip = (x) => x.replace(/[\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g, "");
        const vars = (x) => [x, strip(x), strip(x).replace(/ة/g, "ه"), strip(x).replace(/ه/g, "ة"), strip(x).replace(/ى/g, "ي"), strip(x).replace(/ي/g, "ى"), strip(x).replace(/[أإآٱ]/g, "ا"), strip(x).replace(/ا/g, "أ"), strip(x).split("").join("ـ")];
        for (const w of W) for (const v of vars(w.word)) { n++; if (!rank(v).includes(w)) bad.push(w.word + " <- " + v); }
        const shown = document.querySelector("#res") ? 1 : 0; return { n, bad: bad.slice(0, 5), nb: bad.length }; });
      ok("S7", s7.nb === 0, `${w} normalization misses ${s7.nb}/${s7.n} ${JSON.stringify(s7.bad)}`); R.S7n = s7.n;
      await p.fill("#q", "قَضْبًا"); await p.waitForTimeout(250); const disp = await p.evaluate(() => document.querySelector("#res .row .w").textContent); ok("S7", disp === "قَضْبًا", `${w} displayed text unchanged ${disp}`);
      // ---- S5 subtitle ----
      await go(p, "#/challenge"); const sub = await p.evaluate(() => document.querySelector("#app .sub").textContent); ok("S5", sub === "30 يومًا، يُفتح كل يوم بعد إتمام اليوم الذي قبله، مع مقطع مصوّر.", `${w} subtitle ${sub}`);
      // ---- S1 scroll padding (mobile) ----
      if (w < 800) { const sp = await p.evaluate(() => getComputedStyle(document.documentElement).scrollPaddingBottom); ok("S1", sp === "84px", `${w} scroll-padding-bottom ${sp}`); }
      await p.ctx.close(); ok("errors", p.errs.length === 0, `${w} page errors ${p.errs}`);
      // ---- S9 reset confirmation ----
      const q = await mk(cr, w, {}, { done: [1, 2] }); await app(q); await go(q, "#/challenge");
      await q.click('#app [data-a="reset"]'); await q.waitForTimeout(120);
      let s9 = await q.evaluate(() => { const c = document.querySelector("#app .chc .rcf"); return { inCard: !!c, text: c && c.firstElementChild.textContent, btns: c && [...c.querySelectorAll("button")].map((b) => b.className + ":" + b.textContent), focus: document.activeElement.getAttribute("data-a"), conf: !!window.__confirmCalled }; });
      ok("S9", s9.inCard && s9.text === "هل تريد إعادة التحدي؟ سيُحذف تقدّمك." && JSON.stringify(s9.btns) === JSON.stringify(["btn:إعادة التحدي", "btn o:إلغاء"]) && s9.focus === "rsno" && !s9.conf, `${w} confirm ${JSON.stringify(s9)}`);
      await q.click('#app [data-a="rsno"]'); await q.waitForTimeout(80);
      s9 = await q.evaluate(() => ({ gone: !document.querySelector("#app .rcf"), wrap: document.querySelector("#app .chc").style.flexWrap, done: JSON.parse(localStorage.getItem("gq-prog")).done, focus: document.activeElement.getAttribute("data-a") }));
      ok("S9", s9.gone && s9.wrap === "" && s9.done.length === 2 && s9.focus === "reset", `${w} cancel ${JSON.stringify(s9)}`);
      await q.click('#app [data-a="reset"]'); await q.click('#app [data-a="rsyes"]'); await q.waitForTimeout(120);
      s9 = await q.evaluate(() => ({ done: JSON.parse(localStorage.getItem("gq-prog")).done, conf: !!window.__confirmCalled, reset: !!document.querySelector('#app [data-a="reset"]') }));
      ok("S9", s9.done.length === 0 && !s9.conf && !s9.reset, `${w} confirm resets ${JSON.stringify(s9)}`);
      await q.ctx.close(); ok("errors", q.errs.length === 0, `${w} S9 page errors ${q.errs}`);
      // ---- static pages: M4 source line, S14 label ----
      const sp = await mk(cr, w);
      for (const id of ["80-0", "114-0", "89-2", "78-1"]) {
        await sp.goto(base + "/word/" + W2F[id].f, { waitUntil: "load" }); await sp.evaluate(() => document.fonts.ready);
        const st = await sp.evaluate(() => { const m = document.querySelector("main .cols .card .mn + .m"); const cs = m && getComputedStyle(m); return m && { t: m.textContent, fs: cs.fontSize, c: cs.color, lh: cs.lineHeight, gap: m.getBoundingClientRect().top - document.querySelector("main .cols .card .mn").getBoundingClientRect().bottom }; });
        await app(sp); await go(sp, "#/word/" + id);
        const ap = await sp.evaluate(() => { const m = document.querySelector("#app .cols .card .mn + .m"); const cs = getComputedStyle(m); return { t: m.textContent, fs: cs.fontSize, c: cs.color, lh: cs.lineHeight, gap: m.getBoundingClientRect().top - document.querySelector("#app .cols .card .mn").getBoundingClientRect().bottom }; });
        ok("M4", st && st.t === ap.t && st.t === D.W.find((x) => x.id === id).src && st.fs === ap.fs && st.c === ap.c && st.lh === ap.lh && Math.abs(st.gap - ap.gap) < 0.5, `${w} ${id} static ${JSON.stringify(st)} app ${JSON.stringify(ap)}`);
      }
      await sp.ctx.close();
    }
    for (const x of Object.values(W2F)) { ok("M4", x.src && x.src.length > 0, "source on " + x.f); ok("S14", x.pill === "تصفّح الموقع", "pill " + x.f + " " + x.pill); }
    for (const x of Object.values(S2F)) ok("S14", x.pill === "تصفّح الموقع", "pill " + x.f + " " + x.pill);
    ok("S14", !fs.readdirSync(PUB + "/word").concat(fs.readdirSync(PUB + "/surah")).some((f) => fs.readFileSync(PUB + (fs.existsSync(PUB + "/word/" + f) ? "/word/" : "/surah/") + f, "utf8").includes("افتح في الموقع")), "old label gone from static pages");

    // ---- M5 scroll restore: Chromium 390/1440 and WebKit iPhone ----
    for (const [nm, br, w, dev] of [["cr390", cr, 390], ["cr1440", cr, 1440], ["wk-iphone", wk, 390, pw.devices["iPhone 13"]]]) {
      const ctx = await br.newContext(dev ? { ...dev } : { viewport: { width: w, height: 800 } });
      await ctx.addInitScript(() => { localStorage.setItem("gq-set", JSON.stringify({ style: "glass", mode: "light", pal: "def", gl: 3, gv: 2, snd: false, cm: true })); localStorage.setItem("gq-ld", "1"); });
      const p = await ctx.newPage(); await app(p);
      const y = async () => p.evaluate(() => Math.round(scrollY));
      await go(p, "#/surahs"); await p.evaluate(() => scrollTo(0, 700)); await p.waitForTimeout(150); const y1 = await y();
      await p.click("#app .list.sl a.row >> nth=12"); await p.waitForTimeout(250); const yNew = await y();
      await p.evaluate(() => scrollTo(0, 260)); await p.waitForTimeout(150); const y2 = await y();
      await p.click("#app .list.rs a.row >> nth=0"); await p.waitForTimeout(250); const yNew2 = await y();
      await p.goBack(); await p.waitForTimeout(300); const b1 = await y();
      await p.goBack(); await p.waitForTimeout(300); const b2 = await y();
      await p.goForward(); await p.waitForTimeout(300); const f1 = await y();
      await p.goForward(); await p.waitForTimeout(300); const f2 = await y();
      ok("M5", y1 > 0 && yNew === 0 && yNew2 === 0, `${nm} new navigations start at top (${y1},${yNew},${yNew2})`);
      ok("M5", Math.abs(b1 - y2) <= 1 && Math.abs(b2 - y1) <= 1, `${nm} back restores ${b1}/${y2} ${b2}/${y1}`);
      ok("M5", Math.abs(f1 - y2) <= 1 && f2 === 0, `${nm} forward restores ${f1}/${y2} ${f2}/0`);
      await p.reload(); await p.waitForSelector("#app h1"); await p.waitForTimeout(400); const rl = await y(); ok("M5", rl === f2, `${nm} reload keeps the entry position ${rl}`);
      await ctx.close();
    }
    // ---- S1 focus never under the nav; S6 focus scroll (touch) ----
    { const p = await mk(cr, 390); await app(p); await go(p, "#/day/1"); await p.evaluate(() => scrollTo(0, 0));
      await p.evaluate(() => document.querySelector('#app [data-a="done"]').focus()); await p.waitForTimeout(100);
      const r = await p.evaluate(() => ({ b: document.querySelector('#app [data-a="done"]').getBoundingClientRect().bottom, n: document.querySelector("#nv").getBoundingClientRect().top }));
      ok("S1", r.b <= r.n + 0.5, `day done button bottom ${r.b} vs nav top ${r.n}`);
      await go(p, "#/word/80-0"); await p.evaluate(() => scrollTo(0, 0)); await p.keyboard.press("Tab"); for (let i = 0; i < 12; i++) { await p.keyboard.press("Tab"); const c = await p.evaluate(() => { const e = document.activeElement, r = e.getBoundingClientRect(), n = document.querySelector("#nv"), nr = n.getBoundingClientRect(); return { t: e.textContent.trim().slice(0, 10), b: r.bottom, n: nr.top, inNav: n.contains(e), vis: r.bottom > 0 && r.top < innerHeight }; }); if (!c.inNav && c.vis) ok("S1", c.b <= c.n + 0.5, `tab ${c.t} bottom ${c.b} nav ${c.n}`); }
      await go(p, "#/"); await p.evaluate(() => scrollTo(0, 0)); await p.tap("#q"); await p.waitForTimeout(450);
      const s6 = await p.evaluate(() => ({ top: document.querySelector(".sb").getBoundingClientRect().top, gear: document.getElementById("gear").getBoundingClientRect().bottom, y: scrollY, max: document.documentElement.scrollHeight - innerHeight }));
      ok("S6", Math.abs(s6.top - (s6.gear + 12)) <= 1, `focus scroll ${JSON.stringify(s6)}`); await p.evaluate(() => document.getElementById("q").blur()); ok("S6", await p.evaluate(() => document.getElementById("app").style.minHeight === ""), "temporary room removed on blur");
      await p.ctx.close(); }
  } finally { await cr.close(); await wk.close(); server.close(); }
  console.log(JSON.stringify(R)); console.log("checks", checks, fails.length ? "FAIL (" + fails.length + ")\n" + fails.slice(0, 40).join("\n") : "ALL PASS");
})();
