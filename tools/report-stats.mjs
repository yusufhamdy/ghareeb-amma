// Print summary stats for a report.json. Usage: node report-stats.mjs [path]
import fs from 'fs';
const p = process.argv[2] || './report/report.json';
const r = JSON.parse(fs.readFileSync(p, 'utf8'));
const sorted = [...r].sort((a, b) => b.mismatchPercent - a.mismatchPercent);
const n = r.length;
const over = (x) => r.filter((e) => e.mismatchPercent > x).length;
const avg = r.reduce((s, e) => s + e.mismatchPercent, 0) / n;
console.log('total', n, '| max', sorted[0].mismatchPercent, '| avg', avg.toFixed(3));
console.log('counts >0.5%', over(0.5), '>1%', over(1), '>2%', over(2), '| zeros', over(0) === 0 ? 0 : r.filter((e) => e.mismatchPercent === 0).length);
console.log('worst 20:');
sorted.slice(0, 20).forEach((e) => console.log('  ', String(e.mismatchPercent).padStart(5) + '%', e.id));