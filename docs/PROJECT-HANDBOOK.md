# Ghareeb Al-Quran: project handbook

Last verified at commit `c67dad8` on 2026-11-05.

This handbook is for anyone, person or AI agent, who works on this repository without other context. Every statement
below was checked against the repository, the workflows, `firebase.json`, `firestore.rules`, `package.json`, or a
read-only `gcloud` / `gh` / `firebase` command on the date above. Anything that could not be checked is marked
**UNVERIFIED** with the reason. If the code and this file disagree, the code is right and this file needs a fix.

It never contains secret values, keys, tokens, e-mail addresses or any document content (Quran text, meanings). Secrets
and variables are named, never shown. People are named by role: **owner** (the one project owner and default admin)
and **admin** (anyone the owner adds).

Contents: 1 Overview · 2 Repository map · 3 Architecture · 4 Data model · 5 Admin panel · 6 Security rules ·
7 CI/CD · 8 Backups · 9 Testing · 10 Runbooks · 11 Hard rules · 12 Decision log · 13 Known issues and backlog ·
14 Glossary

---

## 1. Overview

- **What it is:** an Arabic, right-to-left website that explains rare Quranic words (غريب القرآن). For each word it
  shows the meaning, the ayah with the word highlighted, the ayah number and the source. It also has a 30-day
  challenge and a quiz. Today it covers 28 surahs and 73 words, with 30 challenge days (counted from
  `public/words.json` and `public/challenge.json`).
- **Who uses it:** the public, anonymously and with no accounts; their progress stays in the browser's
  `localStorage`. One owner, plus any admins the owner adds, edit the content in an admin panel at `/admin/`.
- **Domain:** https://ghareebalquran.com (Firebase Hosting). It is also served at `ghareebalquran-d9ae5.web.app`
  and `ghareebalquran-d9ae5.firebaseapp.com`.
- **Firebase project ID:** `ghareebalquran-d9ae5` (`.firebaserc`, `firebase.json` workflows). Project number
  `801334278891` (from the Workload Identity pool name). Hosting site ID: `ghareebalquran-d9ae5`.
- **Plan:** the free (Spark) plan. There are no Cloud Functions; the site is static.
- **Repository:** `yusufhamdy/ghareeb-amma` on GitHub. It is **public**, so treat every committed file and every
  Actions log as public. The default branch is `main`.

## 2. Repository map

Tracked top-level entries (from `git ls-files`). Folders that exist only on a developer's machine are listed after.

| Path | What it is |
|---|---|
| `public/` | The deployed website, exactly as served (Hosting `public` dir). About 290 files. |
| `public/index.html` | The single-page app (home, search, surahs, word, challenge, quiz, settings). All inline scripts are CSP-hashed. |
| `public/admin/` | The admin panel: `index.html` plus pure logic modules `word-merge.js`, `history-logic.js`, `challenge-logic.js`, `ayah-check.js`, and `quran-hafs.json` (reference text for the ayah check). |
| `public/words.json`, `public/challenge.json` | The published data the public site reads. |
| `public/word/`, `public/surah/` | Static pages: 73 word pages and 28 surah pages, for search engines. |
| `public/about/`, `privacy/`, `terms/`, `rights/` | The four legal pages (static). |
| `public/sw.js` | The service worker. |
| `public/firebase-config.js` | The public Firebase web config, used **only** by the admin. Contains public identifiers, no secrets. |
| `public/fonts/`, `css/`, `og/`, `assets/` | Self-hosted fonts, styles, share images (`og/word/` per word), other assets. |
| `public/sitemap.xml`, `robots.txt`, `manifest.json`, `404.html` | SEO, PWA manifest and the custom 404. |
| `firebase.json` | Hosting config: security headers with the CSP, cache headers, 71 redirects; Firestore rules path; emulator ports. |
| `firestore.rules` | The Firestore security rules (section 6). |
| `.firebaserc` | Default project `ghareebalquran-d9ae5`. |
| `package.json`, `package-lock.json` | Dependencies and the npm scripts (section 9). |
| `.github/workflows/` | `ci.yml`, `release.yml`, `backup.yml`, `publish.yml`, and a `README.md` that is out of date (section 7). |
| `scripts/` | Build, release, data and backup scripts (listed in sections 7 to 10). |
| `scripts/checks/` | Browser and emulator checks, mostly run by the tests; `README.md` lists them. `vendor/firebasejs-10.14.1/` is the hash-pinned SDK copy used by the tests. |
| `scripts/ci/checks.mjs` | Static checks run in CI: fonts, redirects, sitemap, secret patterns. |
| `test/` | `node:test` suites (about 60 files; `npm test` runs them all). |
| `shared/` | Code shared by the site and the build scripts: `normalize.js`, `seo.js`, `challenge.js`, `legal.js`. |
| `data/` | `redirects.json` (old Arabic URLs to new slugs) and `data/quran/` (the official Hafs text and its loader). |
| `src/utils/` | Older utilities (`migrate.js`, `normalize.js`, `theme-gen.js`); not loaded by the live site. |
| `tools/` | Visual-parity tools from the rebuild (its own `package.json`); `tools/serve.mjs` is a small static server. |
| `design/`, `design-spec-final.html` | The design spec and tokens from the rebuild. |
| `backup/old-public/` | An archived copy of the old site from before the rebuild. |
| `ghareeb-handoff/AGENTS.md` | The original rebuild brief (October 2026). Historical; parts no longer match the current setup (see section 13). |
| `BACKUP-RESTORE.md` | Owner setup and restore steps for the encrypted backups. |
| `DECISIONS-LOG.md`, `PHASE-*-REPORT.md` | History of the rebuild phases and their decisions. |
| `AGENTS.md` | The short entry point for agents, with the hard rules. |
| `docs/PROJECT-HANDBOOK.md` | This file. |
| `.gitattributes` | Keeps the vendored SDK byte for byte (`-text`). |

