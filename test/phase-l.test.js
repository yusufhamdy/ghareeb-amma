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
