// Screenshots for the KFGQPC batch, from any public/ tree (run once on the previous commit's tree, once on this one).
//   node kfgqpc-shots.js <publicRoot> <tag> [outDir]        e.g. tag = before | after
// Writes into outDir/<tag>/:
//   words-glass-dark-gold-400.png, words-shade-light-gold-400.png  contact sheets: the word card of every word page
//   surahs-*.png, surah-*.png, day-open-*.png, quiz-*.png          the surah list, a surah page, an open day card, the quiz
//   card-<id>-<size>.png                                            save-image PNGs (renderCard) for three words
//   legal-<page>-app.png, legal-<page>-static.png                    the legal pages
//   settings-glass-<mode>-<strength>.png                             the settings sheet with the glass slider open
//   admin-editor.png                                                 the admin's word editor showing an ayah (Firebase
//                                                                    stubbed: no network, nothing written)
const { serve } = require("./lib.js");
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const ROOT = process.argv[2], TAG = process.argv[3] || "after";
const OUT = path.join(process.argv[4] || path.join(__dirname, "out/kfgqpc"), TAG);
if (!ROOT) { console.error("usage: node kfgqpc-shots.js <publicRoot> <tag> [outDir]"); process.exit(2); }
const THEMES = [{ style: "glass", mode: "dark", pal: "gold" }, { style: "shade", mode: "light", pal: "gold" }];
const SEED = () => { let s = 12345; Math.random = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648); };
// the three save-image words, found by their letters (marks ignored)
const CARD_WORDS = ["هاويه", "ثجاجا", "والنازعات"];

async function page(br, t, w, extra) {
  const ctx = await br.newContext({ viewport: { width: w, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce", acceptDownloads: true });
  await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); }, Object.assign({ gl: 50, gv: 3, snd: false, cm: true }, t, extra || {}));
  await ctx.addInitScript(SEED);
  return { ctx, p: await ctx.newPage() };
}
const settle = (p, ms) => p.waitForTimeout(ms || 1300);

