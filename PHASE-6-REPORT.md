# Phase 6 report: consolidated QA pass and Hosting preview

Date: 2026-10-14. Branch: `rebuild`. Project: `ghareebalquran-d9ae5`.
Scope: one consolidated functional / accessibility / security QA pass, then a Hosting
**preview channel** deploy only. No production deploy, no push, no production data writes.

## 1. What was run and how

Browser QA is one script, `scripts/qa-phase6.mjs`, run once as a single batched pass. It
serves `public/` on a local static server (port 5182), fulfils the Firebase SDK modules
from the local cache, and blocks every `*.googleapis.com` request so **no production
Firebase traffic happens** and the offline JSON path is exercised exactly as a visitor
with an unreachable Firestore would see it. It performs **no pixel / visual comparison**
(design is being reworked): layout checks are functional only.

Command: `node scripts/qa-phase6.mjs` (16 sections). Result: **100 / 100 checks passed**.

Sections and coverage:

| Section | What it checked |
| --- | --- |
| static | `/`, `/words.json`, `/challenge.json`, `/manifest.json`, `/sw.js`, `/robots.txt`, `/sitemap.xml`, `/admin/`, `/fonts/fonts.css` (200); unknown `/word/*.html` -> 404; admin `noindex` meta + `X-Robots-Tag`; rewrites limited to `/word/**` + `/sitemap.xml`; no Google Fonts host; SW precache |
| home | first render from local JSON in 106 ms (no wait on Firestore); word/surah counts; search box; draw + surah link; 4 nav tabs; `__DATA_SRC__` silently `json`; no visible error; 0 console errors |
| search | finds a word with and without diacritics; matches meaning text; empty-state card; no root (jidhr) search |
| draw | "draw a word" never repeats the same word consecutively (6 draws) |
| surahs | 28 data surahs in mushaf order; word counts sum to 73; surah page word count |
| word | word text, highlighted ayah word and ayah number map correctly (5 samples); "other words from surah" link; unknown word id -> not-found card |
| routes | social strip; footer legal links + year; `#/about`, `#/privacy`, `#/terms`, `#/rights`; unknown hash route -> custom 404 with home + random-word buttons |
| quiz | 10 questions; 4 options each; options are 4 distinct meanings (distractors never equal the correct one); exactly one marked correct; result ring + restart |
| challenge | 30 tiles; fresh device today=1 + 29 locked; legend; locked day page + lock toast; day 1 roulette -> words; marking done persists to `gq-prog`; persistence after reload (day 1 done, day 2 today); sequential rule opens day 3; reel button hidden when `reel` empty; `prefers-reduced-motion` skips the roulette |
| settings | sheet opens as a labelled dialog; dark mode, palette and stop-motion persist to `gq-set`; Escape closes; both styles offered |
| keyboard | Tab order reaches multiple controls; `:focus-visible` applies; Enter on the gear opens the sheet; Escape closes it |
| a11y | `lang="ar" dir="rtl"`; no unlabelled buttons/links on home/surahs/challenge/quiz; icon controls have Arabic labels |
| responsive | no horizontal overflow and no blank screen at 320/400/768/820/1024/1280/1440 across home, surahs, challenge, quiz, word |
| pwa | service worker registers and activates; `ghareeb-pwa-v6` cache holds the shell; manifest complete; offline reload still renders the shell |
| admin | `/admin/` unauthenticated -> sign-in gate; no admin tabs before sign-in; **no Firestore request attempted**; gate text; 0 errors |
| offline | home renders from local JSON with Firestore unreachable (<1800 ms); `__DATA_SRC__` = `json`; challenge renders from local `challenge.json` |

Console/runtime errors: **zero uncaught (`pageerror`) errors on every route**. The only
console output filtered as noise is the Firebase SDK's own "Could not reach Cloud Firestore
backend" retry log, produced solely because the harness deliberately makes Firestore
unreachable; the rejection is handled by the app's JSON fallback and it is not an app error.

## 2. Test suites (run once, in order, at the end)

1. `npm test` -> **65 tests, 64 pass, 1 fail, 0 skipped**. The single failure is the known
   `arabic-guard` `class2Added` for `public/_shade-cards-proposal.html` (untracked design
   draft). Anything else would be a real issue; nothing else failed.
