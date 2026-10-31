"use strict";
/*
 * admin-conflict-merge.test.js - the admin's word editor when the data changed after it opened. Real admin page in demo
 * mode (no Firebase config: data in localStorage; "another window" writes to the same localStorage).
 *   - only the meaning edited: saved merged, the ayah text and every other untouched field stay the newer version;
 *   - both changed a field differently: nothing saved until a value is picked per field; the pick applies, the rest merges;
 *   - a third write while the conflict window is open: the field conflicts again, with the newest value;
 *   - focus / before opening an editor: reloads silently with no unsaved edits, shows a banner with unsaved edits;
 *   - undo still restores the version before the merged save.
 * ASCII only.
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const http = require("http");
const path = require("path");

const PUBLIC = path.resolve(__dirname, "..", "public");
const NAME = "\u0627\u0644\u0646\u0627\u0632\u0639\u0627\u062a"; // An-Naziat
const CH = { startDate: null, releasedUpTo: null, days: [] };

function staticServer(root) {
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".ttf": "font/ttf", ".woff2": "font/woff2", ".png": "image/png" };
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

// as production holds it: every surah carries its number (the admin adds it on any save otherwise)
const JUZ = (fs.readFileSync(path.join(PUBLIC, "admin", "index.html"), "utf8").match(/const JUZ="([^"]+)"/) || [])[1].split(",");
const official = JSON.parse(fs.readFileSync(path.join(PUBLIC, "words.json"), "utf8")).map((s) => Object.assign({ no: 78 + JUZ.indexOf(s.surah.replace(/^\S+\s*/, "")) }, s));
const SI = official.findIndex((s) => s.surah.includes(NAME)), WI = 2;
// the stale copy of today's case: the same word with older bytes in its ayah (never valid against the official text)
function staleData() {
  const d = JSON.parse(JSON.stringify(official)), g = d[SI].ayahs[WI].segments[0];
  g.hl = g.hl.slice(0, 1) + "\u0640" + g.hl.slice(1);
  return d;
}
const THEM = "\u0645\u0639\u0646\u0649 \u0645\u0646 \u0646\u0627\u0641\u0630\u0629 \u0623\u062e\u0631\u0649", ME = "\u0645\u0639\u0646\u0649 \u0645\u0646\u064a";

