# PHASE B — Visual foundation

Branch `rebuild`. One commit per step; `node --test test/phase-b.test.js` after each step;
one full run at the end: `node --test` 89/89 pass, `scripts/ci/checks.mjs` PASSED,
`scripts/qa-phase6.mjs` 100/100, `tools/contrast.mjs` ALL PASS, `arabic-guard` unchanged.

## Steps (commit → change)
- B1 `5ade76c` — item 15: verse highlight is a bounded inline-block box (radius 10, translucent
  accent, no underline); its height stays under the 2.1 line-height so lines never overlap.
- B2 `13c63d7` — item 16: search results and surah word rows are individual cards; results are one
  centered column max-width 720px from 601px up; surah rows keep the 2/3 grid; hover moves the card.
- B3 `32f215e` — items 17/18 (shade only): surah picker cards are `--tc` gradient rectangles in a
  2-up grid with a start badge, name and count; challenge day tiles are 44px with 12px even gaps.
- B4 `a917b2f` — items 12/13: per-theme hover/press/focus (glass lift + accent glow; shade lift +
  `--tc` border, press scales; light card hover), social icon is a centered disc/tile; reduced-motion
  keeps colour changes only, and reduced-transparency is kept.
- B5 `75499d4` — item 4: settings gear is fixed (44px, `inset-inline-end`, above content, below open
  sheets), rotates on hover/press/focus, uses the spec gear path.
- B6 `2877a87` — item 14: draw-a-word = shuffle, other words / browse by surah = book, save = download;
  forward arrows ("تابع" / "التالي") sit at the button end, pointing left.
- B7 `6675dd8` — item 19: ok/bad quiz options get a decorative `aria-hidden` check/cross glyph;
  `tools/contrast.mjs` extended to the shade `.opt.ok` / `.dy.ok` state surfaces across all 20 looks.
- `3a9f076` — service worker cache bumped `v11 → v12` once, at the end.

## Files changed (Phase B)
`public/index.html`, `tools/contrast.mjs`, `test/phase-b.test.js`, `public/sw.js`.
No data files touched; `arabic-guard` baseline unchanged (only UI/CSS changed).

## Preview
https://ghareebalquran-d9ae5--phase-b-v2lduq1j.web.app  (expires 2026-10-23; live site not touched)
