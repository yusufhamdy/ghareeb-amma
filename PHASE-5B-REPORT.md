# Phase 5B Report — Firestore migration, pre-deployment hardening, release pipeline

Branch: `rebuild` · commits `dfc1007` (Phase 5B work) and `b063038` (CI fix), both
pushed to `origin/rebuild`. Remote CI is green; the Hosting preview channel is
configured but cannot deploy (missing repo secret); the release job did not fire.

This report is written in English, as are all project files. (The 3-line Egyptian-Arabic
summary required by `AGENTS.md` §14 is given in the session reply, not in this file,
because the report itself stays English.)

---

## 1. Status summary

| Task | Status | Evidence |
| --- | --- | --- |
| T0 — Safety baseline (Gate G1) | **BLOCKED** | Firestore API disabled on the project (see §3) |
| T1 — Repository hygiene | DONE | `.firebaserc.bak.phase1` removed |
| T2 — Licensed self-hosted fonts | DONE | `public/fonts/` + licenses; 0 Google Fonts refs |
| T3 — Rules emulator lab | **DONE** | `npm run rules:test` → 9/9 pass |
| T4a — Migration helpers | DONE | `src/utils/migrate.js` |
| T4b — Seed tooling | DONE | `scripts/seed-emulator.js` (inert live tool separate) |
| T4c — Client read path | DONE | `public/migrate.js` |
| T4d — Migrated-client verification | **DONE** | `npm run client:verify` → PASS (local + CI) |
| T4e — Live-data protection | BLOCKED | depends on T0; no production write attempted |
| T5 — App/config/product fixes | DONE | see `DECISIONS-LOG.md` |
| T6 — GitHub Actions pipeline | **DONE** | `.github/workflows/*`; CI run green on push |
| T7 — Consolidated verification + preview | **PARTIAL** | local + CI done; preview blocked by G2 secret |

Gate status: G1 pending owner (needs the T0 export); G2 substantially met (work is now
committed and pushed to `rebuild` and CI runs green); G3 pending owner.

Nothing required by Phase 5B is deferred to Phase 7; the remaining items are blocked on
owner-supplied credentials or a production configuration change, not on unimplemented
code.

---

## 2. Work completed (with evidence)

### Remote CI is green on a `rebuild` push

- Run URL: https://github.com/yusufhamdy/ghareeb-amma/actions/runs/38480912900
- Commit: `b063038` (push to `rebuild`).
- Job `Verify` — all steps green: setup Node 20 + Temurin 21; `npm ci`; unit tests;
  Playwright chromium; static checks (fonts, redirects, sitemap, secrets); privacy
  check; Firestore emulator rules tests; migrated client read-path verification (T4d).

### CI fix applied (root `firebase-admin` pinned for the Node 20 baseline)

The first CI run (`38480084675`) failed the T4d step with
`Cannot find module '@google-cloud/firestore'`. Cause: the root `firebase-admin@14.5.0`
lists `@google-cloud/firestore` as an **optional** dependency resolved to `9.x`, whose
`engines.node` is `>=22`; the runner uses Node 20, so npm skips that optional dependency
on an engine mismatch (the local machine runs Node 24, so it installed there and the
break only showed in CI).

Fix: pin the root `firebase-admin` to `^12.6.0`, matching the deployed
`functions/package.json` runtime (`^12.6.0`, `engines.node` 20). Its optional
`@google-cloud/firestore` is `^7.7.0` (`engines.node` `>=14`), which installs and runs on
Node 20. The root tooling only uses the modular `firebase-admin/app` +
`firebase-admin/firestore` APIs, stable across v12–v14. No production code changed.
Recorded in `DECISIONS-LOG.md` ("T7 follow-up").

Re-verified locally after the change:
```
$ npm test            → tests 56  pass 56  fail 0
$ npm run rules:test  → tests 9   pass 9   fail 0
$ npm run client:verify → CLIENT-VERIFY PASS (source = firestore/emulator)
$ npm ci --dry-run    → exit 0 (lockfile in sync)
```

### T3 — Firestore rules emulator lab

