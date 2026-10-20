"use strict";
/*
 * phase-l.test.js - Phase L acceptance.
 *
 * L2: the pwa regression from K5 (qa-phase6 "0 page/console errors" failing
 * with three "A network error occurred." pageerrors on the offline reload)
 * must stay fixed. Root cause: K5 eagerly warmed three fonts with
 * document.fonts.load(...); offline those promises reject with no handler and
 * Chromium surfaces an unhandled rejection. The test drives the real app in
 * Chromium against a static server for public/, with the Firebase SDK URLs
 * stubbed to empty modules (so nothing but the page itself is exercised),
 * visits the home shell and one static word + surah page, then goes offline
 * and reloads: the service worker must serve the shell from cache, the page
 * must render, and zero pageerrors may be observed anywhere in the run.
 *
 * L3 tests are appended in the service-worker step.
 *
 * ASCII only (no Arabic literals): selectors are structural, page text is
 * never asserted here. Skips cleanly when Chromium is unavailable.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const SDK_BASE = "https://www.gstatic.com/firebasejs/10.14.1/";

function staticServer(root) {
  const types = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".woff2": "font/woff2", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml; charset=utf-8",
  };
  return http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

async function launchBrowser(t) {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return null; }
  try { return await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return null; }
}

test("L2: offline reload of the app shell renders with zero pageerrors", async (t) => {
  const browser = await launchBrowser(t);
  if (!browser) return;

  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const BASE = "http://127.0.0.1:" + server.address().port;
  t.after(async () => { await browser.close().catch(() => {}); server.close(); });

  const ctx = await browser.newContext();
  // The SDK imports must never touch the network; serve them as empty modules
  // so the only failures observed offline are real app problems.
  await ctx.route("**/gstatic.com/firebasejs/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: "export default {};\n" }));
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String((e && e.message) || e)));

  const waitFor = (sel, timeout) => page.waitForSelector(sel, { state: "attached", timeout: timeout || 12000 });

  // Online: boot the shell and register/activate the service worker.
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await waitFor("#app .sub");
  await waitFor("#q");
  const reg = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return null;
    return (await navigator.serviceWorker.ready.catch(() => null)) || null;
  });
  assert.ok(reg, "service worker must register and activate");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 15000 })
    .catch(() => {});

  // Online: the controlled pages render (word + surah statics from the cache
  // or the network - both paths must be clean), then back to the shell.
  await page.goto(BASE + "/word/al-falaq-4.html", { waitUntil: "domcontentloaded" });
  await waitFor(".wd");
  await page.goto(BASE + "/surah/abasa.html", { waitUntil: "domcontentloaded" });
  await waitFor(".shd");
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await waitFor("#app .sub");

  // Offline: the shell reload must come from the service-worker cache and
  // still render - with no unhandled font-loading rejections.
  await ctx.setOffline(true);
  let offlineRendered = false;
  try {
    await page.reload({ waitUntil: "domcontentloaded", timeout: 15000 });
    await waitFor("#q", 12000);
    offlineRendered = !!(await page.$("#q"));
  } catch (e) { /* asserted below */ }
  await ctx.setOffline(false).catch(() => {});

  assert.ok(offlineRendered, "offline reload of / must render the app shell from cache");
  assert.deepStrictEqual(pageErrors, [], "zero pageerrors across the whole run");
});

test("L3: /css/app.css and /theme-boot.js are precached and served offline", async (t) => {
  const browser = await launchBrowser(t);
  if (!browser) return;

  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const BASE = "http://127.0.0.1:" + server.address().port;
  t.after(async () => { await browser.close().catch(() => {}); server.close(); });

  const swText = fs.readFileSync(path.join(PUBLIC, "sw.js"), "utf8");
  const cacheName = (swText.match(/CACHE_NAME\s*=\s*'([^']+)'/) || [])[1] || "";
  assert.match(cacheName, /^ghareeb-pwa-v\d+$/, "CACHE_NAME stays in the ghareeb-pwa-vN pattern, no bump");

  const ctx = await browser.newContext();
  await ctx.route("**/gstatic.com/firebasejs/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: "export default {};\n" }));
  const page = await ctx.newPage();
  t.after(() => ctx.close().catch(() => {}));

  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#q", { state: "attached", timeout: 12000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; }).catch(() => {});
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, { timeout: 15000 }).catch(() => {});

  // The install-time precache list must hold the stylesheet and theme boot.
  const precached = await page.evaluate(async (name) => {
    const c = await caches.open(name);
    const keys = (await c.keys()).map((r) => new URL(r.url).pathname);
    return { hasCss: keys.includes("/css/app.css"), hasBoot: keys.includes("/theme-boot.js") };
  }, cacheName);
  assert.ok(precached.hasCss, cacheName + " must precache /css/app.css");
  assert.ok(precached.hasBoot, cacheName + " must precache /theme-boot.js");

  // Offline: both must be served from the cache (network is gone).
  await ctx.setOffline(true);
  const served = await page.evaluate(async () => {
    const get = async (u) => { try { const r = await fetch(u); return { ok: r.ok, status: r.status, len: (await r.text()).length }; } catch (e) { return { ok: false, status: 0, len: 0 }; } };
    return { css: await get("/css/app.css"), boot: await get("/theme-boot.js") };
  });
  await ctx.setOffline(false).catch(() => {});
  assert.ok(served.css.ok && served.css.len > 0, "/css/app.css must be served from cache offline");
  assert.ok(served.boot.ok && served.boot.len > 0, "/theme-boot.js must be served from cache offline");
});

test("L3: activation deletes caches left by other pwa versions", async (t) => {
  const browser = await launchBrowser(t);
  if (!browser) return;

  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const BASE = "http://127.0.0.1:" + server.address().port;
  t.after(async () => { await browser.close().catch(() => {}); server.close(); });

  const swText = fs.readFileSync(path.join(PUBLIC, "sw.js"), "utf8");
  const cacheName = (swText.match(/CACHE_NAME\s*=\s*'([^']+)'/) || [])[1] || "";

  // Simulate an upgrade: plant a cache from an older version on the origin
  // *before* the service worker ever registers (via a same-origin page that
  // does not register one), then load the app. The activate handler must
  // delete every ghareeb-pwa-* cache that is not the current version.
  const ctx2 = await browser.newContext();
  await ctx2.route("**/gstatic.com/firebasejs/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/javascript", body: "export default {};\n" }));
  const page2 = await ctx2.newPage();
  t.after(() => ctx2.close().catch(() => {}));

  await page2.goto(BASE + "/manifest.json", { waitUntil: "domcontentloaded" });
  const planted = await page2.evaluate(async () => {
    const old = await caches.open("ghareeb-pwa-v18");
    await old.put("/stale-old-version", new Response("old"));
    return caches.keys();
  });
  assert.ok(planted.includes("ghareeb-pwa-v18"), "old-version cache must exist before activation");

  await page2.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page2.evaluate(async () => { await navigator.serviceWorker.ready; }).catch(() => {});
  await page2.waitForFunction(async (keep) => {
    const names = await caches.keys();
    return names.includes(keep) && !names.includes("ghareeb-pwa-v18");
  }, cacheName, { timeout: 15000 }).catch(() => {});

  const after = await page2.evaluate(async (keep) => {
    const names = await caches.keys();
    return { names, hasCurrent: names.includes(keep) };
  }, cacheName);
  assert.ok(after.hasCurrent, "current cache " + cacheName + " must survive activation");
  assert.ok(!after.names.includes("ghareeb-pwa-v18"), "old-version cache must be deleted on activation");
});
