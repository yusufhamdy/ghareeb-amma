// Extract one <section id="...">...</section> from design-spec.html (sections do not nest).
// Usage: node extract-section.mjs <sectionId> [outFile]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const spec = path.resolve(here, '../design/design-spec.html');
const id = process.argv[2];
if (!id) {
  console.error('usage: node extract-section.mjs <sectionId> [outFile]');
  process.exit(1);
}
const html = fs.readFileSync(spec, 'utf8');
const needle = 'id="' + id + '"';
const at = html.indexOf(needle);
if (at < 0) {
  console.error('section not found: ' + id);
  process.exit(2);
}
const a = html.lastIndexOf('<', at);
const end = html.indexOf('</section>', at);
const chunk = html.slice(a, end < 0 ? html.length : end + '</section>'.length);
const out = process.argv[3];
if (out) {
  fs.writeFileSync(out, chunk);
  console.log('wrote ' + chunk.length + ' bytes to ' + out);
} else {
  console.log(chunk);
}