`firebase-tools` 15.33.0 requires Java ≥ 21. A portable Temurin JDK `21.0.12.1+1` was
extracted under `%TEMP%\jdk21` and used per-command via `JAVA_HOME`/`PATH`; no system
install and no configuration change.

```
$ npm run rules:test        (Java 21 from %TEMP%)
✔ unauthenticated can read every public document
✔ unauthenticated cannot write or delete public documents
✔ unauthenticated cannot read admin or config documents
✔ catch-all denies any other collection (read, list, write)
✔ owner has full public + admin + config/admins control
✔ granted admin manages public + notes but cannot write config/admins
✔ plain verified user is not an admin and gets no admin access
✔ email_verified=false is treated as unauthenticated for admin checks
✔ admin only controls their own scope: no writes to unreachable paths
ℹ tests 9  ℹ pass 9  ℹ fail 0
```

### T4c/T4d — Firestore read path (fixed and verified)

Three defects were found and fixed in the client verification path:

1. **Emulator namespace** — in `?emul=1` mode `migrate.js` initializes with projectId
   `demo-ghareeb`; production still uses `window.FIREBASE_CONFIG.projectId`.
2. **Words shape** — the app consumes a plain **array** of 28 surahs; the Firestore
   `public/data` document wraps it as `{ rev, surahs }`. `migrate.js` unwraps
   `data.surahs` before setting `window.__WORDS__`. Application code and every Arabic
   byte are unchanged.
3. **Verifier wait** — the verifier now waits for `__DATA_SRC__` to leave `'pending'`
   instead of `!== undefined`.

```
$ npm run client:verify
seed-emulator: public/data with 28 surahs (0 missing no), 73 words; public/challenge days=30; admin/challengeNotes keys=30
CLIENT-VERIFY: data source = firestore (Firestore, emulator)
CLIENT-VERIFY: surah rows = 28
CLIENT-VERIFY: Mushaf order ok (first=78 "...", last=114 "...")
CLIENT-VERIFY: word count ok ("73 كلمة في 28 سورة")
CLIENT-VERIFY: word deep link ok
CLIENT-VERIFY: challenge day tiles = 30
CLIENT-VERIFY: challenge day-1 word rows = 3
CLIENT-VERIFY: no page/console errors
CLIENT-VERIFY PASS
```

The offline JSON fallback remains bounded (8000 ms) and reports the real source via
`window.__DATA_SRC__`; the verifier asserts `'firestore'`, so the migration cannot pass
by silently falling back.

### T6 — GitHub Actions CI/CD

- `.github/workflows/ci.yml` — pushes to `rebuild` and all PRs (fork-safe, read-only
  token, no secrets). Node 20 + Temurin 21, `npm ci`, `npm test`, Playwright chromium,
  `node scripts/ci/checks.mjs`, `check-private.ps1`, `npm run rules:test`,
  `npm run client:verify`. Never deploys. **Green** on run `38480912900`.
- `.github/workflows/preview.yml` — Hosting-only preview channel; same-repo PRs and
  pushes to `rebuild`; gated behind repository variable `PREVIEW_ENABLED` (now `true`);
  fork PRs excluded; uses the `FIREBASE_SERVICE_ACCOUNT` secret.
- `.github/workflows/release.yml` — `main` only; job guard `github.ref ==
  refs/heads/main`; refuses unless the triggering commit is the tip of `origin/main`;
  Workload Identity Federation auth (documented key fallback); deploys rules →
  functions → hosting. **Did not fire** (no release run exists; `rebuild` cannot reach
  it).
- All third-party actions are pinned to commit SHAs.
- `.github/workflows/README.md` — GitHub Actions is the single deployment path;
  `firebase deploy` must not run locally in parallel with a workflow.
- `scripts/ci/checks.mjs` — static checks: no Google Fonts, 71 legacy redirects vs
  `firebase.json` + target files, sitemap↔word-file sync (73), and a secrets scan that
  allowlists the public web key in `public/firebase-config.js`.

