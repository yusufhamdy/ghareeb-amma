// WCAG contrast audit across the 20 look combinations.
//
// The palette tokens mirror `PAL` and `applySet()` in public/index.html:
//   --bg = palette [light bg | dark bg]
//   --ac = palette [light accent | dark accent]
//   --tx = #1D2B25 (day) / #ECEFFA (night)
//   --mu = #55645D (day) / #A3ABC9 (night)
//   --btf = #fff (day, text on accent buttons) | palette dark bg (night)
//
// Style (glass/shade) and calm mode (cm) change surfaces (--gb/--ln), not the
// base bg/ac/tx/mu tokens, so text contrast is identical for both styles.
//
// Thresholds: 4.5:1 for normal text, 3.0:1 for large text (>=24px, or >=18.66px
// bold) and for UI/graphical objects (WCAG 1.4.3 / 1.4.11).

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

// thresholds: 4.5 for body text, 3.0 for large text / UI marks
const checks = [
  { name: 'body text on bg', aa: 4.5 },
  { name: 'muted text on bg', aa: 3.0 },
  { name: 'accent marks on bg', aa: 3.0 },
  { name: 'button text on accent', aa: 4.5 },
];

let failures = 0;
const rows = [];
for (const style of ['glass', 'shade']) {
  for (const pal of Object.keys(PAL)) {
    for (const mode of ['day', 'night']) {
      const [bg, ac, b1, b2] = PAL[pal][mode === 'day' ? 'light' : 'dark'];
      const tx = TX[mode];
      const mu = MU[mode];
      const btf = mode === 'day' ? '#ffffff' : bg;
      const values = [ratio(tx, bg), ratio(mu, bg), ratio(ac, bg), ratio(btf, ac)];
      checks.forEach((c, i) => {
        if (values[i] < c.aa) failures++;
      });
      rows.push({ look: `${style}-${pal}-${mode}`, bg, ac, values });
    }
  }
}

console.log('WCAG contrast audit — ' + rows.length + ' looks (style x palette x mode)');
console.log('legend: body=body text, muted=muted text, accent=accent marks, btn=button text on accent\n');
console.log('look'.padEnd(22), 'body'.padStart(6), 'muted'.padStart(6), 'accent'.padStart(7), 'btn'.padStart(6), ' result');
for (const r of rows) {
  const [body, muted, accent, btn] = r.values;
  const bad = [];
  if (body < 4.5) bad.push('body<' + f(body));
  if (muted < 3) bad.push('muted<' + f(muted));
  if (accent < 3) bad.push('accent<' + f(accent));
  if (btn < 4.5) bad.push('btn<' + f(btn));
  console.log(
    r.look.padEnd(22),
    f(body).padStart(6),
    f(muted).padStart(6),
    f(accent).padStart(7),
    f(btn).padStart(6),
    ' ' + (bad.length ? 'FAIL ' + bad.join(', ') : 'pass')
  );
}
console.log('\nthresholds: body >= 4.5, muted >= 3.0, accent marks >= 3.0, button text >= 4.5');
console.log(failures === 0 ? 'ALL PASS' : failures + ' check(s) below threshold');
