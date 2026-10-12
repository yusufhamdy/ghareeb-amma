// Merge a fresh partial report into a full report by id (fresh wins), then write the
// merged sorted report. Usage: node merge-report.mjs <full.json> <fresh.json> <out.json>
import fs from 'fs';
const [fullPath, freshPath, outPath] = process.argv.slice(2);
const full = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
const fresh = JSON.parse(fs.readFileSync(freshPath, 'utf8'));
const byId = new Map(full.map((e) => [e.id, e]));
let replaced = 0;
for (const e of fresh) { if (byId.has(e.id)) { replaced++; if (byId.get(e.id).mismatchPercent !== e.mismatchPercent) console.log('updated', e.id, byId.get(e.id).mismatchPercent, '->', e.mismatchPercent); } byId.set(e.id, e); }
const merged = [...byId.values()].sort((a, b) => b.mismatchPercent - a.mismatchPercent);
fs.writeFileSync(outPath, JSON.stringify(merged, null, 1));
console.log('merged', merged.length, 'rows; updated', fresh.length, 'fresh,', replaced, 'overwritten by id');