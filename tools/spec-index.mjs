// List the look / viewport / screen dimensions encoded in design-spec.html data-ids.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const h = fs.readFileSync(path.resolve(here, '../design/design-spec.html'), 'utf8');
const ids = [...h.matchAll(/data-id="([a-z0-9-]+)"/g)].map((m) => m[1]);
const looks = [...new Set(ids.map((i) => i.split('-').slice(0, -2).join('-')))].sort();
const vps = [...new Set(ids.map((i) => i.split('-').slice(-2, -1)[0]))];
const screens = [...new Set(ids.map((i) => i.split('-').slice(-1)[0]))];
console.log('data-ids:', ids.length);
console.log('looks (' + looks.length + '):', looks.join(', '));
console.log('viewports:', vps.join(', '));
console.log('screens (' + screens.length + '):', screens.join(', '));
