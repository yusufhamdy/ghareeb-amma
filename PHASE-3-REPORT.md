# PHASE-3-REPORT.md - Phase 3: Challenge and admin

## Summary
Phase 3 is now actually implemented (previously only scaffolded). The challenge
release rule, roulette, admin Challenge tab/API and an automated privacy check
exist and are covered by tests. All 41 tests pass. One architectural assumption
and one deferred item are documented below; nothing is marked done unless it was
run.

## What was implemented

### Challenge / day logic (server-side source of truth)
- `functions/challenge.js` (pure, no Firebase dependency):
  - `cairoDateString` / `daysBetween` — timezone helpers; all calendar maths use
    **Africa/Cairo** explicitly.
  - `computeUnlocked` / `isDayUnlocked` — THE single release decision point.
    Current rule: sequential. Day 1 is open, the next day opens only after the
    previous is done. An explicit admin `releasedUpTo` can pre-open days.
  - `dayStatus` — locked / available / today / done.
  - `viewedAllMeanings` / `canMarkDayDone` / `toggleDayDone` / `markViewed` —
    per user, per day, per word "viewed" tracking; a day can only be marked done
    after every word's meaning in that day was viewed. Duplicate same-day
    completion is idempotent (toggle).
  - `rouletteSelect` — server-side selection with injectable randomness (so it is
    deterministic under test / auditable via a spin id), no-repeat avoidance and
    a graceful empty-pool result.
  - `validateDayReferences` — every referenced word must exist.
  - `sanitizePublicChallenge` / `withNotesForViewer` — notes are only ever
    attached for an admin; absent (not empty) for everyone else.
  - A code comment marks where the planned **date-based** release will switch in.

### Client (public/index.html)
- Release rule aligned with the server: single `released()` / `isDayUnlocked`
  decision point using the same sequential + `releasedUpTo` override rule.
- Per-day "viewed all meanings" tracked in `gq-view` (localStorage), the done
  button is disabled until every meaning in the day has been shown, and the
  click handler re-checks before toggling. Reset clears view state too.

### Admin Challenge tab (public/admin/index.html)
- New "التحدي" tab: edit `startDate`, `releasedUpTo`, per-day words picked from
  the data, reel links, and the PRIVATE day notes. Word references are validated
  against `words.json`; invalid references are flagged. "حالة الإصدار" shows the
  release status, and "تصدير challenge.json" exports the state.
- Admin assets served from `/admin/` (`site.css`, `theme.js`, `firebase-config.js`).

### Admin API (functions/index.js + functions/admin-challenge.js)
- `adminChallenge` HTTPS function: Firebase ID-token auth; owner or `config/admins`
  only. Actions: `get`, `setStartDate`, `setReleasedUpTo`, `setDay`, `setNotes`,
  `roulette`, `releaseStatus`. Full validation with clear error codes.
- `functions/admin-challenge.js` holds the pure, unit-tested handler logic so the
  HTTP layer only does auth + persistence.
- Notes persist in `admin/challengeNotes` and are returned only to admins.

### Firestore rules
- Added an admin-only rule for `admin/challengeNotes`. `public/challenge` stays
  world-readable / admin-writable (as `public/*` already was).

### Privacy
- `scripts/check-private.ps1` rewritten (the committed version was mangled and
  did not work) — scans `public/` for any private note text; prints `OK`/`FOUND`.
- `test/privacy.test.js`: asserts the private file is gitignored and untracked,
  scans `public/` and `functions/` for note text, and asserts the public payload
  never carries notes.

### Normalizer fix
- `src/utils/normalize.js` (and its `functions/` mirror) did not strip the
  combining hamza left by NFKD and did not map alef wasla, so they diverged from
  the client `norm`. Fixed; `test/normalize-parity.test.js` locks the two copies
  together and asserts every challenge word reference resolves to real data.

## Tests
- `node --test` -> **42 tests, 42 pass, 0 fail**:
  - `test/challenge.test.js` (18): Cairo timezone, day lifecycle, sequential
    unlock, missed days, duplicate completion, not-started/ended/empty cases,
    roulette (deterministic, no-repeat, empty pool), reference validation,
    notes-only-for-admin.
  - `test/admin-challenge.test.js` (11): 403 for non-admins on every action,
    unknown-action, get/notes privacy, startDate/releasedUpTo/setDay/setNotes
    validation, roulette, release status.
  - `test/privacy.test.js` (3) and scripts/check-private.ps1 (OK).
  - `test/normalize-parity.test.js` (2) and `test/rules.test.js` (5, static).
- `node --check` clean on all functions modules. No linter is configured in this
  repo, so none was run.

## Assumption (documented)
AGENTS.md gives visitors NO accounts; progress is per-device in localStorage.
Per-user, server-enforced "viewed all meanings" is therefore impossible for
anonymous visitors. Server-side enforcement covers the admin API, roulette and
word validation; the release rule is centralised so it can move server-side in
one place if accounts are ever added. Logged in DECISIONS-LOG.md.

## Open points / deferred
- Firestore rules emulator suite: **resolved on 2026-10-14.**
  `@firebase/rules-unit-testing@5.0.2` accepts firebase ^12, so the suite
  installs and runs: `npm run rules:test` executes 9 tests under the Firestore
  emulator, 9 pass / 0 fail / 0 skipped (static assertions still present as
  well).
- Firestore -> static `challenge.json` publishing: same pattern as the existing
  words pipeline; the admin can export `challenge.json`. Deferred.
- Date-based release and challenge end-date are designed for but intentionally
  not built in this phase.

## Production impact
- None. No deploy was run; all work is on branch `rebuild`.

## Follow-up 2026-10-14 (config + rules tests)

- Cloud Firestore API on `ghareebalquran-d9ae5` was `SERVICE_DISABLED`; it is
  now enabled, and the existing web app `GhareebAlQuran` /
  `1:801334278891:web:d4628cfb54e40270a45cae` matches
  `public/firebase-config.js` field for field.
- `npm run rules:test`: 9 tests, 9 pass, 0 fail, **0 skipped** (emulator).
  `npm test`: 65 tests, 64 pass, 1 fail, 0 skipped - the 1 fail is the known
  `arabic-guard` `class2Added` entry for `public/_shade-cards-proposal.html`.
- **Could not run:** a signed-in admin smoke test against real data. There is
  **no Firestore database on the project** (`firestore:databases:list` ->
  "No databases found"), and creating production data needs an owner decision.
- Production impact: still none. No push, no deploy, no production writes.