Local-only (git-ignored, see `.gitignore`): `node_modules/`; `backup/firestore/` (production exports made by
`scripts/firestore-export.mjs` and snapshots from `scripts/fix-ayat-firestore.mjs`; plaintext, keep off any shared drive);
`data/challenge-notes-private.json` (the owner's private day notes; **never commit or deploy**);
`scripts/checks/out/` (reports, screenshots, and the security audit and remediation plan, including
`scripts/checks/out/remediation-plan/PLAN.md`); `CHECKPOINT.md`; `design/baseline/`; `tools/report/`; `build/`;
`.firebase/`; `.agents/`.

## 3. Architecture

### 3.1 Public site (single-page app)

- `public/index.html` loads its data with two plain fetches, `words.json` and `challenge.json`, and sets
  `window.__DATA_SRC__='json'` just before (`public/index.html`, the main `Promise.all`). `window.__WORDS__` and
  `window.__CH__` are test-only overrides; no public script assigns them (`test/public-isolation.test.js`).
- **No Firebase on public pages.** Since Phase 1B (`be9fa9d`) no public page loads the Firebase SDK, `firebase-config.js`
  or `migrate.js` (deleted), and none talks to Firestore. `test/public-isolation.test.js` checks the code statically
  and in a browser on every route, and `npm run client:verify` checks there are 0 requests to gstatic or Firestore.
- Visitor settings and progress are kept in `localStorage` under `gq-*` keys (for example `gq-set`, `gq-prog`).
- Error tracking: the home page loads the Sentry loader script (added in `789179a`). The CSP allows the Sentry CDN
  and this project's Sentry ingest host.
- **Quran text in the Madinah Mushaf page fonts V2 (QCF V2).** Every ayah is drawn word by word with the glyphs of
  its printed Mushaf page (`public/fonts/qcf-v2/QCF2582.ttf` to `QCF2604.ttf`, Juz Amma; `SOURCE.md` there lists the
  source and SHA-256 of each file). The one table `public/qcf-v2.json` (built offline by
  `scripts/build-qcf-table.mjs`) holds, per word of surahs 78-114, its page, glyph code and official text: the
  Complex's own Hafs text (`data/quran/`) split at Quran.com's word positions; codes and pages from Quran.com,
  cross-checked with `mushaf-v2.txt` and with each font's glyph table. The stored text never changes.
  - `public/qcf.js` (pure, shared by the site, the admin, the static pages, the images and reels) matches each
    stored segment to whole words of the table, letter by letter, and builds the glyph layer; `public/qcf-dom.js`
    loads only the page fonts the visible ayat need and swaps an ayah from Hafs v22 to its glyphs once they have
    loaded; `public/qcf.css` shows one layer or the other.
  - The official text stays in the DOM (visually hidden): screen readers, find in page and copy use it; the glyph
    layer is `aria-hidden`, and copying a selection gives the official text, never glyph codes.
  - Fallbacks: until the fonts load, if one fails, or if an ayah does not match the table (for example a manually
    typed ayah, decision SEC-2), the ayah is shown in Hafs v22 as before (with `qfont.js`).
  - The match check `node scripts/qcf-match.mjs` (ids and positions only) runs `--strict` in CI on pull requests; a
    publish build only lists a mismatch in its summary.
- Static SEO pages (`public/word/*.html`, `public/surah/`, legal pages) are plain HTML. The sitemap has 106 URLs: home,
  73 word pages, 28 surah pages and 4 legal pages.

### 3.2 Service worker (`public/sw.js`)

- Cache name: **`ghareeb-pwa-v47`**. On install it precaches `/`, `/index.html`, the icons, `/css/app.css`,
  `/theme-boot.js`, `/quiz-core.js`, `/word-gap.js`, `/qfont.js`, `/qtext.js`, `/qcf.js`, `/qcf-dom.js`, `/qcf.css`,
  `/qcf-v2.json`, `/fonts/fonts.css`, the Hafs and Amiri font files, `/words.json` and `/challenge.json`. The QCF V2
  page fonts (`/fonts/qcf-v2/`) are cached on first use and then served from the cache. It calls `skipWaiting()`; on activate it deletes every other
  cache and calls `clients.claim()`.
- Fetch handling: only same-origin `GET`. **`/admin` and `/admin/*` are never handled** (always network).
  Navigations are network-first, falling back to the cached page, then `/index.html`, then a small offline page (503).
  `words.json`, `challenge.json`, `qcf-v2.json` and any `.js` or `.css` are network-first with `cache: 'no-cache'`, falling back to
  the cache. Everything else is cache-first.
- `test/public-isolation.test.js` pins the cache name (currently asserts `v47`) and checks the worker precaches no
  Firebase file. Bump the version on any release that changes cached files (runbook 10.6).

### 3.3 Content-Security-Policy and headers

- One CSP for all paths, in `firebase.json` under `hosting.headers` (`source: "**"`). It is **generated** by
  `scripts/csp-update.mjs`, never edited by hand. `script-src` allows `'self'`, the sha256 hash of each inline
  script (3 hashes at this commit), the Sentry CDNs, `https://www.gstatic.com/firebasejs/` (admin SDK) and
  `https://apis.google.com` (admin Google sign-in). `connect-src` allows Firestore, Firebase Auth (identitytoolkit,
  securetoken) and the Sentry ingest host. `frame-src` allows only the Firebase Auth domain. `object-src 'none'`,
  `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`.
- When any inline `<script>` in any HTML file under `public/` changes, run `npm run csp:update` and commit
  `firebase.json` (runbook 10.7). `node scripts/csp-update.mjs --check` fails if `firebase.json` is stale; it runs in
  `test/csp.test.js` and as a Release step.
- Other headers for every path: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: DENY`, and a `Permissions-Policy` that turns off camera, microphone, geolocation, payment and usb.
- Cache headers, from `firebase.json` and confirmed on the live site:

| Path | Cache-Control |
|---|---|
| `/admin/**` | `no-store` (plus `X-Robots-Tag: noindex, nofollow`) |
| `/sw.js`, `/firebase-config.js` | `no-cache` |
| `/fonts/**` | `public, max-age=31536000, immutable` |
| everything else (HTML, `words.json`, `challenge.json`) | not set in `firebase.json`; Hosting's default `max-age=3600` (seen live) |

## 4. Data model

### 4.1 Firestore (the admin's working copy)

Every path below is readable by admins only; the public site never reads Firestore (section 6).

| Path | Fields | Notes |
|---|---|---|
| `public/data` | `rev` (int), `surahs` (list, at most 114), `updatedAt` (timestamp), `by` (the writer's Firebase uid) | The words. Each surah entry: `surah` (name), `no` (surah number), `words`, `meanings`, `ayahs` (parallel lists by index), `source`. Each ayah: `label` and `segments`, each segment `{num, before, hl, after}` (`hl` is the highlighted word). |
| `public/challenge` | `startDate` (null or `YYYY-MM-DD`), `releasedUpTo` (null or int), `days` (list, at most 366) | The 30-day plan. Each day `{d, w, reel...}`; `w` lists `[surahNo, word]` pairs. |
| `public/prev` | `rev`, `surahs`, `savedAt` | The last copy from before version history. The admin no longer writes it; kept as a last resort. |
| `snapshots/{rev}` | `rev`, `surahs` | The full words of version `rev`. Create-only. |
| `history/{rev}` | `rev`, `kind`, `summary` (max 300 chars), `by` (uid), `byEmail`, `at` (server time), `restoredFrom` (only when `kind` is `restore`) | One row per version. `kind` is one of `edit`, `import`, `restore`, `baseline`. Create-only. |
| `config/admins` | `emails` (list of lowercase addresses, at most 50) | Extra admins. The owner is named in the rules, not here. **This document does not exist in production today** (single admin), which is normal. |
| `admin/challengeNotes` | day number -> note text | The owner's private day notes («التدبر»). Never public; never in `challenge.json`. |

- **`rev`:** every save of `public/data` raises `rev` by exactly 1, and writes `snapshots/{rev}` and `history/{rev}`
  in the same transaction. The rules enforce all of this (section 6).
- **`baseline`:** the first save after version history was released (or after any write made outside the admin)
  first records the current, unrecorded version as `kind: "baseline"` with its exact stored bytes, then the new
  version. So a save with its baseline writes five documents.
- Production state on 2026-11-04 (read-only): `public/data` at rev 7, 2 history rows and 2 snapshots. As of the
  2026-11-01 export, Firestore and the published `words.json` differed in exactly one meaning (and in surah order);
  all ayahs matched. That is, one admin edit was not yet published. **UNVERIFIED after 2026-11-01:** not re-read.

### 4.2 Published JSON and how it is produced

- `public/words.json`: a list of surahs `{surah, words, meanings, ayahs, source}` (no `no` field).
  `public/challenge.json`: `{startDate, releasedUpTo, days}`. The private notes never appear in either
  (`scripts/check-private.ps1`, `test/privacy.test.js`).
- **Today the published files are the committed ones.** `release.yml` deploys `public/` from `main`, including
  `words.json` and `challenge.json` as committed. They last changed in `3731447` (2026-10-30). Live hashes on
  2026-11-05: `words.json` `06928b7bc6dc700c`, `challenge.json` `5010809535cfb246` (first 16 hex of SHA-256), the same
  as `main`.
- **Admin saves go live automatically (owner decision, D-6).** Saving in `/admin/`, or confirming a delete there,
  counts as the owner's approval to publish, within the limits below. The scheduled Publish workflow (every 15 minutes,
  section 7) builds, checks and deploys it, usually 30 to 60 minutes after the save. The admin's own message says a
  change appears "after the next publish".
  - **Goes live by itself:** edits and additions; challenge changes; and removals of **at most 7 words** when every
    removed word was removed by an admin save (a history row of kind `edit`, which is what deleting a word or a surah
    writes) after the published rev. A removed surah follows the same rule. Each removed page gets its D-4 redirect.
  - **Waits for the owner in a pull request:** more than 7 removed words, words removed by an import or a restore, and
    any removal the history can't show (a missing history row or snapshot, or a write the admin did not record).
  - **Any failed check deploys nothing.** The run fails and GitHub e-mails the owner. The same state is not retried
    every 15 minutes (section 7); a new save, a challenge change or a commit to `main` starts over.
  - The decision is made by `scripts/publish-plan.mjs` from `history/` and `snapshots/`, read-only. It walks every save
    after the published rev (`public/rev.json`) and finds, for each removed word, the save that removed it.
- **A delete removes the word from the challenge in the same save.** Every published word is used by a challenge day,
  and the challenge-integrity check refuses a reference to a word that is gone. So deleting a word or a surah in
  `/admin/` also removes its references from the challenge days, in the same transaction as the words and their history
  row: one confirmation, and the publish goes through. The confirm dialog names the days that use the word. Days are
  never removed.
- **A delete that would leave a challenge day with no words is blocked.** A visitor finishes a day by marking its
  words, so an empty day could never be finished and every day after it would stay locked. The dialog names the
  day(s) it would empty and asks to add another word to them in the Challenge tab first; its confirm button stays
  disabled. The save checks again on the latest challenge inside the transaction, so if another admin changed the
  challenge after the page loaded, nothing is written and the message names the day. The publish build refuses any
  challenge with an empty day too (challenge integrity, below), however Firestore was edited.
- **Removal ceilings.** An automatic publish never removes more than 7 words: the plan refuses it and the build is run
  with `--max-removals 7`, on top of the 10% ceiling. A scheduled run that finds more removals than the 10% ceiling
  allows (8 or more of 73 words today) fails and says how to go on: the owner reviews the removals and runs Publish by
  hand with `allow_removals` set to the exact number (and `removed_surahs`). That run always opens a pull request,
  never an automatic publish, and the build skips the 10% ceiling for it (`--owner-review`), because the owner reviews
  the pull request. The exact count must still match.
- **The generator:** `scripts/publish-build.mjs --publish` turns `public/data` and `public/challenge` into the site:
  `words.json`, `challenge.json`, `sitemap.xml`, `word/<slug>.html`, `surah/<slug>.html`, the legal pages, the share
  images and `rev.json`.
  - It reads only those two documents, read-only, with the Firestore client, so it works under Workload Identity.
  - It puts the data in the committed shape: surahs from 114 down, the committed key order, no `no` field, and challenge
    references as `[no, word]`. Text is copied exactly.
- **Its safeguards** (any failure stops it, with nothing written):
  - **strict shape:** no unknown keys, types and lengths checked, label format;
  - **removal guard:** checked against the committed `words.json`. The number of removed words must equal
    `allow_removals` exactly, never more than 10% of the words (7 of 73) except in a pull request the owner asked for
    by hand (`--owner-review`), never more than 7 in an automatic publish (`--max-removals 7`), and a removed surah must
    be listed;
  - **challenge integrity:** the same number of days, every day has at least one word, and every reference resolves
    under the site's own word key;
  - **stale files:** word and surah pages, share images and sitemap entries that no longer exist are deleted. Each
    removed page gets a 301 in `firebase.json`, to its surah page, or to `/` when the surah is gone too (decision D-4);
  - **private notes:** `admin/challengeNotes` is never read.
  - There is no Quran-text gate (decision SEC-2). The report shows every changed field.
- **Share images:** a word's share image is made again only when its word, surah or ayah changes. The image does not
  show the meaning, so a meaning-only edit keeps the image as it is.
- **`rev.json`** is `{rev, hash, words}`, with no time in it, so two builds of the same `rev` are identical.
- **Release is the only deploy path,** and it deploys the committed `public/`. An automatic publish commits to `main`
  and then calls Release for that commit (a push made with `GITHUB_TOKEN` never starts Release by itself). Release
  refuses any commit that is not the tip of `main`, so there is no race between a publish and a merge.

## 5. Admin panel (`public/admin/index.html`)

- **Sign-in:** Google sign-in through Firebase Auth (`signInWithPopup`, falling back to `signInWithRedirect` when popups
  are blocked). The page loads the Firebase web SDK **10.14.1** from `https://www.gstatic.com/firebasejs/10.14.1/`.
  If `window.FIREBASE_CONFIG` is missing it runs in a **demo mode** that stores changes in `localStorage` only
  (`live()` is false).
- **Owner vs admin:** the owner is the one address named in `isOwner()` in `firestore.rules`. Admins are the addresses
  in `config/admins`. Both may edit words, the challenge and the notes. Only the owner may change the admins list.
  The rules check this, not the page.
- **Save flow for the words** (`store.update`, every save goes through it):
  1. The page starts a Firestore transaction and reads the latest `public/data`.
  2. If that version has no history row yet, it writes the baseline (`snapshots/{rev}` and `history/{rev}` with
     `kind: "baseline"`).
  3. It applies the edit to the **latest** words (not the copy on screen), checks the size, then writes `public/data`
     with `rev + 1`, `updatedAt` = server time and `by` = the uid, plus `snapshots/{rev+1}` and `history/{rev+1}` with a
     one-line summary.
  4. The rules check every document in the transaction (section 6). If anything fails, nothing is written.
  The challenge and the notes are saved with their own simpler writes.
- **Conflicts and the picker:** while you edit one word, someone (or another tab) may save. On save, the page merges
  per field with `WordMerge.merge` (`public/admin/word-merge.js`), comparing three versions: when the editor
  opened (base), your form (mine) and the latest in the transaction (theirs). A field only you changed takes yours;
  a field only they changed takes theirs; the same new value is fine. If both changed one field differently, the save
  stops and the window shows a **conflict picker**: one choice per field (your version or the newer one). Pressing
  Save stores your choices. Edits to different words in two tabs both survive. Added in `44da0b7`.
- **`WordMerge.canon` and key order:** `canon(v)` is `JSON.stringify` with every object's keys sorted, and
  `same(a, b)` compares `canon` strings byte for byte. Firestore in production returns map keys in a different order
  on different reads, so a plain `JSON.stringify` comparison saw unchanged words as "changed" and caused false
  conflicts and refused saves. Fixed in `5617e7a` (PR #7). Stored Quran text is compared exactly and never
  normalized.
- **Version history and restore:** the Tools tab («أدوات») has the version history («سجل النسخ»). It lists
  `history/` rows, shows what changed between versions (`public/admin/history-logic.js`), and can restore a version.
  A restore is a **new** version with `kind: "restore"` and `restoredFrom`, never an overwrite. Nothing in the
  history can be changed or deleted, even by the owner. The old Undo button was removed with this change (`ab2ef6c`).
- **Unsaved-changes warning:** since admin v2 (`33a7c3a`), leaving or reloading the page with unsaved edits (an open
  editor or unsaved challenge settings) shows the browser's "leave page" prompt (`beforeunload`).
- **Signed out mid-edit:** if the session ends while a window is open (SEC-7), saving writes nothing and shows a
  sign-in message with a button, keeping the typed text. On sign-out the words, admins list, challenge and notes are
  cleared from memory (SEC-9), except in a window kept open, until it closes.
- **The 20-lookup rules limit:** Firestore allows at most 20 document lookups (`get`, `exists`, `getAfter`,
  `existsAfter`) per rules evaluation of a transaction. The rules bind repeated lookups with `let` to stay under it,
  and `test/rules-history.test.js` (test "baseline: passes for the listed admin on the real words, within the limit on
  document lookups") proves a non-owner admin's first save, with its baseline, is accepted. The exact counts have not
  been measured. The local remediation plan (`scripts/checks/out/remediation-plan/PLAN.md`, F-7) estimates "17 raw"
  for the owner and "about 18" for a non-owner after the `let` binding, and calls the latter an inference. The emulator
  merges repeated lookups, so it can't settle the exact number.

## 6. Security rules (`firestore.rules`), in plain words

Helpers:
- `mail()`: the signed-in address in lowercase, only when Google has verified it; otherwise null.
- `isOwner()`: `mail()` equals the one owner address written in the rules.
- `isAdmin()`: the owner, or `mail()` is listed in `config/admins.emails`. A missing list refuses, and no `exists()`
  is used, to save lookups.

| Path | Read | Create / update | Delete |
|---|---|---|---|
| `public/data` | admins | admins, only in the exact shape (`rev`, `surahs`, `updatedAt`, `by`; `by` must be the writer's uid) **and** `savedWithHistory()`: `rev` goes up by exactly 1 (or is 1 for a new document), `updatedAt` is the server time, the old version has its history row, and the new version's history row and snapshot (with the same `surahs`) are written in the same transaction | nobody |
| `public/prev` | admins | admins, in its shape | nobody |
| `public/challenge` | admins | admins, in its shape (`startDate` date string or null, `releasedUpTo` 0..366 or null, `days` at most 366) | nobody |
| `snapshots/{id}` | admins | admins, if `id` equals `rev`, and it records either the baseline (the exact current words) or the save in the same transaction | nobody (no update either) |
| `history/{id}` | admins | admins, if the shape is exact, `by`/`byEmail` are the writer's, `at` is the server time, `kind` is valid, `restoredFrom` only with `restore`, and it matches the snapshot / save in the same transaction | nobody (no update either) |
| `config/admins` | admins | **owner only**, lowercase addresses, at most 50 | owner only |
| `admin/challengeNotes` | admins | admins, keys are day numbers, total text at most 200,000 chars | owner only |
| anything else | nobody | nobody | nobody |

Since Phase 1A (`6fa8246`, PR #6), **visitors cannot read anything in Firestore**: they get the published JSON from
Hosting. The rules do not check what is inside `surahs` or `days` (backlog F-16 / SEC-3), nor the sign-in provider
(F-18 / SEC-10).

How they are tested:
- `npm run rules:test`: `test/rules-emulator.test.js`, `test/rules-access-matrix.test.js` and
  `test/rules-history.test.js` in the Firestore emulator (47 tests at this commit). `test/rules.test.js` is a static
  check of the rules text.
- `scripts/checks/rules-real-data.mjs` (manual): the rules against copies of the real production documents
  (section 9.3).
- Deploying the rules is manual and owner-only (runbook 10.5). The live rules hash on 2026-11-05 was
  `d54cc7eb1c9c28fa`, identical to `firestore.rules` on `main`.

## 7. CI/CD

| Workflow | Name | Trigger | What it does | Deploys |
|---|---|---|---|---|
| `.github/workflows/ci.yml` | CI | `pull_request` (all), and push to branch `rebuild` | `changes`: a pull request that changes only `*.md` files runs no suite. `tests`: `npm test` in 4 parallel shards by test file (`scripts/ci/shard-tests.mjs`, balanced by `scripts/ci/shard-durations.json`, 2 files at a time per 2-core runner). `checks`: `npm run rules:test`, `node scripts/ci/checks.mjs`, `pwsh scripts/check-private.ps1`, `npm run client:verify`. `Verify` (the one final status): fails unless every shard and the checks passed and every test file ran exactly once on the same commit; on a Markdown-only change it runs `checks.mjs` and `check-private` instead. It then records the verified git tree as the artifact `ci-passed-tree-<tree>` (30 days). Caches: npm (setup-node), Playwright Chromium and the Firestore emulator jar, keyed on the locked versions | nothing |
| `.github/workflows/release.yml` | Release | push to `main`, and `workflow_call` from Publish (input `sha`) | Checks the commit is the latest `origin/main`; `npm ci`; `npm test` (with Java 21 and Chromium; no deploy on any failure) unless this exact tree already passed (below); `csp-update.mjs --check`; signs in through Workload Identity; `firebase deploy --only hosting`; `node scripts/smoke-live.mjs https://ghareebalquran.com` (the home page, and the first word of the deployed `words.json` as an app route and as its static page, never a fixed word) | **Hosting only** (never rules) |
| `.github/workflows/backup.yml` | Backup | daily cron `17 3 * * *` (03:17 UTC) and manual | Section 8 | nothing (writes the backups repo) |
| `.github/workflows/publish.yml` | Publish | cron `*/15 * * * *` and manual, on `main`, only while `PUBLISH_ENABLED` is `true` | `check`: reads only the Firestore rev and the public challenge (REST, `ghareeb-backup`, read-only) and compares them with `public/rev.json` and `challenge.json` on `main`; the same, and the run ends. `build`: `publish-plan.mjs plan`, `publish-build.mjs --publish`, then `npm test`, rules tests, CSP check, `checks.mjs`, `check-private`, the credential guard. `commit` (auto): pushes "Publish: Firestore rev N" to `main`. `deploy`: calls Release. `pr` (otherwise): opens or updates the PR from `publish/next`. `remember`: marks a failed, unchanged or PR state so it is not rebuilt every 15 minutes. Concurrency group `publish`. Manual inputs `allow_removals` and `removed_surahs` (empty for the usual run): with a count, always a PR, past the 10% ceiling, exact count required (section 4.2) | **Hosting, through Release** (an automatic publish); never Firestore |
| `.github/workflows/keepalive.yml` | Keepalive | monthly cron `41 5 1 * *` (05:41 UTC on the 1st) and manual, on `main` | Re-enables Publish, Backup and itself through the GitHub API (`gh api -X PUT .../actions/workflows/<file>/enable`). A workflow the owner turned off by hand (`disabled_manually`) is left off. Permissions: `actions: write` only; no checkout, commit, data or deploy | nothing |

- **CI does not run on `main`.** On `main`, Release runs the full test suite before deploying, unless the exact git
  tree it deploys already passed it:
  - **a merge:** the head of the pull request merged into the commit passed a `ci.yml` run in this repository (not a
    fork), and that run recorded this tree (`ci-passed-tree-<tree>`). CI tests a pull request's merge commit, so a
    squash merge has the same tree only when `main` did not move after CI ran;
  - **called by Publish:** the Publish `build` job's checks (npm test, rules tests, CSP, checks.mjs, check-private)
    passed on this tree (input `tested_tree`). The job hands the tree over only when its commit holds the whole
    working tree the checks saw.

  A different tree, or anything not found (an expired artifact, an API error, a Markdown-only pull request), runs the
  full suite as before. The CSP check and the smoke check always run. The step summary says which case it was.
- **Rebalancing the shards:** each CI run's Verify job keeps the measured seconds per test file as the artifact
  `test-durations`. Copy it to `scripts/ci/shard-durations.json` when the shards drift apart. A new test file needs no
  change: it is found by Node's own default patterns and gets an estimate until it has a recorded time.
- **No preview workflow.** Previews are deployed from a developer machine with the CLI (runbook 10.2). The old
  `preview.yml` was removed in PR #15: it could never run (its only trigger was `workflow_dispatch`, but its job
  required a `push` or `pull_request` event), and the secret it needed, `FIREBASE_SERVICE_ACCOUNT`, does not exist.
- `.github/workflows/README.md` is from the rebuild and out of date (it says Release deploys rules and Functions; it
  does not).
- **Publish commits and PRs don't start CI or Release.** Anything pushed or opened with `GITHUB_TOKEN` starts no
  workflow. So the Publish `build` job runs the same checks first, and an automatic publish calls Release itself, which
  runs `npm test` again before deploying. `main` has no required status checks or reviews, so the `commit` job can push.
- **Publish permissions, per job** (the workflow default is none):
  - `check`, `build`: `contents: read`, `id-token: write` (the read-only sign-in). They can't write the repository.
  - `commit`: `contents: write` (push to `main`), `pull-requests: write` (close a publish PR it replaces). No sign-in.
  - `deploy`: `contents: read`, `id-token: write`, passed to Release, which signs in as `WIF_SERVICE_ACCOUNT`.
  - `pr`: `contents: write` (push `publish/next`), `pull-requests: write`. No sign-in.
  - `remember`: none (it saves an Actions cache entry).
- **The credential never reaches the tests:** the `build` job deletes it and sets the three variables to empty before
  any test, and the step "No Google credential is left" fails the job otherwise. The planned data file is deleted too.
- **Not rebuilt every 15 minutes:** a run that fails, finds nothing to publish or opens a PR saves a cache entry named
  `publish-seen-<rev>-<challenge hash>-<main commit>`. Scheduled runs skip that state; a manual run ignores it.
- **Failure e-mails:** GitHub e-mails a scheduled workflow's failures to the person who last changed its schedule.
- **Scheduled workflows are kept on (Keepalive).** In a public repository GitHub turns off scheduled workflows after
  60 days without repository activity, which would stop Publish and Backup without any error. Keepalive runs monthly
  and enables both again; enabling a workflow starts its 60 days again. It also enables itself, since it is scheduled
  too. If it has been turned off anyway, run it by hand (Actions > Keepalive > Run workflow), or enable each workflow
  in the Actions tab.
- Opening the PR also needs the repository setting "Allow GitHub Actions to create and approve pull requests"
  (runbook 10.4). Approving and merging a publish PR stay with the owner.
- All actions are pinned to commit SHAs. Runners are `ubuntu-24.04`.

Repository secrets (names only): `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT`, `BACKUP_DEPLOY_KEY`.
Repository variables: `BACKUP_AGE_RECIPIENT` (the age public key), `BACKUP_REPO`, `BACKUP_ENABLED` (`true`),
`PUBLISH_ENABLED` (`true` since 2026-11-06; set it to `false` to stop all publishing). (`PREVIEW_ENABLED` was deleted on 2026-11-05: nothing read it after `preview.yml` was removed.)

**Workload Identity Federation** (keyless sign-in from GitHub Actions to Google Cloud):
- Pool `github`, provider `github` (ACTIVE), issuer `https://token.actions.githubusercontent.com`.
- Provider condition: `assertion.repository=='yusufhamdy/ghareeb-amma' && assertion.ref=='refs/heads/main'`. Only
  workflows running on `main` of this repository can get any identity.
- Attribute mapping: `google.subject=assertion.sub`, `attribute.repository`, `attribute.repository_owner`.

**Service accounts** (project roles from `gcloud projects get-iam-policy`; 0 user-managed keys on each):

| Account | Project roles | Who can act as it | Used by |
|---|---|---|---|
| `ghareeb-publish@ghareebalquran-d9ae5.iam.gserviceaccount.com` | `roles/datastore.viewer`, `roles/firebasehosting.admin` | `roles/iam.workloadIdentityUser` for `principalSet://.../workloadIdentityPools/github/attribute.repository/yusufhamdy/ghareeb-amma` | Release (through the secret `WIF_SERVICE_ACCOUNT`). Its `datastore.viewer` role is no longer needed, since Release reads no Firestore; removing it is an optional owner step |
| `ghareeb-backup@ghareebalquran-d9ae5.iam.gserviceaccount.com` | `roles/datastore.viewer` only | the same principal set | Backup and Publish (named directly in `backup.yml` and `publish.yml`) |
| `firebase-adminsdk-fbsvc@ghareebalquran-d9ae5.iam.gserviceaccount.com` | `roles/firebase.sdkAdminServiceAgent`, `roles/firebaseauth.admin`, `roles/iam.serviceAccountTokenCreator` | not bound to the pool | Firebase's default Admin SDK account; not used by any workflow |

Google-managed service agents also hold roles (`firebase.managementServiceAgent`, `firebaserules.system`,
`firestore.serviceAgent`). There is **one human with `roles/owner`** (backlog F-13). No account used by CI can deploy
Firestore rules.

## 8. Backups

- **What:** `public/data`, `public/prev`, `public/challenge`, `admin/challengeNotes`, `config/admins`, every
  `snapshots/` and `history/` document (`scripts/firestore-export.mjs`, `DOCS` and `COLLECTIONS`).
- **When:** daily at 03:17 UTC, and by hand from the Actions tab (run one before every rules deploy). The job runs only
  when `BACKUP_ENABLED` is `true` and only on `main`.
- **How** (`.github/workflows/backup.yml`):
  1. Signs in as `ghareeb-backup` (read-only) through Workload Identity.
  2. `node scripts/firestore-export.mjs --quiet --out "$RUNNER_TEMP/export"`: read-only, prints counts only.
  3. `node scripts/backup.mjs seal`: bundles every file with its SHA-256 into one gzipped JSON and encrypts it with
     **age** to the public key in `BACKUP_AGE_RECIPIENT`, then deletes the plaintext. **No private key exists in CI.**
  4. `node scripts/backup.mjs upload`: pushes `backups/backup-<UTC time>.age` to the private repository named in
     `BACKUP_REPO`, over SSH with the deploy key in `BACKUP_DEPLOY_KEY`. GitHub's host key is pinned in the workflow.
     The branch is kept as a single commit, so dropped backups are really gone.
  5. Retention (`scripts/backup-lib.mjs`, `KEEP`): the newest backup of each of the latest **14 days, 8 ISO weeks
     and 12 months**, at most 34 files.
  6. Removes everything the run wrote, even on failure.
- **Where:** the private repository `yusufhamdy/ghareeb-amma-backups` (`private=true`). On 2026-11-05 it held 2 files.
  First good run: 2026-11-04 (manual); the daily schedule ran on 2026-11-05.
- **The private key** exists only with the owner, offline (password manager plus a sealed offline copy, per
  `BACKUP-RESTORE.md`). If it is lost, every backup is unreadable. Never put it in the repo, a secret or a chat.
- **Restore rehearsal** (owner's machine, emulator only; it refuses to run without a local emulator and a `demo-` project):

  ```
  npx firebase emulators:exec --project demo-ghareeb --only firestore "node scripts/backup-restore-rehearsal.mjs --file <backup .age file> --identity <path to the age private key>"
  ```

  Expected output, in order: the number of files decrypted with every hash checked; the structure counts (rev, surahs,
  words, challenge days, snapshots, history rows, documents); "loaded into the emulator and read back: all N documents
  identical"; "rules still enforced: a signed-out reader is refused"; then `REHEARSAL PASSED`. Add `--compare <export
  folder>` to count documents that differ from a fresh export.
- **Rehearsed with the real key:** on 2026-11-04 the owner ran the rehearsal on their machine with the real
  `age-keygen` key, on `backups/backup-2026-11-04T20-39-17Z.age`. Result: 9 files decrypted with every hash checked;
  rev 7, 28 surahs, 73 words, 30 challenge days, 2 snapshots, 2 history rows, 8 documents; all 8 identical after
  loading; a signed-out reader refused (5 probes); `REHEARSAL PASSED`. This also confirms that keys made by the `age`
  command-line tool work with `scripts/backup-lib.mjs` (the repo's tests use a throwaway key from the
  `age-encryption` library).
- **Disaster recovery:**
  1. Stop and look: get a fresh read-only export of the current state (`node scripts/firestore-export.mjs`), so you
     know what is there now.
  2. **Bad edit to the words:** in the admin, Tools, version history, restore the last good version. It becomes a new
     version, and nothing is lost.
  3. **History unusable or Firestore data lost:** take the newest good `.age` file from the backups repo, run the
     rehearsal on it (with `--compare` against the fresh export), then restore the words as a new version through the
     admin's Import. Use the Admin SDK only if the admin can't be used, after the fresh export, and only with the
     owner's explicit approval (`BACKUP-RESTORE.md`, "A real restore").
  4. **Public site broken:** roll back Hosting (runbook 10.8). The public site does not depend on Firestore at all.
  5. **Deploy key or recipient leaked:** follow "If something leaks" in `BACKUP-RESTORE.md`. Also keep the occasional
     backup copy somewhere other than GitHub, since a leaked deploy key can overwrite the backups repo.

## 9. Testing

Requirements: Node 20 (CI and Release; Node 24 also works locally), **Java 21** for the Firestore emulator (CI installs
Temurin 21), Playwright Chromium (`npx playwright install chromium`), and PowerShell (`pwsh`) for
`scripts/check-private.ps1`. The Firestore emulator jar is downloaded once and reused (`scripts/checks/emulator-setup.js`).

### 9.1 npm scripts (`package.json`)

| Command | What it runs |
|---|---|
| `npm test` | Every `test/*.test.js` with `node --test --test-concurrency=2 --test-timeout=600000` (287 tests at this commit; about 11 minutes locally). Includes browser tests and emulator suites that start their own emulators on their own ports. |
| `npm run rules:test` | The three rules suites in the Firestore emulator (section 6). |
| `npm run client:verify` | Seeds the emulator, then `scripts/verify-client-firestore.mjs`: the public page uses only the published JSON, with no Firebase request. |
| `npm run seed` | Seeds a local Firestore emulator with `scripts/seed-emulator.js`. |
| `npm run csp:update` | Regenerates the CSP in `firebase.json`. |

Also run in CI: `node scripts/ci/checks.mjs` and `pwsh -NoProfile -File scripts/check-private.ps1`. CI runs `npm test`
as `node scripts/ci/shard-tests.mjs run --shard N --of 4 --jobs 2` (section 7); `node scripts/ci/shard-tests.mjs plan
--of 4` shows the split.

### 9.2 Emulator checks run by the tests

`test/admin-history-emulator.test.js`, `admin-keyorder-emulator.test.js`, `admin-merge-emulator.test.js`,
`admin-concurrent-emulator.test.js` (two tabs saving at the same moment), `admin-delete-challenge-emulator.test.js`
(a delete removes its challenge references in the same save, and a delete that would empty a day is blocked), `publish-auto-emulator.test.js` (the automatic publish,
case by case, and a manual run with an exact count past the ceiling),
`backup-rehearsal-emulator.test.js` (T-41), and the browser part of `public-isolation.test.js`. Each runs a script from
`scripts/checks/` inside `firebase emulators:exec`; `scripts/checks/README.md` describes each one.

**Vendored Firebase SDK:** the admin checks serve the admin's SDK from `scripts/checks/vendor/firebasejs-10.14.1/`
(`firebase-app.js`, `firebase-auth.js`, `firebase-firestore.js`; byte-identical to gstatic's 10.14.1 and to the
`firebase@10.14.1` npm package, Apache-2.0). `scripts/checks/firebase-sdk-local.mjs` checks each file against its
pinned SHA-256 before use, and fails if `public/admin/index.html` no longer loads 10.14.1. No check downloads the SDK
at test time. The live admin still loads it from gstatic (SEC-5).

### 9.3 Manual checks (not in CI)

Both need an emulator config with **auth and firestore** (`firebase.json` has only firestore). Create one outside the
repo, for example:

```
{"firestore":{"rules":"firestore.rules"},"emulators":{"firestore":{"port":8680},"auth":{"port":9690},"hub":{"port":4460},"logging":{"port":4560},"ui":{"enabled":false}}}
```

with a copy of `firestore.rules` next to it. Then, from the repo root:

| Check | Command | Passing result |
|---|---|---|
| `scripts/checks/admin-audit.mjs` | `npx firebase emulators:exec --config <that config> --project demo-ghareeb --only auth,firestore "node scripts/seed-emulator.js && node scripts/checks/admin-audit.mjs"` (set `AUDIT_OUT` to a folder outside the repo for screenshots) | `ALL ADMIN CHECKS PASSED`, exit 0 (57 checks on 2026-11-05) |
| `scripts/checks/rules-real-data.mjs` | `npx firebase emulators:exec --config <that config> --project demo-ghareeb --only auth,firestore "node scripts/checks/rules-real-data.mjs backup/firestore/<export folder>"` (needs a read-only export first) | exit 0: 0 denied, unauthenticated reads refused, step 2 a no-op |
| `scripts/checks/public-isolation-matrix.mjs` | `OLD_PUBLIC=<a checkout of public/ from before be9fa9d> npx firebase emulators:exec --config <that config> --project demo-ghareeb --only auth,firestore "node scripts/checks/public-isolation-matrix.mjs"` | `ALL CHECKS PASSED` (43 on 2026-11-04) |
| `scripts/qa-phase6.mjs`, `scripts/smoke-ui.mjs` | see each file's header | `qa-phase6` has 1 known failing check (section 13) |

Never print document content from these runs. Their failure details can include meanings: filter output to check
names and counts.

### 9.4 Known slow or flaky-under-load tests

- `npm test` runs browser tests two at a time. Under load (low memory, other heavy processes), page loads can exceed 30 s:
  `test/phase-c.test.js`, `phase-i.test.js`, `phase-k.test.js`, `phase-m.test.js`, `phase-n.test.js` have each timed
  out once and passed on a re-run.
- `test/admin-v2.test.js` A11Y-4 waits up to 10 s for the file picker (raised from 3 s in `c67dad8`).
- `test/phase-h.test.js` H1 once failed only because the emulator exited with an error on shutdown, after the check
  itself passed.
- CI runners sometimes fail to reach Google hosts (network timeout). Re-run the failed job once; if it fails again,
  investigate.

## 10. Runbooks

Every production step needs the owner's explicit approval first (section 11).

### 10.1 Local development

```
npm ci
npx playwright install chromium
node tools/serve.mjs 8080        # serves public/ at http://localhost:8080
```

The public site works fully from local files. **Warning:** `/admin/` served this way loads the real
`firebase-config.js` and talks to the **production** Firestore. For admin work, use the emulators: `npm run seed`, or
the emulator checks in section 9, which point the admin at the emulators.

### 10.2 Preview deploy

```
npx firebase hosting:channel:deploy preview --project ghareebalquran-d9ae5
```

The channel `preview` serves at `https://ghareebalquran-d9ae5--preview-iveutml5.web.app` (expires 2026-12-01 unless
redeployed). **WARNING:** a preview channel is Hosting only; its admin page uses the **production** Firestore and
production sign-in. Never test saves, imports, restores or any write on a preview. Use it to look, and for signed-out
checks.

### 10.3 Production release

1. Open a PR into `main`. CI must pass.
2. The owner approves the merge. Squash-merge, with no attribution lines.
3. `release.yml` runs: full tests, CSP check, Hosting deploy, live smoke check. Watch it to the end:
   `gh run list --workflow release.yml -L1`, then `gh run watch <id> --exit-status`.
4. Verify live: the Hosting version changed (`npx firebase hosting:channel:list --project ghareebalquran-d9ae5`), the
   pages you changed work, and `words.json` / `challenge.json` hashes are as expected.
5. If the only failure is a network timeout reaching Google, re-run the failed job once. Otherwise stop and report.

### 10.4 Publishing words from Firestore

**Admin saves publish themselves (owner decision D-6, section 4.2).** Saving in `/admin/`, or confirming a delete
there, is the owner's approval to publish it, within the limits in 4.2. An agent never starts a publish, merges a
publish PR or changes these limits without the owner's approval for that step. **Never change Quran text, meanings,
sources, headwords or the word list yourself (section 11).**

**One-time setup (owner, done on 2026-11-06):**
1. Settings > Actions > General > Workflow permissions: tick **"Allow GitHub Actions to create and approve pull
   requests"** and save. Leave the default token permission as it is ("Read repository contents and packages
   permissions"): each job asks for the permissions it needs.
2. Settings > Secrets and variables > Actions > Variables: `PUBLISH_ENABLED` is `true`. **Set it to `false` to stop all
   publishing**, the automatic one included; edits then wait in Firestore.

**What happens after a save:**
1. Within about 15 minutes (GitHub may start scheduled runs late), Publish sees the new rev and builds it.
2. All checks pass, and it's an edit, an addition, a challenge change, or at most 7 words deleted in the admin: it
   commits "Publish: Firestore rev N" to `main` and Release deploys it. Nothing for the owner to do.
3. Otherwise it opens or updates the PR **"Publish: Firestore rev N"** from `publish/next`, with the review report
   (every word added, removed or changed, each changed field before and after). Review it and **merge it** (squash);
   Release deploys it. To drop it, close it. Newer saves update the same PR. An automatic publish of a newer rev closes
   a PR it replaces.
4. **A failed run** e-mails the owner and deploys nothing. Read the failing step:
   - the removal guard or challenge integrity names the counts, days, slugs or surah numbers involved. A delete made
     in the admin removes its challenge references itself; a reference to a missing word now comes only from an import,
     a restore or a challenge edit: fix the day in the Challenge tab. "Day N has no words" means a day was emptied
     outside a delete (an import, a restore or a direct edit): add a word to it in the Challenge tab;
   - **more removals than the ceiling** (8 or more of 73 words today): the run summary gives the exact count. Review
     the removals in the admin's version history, then run Publish by hand (Actions > Publish > Run workflow, on
     `main`) with `allow_removals` set to that count and `removed_surahs` to any removed surah numbers. That opens the
     PR (step 3) and never publishes by itself; a count that does not match exactly fails;
   - a test failure means the data would break the site.

   The same state is not tried again by the schedule. Fix the data in the admin (a new save starts over), or run
   Publish by hand (Actions > Publish > Run workflow, on `main`) to retry after a passing fix to `main` or a flaky test.

**To publish right away:** Actions > Publish > Run workflow, on `main`, with `allow_removals` left empty.

**If Publish or Backup stop running:** GitHub turns off scheduled workflows after 60 days without repository activity.
Keepalive (section 7) enables them again every month; to do it at once, run Actions > Keepalive > Run workflow.

**Rollback:**
- Revert the publish commit (or the publish PR's merge commit) with a new PR. Release deploys the previous files.
  Firestore still holds the edit, so set `PUBLISH_ENABLED` to `false` first, or fix the data in the admin, or the next
  run publishes it again.
- For an immediate fix, roll Hosting back first (runbook 10.8).
- Publish never writes to Firestore, so there is nothing to undo there.

**Locally, against the emulator:** `test/publish-auto-emulator.test.js` (the automatic publish, case by case) and
`test/publish-emulator.test.js` (T-36), both in `npm test`. For a backup export,
`scripts/checks/publish-emulator.mjs --export <folder>` (see `scripts/checks/README.md`).

### 10.5 Firestore rules deploy (owner)

1. Change `firestore.rules` in a PR, with tests. `npm run rules:test` and `npm test` must pass.
2. Run a manual Backup and confirm it succeeded.
3. After the owner approves, merge. Release does **not** deploy rules.
4. The owner deploys from their machine: `npx firebase deploy --only firestore:rules --project ghareebalquran-d9ae5`.
5. Rollback: deploy the previous `firestore.rules` from git the same way.

### 10.6 Service worker version bump

When a release changes files the worker caches, raise `CACHE_NAME` in `public/sw.js` (for example `ghareeb-pwa-v45` to
`v46`), update the version asserted in `test/public-isolation.test.js`, and run `npm test`.

### 10.7 CSP update

After changing any inline `<script>` in any HTML file under `public/`:

```
npm run csp:update
node scripts/csp-update.mjs --check
```

Commit `firebase.json` with the change, and say in the PR which hash changed and why.

### 10.8 Hosting rollback

1. Find the previous version: `npx firebase hosting:channel:list --project ghareebalquran-d9ae5` shows only the
   current one per channel. Use the Firebase console's Hosting release history, or the Hosting REST API
   (`sites/ghareebalquran-d9ae5/releases`), to get the version ID.
2. Clone it to live: `npx firebase hosting:clone ghareebalquran-d9ae5@<VERSION_ID> ghareebalquran-d9ae5:live`.
   **UNVERIFIED:** `firebase help hosting:clone` (CLI 15.33.0) documents only `<site>:<channel>` sources. The
   `<site>@<version>` form is from Firebase's documentation and has not been used in this project. The console's
   "Rollback" button on a release is the alternative.
3. Revert the merge on `main` with a PR, so the next Release doesn't redeploy the broken version.

### 10.9 Restoring a backup

Section 8: rehearse first, then restore as a new version through the admin, with the owner's approval.

## 11. Hard rules for any agent or developer

These are also in `AGENTS.md`.

- Never change Quran text, meanings, tafsir, sources, headwords or the word list.
- Nothing goes to `main` or production (merges, Hosting deploys, rules deploys, Firestore writes, IAM, secrets) without
  the owner's explicit approval for that step. **One standing approval (D-6):** the scheduled Publish workflow commits
  and deploys admin saves by itself, within the limits in section 4.2; saving or confirming a delete in `/admin/` is the
  owner's approval for that publish. It does not cover anything an agent does, such as running Publish (by hand or
  with `allow_removals`), merging a publish PR or changing the limits.
- Use the preview channel only for testing, and never test writes there: it uses the production Firestore.
- No attribution lines (such as `Co-Authored-By` or "Generated with") in commits or PRs.
- Never print or commit secrets, keys or tokens. Secrets live only in GitHub secrets or on the owner's machine. Never
  print document content (Quran text, meanings, notes) to a terminal or log.
- Screenshots: headless Playwright page screenshots only. Never capture real screen or desktop windows.
- Don't stop mid-step during a release step. When blocked, report and wait.
- Never commit or deploy `data/challenge-notes-private.json`, and never put its content in any public file or document.
- Refer to people by role (owner, admin), not by name or e-mail address.

## 12. Decision log

Releases and major changes, newest last. Dates are merge dates on `main`.

| Date | Commit / PR | Change | Why |
|---|---|---|---|
| 2026-10-30 | `3731447` (#1) | Release of the rebuilt site: font, ayah corrections, CSP, headwords, navigation, audit fixes, release pipeline | The rebuild (phases in `PHASE-*-REPORT.md`, `DECISIONS-LOG.md`) |
| 2026-10-31 | `15d8d5a` (#2) | Green share images, per-word share images, adaptive favicon | Brand assets |
| 2026-10-31 | `44da0b7` (#3) | Admin three-way per-field merge on save conflicts, with the picker | Two editors or tabs must not overwrite each other |
| 2026-10-31 | `366a8b5` (#4) | Java 21 set up in Release | The emulator tests need it |
| 2026-11-01 | `ab2ef6c` (#5) | Version history (`snapshots/`, `history/`, restore); Undo removed; readable surah drop-down | Recovery from bad saves (audit SEC-1 / F-3) |
| 2026-11-01 | `6fa8246` (#6) | **Phase 1A:** `public/*` readable by admins only | Unpublished Firestore data must never reach visitors (F-1) |
| 2026-11-01 | `5617e7a` (#7) | Compare words with `WordMerge.canon` | Production Firestore returns map keys in varying order, causing false conflicts |
| 2026-11-01 | `dd9ae83` (#8) | Home-search test waits past the nav's first-450-ms click guard | A flaky CI test; the site behaviour was left as is |
| 2026-11-01 | `be9fa9d` (#9) | **Phase 1B:** Firestore and its SDK removed from the public site; `migrate.js` deleted; worker v45 | Visitors read only the published JSON |
| 2026-11-04 | `33a7c3a` (#10) | Admin v2: accessibility, contrast, small-screen layout, unsaved-changes warning, sign-out handling (SEC-7, SEC-9, SEC-13) | Findings from the admin audit |
| 2026-11-04 | `a1539a8` (#11), `31d2460` (#12) | **Phase 2:** daily encrypted backups with a dedicated read-only service account; export uses the Firestore client | Off-site recovery (F-2); firebase-admin 12 refused the Workload Identity credential file |
| 2026-11-05 | `e94ee39` (#13) | Vendored, hash-pinned Firebase SDK for all checks | Test-time downloads from gstatic timed out on runners |
| 2026-11-05 | `c67dad8` (#14) | `admin-audit` and `rules-real-data` updated to the current admin, rules and data | Both manual checks had gone stale and now pass end to end |
| 2026-11-07 | `77097f1` (#25) | **D-6: automatic publish.** Publish runs every 15 minutes; edits, additions, challenge changes and at most 7 words removed by admin saves are committed to `main` and deployed through Release; larger removals, imports and restores open a PR. A delete in the admin removes its challenge references in the same save; one that would leave a day with no words is blocked, and the build refuses an empty day. A manual run with an exact `allow_removals` always opens a PR and may pass the 10% ceiling. The smoke check takes its word page from `words.json`. Keepalive re-enables Publish and Backup monthly | Owner decision: admin edits and deletions go live without a manual Publish step; saving or confirming a delete in the admin is the approval |
| 2026-11-12 | `618fc31` (#29) | **QCF V2:** every ayah is drawn with the glyphs of its printed Madinah Mushaf page (KFGQPC page fonts V2, pages 582-604, `public/fonts/qcf-v2/`), from the table `public/qcf-v2.json` and `public/qcf.js`; Hafs v22 stays the fallback; stored text unchanged | Owner decision: the ayat look exactly as printed in the Mushaf |
| 2026-11-12 | (owner decision) | **QCF V2 font licence: the owner chose to proceed** with serving the page fonts on the live site and committing them to the public repository. The font files carry no licence text, and the Complex's official download could not be reached to compare them (`public/fonts/qcf-v2/SOURCE.md`) | The owner's decision, 2026-11-12, made with that known |

Decisions not to do something:
- **SEC-2 (import skips the ayah check): not fixed as a security issue.** The owner is the only editor and is
  authorized to edit. The local plan records it as "Reframed: editing is allowed", with what remains folded into
  F-5, F-16 and F-22 (publishing).
- **SEC-15: withdrawn** as incorrect, and replaced by F-1.
- **F-6, F-11, F-12 and remediation Phases 3, 4 and 6: deferred** by the owner (source: the owner's instructions for this
  work; not written in the repo).
- **The nav's 450 ms click guard was not changed** (PR #8). Only the test was fixed.
- **No Cloud Functions:** the project stays on the free plan, and the site is static.

## 13. Known issues and backlog

IDs come from the local audit and plan (`scripts/checks/out/admin-audit/REPORT.md`,
`scripts/checks/out/remediation-plan/PLAN.md`; git-ignored, on the owner's machine).

| ID | Issue | Status |
|---|---|---|
| Phase 5 (F-5, F-16, F-22) | Safe publishing: a manual publish that opens a PR with a report, whole-site validation, a large-removal guard, stale pages removed; the 15-minute schedule removed | Built (PR #18: generator, safeguards, tests T-30 to T-38; PR 2: workflow). Waiting for the owner's setup and first run (runbook 10.4); `PUBLISH_ENABLED=false` |
| — | One admin edit in Firestore is not published (section 4.1). An emulator run from the 2026-11-01 export shows the first publish would be exactly that one meaning: `words.json`, one word page and `rev.json` | Waits for the first Publish run |
| — | Tests asserted 28 surahs and 30 challenge days in several places, so a publish that removed a whole surah would have failed `npm test` | Fixed with D-6: the tests read the counts from `words.json` and `challenge.json` |
| — | A delete could leave a challenge day with no words. Visitors can't mark an empty day done, so the days after it would stay locked | Fixed before D-6 merged: the admin blocks such a delete (the dialog names the days, confirm disabled; the save checks again in its transaction) and the publish build refuses a challenge with an empty day |
| — | Nav click guard: `endT` starts at 0, so every nav click in a page's first 450 ms is dropped (`public/index.html:1003`) | Known, minor, not fixed |
| SEC-5 | The admin loads the Firebase SDK from gstatic with no integrity check (dynamic `import()` can't carry SRI) | Open; plan: self-host under `/admin/vendor/` and drop gstatic from the CSP |
| SEC-6 / F-8 | The admin session never ends (persistent login, no idle timeout) | Open (Phase 6) |
| SEC-8 | The admin shares the public site's CSP | Open; plan: its own CSP for `/admin/**` |
| SEC-10 / F-18 | Rules don't check the sign-in provider | Open (Phase 6) |
| SEC-11 | The owner's address is hard-coded in public files (`firestore.rules`, the admin) | Accepted risk; protect the account with 2FA or a passkey |
| SEC-12 | If the config fails to load, the admin opens in demo mode as the owner (no real access) | Open, low |
| SEC-14 | The report link exposes a mailbox through `mailto:` | Accepted, low |
| F-3 / F-4 | Whole-dataset wipe through the UI; challenge and notes have no history | Words covered by version history; challenge and notes: Phase 4 (deferred) |
| F-6 | Simultaneous saves | Deferred |
| F-11 | Import can report failure though committed | Deferred |
| F-12 | History metadata isn't trustworthy on its own; history flooding is permanent | Deferred |
| F-13 | One human project owner | Open |
| F-15 | App Check not enabled | Open |
| F-21 | HSTS weaker on the custom domain | Open |
| — | `scripts/qa-phase6.mjs`: 1 of 100 checks fails, also on unchanged `main` ("word: word text, highlighted ayah word and ayah number map correctly") | Open; not in CI |
| — | `.github/workflows/README.md` and `ghareeb-handoff/AGENTS.md` are out of date (Cloud Functions, public reads, a `rebuild` branch flow) | Open; this handbook and `AGENTS.md` describe the current setup |
| — | **API key restriction:** restrict the Firebase browser API key in the Google Cloud console. Source: the owner's backlog list | To check |
| — | **Sentry:** review the Sentry setup (loaded on the home page and allowed in the CSP). Source: the owner's backlog list | To check |

## 14. Glossary

| Term | Meaning |
|---|---|
| Owner | The one account named in `isOwner()` in `firestore.rules`; the only one who can change admins |
| Admin | An address in `config/admins`, or the owner |
| `rev` | The version number of `public/data`; up by exactly 1 per save |
| Snapshot | `snapshots/{rev}`: the full words of one version |
| History row | `history/{rev}`: who, when, what kind, and a one-line summary of one version |
| Baseline | A history row of kind `baseline`: the first record of a version that was stored without one |
| Restore | A new version that copies an older one (`kind: "restore"`, `restoredFrom`) |
| Three-way merge | `WordMerge.merge(base, mine, theirs)`: per-field merge on save |
| Conflict picker | The admin window that asks, per field, which version to keep when both changed |
| `canon` | Key-sorted JSON used to compare values whatever order their map keys arrive in |
| Publish | Turning Firestore data into the public JSON and pages (`scripts/publish-build.mjs --publish`, run by `publish.yml`), delivered as a PR the owner merges (runbook 10.4) |
| Release | `release.yml`: tests and deploys `main` to live Hosting |
| Preview channel | The Hosting channel `preview`; uses production Firestore |
| Live channel | The production Hosting channel |
| Demo mode | The admin without a Firebase config: changes stay in the browser |
| `__DATA_SRC__` | Set to `'json'` by the public app: its data came from the published files |
| Segments | Parts of an ayah: `before`, `hl` (the highlighted word), `after`, with `num` |
| Headword | The word being explained, as shown in large type |
| Challenge, day, `releasedUpTo` | The 30-day plan; days open by `startDate` or up to `releasedUpTo` |
| Private notes | The owner's per-day notes in `admin/challengeNotes`; never public |
| `gq-*` | `localStorage` keys of the public site (settings, progress) |
| Seal / upload | The two backup steps: encrypt to the age recipient, then push to the backups repo |
| Recipient / identity | age's public key (in CI) / private key (owner only) |
| WIF | Workload Identity Federation: keyless GitHub-to-Google sign-in |
| Phase 1A / 1B / 2 / 5 | Remediation phases: rules lockdown / public site without Firestore / backups / safe publishing |
| T-xx, F-xx, SEC-xx | Test, finding and security-finding IDs from the local audit and plan |
