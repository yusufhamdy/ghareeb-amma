/* Phase D7: social share image generator.
 *
 * Renders public/og.png (1200x630, well under 300 KB) from the site's own
 * title + description (read out of public/index.html, never retyped) and the
 * favicon mark, using the project's Amiri Quran font. The source stays
 * ASCII-only; Arabic is only ever read from committed files at run time.
 *
 * Run: node tools/og.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const FONT = path.join(PUBLIC, 'fonts/amiri-quran-arabic-400-normal.woff2');
const W = 1200, H = 630;
const ACCENT = '#1E6B50';

const indexHtml = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
const title = (indexHtml.match(/<title>([\s\S]*?)<\/title>/) || [, ''])[1].trim();
const desc = (indexHtml.match(/<meta name="description" content="([\s\S]*?)">/) || [, ''])[1].trim();
if (!title) throw new Error('og: could not read <title> from public/index.html');
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const fontB64 = fs.readFileSync(FONT).toString('base64');
const markB64 = fs.readFileSync(path.join(PUBLIC, 'favicon.svg')).toString('base64');

const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><style>
@font-face{font-family:'AmiriQ';src:url(data:font/woff2;base64,${fontB64}) format('woff2');font-weight:400}
html,body{margin:0;padding:0}
.card{position:relative;width:${W}px;height:${H}px;box-sizing:border-box;display:flex;align-items:center;
  gap:64px;padding:0 96px;background:#F2F0E8;font-family:'AmiriQ',serif;direction:rtl;overflow:hidden}
.glow{position:absolute;inset:0;background:
  radial-gradient(760px 520px at 80% 22%,rgba(30,107,80,.16),transparent 62%),
  radial-gradient(620px 460px at 6% 96%,rgba(235,201,138,.28),transparent 60%)}
.mark{position:relative;width:212px;height:212px;flex:0 0 auto;filter:drop-shadow(0 22px 44px rgba(30,107,80,.26))}
.text{position:relative;display:flex;flex-direction:column;align-items:flex-start;gap:20px}
h1{margin:0;font-size:104px;line-height:1.02;font-weight:400;color:${ACCENT}}
.rule{width:132px;height:9px;border-radius:9px;background:#EBC98A}
p{margin:0;font-size:40px;line-height:1.55;color:#40514a;max-width:900px}
</style><div class="card"><div class="glow"></div>
<img class="mark" src="data:image/svg+xml;base64,${markB64}">
<div class="text"><h1>${esc(title)}</h1><div class="rule"></div><p>${esc(desc)}</p></div>
</div></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(PUBLIC, 'og.png'), clip: { x: 0, y: 0, width: W, height: H } });
} finally {
  await browser.close();
}

const size = fs.statSync(path.join(PUBLIC, 'og.png')).size;
if (size > 300 * 1024) throw new Error(`og.png is too large: ${size} bytes`);
console.log(`og: title="${title.slice(0, 40)}", desc length ${desc.length}, wrote public/og.png (${size} bytes)`);
