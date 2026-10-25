/* Shared synchronous theme bootstrap for the static pages.
 *
 * Mirrors the app's own applySet(): it reads the saved "gq-set" record and
 * applies the mode, palette, glass intensity and style (glass/shade) to
 * <html> before first paint, so a stored theme never flashes. It also mirrors
 * the app's shade variables (--tc/--sf/--sbd/--ln) and the .cm class used by
 * the reduced-motion rules, plus the .dk dark-mode marker used by the word pages' chips. ASCII-only: it only holds hex colours and logic.
 */
(function () {
  var GLLV = [[4, 140, 0.88, 0.26, 0.55, 0.1], [12, 160, 0.8, 0.22, 0.63, 0.13], [22, 180, 0.72, 0.18, 0.71, 0.16], [34, 200, 0.64, 0.15, 0.79, 0.19], [48, 220, 0.56, 0.12, 0.87, 0.22]];
  var PAL = {
    def: [["#F2F0E8", "#1E6B50", "#8FCBAE", "#EBC98A"], ["#0A0E1F", "#9FB4FF", "#4B5BDB", "#2FB5A8"]],
    lav: [["#F1F0F8", "#4B3CD8", "#B9B4FF", "#8FA8FF"], ["#0B0D22", "#B7B2FF", "#5B6CF0", "#C6B8FF"]],
    sun: [["#F6F0EA", "#A8381F", "#F2A97B", "#E8B5D6"], ["#140A1C", "#FFB38A", "#E0689B", "#F2A97B"]],
    neo: [["#EEF3F6", "#0B6E8A", "#7FD6EA", "#F0A6D0"], ["#0B0620", "#7FE7FF", "#19C2E8", "#E64AA8"]],
    min: [["#F1F3E8", "#1E6B50", "#A5E3C4", "#F2E28A"], ["#08140F", "#A6F0C6", "#3FBF8F", "#E8D56A"]]
  };
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
  var set = { mode: "auto", pal: "def", gl: 3, cm: false, style: "glass" };
  var hasCm = false;
  try {
    var saved = JSON.parse(localStorage.getItem("gq-set") || "{}");
    for (var k in saved) { if (saved[k] !== undefined) set[k] = saved[k]; }
    hasCm = saved.cm !== undefined;
  } catch (e) {}
  // K3: on the first visit (no saved choice) stop-motion follows the device's
  // prefers-reduced-motion; once toggled, the saved choice always wins.
  if (!hasCm) set.cm = matchMedia("(prefers-reduced-motion:reduce)").matches;
  if (set.gv !== 2) { var g = set.gl; set.gl = g === 0 ? 1 : g === 1 ? 3 : g === 2 ? 5 : (g >= 1 && g <= 5 ? g : 3); set.gv = 2; }
  function apply() {
    var dark = set.mode === "dark" || (set.mode === "auto" && matchMedia("(prefers-color-scheme:dark)").matches);
    var p = PAL[set.pal] || PAL.def;
    var c = dark ? p[1] : p[0];
    var lv = GLLV[Math.min(4, Math.max(0, set.gl - 1))];
    var r = document.documentElement.style;
    r.setProperty("--bg", c[0]); r.setProperty("--ac", c[1]); r.setProperty("--b1", c[2]); r.setProperty("--b2", c[3]);
    r.setProperty("--tx", dark ? "#ECEFFA" : "#1D2B25");
    r.setProperty("--mu", dark ? "#A3ABC9" : "#55645D");
    r.setProperty("--gb", rgba("#ffffff", dark ? lv[3] : lv[2]));
    r.setProperty("--gbr", rgba("#ffffff", dark ? lv[5] : lv[4]));
    r.setProperty("--sat", lv[1] + "%");
    r.setProperty("--bl", lv[0] + "px");
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
    if (!c || !c.querySelector(":scope>svg.im") || c.disabled || c.getAttribute("aria-disabled") === "true") return;
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
