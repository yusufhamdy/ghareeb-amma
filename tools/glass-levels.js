/*
 * glass-levels.js - single source of truth for the glass-intensity slider
 * (Phase A STEP 3).
 *
 * These are the old site's five levels (main d4405a7, GLLV). The app's continuous
 * 0..100 slider goes piecewise-linear through them (the GQ_THEME block, table GL,
 * in public/index.html, theme-boot.js and theme.js): 0, 25, 50, 75 and 100 are
 * levels 1..5 exactly. test/glass-slider.test.js checks the table and the CSS
 * variables the real page writes, so the copies cannot silently drift.
 *
 * Each level = { bl: blur px, sat: saturate %, bg: glass-fill alpha, rim: border alpha }.
 * Level 1 is "barely-there" (least blur, thinnest fill); level 5 is the strongest
 * glass (most blur, thinnest scrim). The fill is always white; over the dark page
 * background it still reads dark, and the SVG/contrast model in tools/contrast.mjs
 * verifies text over the composited surface at levels 1 and 5.
 */

export const LEVELS = [
  { bl: 4,  sat: 140, bg: { light: 0.88, dark: 0.26 }, rim: { light: 0.55, dark: 0.10 } },
  { bl: 12, sat: 160, bg: { light: 0.80, dark: 0.22 }, rim: { light: 0.63, dark: 0.13 } },
  { bl: 22, sat: 180, bg: { light: 0.72, dark: 0.18 }, rim: { light: 0.71, dark: 0.16 } },
  { bl: 34, sat: 200, bg: { light: 0.64, dark: 0.15 }, rim: { light: 0.79, dark: 0.19 } },
  { bl: 48, sat: 220, bg: { light: 0.56, dark: 0.12 }, rim: { light: 0.87, dark: 0.22 } },
];

export const DEFAULT_LEVEL = 3;

// Migrate the legacy 3-step values (0,1,2 = خفيف/متوسط/قوي) to the 5-step scale.
// Anything already on 1..5 (new installs) or missing maps to itself / the default.
export function normalizeLevel(v, hasFlag) {
  if (hasFlag) return v >= 1 && v <= 5 ? v : DEFAULT_LEVEL;
  if (v === 0) return 1;
  if (v === 1) return 3;
  if (v === 2) return 5;
  return v >= 1 && v <= 5 ? v : DEFAULT_LEVEL;
}

export default { LEVELS, DEFAULT_LEVEL, normalizeLevel };
