// Collect computed-style signatures per element type across pages (def palette, light).
const L = require("./lib.js"); const PAGES = require("./pages.js"); const fs = require("fs");
const TYPES = {
  "btn-filled": ".btn:not(.o)", "btn-outlined": ".btn.o", "card": ".card", "pill": "a.pill", "h1": "h1", "sub": ".sub",
  "muted": ".m", "pnb": ".pnb", "row": ".row", "chip": ".chip", "logo": ".logo", "footer-link": ".fl a", "search": ".sb",
  "list": ".list", "strip": ".strip", "dcard": ".dcard", "opt": ".opt", "dy": ".dy:not(.sw)", "h2": "h2", "para": "p",
};
const PROPS = ["fontSize", "fontWeight", "lineHeight", "fontFamily", "height", "borderRadius", "paddingTop", "paddingInlineStart", "borderTopWidth", "boxShadow", "backgroundColor", "color", "gap", "marginTop"];
(async () => {
  const { server, base } = await L.serve();
  const br = await L.chromium.launch();
  const out = {};
  for (const style of ["glass", "shade"]) for (const w of [1440, 390]) {
    const c = { style, pal: "def", mode: "light", w, tag: `${style}/${w}` };
    const ctx = await L.context(br, c, { prog: { done: [1] } }); const p = await ctx.newPage();
    for (const [label, url, setup] of PAGES) {
      await p.goto("about:blank"); await p.goto(base + url, { waitUntil: "load" }); await p.waitForTimeout(500);
      if (setup) { try { await setup(p); await p.waitForTimeout(400); } catch (e) { console.error(label, e.message); } }
      const sig = await p.evaluate(([T, P]) => {
        const o = {};
        for (const [k, sel] of Object.entries(T)) {
          o[k] = [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0).slice(0, 4).map((e) => {
            const c = getComputedStyle(e); const s = {}; P.forEach((p) => (s[p] = c[p]));
            s.boxShadow = s.boxShadow === "none" ? "none" : "yes"; s.fontFamily = s.fontFamily.split(",")[0];
            const svg = e.querySelector(":scope > svg"); s.icon = svg ? svg.getAttribute("width") : "-";
            s.text = (e.textContent || "").trim().slice(0, 18); return s;
          });
        }
        return o;
      }, [TYPES, PROPS]);
      for (const [k, arr] of Object.entries(sig)) for (const s of arr) {
        const text = s.text; delete s.text;
        const key = JSON.stringify(s);
        ((out[c.tag] ||= {})[k] ||= {})[key] ||= [];
        out[c.tag][k][key].push(label + ":" + text);
      }
    }
    await ctx.close();
  }
  await br.close(); server.close();
  fs.writeFileSync("consistency.json", JSON.stringify(out, null, 1));
  for (const [tag, types] of Object.entries(out)) {
    console.log("##### " + tag);
    for (const [k, sigs] of Object.entries(types)) {
      const keys = Object.keys(sigs); if (keys.length < 2) continue;
      // print only properties that vary
      const objs = keys.map((x) => JSON.parse(x)); const vary = Object.keys(objs[0]).filter((p) => new Set(objs.map((o) => o[p])).size > 1);
      console.log("== " + k + "  varies: " + vary.join(","));
      keys.forEach((x, i) => console.log("   " + vary.map((p) => p + "=" + objs[i][p]).join(" ") + "  <- " + [...new Set(sigs[x].map((s) => s.split(":")[0]))].join(",")));
    }
  }
})();
