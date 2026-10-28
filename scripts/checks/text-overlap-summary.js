// groups the audit hits of one run (dir with <width>/results.json) by page pattern, element and other
const dir = process.argv[2];
let H = [];
for (const w of [320, 360, 400, 768, 1024, 1440]) { try { H = H.concat(require(require("path").resolve(dir, String(w), "results.json")).hits); } catch (e) {} }
const strip = (s) => (s || "").replace(/"[^"]*"/, "").replace(/ \([^)]*px\)/, "").trim();
const g = {};
for (const h of H) { const k = h.page.replace(/ \d+-\d+$| [a-z-]+-\d+(-\d+)?$/, " *") + " | " + h.kind + " | " + strip(h.element) + " | " + strip(h.other); (g[k] = g[k] || []).push(h); }
console.log(H.length + " hits");
for (const [k, v] of Object.entries(g).sort((a, b) => b[1].length - a[1].length)) {
  const px = v.map((h) => (h.kind === "overlap" ? Math.max(h.intoBoxPx, h.intoInkPx) : h.clippedH));
  const ex = v.slice().sort((a, b) => Math.max(b.intoBoxPx || 0, b.intoInkPx || 0, b.clippedH || 0) - Math.max(a.intoBoxPx || 0, a.intoInkPx || 0, a.clippedH || 0))[0];
  console.log(`${v.length}x ${k}\n   looks ${[...new Set(v.map((h) => h.look))].join(",")} | widths ${[...new Set(v.map((h) => h.width))].join(",")} | px ${Math.min(...px)}-${Math.max(...px)} | worst: ${ex.page} ${ex.look} ${ex.width} ${ex.element.slice(0, 60)} -> ${(ex.other || "").slice(0, 50)}`);
}
