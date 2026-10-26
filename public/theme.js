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
const GT=GQ_THEME,PAL=Object.fromEntries(GT.ORDER.map(k=>[k,{n:GT.PAL[k].n,l:GT.PAL[k].l,d:GT.PAL[k].d}]));
var ST={mode:"auto",pal:GT.DEFAULT,gl:1,rm:false};try{Object.assign(ST,JSON.parse(localStorage.getItem("gq")||"{}"))}catch(e){}
if(ST.pal==="min")ST.pal="def";if(!PAL[ST.pal])ST.pal=GT.DEFAULT;
const isNight=()=>ST.mode==="dark"||(ST.mode==="auto"&&matchMedia("(prefers-color-scheme:dark)").matches);
function theme(){
 const n=isNight(),p=PAL[ST.pal]||PAL[GT.DEFAULT],c=n?p.d:p.l,r=document.documentElement.style,a=[.05,.08,.12][ST.gl],b=[.38,.5,.62][ST.gl];
 const v={"--bg":c[0],"--ac":c[1],"--b1":c[2],"--b2":c[3],"--tx":n?"#ECEFFA":"#1D2B25","--mu":n?"#A3ABC9":"#55645D",
  "--gb":n?`rgba(255,255,255,${a})`:`rgba(255,255,255,${b})`,"--gbr":n?"rgba(255,255,255,.22)":"rgba(255,255,255,.85)",
  "--btf":n?c[0]:"#FFFFFF","--ln":n?"rgba(255,255,255,.12)":"rgba(29,43,37,.12)","--ring":n?"rgba(255,255,255,.16)":"rgba(29,43,37,.14)",
  "--sh":n?"rgba(18,24,44,.88)":"rgba(250,248,242,.9)","--dg":n?"#ff9a86":"#b8402c","--bl":[10,22,34][ST.gl]+"px"};
 for(const k in v)r.setProperty(k,v[k]);
 document.body.classList.toggle("rm",ST.rm||matchMedia("(prefers-reduced-motion:reduce)").matches);
 const m=document.querySelector('meta[name="theme-color"]');if(m)m.content=c[0];
}
theme();matchMedia("(prefers-color-scheme:dark)").addEventListener("change",theme);
