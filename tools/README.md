# Visual parity tools

These scripts were written without a browser available, so they are UNTESTED. Fix them if needed; the goal matters more than the code.

1. `npm run setup` (installs Playwright and Chromium).
2. `npm run baseline` renders each frame of `design/design-spec.html` (1020 frames) into `design/baseline/<data-id>.png`. Use a filter to run a subset, for example `node baseline.mjs glass-def`.
3. Start the site (Firebase emulators) with the seed data, then `BASE_URL=http://localhost:5000 npm run compare`. It writes `tools/report/report.json` (worst first) and diff images.

Notes:
- `data-id` format: `<style>-<palette>-<mode>-<viewport>-<screen>`, for example `shade-lav-night-m-word`.
- The spec frames use Amiri Quran as a stand-in; the real site uses KFGQPC Uthmanic Hafs. Ignore glyph-shape differences, never ignore layout, spacing, color or size differences.
- Challenge screens need the fixtures in `screens.json` (`fixtureNow`, `startDate` 2026-10-05, done days 1 to 4). Quiz screens use random questions; mock `Math.random` or skip them.
- Taller pages are compared on the overlapping area only. `sizeDelta` shows height differences.
