import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const h = fs.readFileSync(path.resolve(here, '../design/design-spec.html'), 'utf8');
const scripts = [...h.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
console.log('scripts:', scripts.length);
scripts.forEach((s, i) => {
  console.log('--- script ' + i + ' (len ' + s.length + ') ---');
  console.log(s.slice(0, 3000));
});
// Show the CSS rules that mention display:none or the tab classes
const style = [...h.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const lines = style.split('}').filter((l) => /display:\s*none|\.sec|\.grid|hidden|data-v|data-t/.test(l));
console.log('\n--- CSS rules mentioning visibility/tabs ---');
for (const l of lines.slice(0, 40)) console.log(l.trim().slice(0, 300) + '}');
