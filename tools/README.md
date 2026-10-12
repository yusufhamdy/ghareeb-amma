# Visual parity tools

These scripts were written without a browser available, so they are UNTESTED. Fix them if needed; the goal matters more than the code.

1. `npm run setup` (installs Playwright and Chromium).
2. `npm run baseline` renders each frame of `design/design-spec.html` (1020 frames) into `design/baseline/<data-id>.png`. Use a filter to run a subset, for example `node baseline.mjs glass-def`.
3. Serve `public/` with the bundled static server (`node tools/serve.mjs`, default :5173), then `BASE_URL=http://localhost:5173 npm run compare`. It writes `tools/report/report.json` (worst first) and diff images. The full matrix is 15 screens x 20 looks x 3 viewports = 900 comparisons (~40-60 min).

Notes:
- `data-id` format: `<style>-<palette>-<mode>-<viewport>-<screen>`, for example `shade-lav-night-m-word`.
- The spec frames use Amiri Quran as a stand-in; the real site uses KFGQPC Uthmanic Hafs. Ignore glyph-shape differences, never ignore layout, spacing, color or size differences.
- Challenge screens need the fixtures in `screens.json` (`fixtureNow`, `startDate` 2026-10-05, done days 1 to 4). Quiz screens use random questions; mock `Math.random` or skip them.
- Taller pages are compared on the overlapping area only. `sizeDelta` shows height differences.
- Tablet/desktop comparisons inject `tools/app-frame-mode.mjs` (mirrors the frames'
  absolute anchoring of the fixed nav/blobs/loader/sheet overlay) and a service-worker
  stub, so full-page shots are faithful to the frame and the loading-screen fixture is
  deterministic. `tools/heat.mjs`, `rows.mjs`, `diffbbox.mjs`, `shift.mjs`, `px.mjs`,
  `spec-boxes.mjs`, `spec-css.mjs`, `contrast.mjs` support triage without viewing images.
