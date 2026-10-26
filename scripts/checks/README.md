# Check scripts

Browser checks used to verify UI work before committing. They are not part of `npm test`. Each one serves the working
tree's `public/` on a random local port with Playwright (Chromium unless noted), reads it only, and prints
`ALL CHECKS PASSED` or a list of failures. Run them from this folder (`cd scripts/checks`): output files (screenshots,
JSON) land here and are git-ignored. Nothing here writes to Firebase; the admin checks load the admin page with an
empty Firebase config and block every Google request.

Shared helpers: `lib.js` (static server, theme combinations, pixel analysis), `pages.js` (every reviewable page/state),
`shadowrule.js` (the shadow-on-buttons measurement, also used by `probe2.js` and `v22.js`).

| Script | What it checks | Run |
| --- | --- | --- |
| `probe2.js` | Full-site interaction probe: button tiers in all 20 combinations (5 palettes x light/dark x glass/shade) at 1440 and 390, prev/next pills, chevron nudge and its timing, motion off, row/card press feedback, and the shadow rule on every page at 320/390/1440 | `node probe2.js` (long) |
| `v22.js` | Icon motion (rest shape, only the named part moves, once per trigger, hover/focus/press/tap, motion off, disabled), motion coverage (every enabled button or pill on every page that contains the book, shuffle, download, share, platform or chevron icon runs that icon's motion; lists them all and any other icon inside a button), done/undo animation (no movement within 0.5px, sounds, already-done day), the locked next-day pill, the video card (0-3 links, old link, order, truncation, tiers, shadow rule) and the admin link fields | `node v22.js` or any of `icons cover done lock video admin` |
| `reel-links-emulator.mjs` | Video links saved and read through the Firestore **emulator** (0, 1, 2, 3 links and the old link only), rules, the published file and the app | from the repo root: `npx firebase emulators:exec --project demo-ghareeb --only firestore "node scripts/checks/reel-links-emulator.mjs"` |
| `v21.js` | Nav animation, day pills, landscape nav, the previous icon motion (superseded by `v22.js` icons) | `node v21.js` |
| `v20.js` | Sharing, titles, scroll restore, a11y, search (Chromium, plus WebKit iPhone) | `node v20.js` |
| `shadowrule.js` | Shadow rule alone | `node shadowrule.js [widths] [full]`, e.g. `node shadowrule.js 320,390,1440` |
| `cards.js`, `cards2.js` | Generate "حفظ كصورة" PNGs through the real save flow into `cards/` / `cards2/` | `node cards.js` |
| `sheets.js`, `sheets2.js` | Contact sheets from those PNGs, 390px site shots, glass-vs-shade diff (run `cards*.js` first) | `node sheets.js` |
| `contrast.js` | Pixel-measured text contrast in all 40 combinations -> `contrast.json` | `node contrast.js` (`ONLY=1` for a subset) |
| `tune.js` | Glass veil tuning from `contrast.js` pages -> `tune.json` | `node tune.js` |
| `cm.js` | Contrast of pill second line, locked day numbers and static chips in 20 combinations -> `cm.json` | `node cm.js [width]` |
| `consistency.js` | Computed-style signatures per element type across pages -> `consistency.json` | `node consistency.js` |
| `divgap.js` | Word ink to dashed-divider gap on the word page (app and static) | `node divgap.js <label> [baseUrl]` |
| `hl.js` | Ayah highlight vs real ink, page and saved card | `node hl.js [widths] [styles] [engine] [nocard]` |
| `wnav.js` | Word prev/next on all 73 words, app and static, 320/390/1440 | `node wnav.js [shots]` |
| `spill.js` | Surah prev/next on all 28 surahs; optional row-size compare with a reference build | `node spill.js [refPublicDir]` |
| `pill4.js` | Prev/next pill geometry at 320-390px, word and surah pages | `node pill4.js` |
| `navdrag.js` | Bottom-nav drag with real touch input (CDP) plus desktop mouse | `node navdrag.js` |
| `wcf.js` | Word-card fit: meaning/ayah sizes per width, CLS | `node wcf.js <label> [baseUrl]` |
| `rest4.js` | At-rest box diff between a previous build (`base2/public`, export it first) and the working tree | `git archive HEAD~1 public \| tar -x -C base2` then `node rest4.js` |
| `qcore2.js` | QCORE load fix on WebKit iPhone 13, locally or against a URL (read-only) | `node qcore2.js [local\|https://...]` |
