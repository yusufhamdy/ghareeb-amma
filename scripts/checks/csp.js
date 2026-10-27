// Network origins and CSP violations on a deployed site (the preview), page by page.
//   node csp.js <base URL> [--sentry] [out.json]
// Visits: home and every tab, a word page, a surah page, a day page, the quiz (answering), the settings sheet,
// save image (the PNG is generated and saved), share (Web Share stubbed), the app's legal views, a static word,
// surah and legal page, the 404 page, an offline reload through the service worker, and the admin page (load,
// then the sign-in button: the popup's own requests are listed separately - its document has its own policy).
// With --sentry it also runs Sentry.captureMessage('csp-check') and waits for the event request to the ingest host.
// Records every request (origin, type, status or failure) and every securitypolicyviolation / CSP console error.
// Read-only: nothing is saved anywhere but the local output file; the admin is never signed in.
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const BASE = (process.argv[2] || "").replace(/\/$/, "");
const SENTRY = process.argv.includes("--sentry");
const OUT = process.argv.slice(3).find((a) => !a.startsWith("--")) || path.join(__dirname, "out/csp/observed.json");
if (!BASE) { console.error("usage: node csp.js <base URL> [--sentry] [out.json]"); process.exit(2); }

const VIOLATION_HOOK = () => {
  window.__csp = [];
  document.addEventListener("securitypolicyviolation", (e) => window.__csp.push({ dir: e.effectiveDirective, blocked: e.blockedURI, src: e.sourceFile, line: e.lineNumber, sample: e.sample }));
};

