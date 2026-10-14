# PHASE 7B REPORT - non-design production setup (FREE / Spark plan)

Date: 2026-10-15
Branch: `rebuild`
Project: `ghareebalquran-d9ae5`
Repo: https://github.com/yusufhamdy/ghareeb-amma.git
Scope: Firestore database creation, rules deploy, seed (blocked), Hosting
rewrite change, publisher dry run (blocked), GitHub CI config, preview deploy.

## Summary of results

| Step | Result |
| --- | --- |
| 0 Access / permissions | firebase ✅, gh ✅, git ✅, file writes ✅; **gcloud NOT installed** |
| 1 Create Firestore DB | ✅ Created `(default)` in **europe-west1**, Native/standard mode |
| 2 Deploy Firestore rules | ✅ Deployed `firestore.rules`; live REST checks match |
| 3 Backup + live seed | ⚠️ Backup ✅; **seed BLOCKED** (no Application Default Credentials) |
| 4 Hosting rewrite change | ✅ Applied + committed `b1d5e0d`; `checks.mjs` PASSED |
| 5 Publisher dry run vs live | ⛔ BLOCKED (needs ADC + seeded data; live DB empty) |
| 6 GitHub CI config | ⚠️ `PUBLISH_ENABLED=false` set; **WIF secrets BLOCKED** (no gcloud) |
| 7 Preview deploy + smoke | ✅ Preview deployed; 1 deviation (404 status, see Findings) |
| 8 Push readiness | ✅ Scanned; push command provided, NOT run |

## Step details

### Step 1 - Firestore database
Command:
```
firebase firestore:databases:create "(default)" --project ghareebalquran-d9ae5 --location europe-west1 --edition standard
```
Result: `Successfully created projects/ghareebalquran-d9ae5/databases/(default)`.
`firestore:databases:list` returned "No databases found" beforehand, so there was
no pre-existing database and no conflicting locked default location. Native
(standard) mode, europe-west1 (Tel Aviv excluded by the owner). No Blaze, no
billing change.

### Step 2 - Firestore rules (rules only)
Command: `firebase deploy --only firestore:rules --project ghareebalquran-d9ae5`
Result: rules compiled and released. Live verification with UNAUTHENTICATED REST
calls only (no test data written):

- `GET public/data` -> 404 (read permitted by rules; document does not exist yet)
- `GET admin/challengeNotes` -> 403 (denied) ✅
- `PATCH public/data` -> 403 (denied) ✅

Rules were already proven 9/9 on the emulator; `rules:test` was NOT re-run.