```
$ node scripts/ci/checks.mjs
NOTE secrets: allowlisted public web key in public/firebase-config.js
OK   google-fonts: 0 references in public/ and functions/
OK   redirects: 71 legacy 301s verified against firebase.json + destination files
OK   sitemap: 73 word pages match sitemap exactly
OK   secrets: 577 tracked files scanned, no sensitive material
checks.mjs: PASSED
```

CI-safety: the Stage A guard (`test/arabic-guard.test.js`) skips in a fresh CI checkout
because its baseline fixture and the untracked `ghareeb-handoff/` bundle are not
committed; it always runs in the full local environment.

### T7 — local pre-flight

```
$ npm test                 → tests 56  pass 56  fail 0
$ powershell -File scripts/check-private.ps1   → OK
$ node scripts/ci/checks.mjs                   → PASSED
$ node scripts/smoke-ui.mjs   (inside Firestore emulator, seed first)
[400]  OK (all surfaces rendered, 0 errors)
[820]  OK (all surfaces rendered, 0 errors)
[1440] OK (all surfaces rendered, 0 errors)
SMOKE-UI PASS: 3 viewports x home/search/surahs/surah/word/challenge/day/quiz/settings/legal/404
```

`scripts/smoke-ui.mjs` drives Chromium at 400/820/1440 through the required surfaces and
requires the data source to be the Firestore emulator, failing on any page/console error.

### Committed phase contents

Commit `dfc1007` (264 files = 33 added, 84 modified, 147 deleted):
- 33 added: workflows + README, `.npmrc`, `PHASE-5B-REPORT.md`, `data/redirects.json`,
  `public/fonts/*` (woff2 + licenses + `fonts.css`), `public/migrate.js`,
  `src/utils/migrate.js`, `scripts/arabic-baseline.js`, `scripts/ci/checks.mjs`,
  `scripts/clean-word-pages.js`, `scripts/gen-redirects.js`, `scripts/seed-live.js`,
  `scripts/smoke-ui.mjs`, `scripts/verify-client-firestore.mjs`,
  `test/arabic-guard.test.js`, `test/data-migration.test.js`,
  `test/rules-emulator.test.js`.
- 147 deleted: `public/admin.html` (T5c), `public/fonts/placeholder.txt` (T2), and 145
  legacy/stale word pages (73 Arabic-named + 72 garbled duplicates) (T5b). 0 canonical
  sitemap pages deleted; `public/word/` now holds exactly 73 canonical ASCII pages.
- 84 modified: all 73 word pages changed **only** the Google Fonts `<link>` →
  `/fonts/fonts.css` (verified: 0 other changed lines), plus `firebase.json`,
  `functions/index.js`, `public/index.html`, `public/admin/index.html`,
  `public/firebase-config.js`, `public/sw.js`, `.gitignore`, `DECISIONS-LOG.md`,
  `package.json`, `package-lock.json`, `scripts/seed-emulator.js`,
  `test/data-migration.test.js`.

Commit `b063038` (3 files): `package.json`, `package-lock.json`, `DECISIONS-LOG.md`.

---

## 3. Blockers (exact)

### T0 / T4e — live Firestore safety baseline
- `firebase firestore:export` **no longer exists** in firebase-tools 15.33.0.
- The Cloud Firestore API is **DISABLED** on `ghareebalquran-d9ae5`: both the REST call
  (`documents:listCollectionIds`) and `firebase firestore:databases:list` return
  HTTP 403, reason `SERVICE_DISABLED`, service `firestore.googleapis.com`.
- Enabling the API is a **production configuration change** and was **not** performed.
  No empty/misleading backup directory was created. Therefore the live export,
  live-vs-migration diff, and T4e live-data protection remain blocked.

