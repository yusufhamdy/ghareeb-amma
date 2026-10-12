import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const h = fs.readFileSync(path.resolve(here, '../design/design-spec.html'), 'utf8');
const style = [...h.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
for (const rule of style.split('}')) {
  const r = rule.trim();
  if (/\.frame/.test(r) && !/^\s*$/.test(r)) console.log(r.slice(0, 260) + '}');
}