### Step 3 - Backup and seed
Backup created OUTSIDE the repo before any write:
`C:\Users\Yusuf\ghareeb-backups\20261015-015426\`
containing `words.json`, `challenge.json`, `redirects.json`,
`challenge-notes-private.json` and `hashes.txt` (SHA-256 per file). All 4 hashes
match the owner-supplied values.

`scripts/seed-live.js` was reviewed first: it writes exactly `public/data`,
`public/challenge` and `admin/challengeNotes`, guarded by `--allow-live` +
`GHAREEB_LIVE_SEED_AUTHORIZED=1` + `--confirm`. (Note: its plan-only path is
unreachable because the guard tests `confirm === false`; running without
`--confirm` always refuses. Harmless but worth fixing later.)

Seed attempt:
```
$env:GHAREEB_LIVE_SEED_AUTHORIZED=1; node scripts/seed-live.js --allow-live --confirm
```
Failed: `Error: Could not load the default credentials`.

**BLOCKER:** no Application Default Credentials, no
`GOOGLE_APPLICATION_CREDENTIALS`, and no service-account key file exist on this
machine. Seeding needs an owner login. Backup was already taken, so this is a
safe stop. Documented as "Owner step A" in `DECISIONS-LOG.md`.

### Step 4 - Hosting rewrite change
`firebase.json` hosting rewrites changed from the two Cloud Function rewrites
(`/word/**` and `/sitemap.xml` -> function `seo`) to only:
```json
"rewrites": [ { "source": "**", "destination": "/index.html" } ]
```
`_shade-cards-proposal.html` kept in `hosting.ignore`. `functions/seo.js` and
`adminChallenge` were NOT deleted. `node scripts/ci/checks.mjs` -> PASSED.
Committed on `rebuild`: `b1d5e0d`.

### Step 5 - Publisher dry run against live Firestore
`scripts/publish-build.mjs` default path reads Firestore via firebase-admin and
therefore needs ADC (blocked, same as Step 3). Additionally the live database is
still empty (Step 3 blocked), so the generator would abort on empty data by
design. Not run. Required once the owner unblocks credentials + seed.

### Step 6 - GitHub CI configuration
`gh auth status`: logged in as `yusufhamdy` (scopes: gist, read:org, repo,
workflow). Repository `yusufhamdy/ghareeb-amma`.

Existing secrets (names only): **none**.
Existing variables (names only): `PREVIEW_ENABLED` (already existed).
`WIF_PROVIDER` and `WIF_SERVICE_ACCOUNT` do **not** exist. `gcloud` is not
installed, so the WIF pool/provider and service account cannot be created here
and doing so also requires broad owner IAM. **STOPPED** and written as
"Owner step B" in `DECISIONS-LOG.md` with exact least-privilege commands
(Firestore read + Hosting deploy only).

Set now: `PUBLISH_ENABLED = false` (repo variable). The owner flips it to `true`
after the first successful manual workflow run. The workflow was NOT triggered.

### Step 7 - Preview deploy + smoke
Command:
```
firebase hosting:channel:deploy phase7b --expires 7d --project ghareebalquran-d9ae5
```
Preview URL: **https://ghareebalquran-d9ae5--phase7b-truizs9q.web.app**
Expires: 2026-10-22 (version `d91a79606b214cb9`).

Smoke results (once):
- home `/` -> 200 ✅
- word page `/word/an-nas-4.html` -> 200 ✅ (static file; confirms rewrite removal)
- legacy redirect `/word/الصمد.html` -> 301 -> `/word/al-ikhlas-2.html` ✅
- unknown path -> **200 (not 404)** - see Findings
- `/admin/` -> 200 with `X-Robots-Tag: noindex` + `Cache-Control: no-store` ✅
- headless run: `window.__DATA_SRC__ = "json"`, 0 page errors - the app is on the
  bundled JSON fallback because the live Firestore is empty (Step 3 blocked).
  The Firestore read path is reachable (REST read permitted, 404 = doc absent).

Admin sign-in was NOT tested (owner does it). Note the deploy warned: "Unable to
add channel domain to Firebase Auth" - the preview domain may need adding to
Auth authorized domains for sign-in to work on the preview channel.

### Step 8 - Push readiness (nothing pushed)
`git fetch origin` done. Local `rebuild` is **13 commits ahead** of
`origin/rebuild`. Unpushed range file scan (names + sizes only): no secret-named
files, no file over ~364 KB (`package-lock.json`, normal). `.npmrc` in the range
is a deletion of a benign 5-line `legacy-peer-deps=true` file (no token).
`challenge-notes-private.json` is gitignored and absent from the range.

Exact push command (NOT run):
```
git push origin rebuild
```

## Findings / deviations

1. **404 status changed (preview).** Removing the function rewrites and using a
   `**` -> `/index.html` catch-all means unknown paths return HTTP **200** (the
   SPA shell) instead of **404**. There is no `public/404.html`, so previously
   those paths got Firebase's default 404. AGENTS.md section 7 expects a real 404
   status for unknown `/word/*` URLs. This applied change is exactly the snippet
   the owner documented in `DECISIONS-LOG.md`. Owner to decide: add a static
   `public/404.html` or a narrower rewrite if the 404 status must be preserved.
   Preview-only impact; no production change was made.
2. **Seed + publisher + data-from-Firestore verification are all blocked** on the
   same missing credentials (Owner step A). The core "app reads Firestore" check
   could not be satisfied; the app correctly falls back to JSON.
3. **WIF not configured** (Owner step B). `publish.yml` cannot authenticate until
   the two secrets exist.
4. `gcloud` is not installed on this machine, blocking any gcloud-based step.

## Owner remaining manual steps

1. Install the Google Cloud CLI and run `gcloud auth application-default login`
   (Owner step A in `DECISIONS-LOG.md`), then re-run the live seed.
2. Create the WIF pool/provider + least-privilege service account and set
   `WIF_PROVIDER` and `WIF_SERVICE_ACCOUNT` (Owner step B in `DECISIONS-LOG.md`).
3. After a first successful manual `publish.yml` run, set
   `PUBLISH_ENABLED = true`.
4. Decide on the 404 status (Finding 1).
5. Optionally add the preview channel domain to Firebase Auth authorized domains
   for admin sign-in testing on the preview.
6. Push when ready: `git push origin rebuild`.

## Verification run in this phase

- `npm test`: 76 tests, 75 pass, **1 fail** = the single known `arabic-guard`
  `class2Added` (`public/_shade-cards-proposal.html`). No other failures.
- `node scripts/ci/checks.mjs`: PASSED.
- `rules:test`: NOT re-run (rules unchanged).
- Protected hashes (SHA-256): all 4 **OK**.

## Hard limits honored

No `git push`, no production Hosting live-channel deploy, no Cloud Functions
deploy, no Blaze/billing change, no production deletions, no secrets printed or
committed, `git add .` never used, design files untouched.