(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 400, height: 900 }, acceptDownloads: true });
  await ctx.addInitScript(VIOLATION_HOOK);
  await ctx.addInitScript(() => {
    try { localStorage.setItem("gq-ld", "1"); } catch (e) {}
    try { Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true }); Object.defineProperty(navigator, "share", { configurable: true, value: () => Promise.resolve() }); } catch (e) {}
  });
  const out = { base: BASE, steps: [], origins: {}, violations: [], consoleCsp: [], failed: [], popup: {} };
  let step = "start";
  const note = (url, type, status) => {
    let o; try { o = new URL(url); } catch (e) { return; }
    if (o.protocol === "data:" || o.protocol === "blob:") { o = { origin: o.protocol }; }
    const k = o.origin + (o.origin === "https://www.gstatic.com" ? "/" + (o.pathname || "").split("/")[1] : "");
    const r = (out.origins[k] = out.origins[k] || { types: {}, steps: [] });
    r.types[type] = (r.types[type] || 0) + 1;
    if (!r.steps.includes(step)) r.steps.push(step);
    if (status === "failed") out.failed.push({ step, url: url.slice(0, 160), type });
  };
  ctx.on("request", (r) => note(r.url(), r.resourceType()));
  ctx.on("requestfailed", (r) => { const f = r.failure(); if (!/ERR_ABORTED/.test(f && f.errorText || "")) note(r.url(), r.resourceType(), "failed"); });
  const p = await ctx.newPage();
  p.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) out.consoleCsp.push({ step, text: m.text().slice(0, 300) }); });
  const grab = async () => { const v = await p.evaluate(() => (window.__csp || []).splice(0)).catch(() => []); v.forEach((x) => out.violations.push(Object.assign({ step }, x))); };
  const go = async (name, url, fn) => {
    step = name; out.steps.push(name);
    if (url) await p.goto(BASE + url, { waitUntil: "load" });
    await p.waitForTimeout(1200);
    if (fn) await fn();
    await p.waitForTimeout(500);
    await grab();
  };
  const hash = (h) => p.evaluate((x) => { location.hash = x; }, h);

  await go("home", "/");
  for (const t of ["#/surahs", "#/challenge", "#/quiz", "#/"]) await go("tab " + t, null, () => hash(t));
  await go("word", null, () => hash("#/word/101-1"));
  await go("surah", null, () => hash("#/surah/78"));
  await go("day", null, async () => { await hash("#/day/1"); await p.waitForTimeout(800); const c = await p.$(".dcard"); if (c) await c.click(); });
  await go("quiz", null, async () => { await hash("#/quiz"); await p.waitForTimeout(800); const o = await p.$("#app .opt"); if (o) await o.click(); });
  await go("settings sheet", null, async () => { await hash("#/"); await p.waitForTimeout(500); await p.click("#gear"); await p.waitForTimeout(600); await p.keyboard.press("Escape"); });
  await go("save image", null, async () => {
    await hash("#/word/101-1"); await p.waitForTimeout(800); await p.click('#app [data-a="card"]'); await p.waitForTimeout(900);
    const dl = p.waitForEvent("download", { timeout: 15000 }).catch(() => null);
    await p.click('#sh [data-a="savepng"]').catch(() => {});
    const d = await dl; out.download = d ? d.suggestedFilename() : null;
    await p.keyboard.press("Escape");
  });
  await go("share", null, async () => { await p.click('#app [data-a="share"]').catch(() => {}); });
  for (const k of ["about", "privacy", "terms", "rights"]) await go("app legal " + k, null, () => hash("#/" + k));
  await go("static word", "/word/al-qariah-9.html");
  await go("static surah", "/surah/an-naba.html");
  for (const k of ["about", "privacy", "terms", "rights"]) await go("static legal " + k, "/" + k + "/");
  await go("404", "/no-such-page");
  // offline reload through the service worker (registered and controlling after a reload)
  await go("service worker ready", "/", async () => { await p.evaluate(() => navigator.serviceWorker && navigator.serviceWorker.ready); await p.reload({ waitUntil: "load" }); await p.waitForTimeout(1500); });
  await go("offline reload", null, async () => {
    await ctx.setOffline(true);
    await p.reload({ waitUntil: "load" }).catch((e) => out.failed.push({ step, url: "reload", type: String(e.message).slice(0, 120) }));
    await p.waitForTimeout(1500);
    out.offline = await p.evaluate(() => ({ title: document.title, words: typeof W !== "undefined" ? W.length : 0, controlled: !!(navigator.serviceWorker && navigator.serviceWorker.controller), qf: document.documentElement.classList.contains("qf"), font: [...document.fonts].filter((f) => /KFGQPC/.test(f.family)).map((f) => f.status) })).catch((e) => ({ error: e.message }));
    await ctx.setOffline(false);
  });
  if (SENTRY) {
    await go("sentry", "/", async () => {
      const sent = p.waitForRequest((r) => /ingest\.de\.sentry\.io/.test(r.url()), { timeout: 20000 }).catch(() => null);
      await p.evaluate(() => { window.Sentry.captureMessage("csp-check"); }); // the loader queues the call and loads the SDK
      const r = await sent;
      if (r) { const res = await r.response().catch(() => null); out.sentry = { url: r.url().replace(/sentry_key=[^&]+/, "sentry_key=..."), status: res ? res.status() : "no response" }; }
      else out.sentry = { error: "no request to the ingest host within 20s" };
    });
  }
  // admin: load, then open the sign-in popup and list what it loads (never signed in)
  await go("admin", "/admin/", async () => {
    await p.waitForTimeout(1500);
    const btn = await p.$('[data-a="in"], #app button');
    if (btn) {
      const pop = p.waitForEvent("popup", { timeout: 10000 }).catch(() => null);
      await btn.click().catch(() => {});
      const w = await pop;
      if (w) {
        const seen = {};
        w.on("request", (r) => { try { const o = new URL(r.url()).origin; seen[o] = (seen[o] || 0) + 1; } catch (e) {} });
        await w.waitForTimeout(4000);
        out.popup = { url: w.url().slice(0, 80), origins: seen };
        await w.close().catch(() => {});
      }
      await p.waitForTimeout(1500);
    }
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log("origins:"); for (const [k, v] of Object.entries(out.origins).sort()) console.log("  " + k + "  " + JSON.stringify(v.types) + "  [" + v.steps.slice(0, 6).join(", ") + (v.steps.length > 6 ? ", ..." : "") + "]");
  console.log("popup:", JSON.stringify(out.popup));
  console.log("offline:", JSON.stringify(out.offline), "download:", out.download, "sentry:", JSON.stringify(out.sentry || null));
  console.log("failed requests:", out.failed.length); out.failed.slice(0, 20).forEach((f) => console.log("  " + JSON.stringify(f)));
  console.log("CSP violations:", out.violations.length, "console CSP errors:", out.consoleCsp.length);
  out.violations.slice(0, 30).forEach((v) => console.log("  " + JSON.stringify(v)));
  out.consoleCsp.slice(0, 30).forEach((v) => console.log("  " + JSON.stringify(v)));
  await br.close();
  process.exitCode = out.violations.length || out.consoleCsp.length ? 1 : 0;
})();
