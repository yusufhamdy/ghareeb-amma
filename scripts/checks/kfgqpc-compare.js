// Compares two kfgqpc.js runs (before = Amiri Quran, after = KFGQPC) component by component.
//   node kfgqpc-compare.js out/kfgqpc/metrics-before.json out/kfgqpc/metrics-after.json [out.md]
// For every theme/width: word card, headword, ayah block (with line counts), highlight pills (height, margins),
// divider gap, surah list rows / tiles, surah heading, day card (closed/open), quiz card. Lists every change over
// 2px with the reason the numbers show (ayah lines added or removed, headword ink depth, lines in the headword).
const fs = require("fs"), path = require("path");
const [A, B] = [process.argv[2], process.argv[3]].map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const OUT = process.argv[4] || path.join(__dirname, "out/kfgqpc/metrics-compare.md");
const r1 = (x) => (x == null ? "-" : (Math.round(x * 10) / 10).toString());
const stats = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); if (!s.length) return null; return { min: s[0], med: s[Math.floor(s.length / 2)], max: s[s.length - 1], n: s.length }; };
const fmt = (s) => (s ? r1(s.min) + " / " + r1(s.med) + " / " + r1(s.max) : "-");
const lines = ["# KFGQPC vs Amiri Quran - component metrics", "", "Values are CSS px: min / median / max over all words (or rows). Before = Amiri Quran (HEAD), after = KFGQPC Uthmanic Hafs v22.", ""];
for (const tag of Object.keys(A.themes)) {
  const a = A.themes[tag], b = B.themes[tag];
  lines.push("## " + tag, "", "| component | before | after | changed > 2px |", "| --- | --- | --- | --- |");
  const ids = Object.keys(a.words);
  const comp = (name, f) => {
    const xa = ids.map((id) => f(a.words[id])), xb = ids.map((id) => f(b.words[id]));
    const ch = ids.filter((id, i) => xa[i] != null && xb[i] != null && Math.abs(xa[i] - xb[i]) > 2);
    lines.push("| " + name + " | " + fmt(stats(xa)) + " | " + fmt(stats(xb)) + " | " + ch.length + " of " + ids.length + " |");
    return ch;
  };
  const cardCh = comp("word card height", (w) => w.card);
  comp("headword block (incl. divider padding)", (w) => w.wd);
  comp("headword lines", (w) => w.wdLines);
  const ayCh = comp("ayah block height", (w) => w.ay);
  comp("ayah lines", (w) => w.ayLines);
  comp("highlight pill height", (w) => (w.marks[0] && w.marks[0].pill ? w.marks[0].pill.h : null));
  comp("pill margin above ink", (w) => (w.marks[0] && w.marks[0].margin ? w.marks[0].margin.top : null));
  comp("pill margin below ink", (w) => (w.marks[0] && w.marks[0].margin ? w.marks[0].margin.bottom : null));
  comp("pill top/bottom margin difference (centring)", (w) => (w.marks[0] && w.marks[0].margin ? Math.abs(w.marks[0].margin.top - w.marks[0].margin.bottom) : null));
  comp("divider gap (target 20)", (w) => w.gap);
  const row = (name, xa, xb) => lines.push("| " + name + " | " + fmt(stats(xa)) + " | " + fmt(stats(xb)) + " | " + xa.filter((x, i) => Math.abs(x - xb[i]) > 2).length + " of " + xa.length + " |");
  row("surah list rows / tiles", a.surahs.rows, b.surahs.rows);
  row("surah names in the list", a.surahs.names, b.surahs.names);
  row("surah heading (h1)", [a.surah.h1], [b.surah.h1]);
  row("surah page word rows", a.surah.rows, b.surah.rows);
  if (a.day && b.day) { row("day card, closed", [a.day.closed], [b.day.closed]); row("day card, open", [a.day.open], [b.day.open]); row("day card ayah", [a.day.ay], [b.day.ay]); }
  if (a.quiz && b.quiz) { row("quiz card", [a.quiz.card], [b.quiz.card]); row("quiz ayah", [a.quiz.ay], [b.quiz.ay]); }
  lines.push("", "Word cards that changed by more than 2px, and why:", "");
  const why = { lines: 0, ink: 0 };
  for (const id of cardCh) {
    const wa = a.words[id], wb = b.words[id], d = wb.card - wa.card, parts = [];
    if (wa.ayLines !== wb.ayLines) { parts.push("ayah lines " + wa.ayLines + " -> " + wb.ayLines + " (" + r1(wb.ay - wa.ay) + "px)"); why.lines++; }
    else if (Math.abs(wb.ay - wa.ay) > 0.5) parts.push("ayah block " + r1(wb.ay - wa.ay) + "px");
    if (wa.wdLines !== wb.wdLines) parts.push("headword lines " + wa.wdLines + " -> " + wb.wdLines);
    const wdD = wb.wd - wa.wd;
    if (Math.abs(wdD) > 0.5) { parts.push("headword block " + r1(wdD) + "px (divider stays 20px below the lowest ink, which sits higher in KFGQPC)"); why.ink++; }
    if (!parts.length) parts.push("two-column row at this width: the card takes the row height, which follows sub-pixel changes on both cards");
    lines.push("- " + id + ": " + r1(d) + "px - " + parts.join("; "));
  }
  lines.push("", "Summary: " + cardCh.length + " word cards changed by more than 2px (" + why.lines + " with a different number of ayah lines, " + why.ink + " with a different headword block); ayah blocks changed in " + ayCh.length + ".", "");
}
fs.writeFileSync(OUT, lines.join("\n"));
console.log(lines.join("\n"));