2. `npm run rules:test` -> **9 tests, 9 pass, 0 fail, 0 skipped** (Firestore emulator).
3. `node scripts/ci/checks.mjs` -> **PASSED**: no Google Fonts; 71 legacy redirects; 73
   sitemap word pages; 464 tracked files scanned with no sensitive material; PWA manifest /
   SW / offline fallback; 73 canonical URLs. Two NOTEs: legal pages are not yet real static
   URLs (deferred), and the canonical scheme is verified by `test/seo.test.js`.

No product code was changed in Phase 6: the QA pass found **no non-design product bugs**.

## 3. Issues found and fixed

- None in the product.
- Config fix: added `_shade-cards-proposal.html` to `firebase.json` `hosting.ignore` so the
  unreviewed design draft is never published on any Hosting channel. Confirmed: the preview
  returns 404 for `/_shade-cards-proposal.html`.
- Test-harness fixes only (not product): tolerate a missing selector without aborting the
  run; choose a surah with more than one word for the "other words" check; use day 1 (open)
  for the reduced-motion check; treat the SDK Firestore-unreachable log as noise.

## 4. Preview deploy

- Command: `firebase hosting:channel:deploy phase6 --expires 7d --project ghareebalquran-d9ae5`.
- **Preview URL:** https://ghareebalquran-d9ae5--phase6-wpzhnn0z.web.app (channel `phase6`,
  version `f0bcd2a413e24a48`, expires **2026-10-21**). 166 files uploaded. Live channel
  untouched.
- Smoke check (HTTPS, read-only): home 200; word page 200; legacy redirect
  `/word/الخناس.html` -> 301 `/word/an-nas-4.html`; unknown path 404; proposal 404;
  `/sitemap.xml` 200; `/robots.txt` 200; `/words.json` 200; `/admin/` 200 with
  `X-Robots-Tag: noindex`. **9 / 9 OK**.
- Warnings: the `seo` Cloud Function is not deployed (we must not deploy functions in this
  phase), so the CLI warns "Unable to find a valid endpoint for function `seo`". Static
  `/word/*.html` and `/sitemap.xml` still serve correctly on the preview; the function path
  itself is unverified until Phase 7. Firebase Auth channel-domain sync was skipped by the
  CLI.

## 5. Blockers and unresolved issues

- **No Firestore database exists** on `ghareebalquran-d9ae5`. A real signed-in admin smoke
  test cannot run, and the Firestore data path cannot be validated against a live DB.
  Creating the database is an owner decision (not done here).
- **`FIREBASE_SERVICE_ACCOUNT` is not present locally**, so live seeding/verification of
  Firestore is not possible in this environment.
- `/admin/` has no emulator hook, so admin authorization is covered by `rules:test` in the
  emulator plus the browser check that an unauthenticated visitor is blocked and that no
  Firestore request is made before sign-in.
- Legal pages are in-app hash routes only; real static URLs (`/about`, `/privacy`, `/terms`,
  `/rights`) are not implemented (documented, deferred).

## 6. Deferred design items (not fixed, by instruction)

- The Shade cards rework and all visual styling (`public/_shade-cards-proposal.html`,
  design-spec files) are owned by the owner and reworked after this phase.
- No pixel/visual comparison was run (`tools/compare.mjs`, `tools/baseline.mjs`). The full
  900-comparison matrix remains deferred until after the design changes and after
  regenerating `design/baseline/`.

## 7. Protected content

The 4 SHA-256 hashes were verified once, all unchanged:
`public/words.json`, `public/challenge.json`, `data/redirects.json`,
`data/challenge-notes-private.json`. No Arabic/Qur'anic data file was modified.

## 8. Next phase

Phase 7: the authorized production rollout - deploy Firestore rules/indexes and Cloud
Functions, run the mapped data migration against an exported backup, deploy Hosting to the
live channel, verify the domain, and merge to `main`. Before that: the owner finishes the
design, `design/baseline/` is regenerated, and the deferred full visual matrix is run once.
Do not start Phase 7 without its prompt. No production changes were made in Phase 6.
