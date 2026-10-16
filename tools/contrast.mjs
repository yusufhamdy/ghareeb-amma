// WCAG contrast audit across the 20 look combinations.
//
// The palette tokens mirror `PAL` and `applySet()` in public/index.html:
//   --bg = palette [light bg | dark bg]
//   --ac = palette [light accent | dark accent]
//   --tx = #1D2B25 (day) / #ECEFFA (night)
//   --mu = #55645D (day) / #A3ABC9 (night)
//   --btf = #fff (day, text on accent buttons) | palette dark bg (night)
//
// Two audits:
// 1. Base colour pairs (text/accent on --bg). Identical for both styles because
//    the style only changes surfaces (--gb/--sf/--ln), not the base tokens.
// 2. The composited *surface* text actually sits on, per style and per glass
//    level. The glass fill is white composited over --bg; the shade fill is
//    `mix(bg, #fff, .55)` day / `.07` night (see the applySet wrapper). Text must
//    stay readable on that surface at the thinnest and thickest glass scrim
//    (levels 1 and 5). Decorative `#bg` blobs are excluded: they are
//    pointer-events:none corner decoration, not a surface the tool can fix.
//
// Thresholds: 4.5:1 for normal text, 3.0:1 for large text (>=24px, or >=18.66px
// bold) and for UI/graphical objects (WCAG 1.4.3 / 1.4.11).

import { LEVELS } from './glass-levels.js';

const PAL = {
  def: { light: ['#F2F0E8', '#1E6B50', '#8FCBAE', '#EBC98A'], dark: ['#0A0E1F', '#9FB4FF', '#4B5BDB', '#2FB5A8'] },
  lav: { light: ['#F1F0F8', '#4B3CD8', '#B9B4FF', '#8FA8FF'], dark: ['#0B0D22', '#B7B2FF', '#5B6CF0', '#C6B8FF'] },
  sun: { light: ['#F6EFEA', '#A8381F', '#F2A97B', '#E8B5D6'], dark: ['#140A1C', '#FFB38A', '#E0689B', '#F2A97B'] },
  neo: { light: ['#EEF3F6', '#0B6E8A', '#7FD6EA', '#F0A6D0'], dark: ['#0B0620', '#7FE7FF', '#19C2E8', '#E64AA8'] },
  min: { light: ['#F1F3E8', '#1E6B50', '#A5E3C4', '#F2E28A'], dark: ['#08140F', '#A6F0C6', '#3FBF8F', '#E8D56A'] },
};
const TX = { day: '#1D2B25', night: '#ECEFFA' };
const MU = { day: '#55645D', night: '#A3ABC9' };
const NAMES = { def: 'default', lav: 'lavender', sun: 'sunset', neo: 'neon', min: 'mint' };

const hex = (h) => {
  h = h.replace('#', '');
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
const lum = (h) => {
  const [r, g, b] = hex(h).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const f = (n) => n.toFixed(2);
const mix = (a, b, t) => {
  a = a.replace('#', ''); b = b.replace('#', '');
  return '#' + [0, 2, 4].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * (1 - t) + parseInt(b.slice(i, i + 2), 16) * t).toString(16).padStart(2, '0')).join('');
};

// thresholds: 4.5 for body text, 3.0 for large text / UI marks
const checks = [
  { name: 'body text on bg', aa: 4.5 },
  { name: 'muted text on bg', aa: 3.0 },
  { name: 'accent marks on bg', aa: 3.0 },
  { name: 'button text on accent', aa: 4.5 },
];
const surfChecks = [
  { name: 'body text on surface', aa: 4.5 },
  { name: 'muted text on surface', aa: 3.0 },
  { name: 'accent marks on surface', aa: 3.0 },
];

const looks = [];
for (const style of ['glass', 'shade'])
  for (const pal of Object.keys(PAL))
    for (const mode of ['day', 'night']) looks.push({ style, pal, mode });

// ---- audit 1: base colour pairs ----
let failures = 0;
const rows = [];
for (const { style, pal, mode } of looks) {
  const [bg, ac] = PAL[pal][mode === 'day' ? 'light' : 'dark'];
  const tx = TX[mode], mu = MU[mode], btf = mode === 'day' ? '#ffffff' : bg;
  const values = [ratio(tx, bg), ratio(mu, bg), ratio(ac, bg), ratio(btf, ac)];
  values.forEach((v, i) => { if (v < checks[i].aa) failures++; });
  rows.push({ look: `${style}-${pal}-${mode}`, values });
}

console.log('WCAG contrast audit — base pairs — ' + rows.length + ' looks (style x palette x mode)');
console.log('legend: body=body text, muted=muted text, accent=accent marks, btn=button text on accent\n');
console.log('look'.padEnd(22), 'body'.padStart(6), 'muted'.padStart(6), 'accent'.padStart(7), 'btn'.padStart(6), ' result');
for (const r of rows) {
  const [body, muted, accent, btn] = r.values;
  const bad = [];
  if (body < 4.5) bad.push('body<' + f(body));
  if (muted < 3) bad.push('muted<' + f(muted));
  if (accent < 3) bad.push('accent<' + f(accent));
  if (btn < 4.5) bad.push('btn<' + f(btn));
  console.log(r.look.padEnd(22), f(body).padStart(6), f(muted).padStart(6), f(accent).padStart(7), f(btn).padStart(6), ' ' + (bad.length ? 'FAIL ' + bad.join(', ') : 'pass'));
}

