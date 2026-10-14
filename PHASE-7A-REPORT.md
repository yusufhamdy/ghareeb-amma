PHASE-7A REPORT (free-plan Firestore->static)

Branch: rebuild
HEAD: 14fcc0a

Generator: scripts/publish-build.mjs (ASCII-only)
- Reproduces committed static site byte-for-byte (76 files: words.json, challenge.json, sitemap.xml, 73 word/*.html). Verified in test/seo.test.js.
- Canonical slugs from functions/seo.js; public challenge via functions/challenge.js sanitizePublicChallenge (strips private notes).
- Order rules: each surah's words sorted by ascending ayah (app idx and others follow that); sitemap uses same order. Description always prefixed "<word>: "; body has prefix stripped when present.
- Change detection: rev.json hash over all outputs; workflow skips deploy if hash unchanged (--current-url https://ghareebalquran.com/rev.json).

Admin (Task 4): public/admin/challenge-logic.js (ASCII-only, UMD) mirrors rouletteSelect + validateDayReferences (parity tested). Admin page loads it and uses validateDayReferences; day modal adds a roulette preview button (client-side). Private notes never read/published by generator.

Workflow: .github/workflows/publish.yml (schedule 15m + dispatch, job gated by vars.PUBLISH_ENABLED='true', WIF auth, generates to build/site, assembles build/hosting and deploys only on change). build/ added to .gitignore.

Protected files SHA-256 (byte-identical this phase):
- public/words.json: C96D158B315A1CA754C8DC0CEBD905A25E6AC57ABEF15FD5557C04B12F243AD9
- public/challenge.json: 5010809535CFB246400DF1F3155E2A1319FEB1E536916247F21B1D51874D514E
- data/redirects.json: BC958D7FB9329C81C85E13F461B00FE0FCB8FE8EE939FE429769469D0546B87F
- data/challenge-notes-private.json: 808A272B24AC5D251849F7FB4E6CD067DA11E3D44A9ED326A05B207F97240836

Files changed/added (explicit filenames):
- scripts/publish-build.mjs (new, ASCII-only)
- public/admin/challenge-logic.js (new, ASCII-only)
- test/seo.test.js (edited, ASCII-only)
- test/challenge-logic-parity.test.js (new, ASCII-only)
- .github/workflows/publish.yml (new, ASCII-only)
- public/admin/index.html (edited, ASCII-only; Arabic runs unchanged)
- .gitignore (edited)
- DECISIONS-LOG.md (append, ASCII-only)
- PHASE-7A-REPORT.md (this file)

Tests: single-file runs only during development; final single runs: node --test (all tests, 1 expected failure: arabic-guard class2Added public/_shade-cards-proposal.html), node scripts/ci/checks.mjs (PASSED). Rules emulator run requires Java 21 (skipped locally).