async function contactSheet(p, files, cols, out) {
  const imgs = files.map((f) => "data:image/png;base64," + fs.readFileSync(f).toString("base64"));
  const data = await p.evaluate(async ([imgs, cols]) => {
    const load = (s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s; });
    const list = await Promise.all(imgs.map(load));
    const w = Math.max(...list.map((i) => i.width)), h = Math.max(...list.map((i) => i.height)), g = 12;
    const rows = Math.ceil(list.length / cols), c = document.createElement("canvas");
    c.width = cols * (w + g) + g; c.height = rows * (h + g) + g;
    const x = c.getContext("2d"); x.fillStyle = "#888"; x.fillRect(0, 0, c.width, c.height);
    list.forEach((im, i) => x.drawImage(im, g + (i % cols) * (w + g), g + Math.floor(i / cols) * (h + g)));
    return c.toDataURL("image/png");
  }, [imgs, cols]);
  fs.writeFileSync(out, Buffer.from(data.split(",")[1], "base64"));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const tmp = path.join(OUT, "_tiles"); fs.mkdirSync(tmp, { recursive: true });
  const { server, base } = await serve(ROOT);
  const br = await chromium.launch();
  for (const t of THEMES) {
    const tt = `${t.style}-${t.mode}-${t.pal}`;
    const { ctx, p } = await page(br, t, 400);
    await p.goto(base + "/#/"); await settle(p);
    const ids = await p.evaluate(() => W.map((w) => w.id));
    const tiles = [];
    for (const id of ids) {
      await p.goto(base + "/#/word/" + id); await settle(p, 1100);
      const card = await p.$(".cols .card");
      const f = path.join(tmp, `${tt}-${id}.png`); await card.screenshot({ path: f }); tiles.push(f);
    }
    await contactSheet(p, tiles, 8, path.join(OUT, `words-${tt}-400.png`));
    for (const [name, h, fn] of [["surahs", "#/surahs"], ["surah", "#/surah/79"], ["day-open", "#/day/1", async () => { const c = await p.$(".dcard"); if (c) { await c.click(); await p.waitForTimeout(700); } }], ["quiz", "#/quiz"]]) {
      await p.goto(base + "/" + h); await settle(p); if (fn) await fn();
      await p.screenshot({ path: path.join(OUT, `${name}-${tt}-400.png`), fullPage: true });
    }
    await ctx.close();
  }
  // save-image PNGs (glass light gold, the default look) for three words, regular and story
  {
    const { ctx, p } = await page(br, { style: "glass", mode: "light", pal: "gold" }, 400);
    await p.goto(base + "/#/"); await settle(p);
    const ids = await p.evaluate((keys) => keys.map((k) => { const w = W.find((x) => norm(x.word).replace(/\s+/g, "").startsWith(k)); return w ? w.id : null; }), CARD_WORDS);
    await p.evaluate(() => cardFonts());
    for (const id of ids.filter(Boolean)) for (const size of ["n", "s"]) {
      const data = await p.evaluate(([id, size]) => renderCard(byId(id), size).toDataURL("image/png"), [id, size]);
      fs.writeFileSync(path.join(OUT, `card-${id}-${size === "s" ? "story" : "regular"}.png`), Buffer.from(data.split(",")[1], "base64"));
    }
    // legal pages: the app view and the static page
    for (const k of ["about", "privacy", "terms", "rights"]) {
      await p.goto(base + "/#/" + k); await settle(p, 900); await p.screenshot({ path: path.join(OUT, `legal-${k}-app.png`), fullPage: true });
      await p.goto(base + "/" + k + "/"); await settle(p, 900); await p.screenshot({ path: path.join(OUT, `legal-${k}-static.png`), fullPage: true });
    }
    await ctx.close();
  }
  // the settings sheet with the glass slider open, at each strength, light and dark
  for (const mode of ["light", "dark"]) for (const gl of [0, 50, 100]) {
    const { ctx, p } = await page(br, { style: "glass", mode, pal: "gold", gl, cm: false }, 390);
    await p.goto(base + "/#/"); await settle(p, 700); await p.click("#gear"); await p.waitForTimeout(1100);
    await p.screenshot({ path: path.join(OUT, `settings-glass-${mode}-${gl}.png`) });
    await ctx.close();
  }
  // the admin's word editor showing an ayah (Firebase stubbed; no network, nothing written)
  {
    const STUB = [
      "export function initializeApp(c){return {c}}", "export function getAuth(a){return {a}}",
      "export function onAuthStateChanged(a,cb){setTimeout(function(){cb({email:'yusufhamdy20@gmail.com',emailVerified:true})},0)}",
      "export class GoogleAuthProvider{}", "export function signInWithPopup(){return Promise.resolve()}", "export function signInWithRedirect(){return Promise.resolve()}", "export function signOut(){return Promise.resolve()}",
      "export function getFirestore(a){return {a}}", "export function serverTimestamp(){return 0}", "export function setDoc(){return Promise.reject(new Error('read-only screenshot'))}",
      "export function doc(db){var p=[];for(var i=1;i<arguments.length;i++)p.push(arguments[i]);return {path:p.join('/')}}",
      "export function getDoc(ref){if(ref.path==='public/data')return Promise.resolve({exists:function(){return true},data:function(){return {rev:1,surahs:window.__S__}}});return Promise.resolve({exists:function(){return false},data:function(){return {}}})}",
      "export function runTransaction(){return Promise.reject(new Error('read-only screenshot'))}", "export function arrayUnion(){} export function arrayRemove(){}",
    ].join("\n");
    const words = fs.readFileSync(path.join(ROOT, "words.json"), "utf8");
    const ctx = await br.newContext({ viewport: { width: 900, height: 1100 }, deviceScaleFactor: 2 });
    await ctx.addInitScript({ content: "window.__S__=" + words + ";window.FIREBASE_CONFIG={apiKey:'x',authDomain:'x',projectId:'demo-x',appId:'x'};" });
    await ctx.route("**/firebase-config.js", (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: "window.FIREBASE_CONFIG={apiKey:'x',authDomain:'x',projectId:'demo-x',appId:'x'};" }));
    await ctx.route("https://www.gstatic.com/firebasejs/**", (r) => r.fulfill({ status: 200, contentType: "text/javascript", headers: { "access-control-allow-origin": "*" }, body: STUB }));
    const p = await ctx.newPage();
    await p.goto(base + "/admin/"); await p.waitForSelector("#app .top", { timeout: 25000 });
    await p.click('[data-a="tab"][data-v="w"]');
    const row = await p.$('[data-a="editW"][data-v="26.0"]') || await p.$('[data-a="editW"]');
    await row.click(); await p.waitForSelector("#md #pv"); await p.waitForTimeout(1200);
    await p.screenshot({ path: path.join(OUT, "admin-editor.png"), fullPage: false });
    await ctx.close();
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  await br.close(); server.close();
  console.log("written to " + OUT + ": " + fs.readdirSync(OUT).length + " files");
})();
