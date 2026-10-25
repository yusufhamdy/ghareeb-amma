// Verify the QCORE fix (WebKit, iPhone 13). Usage: node qcore2.js [local|https://...]
const pw = require("playwright");
let BASE = process.argv[2] || "local";
const dev = pw.devices["iPhone 13"];
const fails = []; const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails.push(m); };
const waitSW = (p) => p.evaluate(async () => { await navigator.serviceWorker.ready; for (let i = 0; i < 50 && !navigator.serviceWorker.controller; i++) await new Promise((r) => setTimeout(r, 100)); return !!navigator.serviceWorker.controller; });
const precacheList = async (p) => p.evaluate(async () => { const t = await (await fetch("/sw.js", { cache: "no-store" })).text(); return { name: /CACHE_NAME = '([^']+)'/.exec(t)[1], list: [...t.match(/assetsToCache = \[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) }; });

(async () => {
  let srv = null; if (BASE === "local") { const { serve } = require("./lib.js"); srv = await serve(); BASE = srv.base; }
  console.log("BASE", BASE);
  // A. new service worker installs with every listed file cached
  { const br = await pw.webkit.launch(); const ctx = await br.newContext({ ...dev, serviceWorkers: "allow" }); const p = await ctx.newPage();
    await p.goto(BASE + "/", { waitUntil: "load" }); ok(await waitSW(p), "A: service worker controls the page");
    const { name, list } = await precacheList(p);
    const cached = await p.evaluate(async (n) => (await (await caches.open(n)).keys()).map((r) => new URL(r.url).pathname), name);
    const missing = list.filter((f) => !cached.includes(f));
    ok(name === "ghareeb-pwa-v30", "A: CACHE_NAME " + name);
    ok(["/quiz-core.js", "/migrate.js", "/firebase-config.js", "/word-gap.js"].every((f) => list.includes(f)), "A: precache list has the four scripts");
    ok(!missing.length, "A: all " + list.length + " precache files are in " + name + (missing.length ? " (missing " + missing + ")" : ""));
    await br.close(); }
  // B. just after a cache bump (cache = precache list only), network dropped -> quiz opens from cache
  { const br = await pw.webkit.launch(); const ctx = await br.newContext({ ...dev, serviceWorkers: "allow" }); const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(BASE + "/", { waitUntil: "load" }); await waitSW(p);
    const { name, list } = await precacheList(p);
    await p.evaluate(async ([n, l]) => { for (const k of await caches.keys()) await caches.delete(k); await (await caches.open(n)).addAll(l); }, [name, list]);
    await ctx.setOffline(true);
    await p.evaluate(() => { location.hash = "#/quiz" }); await p.reload({ waitUntil: "load" }).catch(() => {}); await p.waitForTimeout(3000);
    const s = await p.evaluate(() => ({ q: typeof window.QCORE, opts: document.querySelectorAll(".opts .opt").length, h1: (document.querySelector("#app h1") || {}).textContent }));
    ok(s.q === "object" && s.opts === 4, "B: offline right after the bump, quiz opens from cache " + JSON.stringify(s));
    ok(!errs.some((e) => /QCORE/.test(e)), "B: no QCORE error");
    await br.close(); }
  // C. only quiz-core.js blocked -> retry view, no uncaught error, Sentry.captureMessage called
  { const br = await pw.webkit.launch(); const ctx = await br.newContext({ ...dev, serviceWorkers: "block" }); const p = await ctx.newPage();
    await ctx.route(/\/quiz-core\.js/, (r) => r.abort()); await ctx.route(/sentry-cdn\.com/, (r) => r.abort());
    await ctx.addInitScript(() => { window.__sent = []; window.Sentry = { captureMessage: (m) => window.__sent.push(m) }; window.__unc = []; addEventListener("error", (e) => window.__unc.push(String(e.message)), true); });
    const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(BASE + "/#/quiz", { waitUntil: "load" }); await p.waitForTimeout(3000);
    const s = await p.evaluate(() => ({ q: typeof window.QCORE, h1: (document.querySelector("#app h1") || {}).textContent, retry: !!document.querySelector('#app [data-a="reload"]'), sent: window.__sent, unc: window.__unc.filter((m) => m && m !== "undefined") }));
    ok(s.q === "undefined", "C: quiz-core.js blocked");
    ok(s.h1 === "تعذّر تحميل الاختبار" && s.retry, "C: retry view shown (" + s.h1 + ")");
    ok(!errs.length && !s.unc.length, "C: no uncaught error " + JSON.stringify(errs.concat(s.unc)));
    ok(s.sent.length === 1 && /QCORE missing/.test(s.sent[0]), "C: Sentry.captureMessage called once " + JSON.stringify(s.sent));
    await p.click('#app [data-a="reload"]').catch(() => {}); await p.waitForLoadState("load"); await p.waitForTimeout(1500);
    ok((await p.evaluate(() => (document.querySelector("#app h1") || {}).textContent)) === "تعذّر تحميل الاختبار", "C: retry reloads (still blocked -> same view)");
    await br.close(); }
  if (srv) srv.server.close();
  console.log(fails.length ? "FAIL (" + fails.length + ")" : "ALL PASS");
})();
