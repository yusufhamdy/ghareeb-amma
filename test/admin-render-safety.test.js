"use strict";
/*
 * admin-render-safety.test.js - stored challenge data cannot inject markup into the admin console, and adding an
 * admin needs a confirmation that shows the address.
 *   - a challenge day whose number is a string of markup renders as a number (never as markup), in the Challenge tab
 *     and in its data-v attribute;
 *   - "add admin" opens a confirmation whose title shows the address; nothing is saved until "yes".
 * Runs the admin in its demo mode (no Firebase config: data in localStorage), owner view. ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PUBLIC = path.resolve(__dirname, "..", "public");

function staticServer(root) {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf", ".png": "image/png" };
  return http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || "/").split("?")[0]);
    if (p === "/firebase-config.js") { res.writeHead(200, { "content-type": types[".js"] }); res.end("window.FIREBASE_CONFIG=null;"); return; }
    if (p.endsWith("/")) p += "index.html";
    const file = path.join(root, p);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
}

const EVIL = '1</span><i id="inj"></i><span x="';

test("admin: a stored day number cannot inject markup; adding an admin asks first", { timeout: 120000 }, async (t) => {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let br;
  try { br = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return; }
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const page = await br.newPage({ viewport: { width: 900, height: 1000 } });
    await page.addInitScript((evil) => {
      try {
        if (!sessionStorage.getItem("seeded")) {
          sessionStorage.setItem("seeded", "1");
          localStorage.setItem("gqch", JSON.stringify({ startDate: null, releasedUpTo: null, days: [{ d: evil, w: [] }, { d: 2, w: [] }] }));
          localStorage.setItem("gqaa", "[]");
        }
      } catch (e) {}
    }, EVIL);
    await page.goto(base + "/admin/", { waitUntil: "load" });
    await page.waitForSelector("#app .tabs", { timeout: 25000 });

    // the Challenge tab
    await page.click('[data-a="tab"][data-v="c"]');
    await page.waitForTimeout(300);
    const c = await page.evaluate(() => ({ inj: !!document.getElementById("inj"), nb: [...document.querySelectorAll("#app .nb")].map((e) => e.textContent), dv: [...document.querySelectorAll('#app [data-v]')].map((e) => e.getAttribute("data-v")) }));
    assert.strictEqual(c.inj, false, "no injected element");
    assert.ok(c.nb.length >= 2 && c.nb.every((x) => !/[<>]/.test(x)), "day numbers render as text: " + JSON.stringify(c.nb));
    assert.ok(c.dv.every((x) => !/[<>"]/.test(x)), "no markup in data-v");

    // add an admin: a confirmation with the address, nothing saved before "yes"
    await page.click('[data-a="tab"][data-v="a"]');
    await page.waitForSelector("#ae");
    await page.fill("#ae", "New.Admin@Example.com");
    await page.click('[data-a="addA"]');
    await page.waitForSelector("#cd.open, #cd[open], #cd.on", { timeout: 5000 }).catch(() => {});
    const dlg = await page.evaluate(() => ({ title: document.getElementById("cdt").textContent, saved: localStorage.getItem("gqaa") }));
    assert.ok(dlg.title.includes("new.admin@example.com"), "the confirmation shows the address: " + dlg.title);
    assert.strictEqual(dlg.saved, "[]", "nothing saved before confirming");
    await page.click('#cd [data-cd="yes"]');
    await page.waitForTimeout(400);
    assert.deepStrictEqual(JSON.parse(await page.evaluate(() => localStorage.getItem("gqaa"))), ["new.admin@example.com"], "saved after confirming");
  } finally {
    await br.close();
    await new Promise((r) => server.close(r));
  }
});
