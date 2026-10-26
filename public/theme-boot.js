/* Shared synchronous theme bootstrap for the static pages.
 *
 * GQ_THEME holds the theme definitions (palettes, picker order, default, migration, glass mapping); the same block is
 * copied verbatim into index.html and theme.js and test/theme-copies.test.js keeps the copies identical. The bootstrap
 * mirrors the app's own applySet(): it reads the saved "gq-set" record and applies the mode, palette, glass strength
 * and style (glass/shade) to <html> before first paint, so a stored theme never flashes. It also mirrors the app's
 * shade variables (--tc/--sf/--sbd/--ln) and the .cm class used by the reduced-motion rules, plus the .dk dark-mode
 * marker used by the word pages' chips. ASCII-only: it holds hex colours and logic; the palette names are escapes.
 */
(function () {
  /* GQ_THEME:begin - the theme definitions: palettes (names, light/dark colours, swatch gradient), picker order, default, migration of
     saved settings, and the continuous glass mapping. Identical copies live in the public folder: index.html (inline),
     theme-boot.js and theme.js; test/theme-copies.test.js fails if any copy differs. ASCII-only. */
  var GQ_THEME = (function () {
    // [background, accent, glow 1, glow 2] per mode (each palette keeps one hue family in light and dark); sw: the
    // picker swatch, a 135deg gradient [start, end], the same in light and dark
    var PAL = {
      gold: { n: "\u0630\u0647\u0628\u064a", l: ["#F4EDD8", "#7A5412", "#E3C94F", "#E2CC8E"], d: ["#14100A", "#F0CD78", "#B9862A", "#7C5A24"], sw: ["#B59045", "#F0CD78"] },
      def: { n: "\u0632\u0645\u0631\u062f\u064a", l: ["#F2F0E8", "#1E6B50", "#8FCBAE", "#EBC98A"], d: ["#07140F", "#8EE6B4", "#1F8A57", "#2C6E44"], sw: ["#56A882", "#8EE6B4"] },
      lav: { n: "\u0628\u0646\u0641\u0633\u062c\u064a", l: ["#F1F0F8", "#4B3CD8", "#B9B4FF", "#8FA8FF"], d: ["#0B0D22", "#B7B2FF", "#5B6CF0", "#C6B8FF"], sw: ["#8177EC", "#B7B2FF"] },
      sun: { n: "\u063a\u0631\u0648\u0628", l: ["#F6EFEA", "#A8381F", "#F2A97B", "#E8B5D6"], d: ["#140A1C", "#FFB38A", "#E0689B", "#F2A97B"], sw: ["#D47654", "#FFB38A"] },
      neo: { n: "\u0641\u064a\u0631\u0648\u0632\u064a", l: ["#EEF3F6", "#0B6E8A", "#72CFF0", "#8FE6DA"], d: ["#0B0620", "#7FE7FF", "#19C2E8", "#20B8B0"], sw: ["#45AAC4", "#7FE7FF"] }
    };
    var ORDER = ["gold", "def", "lav", "sun", "neo"], DEFAULT = "gold", GLASS_DEFAULT = 50;
    // Glass strength 0..100 maps evenly onto the old lightest (level 1) and strongest (level 5) values:
    // blur 4..48px, saturate 140..220%, fill alpha light .88..56 / dark .26..12, rim alpha light .55..87 / dark .10..22.
    var G0 = [4, 140, 0.88, 0.26, 0.55, 0.1], G1 = [48, 220, 0.56, 0.12, 0.87, 0.22];
    function glass(v, dark) {
      var t = Math.min(100, Math.max(0, +v || 0)) / 100, at = function (i) { return G0[i] + (G1[i] - G0[i]) * t; };
      return { bl: +at(0).toFixed(2) + "px", sat: +at(1).toFixed(1) + "%", gb: +at(dark ? 3 : 2).toFixed(3), gbr: +at(dark ? 5 : 4).toFixed(3) };
    }
    // Saved settings: "min" (removed) becomes the green palette, an unknown or missing palette the default; glass
    // strength moves to 0..100 (gv 3) from the 1..5 scale (gv 2) or the older 0/1/2 scale.
    function migrate(s) {
      if (s.pal === "min") s.pal = "def";
      if (!PAL[s.pal]) s.pal = DEFAULT;
      if (s.gv !== 3) {
        var g = s.gl;
        if (s.gv !== 2) g = g === 0 ? 1 : g === 1 ? 3 : g === 2 ? 5 : (g >= 1 && g <= 5 ? g : 3);
        else if (!(g >= 1 && g <= 5)) g = 3;
        s.gl = Math.round((g - 1) * 25);
        s.gv = 3;
      }
      if (!(s.gl >= 0 && s.gl <= 100)) s.gl = GLASS_DEFAULT;
      return s;
    }
    return { PAL: PAL, ORDER: ORDER, DEFAULT: DEFAULT, GLASS_DEFAULT: GLASS_DEFAULT, glass: glass, migrate: migrate };
  })();
  /* GQ_THEME:end */
  var PAL = GQ_THEME.PAL, DEFAULT = GQ_THEME.DEFAULT, GLASS_DEFAULT = GQ_THEME.GLASS_DEFAULT, glass = GQ_THEME.glass, migrate = GQ_THEME.migrate;

  function rgba(h, a) {
    h = h.replace("#", "");
    if (h.length === 3) h = h.replace(/./g, function (x) { return x + x; });
    var n = parseInt(h, 16);
    return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
  }
  function mix(a, b, t) {
    a = a.replace("#", ""); b = b.replace("#", "");
    var out = "";
    for (var i = 0; i < 3; i++) {
      var x = parseInt(a.substr(i * 2, 2), 16), y = parseInt(b.substr(i * 2, 2), 16);
      out += Math.round(x * (1 - t) + y * t).toString(16).padStart(2, "0");
    }
    return "#" + out;
  }
  var set = { mode: "auto", pal: DEFAULT, gl: GLASS_DEFAULT, gv: 3, cm: false, style: "glass" };
  var hasCm = false, hasGl = false;
  try {
    var saved = JSON.parse(localStorage.getItem("gq-set") || "{}");
    for (var k in saved) { if (saved[k] !== undefined) set[k] = saved[k]; }
    hasCm = saved.cm !== undefined;
    hasGl = saved.gl !== undefined;
    if (!hasGl) set.gv = 3;
  } catch (e) {}
  // K3: on the first visit (no saved choice) stop-motion follows the device's
  // prefers-reduced-motion; once toggled, the saved choice always wins.
  if (!hasCm) set.cm = matchMedia("(prefers-reduced-motion:reduce)").matches;
  migrate(set);
  function apply() {
    var dark = set.mode === "dark" || (set.mode === "auto" && matchMedia("(prefers-color-scheme:dark)").matches);
    var p = PAL[set.pal] || PAL[DEFAULT];
    var c = dark ? p.d : p.l;
    var gl = glass(set.gl, dark);
    var r = document.documentElement.style;
    r.setProperty("--bg", c[0]); r.setProperty("--ac", c[1]); r.setProperty("--b1", c[2]); r.setProperty("--b2", c[3]);
    r.setProperty("--tx", dark ? "#ECEFFA" : "#1D2B25");
    r.setProperty("--mu", dark ? "#A3ABC9" : "#55645D");
    r.setProperty("--gb", rgba("#ffffff", gl.gb));
    r.setProperty("--gbr", rgba("#ffffff", gl.gbr));
    r.setProperty("--sat", gl.sat);
    r.setProperty("--bl", gl.bl);
    r.setProperty("--btf", dark ? c[0] : "#fff");
    r.setProperty("--ln", dark ? "rgba(255,255,255,.12)" : "rgba(29,43,37,.12)");
    document.documentElement.classList.toggle("cm", !!set.cm);
    // .dk marks dark mode so the static word pages' glass chips use their higher-contrast colour in dark
    // mode only; set here, before first paint, so the chips never show the light colour first.
    document.documentElement.classList.toggle("dk", dark);
    var shade = set.style === "shade";
    document.documentElement.classList.toggle("shade", shade);
    if (shade) {
      r.setProperty("--tc", c[2]);
      r.setProperty("--sf", dark ? mix(c[0], "#ffffff", 0.07) : mix(c[0], "#ffffff", 0.55));
      r.setProperty("--sbd", dark ? "rgba(255,255,255,.08)" : "rgba(29,43,37,.1)");
      r.setProperty("--ln", dark ? "rgba(255,255,255,.14)" : "rgba(29,43,37,.14)");
    }
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.content = c[0];
  }
  apply();
  try { matchMedia("(prefers-color-scheme:dark)").addEventListener("change", apply); } catch (e) {}

  // Icon motion (the "all surahs" book): hover and focus-visible run it from the stylesheet; a press (pointer, Enter or
  // Space) replays it once through .imp, the same as the app. .imp is dropped once the motion is over and the control
  // is neither hovered nor focused.
  var hv = matchMedia("(hover:hover)");
  function drop(c) {
    if (c._imt || (hv.matches && c.matches(":hover")) || c.matches(":focus-visible")) return;
    c.classList.remove("imp");
  }
  function press(e) {
    var c = e.target.closest && e.target.closest("a,button");
    if (!c || !c.querySelector("svg.im") || c.disabled || c.getAttribute("aria-disabled") === "true") return;
    c.classList.remove("imp"); void c.offsetWidth; c.classList.add("imp");
    clearTimeout(c._imt);
    c._imt = setTimeout(function () { c._imt = 0; drop(c); }, 600);
  }
  function out(e) {
    var c = e.target.closest && e.target.closest(".imp");
    if (c) setTimeout(function () { drop(c); }, 0);
  }
  addEventListener("pointerdown", press, true);
  addEventListener("keydown", function (e) { if (!e.repeat && (e.key === "Enter" || e.key === " ")) press(e); }, true);
  addEventListener("mouseout", out, true);
  addEventListener("focusout", out, true);
})();
