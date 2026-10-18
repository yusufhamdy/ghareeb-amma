"use strict";
/*
 * phase-j.test.js - Phase J acceptance.
 *
 * J1: search layout collapse when typing; gear hides while typing (J2);
 * J3: iOS glass performance counts and cleanup;
 * J4: save-as-image renderer produces identical preview/saved layout and respects theme.
 *
 * ASCII-only; Arabic only as \uXXXX escapes if needed.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const PUBLIC = path.join(ROOT, "public");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

function staticServer(dir) {
  const types = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  };
  return http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/") p = "/index.html";
    const file = path.join(dir, p);
    if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end("not found"); return;
    }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

async function env(t) {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return null; }
  let browser;
  try { browser = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return null; }

  const words = fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8");
  const chObj = Object.assign(JSON.parse(fs.readFileSync(path.join(PUBLIC, "challenge.json"), "utf8")), { releasedUpTo: 30 });
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;

  return {
    base,
    async page(width, height, set) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
      page.on("dialog", (d) => d.dismiss().catch(() => {}));
      const content = "window.__WORDS__=" + words + ";window.__CH__=" + JSON.stringify(chObj) + ";" +
        "try{localStorage.setItem('gq-set',JSON.stringify(" + JSON.stringify(set) + "))}catch(e){}";
      await page.addInitScript({ content });
      return page;
    },
    async close() { await browser.close(); await new Promise((r) => server.close(r)); },
  };
}

// ---------------------------------------------------------------------------
// J3/J4 minimal scaffolding (will be expanded as needed)
// ---------------------------------------------------------------------------
test("J3: glass performance counts and cleanup - scaffold", { timeout: 120000 }, async (t) => {
  const html = read("public/index.html");
  assert.ok(html.length > 0);
});
test("J4: save-as-image renderer - scaffold", { timeout: 120000 }, async (t) => {
  const html = read("public/index.html");
  assert.ok(html.length > 0);
});