test("admin word editor: three-way merge, conflict window, focus reload and banner, undo", { timeout: 240000 }, async (t) => {
  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { t.skip("playwright not installed"); return; }
  let br;
  try { br = await chromium.launch(); } catch (e) { t.skip("chromium unavailable: " + e.message); return; }
  const server = staticServer(PUBLIC);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  const open = async (surahs, rev) => {
    const ctx = await br.newContext({ viewport: { width: 700, height: 900 } });
    await ctx.addInitScript(([d, c]) => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("gqad", d); localStorage.setItem("gqch", c); } }, [JSON.stringify({ rev, surahs }), JSON.stringify(CH)]);
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(base + "/admin/index.html");
    await p.waitForSelector('[data-a="tab"][data-v="w"]');
    await p.click('[data-a="tab"][data-v="w"]');
    return { ctx, p, errs };
  };
  const stored = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("gqad")));
  // another window saves: the function edits the stored surahs, and the revision goes up
  const other = (p, edit) => p.evaluate(([src, si, wi]) => { const d = JSON.parse(localStorage.getItem("gqad")); new Function("d", "si", "wi", src)(d.surahs, si, wi); d.rev++; localStorage.setItem("gqad", JSON.stringify(d)); }, [edit, SI, WI]);
  const openWord = async (p) => { await p.click(`[data-a="editW"][data-v="${SI}.${WI}"]`); await p.waitForSelector("#e-m"); };
  const toast = (p) => p.locator("#toast").textContent();
  const MERGED = "\u062f\u0645\u062c"; // "merge" in the merged message
  // the newer version: the official ayah text, plus another surah and this word's label changed by the other window
  const OFFICIAL_SEG = JSON.stringify(official[SI].ayahs[WI].segments);
  const newer = `d[si].ayahs[wi].segments=${OFFICIAL_SEG};d[si].ayahs[wi].label="3";d[0].meanings[0]=d[0].meanings[0]+" newer";d[si].source="newer source";`;
  try {
    { // today's case: open, another write, edit the meaning only, save
      const { ctx, p, errs } = await open(staleData(), 5);
      await openWord(p);
      await other(p, newer);
      const before = await stored(p);
      await p.fill("#e-m", ME);
      await p.click('[data-a="saveW"]');
      await p.waitForFunction(() => !document.querySelector("#e-m"));
      assert.match(await toast(p), new RegExp(MERGED), "the short merged message");
      const after = await stored(p);
      assert.strictEqual(after.rev, before.rev + 1);
      assert.strictEqual(after.surahs[SI].meanings[WI], ME, "my edit is saved");
      assert.strictEqual(JSON.stringify(after.surahs[SI].ayahs[WI].segments), OFFICIAL_SEG, "the ayah text is the newer version, byte for byte");
      assert.strictEqual(after.surahs[SI].words[WI], before.surahs[SI].words[WI]);
      assert.strictEqual(after.surahs[SI].ayahs[WI].label, "3");
      assert.strictEqual(after.surahs[SI].source, "newer source");
      after.surahs[SI].meanings[WI] = before.surahs[SI].meanings[WI];
      assert.strictEqual(JSON.stringify(after.surahs), JSON.stringify(before.surahs), "nothing else changed");
      // undo keeps working: back to the version before my save
      await p.click('[data-a="tab"][data-v="t"]');
      await p.click('[data-a="undo"]');
      await p.click('[data-cd="yes"]');
      await p.waitForFunction((r) => JSON.parse(localStorage.getItem("gqad")).rev === r, before.rev + 2);
      assert.strictEqual(JSON.stringify((await stored(p)).surahs), JSON.stringify(before.surahs), "undo restores the newer version");
      assert.deepStrictEqual(errs, []);
      await ctx.close();
    }
    { // a real conflict
      const { ctx, p, errs } = await open(staleData(), 5);
      await openWord(p);
      await other(p, newer + `d[si].meanings[wi]=${JSON.stringify(THEM)};`);
      const before = await stored(p);
      await p.fill("#e-m", ME);
      await p.fill("#e-l", "3-4");
      await p.click('[data-a="saveW"]');
      await p.waitForSelector(".cf");
      assert.strictEqual((await stored(p)).rev, before.rev, "nothing saved");
      assert.strictEqual(await p.locator(".cf").count(), 1, "only the field that really conflicts");
      const txt = await p.locator(".cf").textContent();
      assert.ok(txt.includes(ME) && txt.includes(THEM), "both values shown");
      // saving with no choice: an error, nothing saved
      await p.click('[data-a="saveC"]');
      await p.waitForSelector(".cf .ferr");
      assert.strictEqual((await stored(p)).rev, before.rev);
      // a third write while the window is open: the field conflicts again with the newest value
      await p.check('.cf input[value="mine"]');
      await other(p, `d[si].meanings[wi]="even newer";`);
      await p.click('[data-a="saveC"]');
      await p.waitForFunction(() => document.querySelector(".cf") && document.querySelector(".cf").textContent.includes("even newer"));
      assert.strictEqual((await stored(p)).rev, before.rev + 1, "the third write only");
      assert.strictEqual(await p.locator('.cf input:checked').count(), 0, "the old choice does not carry over");
      await p.check('.cf input[value="mine"]');
      await p.click('[data-a="saveC"]');
      await p.waitForFunction(() => !document.querySelector(".cf"));
      const a = await stored(p);
      assert.strictEqual(a.surahs[SI].meanings[WI], ME, "the pick is saved");
      assert.strictEqual(a.surahs[SI].ayahs[WI].label, "3-4", "my other edit is kept");
      assert.strictEqual(JSON.stringify(a.surahs[SI].ayahs[WI].segments), OFFICIAL_SEG, "the untouched field keeps the newer value");
      assert.strictEqual(a.surahs[SI].source, "newer source");
      assert.deepStrictEqual(errs, []);
      await ctx.close();
    }
    { // picking the newer value; going back to editing
      const { ctx, p } = await open(official, 5);
      await openWord(p);
      await other(p, `d[si].meanings[wi]=${JSON.stringify(THEM)};`);
      await p.fill("#e-m", ME);
      await p.click('[data-a="saveW"]');
      await p.waitForSelector(".cf");
      await p.click('[data-a="backC"]');
      assert.strictEqual(await p.inputValue("#e-m"), ME, "back in the form, my edit is still there");
      await p.click('[data-a="saveW"]');
      await p.waitForSelector(".cf");
      await p.check('.cf input[value="theirs"]');
      await p.click('[data-a="saveC"]');
      await p.waitForFunction(() => !document.querySelector("#md .mb"));
      // every field is the newer version: nothing to write, the revision stays (undo keeps its version)
      const a = await stored(p);
      assert.strictEqual(a.surahs[SI].meanings[WI], THEM);
      assert.strictEqual(a.rev, 6);
      await ctx.close();
    }
    { // focus and opening an editor, with no unsaved edits: silent reload
      const { ctx, p, errs } = await open(official, 5);
      const focus = () => p.evaluate(() => window.dispatchEvent(new Event("focus")));
      await other(p, `d[si].meanings[wi]=${JSON.stringify(THEM)};`);
      await focus();
      await p.waitForFunction(() => D.rev === 6);
      assert.strictEqual(await p.locator(".wnew").count(), 0);
      await other(p, `d[si].meanings[wi]="before open";`);
      await openWord(p);
      assert.strictEqual(await p.inputValue("#e-m"), "before open", "the editor opens on the newer word");
      // a window with no edits is rebuilt
      await other(p, `d[si].meanings[wi]="while open";`);
      await focus();
      await p.waitForFunction(() => document.querySelector("#e-m").value === "while open");
      assert.strictEqual(await p.locator(".wnew").count(), 0);
      // with unsaved edits: a banner, and my edits stay
      await p.fill("#e-m", ME);
      await other(p, `d[si].words[wi]=d[si].words[wi];`);
      await focus();
      await p.waitForSelector(".wnew");
      assert.strictEqual(await p.inputValue("#e-m"), ME);
      // reload from the banner asks first, then shows the newest data
      await p.click('[data-a="reloadNewer"]');
      await p.click('[data-cd="yes"]');
      await p.waitForFunction(() => !document.querySelector("#e-m") && D.rev === 9);
      assert.strictEqual(await p.locator(".wnew").count(), 0);
      assert.deepStrictEqual(errs, []);
      await ctx.close();
    }
    { // saving with the banner showing merges, and the banner goes
      const { ctx, p } = await open(official, 5);
      await openWord(p);
      await p.fill("#e-m", ME);
      await other(p, `d[si].ayahs[wi].label="3";d[0].meanings[0]+=" x";`);
      await p.evaluate(() => window.dispatchEvent(new Event("focus")));
      await p.waitForSelector(".wnew");
      await p.click('[data-a="saveW"]');
      await p.waitForFunction(() => !document.querySelector("#e-m"));
      assert.match(await toast(p), /./);
      const a = await stored(p);
      assert.strictEqual(a.surahs[SI].meanings[WI], ME);
      assert.ok(a.surahs[0].meanings[0].endsWith(" x"));
      assert.strictEqual(await p.evaluate(() => NEWER), false);
      await ctx.close();
    }
    { // a word deleted elsewhere: the existing message, and nothing written by the save itself
      const { ctx, p } = await open(official, 5);
      await openWord(p);
      await p.fill("#e-m", ME);
      await other(p, `d[si].words.splice(wi,1);d[si].meanings.splice(wi,1);d[si].ayahs.splice(wi,1);`);
      const before = await stored(p);
      await p.click('[data-a="saveW"]');
      await p.waitForSelector('[data-a="retry"]');
      assert.strictEqual((await stored(p)).rev, before.rev);
      await ctx.close();
    }
  } finally {
    await br.close();
    await new Promise((r) => server.close(r));
  }
});
