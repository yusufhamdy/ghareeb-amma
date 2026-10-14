# PHASE 7B REPORT - non-design production setup (FREE / Spark plan)

Date: 2026-10-15 (resumed after a laptop restart; state re-verified read-only)
Branch: `rebuild`
Project: `ghareebalquran-d9ae5`
Repo: https://github.com/yusufhamdy/ghareeb-amma.git
Scope: Firestore database, rules deploy, seed, Hosting rewrite change, publisher
dry run, GitHub CI config, preview deploy. No push, no live-channel deploy, no
Cloud Functions, no Blaze/billing change.

## Status per phase step

| Step | Status | Result |
| --- | --- | --- |
| 0 Access / permissions | done | firebase ✅, gh ✅, git ✅, file writes ✅; gcloud installed (not on PATH) |
| 1 Create Firestore DB | done | `(default)` in **europe-west1**, Native/standard, freeTier=true |
| 2 Deploy Firestore rules | done | deployed; live behavior matches `firestore.rules` |
| 3 Backup + seed | done | backup ✅; seed ran -> 28 surahs, 73 words, 30 note keys |
| 4 Hosting rewrite change | done | committed `b1d5e0d`; `checks.mjs` PASSED |
| 5 Publisher dry run vs live | **deviation** | word pages identical; words/sitemap/challenge differ (see below) |
| 6 GitHub CI config | partial | `PUBLISH_ENABLED=false` set; **WIF secrets missing** (owner step B) |
| 7 Preview deploy + smoke | done | preview live; now serves data from Firestore |
| 8 Push readiness | done | 15 commits ahead; scan clean; push command below (not run) |

## Resume / real-state check (STEP R)

- `java -version` -> OpenJDK 21.0.12.1 LTS. `firebase login:list` -> yusufhamdy20@gmail.com.
- Firestore database exists: `projects/ghareebalquran-d9ae5/databases/(default)`,
  STANDARD edition, FIRESTORE_NATIVE, `locationId: europe-west1`, `freeTier: true`.
- Live rules behavior (unauthenticated REST): `public/data` read allowed (404 =
  doc absent before seed), `public/challenge` read allowed, `admin/challengeNotes`
  read 403, `config/admins` 403, `public/data` write 403. Matches `firestore.rules`.