// ---- audit 2: composited glass/shade surface, levels 1 and 5 ----
const surfRows = [];
for (const { style, pal, mode } of looks) {
  const [bg, ac] = PAL[pal][mode === 'day' ? 'light' : 'dark'];
  const tx = TX[mode], mu = MU[mode];
  for (const lvl of [1, 5]) {
    const surf = style === 'glass'
      ? mix(bg, '#ffffff', LEVELS[lvl - 1].bg[mode === 'day' ? 'light' : 'dark'])
      : mix(bg, '#ffffff', mode === 'day' ? 0.55 : 0.07);
    const values = [ratio(tx, surf), ratio(mu, surf), ratio(ac, surf)];
    values.forEach((v, i) => { if (v < surfChecks[i].aa) failures++; });
    surfRows.push({ look: `${style}-${pal}-${mode}`, lvl: style === 'glass' ? lvl : lvl + '*', surf, values });
  }
}

console.log('\nWCAG contrast audit — ' + (surfRows.length) + ' surfaces (level 1 & 5; * = level does not change the shade surface)');
console.log('look'.padEnd(22), 'lvl'.padStart(4), 'body'.padStart(6), 'muted'.padStart(6), 'accent'.padStart(7), ' result');
for (const r of surfRows) {
  const [body, muted, accent] = r.values;
  const bad = [];
  if (body < 4.5) bad.push('body<' + f(body));
  if (muted < 3) bad.push('muted<' + f(muted));
  if (accent < 3) bad.push('accent<' + f(accent));
  console.log(r.look.padEnd(22), String(r.lvl).padStart(4), f(body).padStart(6), f(muted).padStart(6), f(accent).padStart(7), ' ' + (bad.length ? 'FAIL ' + bad.join(', ') : 'pass'));
}

// ---- audit 3: selected / completed state surfaces (.opt.ok, .dy.ok) ----
// Glass uses the plain accent fill. Shade paints a vertical --tc gradient; the
// label sits on the middle of that gradient, so the surface behind the text is
// sampled at the gradient midpoint. The .opt.ok meaning is body copy (>= 4.5);
// the .dy.ok numeral is a state tile and carries the 3:1 UI floor (WCAG 1.4.11).
const stateRows = [];
for (const { style, pal, mode } of looks) {
  const [bg, ac, tc] = PAL[pal][mode === 'day' ? 'light' : 'dark'];
  const tx = TX[mode], btf = mode === 'day' ? '#ffffff' : bg;
  const sf = mix(bg, '#ffffff', mode === 'day' ? 0.55 : 0.07);
  let opt, dy;
  if (style === 'glass') {
    opt = ratio(btf, ac);
    dy = ratio(btf, ac);
  } else {
    opt = ratio(tx, mix(tc, sf, 0.5));
    dy = ratio(tx, mix(tc, mix(tc, sf, 0.6), 0.5));
  }
  const values = [opt, dy];
  const floors = [4.5, 3.0];
  values.forEach((v, i) => { if (v < floors[i]) failures++; });
  stateRows.push({ look: `${style}-${pal}-${mode}`, values });
}

console.log('\nWCAG contrast audit - ' + stateRows.length + ' selected/completed state surfaces (.opt.ok, .dy.ok)');
console.log('look'.padEnd(22), 'opt.ok'.padStart(7), 'dy.ok'.padStart(6), ' result');
for (const r of stateRows) {
  const [opt, dy] = r.values;
  const bad = [];
  if (opt < 4.5) bad.push('opt<' + f(opt));
  if (dy < 3.0) bad.push('dy<' + f(dy));
  console.log(r.look.padEnd(22), f(opt).padStart(7), f(dy).padStart(6), ' ' + (bad.length ? 'FAIL ' + bad.join(', ') : 'pass'));
}

// ---- audit 4: button hover inversion (.btn <-> .btn.o) ----
// F3: the filled draw button inverts to the outlined look on hover (accent text
// on the transparent/base surface) and its outlined siblings invert to filled
// (button text on the accent fill). Glass: accent-on-bg / btf-on-accent.
// Shade: tx-on-bg / bg-on-tx (both match the base body pair). Floor 4.5.
const hovRows = [];
for (const { style, pal, mode } of looks) {
  const [bg, ac] = PAL[pal][mode === 'day' ? 'light' : 'dark'];
  const tx = TX[mode], btf = mode === 'day' ? '#ffffff' : bg;
  const filled = style === 'glass' ? ratio(ac, bg) : ratio(tx, bg);
  const outlined = style === 'glass' ? ratio(btf, ac) : ratio(bg, tx);
  const values = [filled, outlined];
  values.forEach((v) => { if (v < 4.5) failures++; });
  hovRows.push({ look: `${style}-${pal}-${mode}`, values });
}

console.log('\nWCAG contrast audit - button hover inversion (.btn <-> .btn.o, floor 4.5)');
console.log('look'.padEnd(22), 'filled'.padStart(7), 'outlnd'.padStart(7), ' result');
for (const r of hovRows) {
  const [filled, outlined] = r.values;
  const bad = [];
  if (filled < 4.5) bad.push('filled<' + f(filled));
  if (outlined < 4.5) bad.push('outlined<' + f(outlined));
  console.log(r.look.padEnd(22), f(filled).padStart(7), f(outlined).padStart(7), ' ' + (bad.length ? 'FAIL ' + bad.join(', ') : 'pass'));
}

console.log('\nthresholds: body >= 4.5, muted >= 3.0, accent marks >= 3.0, button text >= 4.5, opt.ok >= 4.5, dy.ok >= 3.0, hover >= 4.5');
console.log(failures === 0 ? 'ALL PASS' : failures + ' check(s) below threshold');
process.exit(failures === 0 ? 0 : 1);
process.exit(failures === 0 ? 0 : 1);
