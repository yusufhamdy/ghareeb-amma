# Phase 5B Report — Firestore migration, pre-deployment hardening, release pipeline

Branch: `rebuild` · HEAD `b5877c9` (nothing committed since) · working tree preserved
(0 staged; 84 modified, 147 deleted, 32 untracked entries). No commit, push, merge,
deploy, or production write was performed in this phase.

This report is written in English. (The two-line Egyptian-Arabic summary requested at
the end of `ghareeb-handoff/prompts/PHASE-5B.md` is intentionally omitted because the
owner's standing instruction is English-only reporting; it can be added on request.)

---

## 1. Status summary

| Task | Status | Evidence |
| --- | --- | --- |
| T0 — Safety baseline (Gate G1) | **BLOCKED** | Firestore API disabled on the project (see §3) |
| T1 — Repository hygiene | DONE (earlier) | `.firebaserc.bak.phase1` removed |
| T2 — Licensed self-hosted fonts | DONE / decided (earlier) | KFGQPC Uthmanic Hafs approved; not embedded yet |
| T3 — Rules emulator lab | **DONE (this session)** | `npm run rules:test` → 9/9 pass |
| T4a — Migration helpers | DONE (earlier) | `src/utils/migrate.js` |
| T4b — Seed tooling | DONE (earlier) | `scripts/seed-emulator.js` (inert live tool separate) |
| T4c — Client read path | DONE (this session fixes) | `public/migrate.js` |
| T4d — Migrated-client verification | **DONE (this session)** | `npm run client:verify` → PASS |
| T4e — Live-data protection | BLOCKED | depends on T0; no production write attempted |
| T5 — App/config/product fixes | DONE (earlier) | see `DECISIONS-LOG.md` |
| T6 — GitHub Actions pipeline | **DONE (prepared, not pushed)** | `.github/workflows/*` |
| T7 — Consolidated verification + preview | **PARTIAL** | local pre-flight PASS; remote part blocked by G2 |
| Gate G1 | Pending owner | needs T0 evidence |
| Gate G2 | Pending owner | needs approval to commit/push + open preview |
| Gate G3 | Pending owner | closes the phase |

Nothing required by Phase 5B is deferred to Phase 7; the remaining items are blocked
on owner decisions or a production configuration change, not on unimplemented code.

---

## 2. Work completed (with evidence)

### T3 — Firestore rules emulator lab (unblocked)

`firebase-tools` 15.33.0 requires Java ≥ 21. No JDK was installed. A **portable**
Temurin JDK `21.0.12.1+1` was extracted under `%TEMP%\jdk21` (official Adoptium
binary) and used per-command via `JAVA_HOME`/`PATH`. **No system install and no
configuration change**; removal is simply deleting the temp folder.

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

1. **Emulator namespace** — the emulator namespaces data per project id; the seed
   writes to the `demo-ghareeb` demo project, but the client connected with the
   production project id, so reads returned nothing. In `?emul=1` mode `migrate.js`
   now initializes with projectId `demo-ghareeb`; production still uses
   `window.FIREBASE_CONFIG.projectId`.
2. **Words shape** — the app's `build()` consumes the JSON words shape, a plain
   **array** of 28 surahs (`public/words.json`). The Firestore `public/data` document
   wraps it as `{ rev, surahs }`. `migrate.js` now unwraps `data.surahs` before
   setting `window.__WORDS__`. The application code and every Arabic byte are
   unchanged.
3. **Verifier wait** — `scripts/verify-client-firestore.mjs` waited for
   `__DATA_SRC__ !== undefined`, but `migrate.js` sets `'pending'` synchronously, so
   it read the pre-resolve value. It now waits for the value to leave `'pending'`.

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

### T6 — GitHub Actions CI/CD (prepared only)

- `.github/workflows/ci.yml` — pushes to `rebuild` and all PRs (fork-safe, read-only
  token, no secrets). Node 20 + Temurin 21, `npm ci`, `npm test`, Playwright chromium,
  `node scripts/ci/checks.mjs`, `check-private.ps1`, `npm run rules:test`,
  `npm run client:verify`. Never deploys.
- `.github/workflows/preview.yml` — Hosting-only preview channel; same-repo PRs and
  pushes to `rebuild`; gated behind repository variable `PREVIEW_ENABLED` (set at G2);
  fork PRs excluded; uses the `FIREBASE_SERVICE_ACCOUNT` secret.
- `.github/workflows/release.yml` — `main` only; refuses to run unless the triggering
  commit is the tip of `origin/main`; Workload Identity Federation auth (documented key
  fallback); deploys rules → functions → hosting.
- All third-party actions are pinned to commit SHAs.
- `.github/workflows/README.md` — records that GitHub Actions is the single deployment
  path and that `firebase deploy` must not run locally in parallel with a workflow.
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

CI-safety: the Stage A guard (`test/arabic-guard.test.js`) skips in a fresh CI
checkout because its baseline fixture and the untracked `ghareeb-handoff/` bundle are
not committed; it always runs in the full local environment.

### T7 — local pre-flight (remote half blocked)

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

`scripts/smoke-ui.mjs` (new) drives Chromium at 400/820/1440 through the required
surfaces and requires the data source to be the Firestore emulator, failing on any
page/console error.

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

### T7 remote half — CI run, preview channel, "release did not fire"
- Requires Gate G2: owner approval to commit and push to `rebuild`, plus the CI
  secrets and the `PREVIEW_ENABLED` variable. Nothing was pushed.

### Non-blocking environment note
- The emulator JVM intermittently fails with "insufficient memory … commit metaspace"
  when the Windows commit charge spikes. It is transient and unrelated to the project;
  a bounded heap via `JAVA_TOOL_OPTIONS` reduces the footprint and the run is retried.

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
configuration was modified.

---

## 6. Outstanding issues and risks

1. **Live data state is unverified** — the migration is proven only against the
   emulator. Whether live Firestore matches the migration source cannot be checked
   until the API is enabled and the T0 export is produced.
2. **CI/preview/release are unexercised** — the workflows are correct-by-construction
   and validated locally (`js-yaml` parse, `checks.mjs`), but no run URL, preview URL,
   or "release did not fire" evidence exists yet.
3. **JDK is temporary** — the local emulator lab depends on the extracted temp JDK;
   CI uses `actions/setup-java` so it is self-sufficient. A lasting local JDK 21 is
   recommended for future local runs.
4. **Transient JVM memory errors** on this machine (see §3).
5. **Private data** — `data/challenge-notes-private.json` is gitignored and local-only;
   `check-private.ps1` passes (no private text under `public/` or `functions/`).

---

## 7. Next-phase recommendation

Proceed to **Phase 6 (consolidated QA + preview only)** once the owner approves Gate G2
(commit + push to `rebuild`, run CI, open the preview channel) and, separately, the T0
Firestore API enablement for the live baseline. Everything implemented by Phase 5B is
complete and locally verified; the remaining items are authorization/configuration
steps, not new development.
