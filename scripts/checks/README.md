# Check scripts

Browser checks used to verify UI work before committing. They are not part of `npm test`. Each one serves the working
tree's `public/` on a random local port with Playwright (Chromium unless noted), reads it only, and prints
`ALL CHECKS PASSED` or a list of failures. Run them from this folder (`cd scripts/checks`): output files (screenshots,
JSON) land here and are git-ignored. Nothing here writes to Firebase, and nothing reads production: `lib.js` serves an empty Firebase config, so every page runs on
the local JSON (the two emulator checks opt into the real config and point it at the emulator); the admin checks also
block every Google request.

Shared helpers: `lib.js` (static server, theme combinations, pixel analysis), `pages.js` (every reviewable page/state),
`shadowrule.js` (the shadow-on-buttons measurement, also used by `probe2.js` and `v22.js`).

| Script | What it checks | Run |
| --- | --- | --- |
| `probe2.js` | Full-site interaction probe: button tiers in all 20 combinations (5 palettes x light/dark x glass/shade) at 1440 and 390, prev/next pills, chevron nudge and its timing, motion off, row/card press feedback, and the shadow rule on every page at 320/390/1440 | `node probe2.js` (long) |
| `v22.js` | Icon motion (rest shape, only the named part moves, once per trigger, hover/focus/press/tap, motion off, disabled), motion coverage (every enabled button or pill on every page that contains the book, shuffle, download, share, platform or chevron icon runs that icon's motion; lists them all and any other icon inside a button), done/undo animation (no movement within 0.5px, sounds, already-done day), the locked next-day pill, the video card (0-3 links, old link, order, truncation, tiers, shadow rule) and the admin link fields | `node v22.js` or any of `icons cover done lock video admin` |
| `reel-links-emulator.mjs` | Video links saved and read through the Firestore **emulator** (0, 1, 2, 3 links and the old link only), rules, the published file and the app | from the repo root: `npx firebase emulators:exec --project demo-ghareeb --only firestore "node scripts/checks/reel-links-emulator.mjs"` |
| `reel-links-client.mjs` | The full path, **emulator** only: all 30 days opened and saved in the admin's own day editor with their words unchanged (days 3 and 21 store ي where the word list has ئ); links typed into the editor and saved through its save handler (`store.chSave` captured as the `chDoc()` document the live store writes), written through the rules; then `#/day/N` through `migrate.js` (`?emul=1`): every link field mapped, links shown from the published `challenge.json` (`publicChallenge()` of the stored document), and a Firestore answer after first render changing nothing on the page | from the repo root: `npx firebase emulators:exec --project demo-ghareeb --only firestore "node scripts/checks/reel-links-client.mjs"` |
| `admin-audit.mjs` | The admin against the Firestore **and Auth** emulators, signed in through the Auth emulator: every window (focus in and kept in, Esc, outside click, × at the top, focus back to the opener, no background scroll), the unsaved-edits prompt on every close path (cancel, ×, Esc, outside click, back button, sign-out in another tab), two tabs (both day edits and both word edits survive, the same item gives a conflict with retry), settings never written by a day save, busy state and one write per double click, offline and failed saves keeping the window and edits, load error with retry, delete/rename prompts, field errors, toasts, search normalization, MSA text, and the publish allow-list. Replaces the seeded private notes with placeholders; screenshots and `results.json` go to `AUDIT_OUT` | from the repo root, with a config that adds `emulators.auth` (port 9099): `npx firebase emulators:exec --config <that config> --project demo-ghareeb --only auth,firestore "node scripts/seed-emulator.js && node scripts/checks/admin-audit.mjs"` |
| `v21.js` | Nav animation, day pills, landscape nav, the previous icon motion (superseded by `v22.js` icons) | `node v21.js` |
| `v20.js` | Sharing, titles, scroll restore, a11y, search (Chromium, plus WebKit iPhone) | `node v20.js` |
| `shadowrule.js` | Shadow rule alone | `node shadowrule.js [widths] [full]`, e.g. `node shadowrule.js 320,390,1440` |
| `cards.js`, `cards2.js` | Generate "حفظ كصورة" PNGs through the real save flow into `cards/` / `cards2/` | `node cards.js` |
| `sheets.js`, `sheets2.js` | Contact sheets from those PNGs, 390px site shots, glass-vs-shade diff (run `cards*.js` first) | `node sheets.js` |
| `palettes.js` | The colours each palette really shows (background, accent from the logo, button fill, both glows sampled at their centres, card surface, highlight, swatch) for the 5 palettes in light/dark × glass/shade; CIEDE2000 between every pair (flags accent < 15 or overall < 12), swatch vs applied accent, and a comparison image (palettes in columns, mode × style in rows) | `node palettes.js` (`OUT=` for the output folder) |
| `slider.js` | The glass strength slider over a full drag (390/1440, CPU 1× and 4×): range and step, live updates, CSS writes per frame (at most one), storage writes (on release only), value text, frame times and long tasks (390 at 4×: median ≤ 16.7ms, p95 ≤ 33ms, no long tasks), even blur steps, arrow keys | `node slider.js` |
| `settings.js` | The settings sheet (section order, no overlay, outside tap closes, page left visible, swatches in one row at 320/390/1440, controls ≥ 44px, whole-row switches, radio groups with arrow keys and one Tab stop each; swatches: the exact 135° gradient per palette at 48px, the selected one ringed in the accent 3px off the circle, accent bars 14×3 (24 when selected, name semibold) in each palette's accent of the current mode; the glass sample in both styles) and the gear (one 60° turn ≈ 400ms on hover, focus-visible, press and tap; none with motion off); screenshots of the sheet at 390 and 1440 in light/dark × glass/shade | `node settings.js` |
| `tiles.js` | Generator, not a check: recolours a palette's six shade tiles for another palette in CIE Lab (used for the ذهبي tiles and the green palette's dark tiles) | `node tiles.js <src> <srcBg> <srcGlow> <dst> <dstBg> <dstGlow>` |
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