### T7 — Hosting preview channel could not be deployed (missing credential)
- `PREVIEW_ENABLED` is set to `true`, so the preview job now runs on every `rebuild`
  push. It fails at the deploy step with the exact error
  `Input required and not supplied: firebaseServiceAccount` (run
  https://github.com/yusufhamdy/ghareeb-amma/actions/runs/38480912969).
- Exact blocker: repository secret `FIREBASE_SERVICE_ACCOUNT` is not set
  (`gh secret list` is empty; no service-account key file exists on this machine, and
  `GOOGLE_APPLICATION_CREDENTIALS` is unset).
- Owner action required (one command, run on a machine with a Firebase service-account
  key — created via `firebase init hosting:github` or the Google Cloud console, with the
  Firebase Hosting Admin role on `ghareebalquran-d9ae5`):
  ```
  gh secret set FIREBASE_SERVICE_ACCOUNT --repo yusufhamdy/ghareeb-amma < path/to/service-account.json
  ```
  Creating a new service account is a project IAM change and was **not** performed
  without explicit approval for that exact change. Until the secret exists, previews
  cannot be created and the preview HTTP checks in T7 cannot be run.

### Release job — confirmed not fired
- `release.yml` triggers only on `main` and the job guards `github.ref ==
  refs/heads/main`; `rebuild` cannot reach it. No Release workflow run exists
  (`gh run list --workflow=release.yml` → not found on the default branch; no run on
  `rebuild`). This satisfies the "no accidental release" requirement.

### Non-blocking environment note
- The emulator JVM intermittently fails with "insufficient memory … commit metaspace"
  when the Windows commit charge spikes. It is transient and unrelated to the project; a
  bounded heap via `JAVA_TOOL_OPTIONS` reduces the footprint and the run is retried.

---

## 4. Backup / restore status

The T0 export could not be produced (Firestore API disabled). Existing local snapshots
were **verified read-only**:

| Snapshot | Result |
| --- | --- |
| git tag `old-site-backup` @ `2712c290620a44d83d4c04bcc1c315b430b0a9c5` | tree of 163 files present |
| `backup/old-public` | 158/158 files readable; blobs present in the object DB |
| `%LOCALAPPDATA%\opencode\ghareeb-copy\stale-word-pages` | 145/145 files readable; blobs present in the object DB |

Planned restore procedure (unchanged, not yet exercisable): enable the Firestore API →
`firebase firestore:export` to a dated path outside `public/` → record document counts
and a sha256 manifest → spot-check against the local `data/`-derived JSON → restore
**into a scratch project first**; same-project restore only after explicit approval.
No sha256 manifest exists yet because no export exists.

---

## 5. Owner-approved production writes

**None.** No production data write, seed, overwrite, deletion, index change, rules
deploy, function deploy, or hosting deploy was performed. No live Firestore or Cloud
configuration was modified. The only remote Git action was pushing commits `dfc1007`
and `b063038` to `rebuild`.

---

## 6. Outstanding issues and risks

1. **Live data state is unverified** — the migration is proven only against the
   emulator. Whether live Firestore matches the migration source cannot be checked until
   the API is enabled and the T0 export is produced.
2. **Preview channel is unverified** — the workflow is correct and the gate wiring is
   proven (the job runs and fails only on the missing credential), but no preview URL or
   preview HTTP evidence exists until `FIREBASE_SERVICE_ACCOUNT` is set. The preview job
   currently shows a red run on each `rebuild` push for exactly that reason.
3. **Release workflow is unexercised** — by design it fires only on `main`; it was
   verified not to fire from `rebuild`.
4. **JDK is temporary** — the local emulator lab depends on the extracted temp JDK; CI
   uses `actions/setup-java` so it is self-sufficient. A lasting local JDK 21 is
   recommended for future local runs.
5. **Transient JVM memory errors** on this machine (see §3).
6. **Private data** — `data/challenge-notes-private.json` is gitignored and local-only;
   `check-private.ps1` passes (no private text under `public/` or `functions/`).

---

## 7. Next-phase recommendation

Everything implemented by Phase 5B is complete and locally verified, and remote CI is
green. Proceed to **Phase 6 (consolidated QA + preview only)** once the owner:
1. sets the repository secret `FIREBASE_SERVICE_ACCOUNT` (so the preview channel can be
   created and the T7 preview HTTP checks can run), and
2. separately approves enabling the Cloud Firestore API for the T0 live baseline.

Both are authorization/configuration steps, not new development.
