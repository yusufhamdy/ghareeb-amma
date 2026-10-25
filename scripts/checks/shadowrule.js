// Shadow rule, scoped to controls (drop shadows: positive y offset; zero-offset glows are not drop shadows): wherever an element with an at-rest drop shadow sits above another painted element (horizontally
// overlapping, neither containing the other), the gap between them must be at least the shadow's downward reach
// (offset-y + blur + spread). Exported as a browser function for probe2.js and the standalone scan below.
const REPO = require("path").resolve(__dirname, "../..").split(require("path").sep).join("/");
function shadowViolations() {
  const vis = (e) => { const cs = getComputedStyle(e); if (cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0) return false; const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  const fixed = (e) => { for (let x = e; x; x = x.parentElement) { const p = getComputedStyle(x).position; if (p === "fixed" || p === "sticky") return true; } return false; };
  const reachOf = (cs) => {
    if (!cs.boxShadow || cs.boxShadow === "none") return null;
    let best = null;
    for (const part of cs.boxShadow.split(/,(?![^(]*\))/)) {
      if (/inset/.test(part)) continue;
      const nums = part.replace(/rgba?\([^)]*\)|color-mix\([^)]*\)|#[0-9a-f]+/gi, "").match(/-?[\d.]+px/g);
      if (!nums || nums.length < 2) continue;
      const [ox, oy, blur = "0px", spread = "0px"] = nums.map((n) => n);
      const col = (part.match(/rgba?\([^)]*\)/) || ["rgb(0,0,0)"])[0], a = /rgba/.test(col) ? parseFloat(col.split(",")[3]) : 1;
      if (a === 0) continue;
      const down = parseFloat(oy) + parseFloat(blur) + parseFloat(spread), side = parseFloat(blur) + parseFloat(spread);
      if (parseFloat(oy) > 0 && down > 0 && (!best || down > best.down)) best = { down, side, ox: parseFloat(ox), txt: part.trim() };
    }
    return best;
  };
  const painted = (e, cs) => {
    const bg = cs.backgroundColor, bga = /rgba/.test(bg) ? parseFloat(bg.split(",")[3]) : bg === "transparent" ? 0 : 1;
    const bw = ["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(cs["border" + s + "Width"]) > 0 && !/rgba\(.*,\s*0\)/.test(cs["border" + s + "Color"]));
    return bga > 0 || cs.backgroundImage !== "none" || bw || (cs.boxShadow && cs.boxShadow !== "none");
  };
  const root = document.body, all = [...root.querySelectorAll("*")].filter((e) => !e.closest("svg,#ld,#sh,.toast,.rou,script,style") && vis(e) && !fixed(e));
  // scope: only buttons and pills below a shadow (filled/outlined buttons, prev/next pills, header pills)
  const surf = all.filter((e) => e.matches(".btn,.pnb,.pill") && painted(e, getComputedStyle(e)));
  const out = [];
  const name = (e) => e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\s+/).join(".") : "") + (e.textContent.trim() ? "«" + e.textContent.trim().slice(0, 14) + "»" : "");
  for (const a of all) {
    const cs = getComputedStyle(a), s = reachOf(cs); if (!s) continue;
    const ra = a.getBoundingClientRect(), L = ra.left + s.ox - s.side, R = ra.right + s.ox + s.side;
    for (const b of surf) {
      if (b === a || a.contains(b) || b.contains(a)) continue;
      const rb = b.getBoundingClientRect();
      if (rb.top < ra.bottom - 0.5) continue; // only elements below
      if (rb.right <= L || rb.left >= R) continue;
      const gap = rb.top - ra.bottom;
      if (gap < s.down - 0.5) out.push({ a: name(a), b: name(b), gap: +gap.toFixed(1), reach: +s.down.toFixed(1), shadow: s.txt.slice(0, 60) });
    }
  }
  // keep the nearest offender per shadow element
  const seen = new Map(); for (const v of out) { const k = v.a; if (!seen.has(k) || seen.get(k).gap > v.gap) seen.set(k, v); }
  return [...seen.values()];
}
if (typeof module !== "undefined") module.exports = { shadowViolations };

