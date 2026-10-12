// Print design-spec.html CSS rules matching a regex pattern.
// Usage: node spec-css.mjs "\.wrap"
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const h = fs.readFileSync(path.resolve(here, '../design/design-spec.html'), 'utf8');
const style = [...h.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const re = new RegExp(process.argv[2] || '.');
for (const rule of style.split('}')) {
  const r = rule.trim();
  if (r && re.test(r)) console.log(r.replace(/\s+/g, ' ').slice(0, 300) + '}');
}