- Backup folder present: `C:\Users\Yusuf\ghareeb-backups\20261015-015426\`
  with `hashes.txt` + the 4 files.
- `DECISIONS-LOG.md` already had the STEP 1 entry.
- **Billing: NOT linked** (`billingEnabled: false`). Do not stop on billing.
- New since restart: gcloud installed under `%LOCALAPPDATA%\Google\Cloud SDK`,
  and Application Default Credentials now exist (ADC file present), which
  unblocked the seed.

## Step details

### Step 3 - Seed (now done)
`$env:GHAREEB_LIVE_SEED_AUTHORIZED=1; node scripts/seed-live.js --allow-live --confirm`
-> `seed-live: wrote migrated data to LIVE project ghareebalquran-d9ae5 (surahs=28)`.
Read-only verification: `public/data` rev=1, 28 surahs, **73 words**;
`public/challenge` present; `admin/challengeNotes` present with **30 day keys**
(count only, contents never printed).

### Step 5 - Publisher dry run (DEVIATION - needs an owner decision)
Ran `node scripts/publish-build.mjs --project ghareebalquran-d9ae5 --out <temp>`
-> 77 files, "changed". Compared to the committed static files:

- **73/73 word pages: byte-identical.** ✅
- **`words.json`: differs.** Firestore `public/data` is the MIGRATED shape:
  each surah has an extra `no` and the list is sorted **ascending mushaf order**
  (78..114) by `src/utils/migrate.js` (`migrateSurahs`). The committed
  `public/words.json` is the **legacy** shape: no `no`, **descending** (114..78).
- **`sitemap.xml`: differs** - the same 74 URLs, reordered to the ascending surah
  order (65 lines reordered).
- **`challenge.json`: differs in shape.** Committed day words are
  `[no, word]` tuples; the Firestore doc (and therefore the output) uses
  `{no, word}` objects. `publish-build.mjs` writes the Firestore `surahs`
  verbatim (line 274) and serialises the Firestore challenge shape via
  `sanitizePublicChallenge` (line 275); it does not normalise back to the
  committed legacy shape.
- The Phase 7A "byte-for-byte" claim holds only when `buildSite()` is fed the
  committed `public/words.json` (`test/seo.test.js`), not for the live Firestore
  shape. **The publish workflow, if enabled, would change these three files on
  the live site.** No live deploy was performed.

Owner decision required: either (a) migrate/serve Firestore in the committed
legacy shape, or (b) accept the mushaf-order + `{no,word}` shape and regenerate
the committed static files (and confirm the app reads that shape). Note AGENTS.md
section 7 asks for mushaf order, which the Firestore shape already is.

- **Private notes:** 30 private `challenge-notes-private.json` strings searched
  across all 77 generated files -> **0 leaks.**

### Step 6 - GitHub CI (blocked on WIF)
Secrets (names only): **none**. Variables (names only): `PREVIEW_ENABLED`,
`PUBLISH_ENABLED=false`. `WIF_PROVIDER` / `WIF_SERVICE_ACCOUNT` do not exist.
gcloud has **no credentialed account** (`gcloud auth list` empty), so the WIF
pool/provider + service account cannot be created here; creation also needs
broad owner IAM. Owner step B in `DECISIONS-LOG.md` has the exact
least-privilege commands (Firestore read + Hosting deploy only). The workflow was
NOT triggered.

### Step 7 - Preview + smoke
Preview URL: **https://ghareebalquran-d9ae5--phase7b-truizs9q.web.app**
(expires 2026-10-22, version `d91a79606b214cb9`).
- home 200; word page `/word/an-nas-4.html` 200; legacy redirect
  `/word/<arabic>.html` 301 -> `/word/al-ikhlas-2.html`; `/admin/` 200 with
  `X-Robots-Tag: noindex` + `Cache-Control: no-store`.
- headless run now: `window.__DATA_SRC__ = "firestore"`, 0 page errors.
- **Deviation (unchanged):** unknown paths return HTTP **200** (SPA catch-all
  `**` -> `/index.html`), not **404**; there is no `public/404.html`. AGENTS.md
  section 7 wants a real 404 status. Owner to decide (Finding 1 below).
- Deploy warning: the channel domain was not added to Firebase Auth authorized
  domains; admin sign-in on the preview may need that. Admin sign-in was NOT
  tested (owner does it).

### Step 8 - Push readiness (nothing pushed)
`git fetch origin` done. Local `rebuild` is **15 commits ahead** of
`origin/rebuild`. Unpushed-range scan (names + sizes only): no secret-named
files; the only large file is `package-lock.json` (364 KB, normal). `.npmrc` in
the range is a deletion of a benign `legacy-peer-deps=true` file. 
`challenge-notes-private.json` is gitignored and absent from the range.

Exact push command (NOT run):
```
git push origin rebuild
```

## Findings / deviations

1. **STEP 5: publisher output != committed static files** (words.json,
   sitemap.xml, challenge.json). Root cause: live Firestore stores the migrated
   mushaf-order shape with `no` / `{no,word}`, while the committed files use the
   legacy descending tuple shape. Word pages match. Requires an owner decision
   before enabling the publish workflow. (See Step 5.)
2. **404 status** is now 200 due to the `**` catch-all rewrite (applied exactly
   as documented in `DECISIONS-LOG.md`). No `public/404.html` exists.
3. **WIF not configured** -> `publish.yml` cannot authenticate yet (owner step B).
4. gcloud has no credentialed account on this machine, blocking gcloud-based
   steps (WIF creation).

## Owner remaining manual steps

1. Decide on Finding 1 (reconcile the publisher output shape/order with the
   committed static files) before enabling publishing.
2. Create the WIF pool/provider + least-privilege service account and set
   `WIF_PROVIDER` + `WIF_SERVICE_ACCOUNT` (owner step B in `DECISIONS-LOG.md`).
3. After a first successful manual `publish.yml` run, set `PUBLISH_ENABLED=true`.
4. Decide on the 404 status (Finding 2).
5. Optionally add the preview channel domain to Firebase Auth authorized domains.
6. Push when ready: `git push origin rebuild`.

## Verification run in this phase

- `npm test`: 76 tests, 75 pass, **1 fail** = the single known `arabic-guard`
  `class2Added` (`public/_shade-cards-proposal.html`). Not re-run after the
  resume because no repo code files changed since (only docs).
- `node scripts/ci/checks.mjs`: PASSED (same reason, not re-run).
- `rules:test`: not run (rules unchanged).
- Protected SHA-256 hashes: all 4 **OK** (words.json, challenge.json,
  redirects.json, challenge-notes-private.json).

## Hard limits honored

No `git push`, no production Hosting live-channel deploy, no Cloud Functions
deploy, no Blaze/billing change, no production deletions, no secrets printed or
committed, `git add .` never used, design files untouched, protected files
byte-identical.