if (require.main === module) (async () => {
  const pw = require("playwright"); const fs = require("fs"); const { serve } = require("./lib.js");
  const { server, base } = await serve(); const br = await pw.chromium.launch();
  const widths = (process.argv[2] || "320,390,1440").split(",").map(Number), full = process.argv[3] === "full";
  const wfiles = fs.readdirSync(REPO + "/public/word"), sfiles = fs.readdirSync(REPO + "/public/surah");
  const agg = {}; let pages = 0;
  for (const w of widths) for (const style of ["glass", "shade"]) {
    const ctx = await br.newContext({ viewport: { width: w, height: 900 } });
    await ctx.addInitScript((s) => { localStorage.setItem("gq-set", JSON.stringify(s)); localStorage.setItem("gq-ld", "1"); localStorage.setItem("gq-prog", JSON.stringify({ done: [1, 2] })); }, { style, mode: "light", pal: "def", gl: 3, gv: 2, snd: false, cm: true });
    const p = await ctx.newPage(); await p.goto(base + "/", { waitUntil: "load" }); await p.waitForSelector("#app h1"); await p.evaluate(() => document.fonts.ready);
    const D = await p.evaluate(() => ({ W: W.map((x) => x.id), S: S.map((s) => s.num), C: CH.map((c) => c.d) }));
    const routes = ["#/", "#/surahs", "#/challenge", "#/quiz", "#/about", "#/nope"].concat((full ? D.W : D.W.slice(0, 12)).map((x) => "#/word/" + x), (full ? D.S : D.S.slice(0, 8)).map((x) => "#/surah/" + x), (full ? D.C : D.C.slice(0, 4)).map((x) => "#/day/" + x));
    const add = (pg, v) => { for (const x of v) { const k = x.a.replace(/«.*»/, "") + " -> " + x.b.replace(/«.*»/, ""); agg[k] = agg[k] || { n: 0, ex: [] }; agg[k].n++; if (agg[k].ex.length < 3) agg[k].ex.push(`${w}/${style} ${pg} gap ${x.gap} < ${x.reach}`); } };
    for (const r of routes) { await p.evaluate((h) => { location.hash = h; }, r); await p.waitForTimeout(120); if (r === "#/quiz") { add(r, await p.evaluate(shadowViolations)); await p.click("#app .opt >> nth=0"); await p.waitForTimeout(120); } add(r + (r === "#/quiz" ? "(answered)" : ""), await p.evaluate(shadowViolations)); pages++; }
    await p.evaluate(() => { location.hash = "#/"; }); await p.waitForTimeout(150); await p.fill("#q", "ا"); await p.waitForTimeout(300); add("#/ search", await p.evaluate(shadowViolations));
    await p.fill("#q", "زززز"); await p.waitForTimeout(300); add("#/ no-results", await p.evaluate(shadowViolations));
    for (const f of [...(full ? wfiles : wfiles.slice(0, 6)).map((x) => "/word/" + x), ...(full ? sfiles : sfiles.slice(0, 4)).map((x) => "/surah/" + x), "/about/", "/404.html"]) { await p.goto(base + f, { waitUntil: "load" }); await p.evaluate(() => document.fonts.ready); await p.addScriptTag({ content: shadowViolations.toString() }); add(f, await p.evaluate(() => shadowViolations())); pages++; }
    await ctx.close();
  }
  for (const [k, v] of Object.entries(agg).sort((a, b) => b[1].n - a[1].n)) console.log(String(v.n).padStart(4), k, "|", v.ex.join(" ; "));
  console.log("pages", pages, "violation kinds", Object.keys(agg).length);
  await br.close(); server.close();
})();
