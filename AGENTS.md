# AGENTS.md: Ghareeb Al-Quran

Start here. The full guide is [`docs/PROJECT-HANDBOOK.md`](docs/PROJECT-HANDBOOK.md): architecture, data model, admin,
rules, CI/CD, backups, tests, runbooks and the decision log. Read the sections you need before changing anything.

`ghareeb-handoff/AGENTS.md` is the original rebuild brief from October 2026. Its content and design rules still
describe the site's intent, but its notes on the stack and workflow are out of date. Where they differ, this file and
the handbook describe what is deployed now.

## The project in five lines

- An Arabic (RTL) static site at https://ghareebalquran.com explaining rare Quranic words. Firebase project
  `ghareebalquran-d9ae5`, free plan, no Cloud Functions.
- Visitors read only the published `public/words.json` and `public/challenge.json`. No public page loads Firebase.
- One owner, and any admins the owner adds, edit in `/admin/`, which writes to Firestore with version history.
- Firestore rules allow admins only (`firestore.rules`). Release (`.github/workflows/release.yml`) deploys Hosting
  only when `main` changes.
- Daily encrypted backups go to a private repository (`.github/workflows/backup.yml`, `BACKUP-RESTORE.md`).

## Hard rules

1. Never change Quran text, meanings, tafsir, sources, headwords or the word list.
2. Nothing goes to `main` or production without the owner's explicit approval for that step. That covers merges,
   Hosting deploys, rules deploys, Firestore writes, IAM changes, and secrets or variables.
3. Use the preview channel only for testing, and never test writes there: it uses the **production** Firestore.
4. No attribution lines (such as `Co-Authored-By` or "Generated with") in commits or PRs.
5. Never print or commit secrets, keys or tokens. Secrets live only in GitHub secrets or on the owner's machine.
   Name them, never show their values.
6. Never print document content (Quran text, meanings, private notes) to a terminal, log or report.
7. Never commit or deploy `data/challenge-notes-private.json`. Its content must never reach any public file or
   document.
8. Screenshots: headless Playwright page screenshots only. Never capture real screen or desktop windows.
9. Don't stop mid-step during a release step. When blocked, report and wait.
10. Refer to people by role (owner, admin), not by name or e-mail address.

## Before you open a PR

```
npm ci
npx playwright install chromium
npm test                          # about 11 minutes; needs Java 21 for the emulator suites
npm run rules:test
node scripts/csp-update.mjs --check
node scripts/ci/checks.mjs
```

- If you changed any inline `<script>` under `public/`, run `npm run csp:update` and commit `firebase.json`.
- If you changed files the service worker caches, bump `CACHE_NAME` in `public/sw.js` and the version asserted in
  `test/public-isolation.test.js`.
- CI (`.github/workflows/ci.yml`) runs on every PR. Only the owner approves a merge to `main`.

## Where things are

| Need | Look at |
|---|---|
| How data flows, the service worker, the CSP | Handbook section 3 |
| Firestore documents and fields | Handbook section 4 |
| Admin save, conflicts, history | Handbook section 5, `public/admin/` |
| Rules in plain words | Handbook section 6 |
| Workflows, Workload Identity, service accounts | Handbook section 7 |
| Backups and disaster recovery | Handbook section 8, `BACKUP-RESTORE.md` |
| Tests and manual checks | Handbook section 9, `scripts/checks/README.md` |
| Step-by-step commands | Handbook section 10 |
| Open issues | Handbook section 13 |
