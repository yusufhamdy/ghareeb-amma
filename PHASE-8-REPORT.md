# PHASE 8 REPORT — apply `design-spec-final.html`

Branch: `rebuild` · Design source: `design-spec-final.html` (committed) · Date: 2026-10-15

## 1. Design source

- `design-spec-final.html` (5.79 MB) is now the single source of truth for look-and-feel.
- `tools/baseline.mjs` defaults to it (`SPEC=<file>` overrides). Committed for reproducibility.
- Spec id diff vs the previous spec: **0 ids removed, 86 added, tokens effectively unchanged**
  (only new CSS var `--n`). All new frames use the **`def` palette only**.

## 2. Screens added by the final spec (by id)

| id | note |
| --- | --- |
| `roulette` | "draw a word" spinner overlay (transient) |
| `daymulti` | multi-word day progression ("اليوم 6 / من 30", "2 من 3 كلمات") |
| `unauth` | admin "not authorized" gate |
| `fail` | data-load failure state |
| `dlword` | word page reached from a link |
| `admin` | admin panel (list/delete rows, confirm delete) |
| `savecard` | save-as-image sheet |
| `brand` | brand board (2 desktop frames only) |

New components implied: **status list** (`fail`), **save-image sheet** with size choices
(`savecard`), **not-authorized card** (`unauth`), **Arabic word-count phrasing** ("كلمة واحدة"
/ "كلمتان" / "N كلمات"), and a **range slider** for glass intensity in settings (`sheet`).

## 3. What was implemented

| Area | Files | Commit |
| --- | --- | --- |
| Design source + SW cache `v7`→`v8` | `tools/baseline.mjs`, `design-spec-final.html`, `public/sw.js` | `f48d939` |
| Static legal pages `/about /privacy /terms /rights` (verbatim LEG copy, ASCII-only `\u`), sitemap, SEO tests | `functions/legal.js`, `public/{about,privacy,terms,rights}/index.html`, `scripts/publish-build.mjs`, `test/seo.test.js` | `b683f5b` |
| Word-page template matched to `dlword`; 73 pages regenerated | `scripts/publish-build.mjs`, `public/word/*.html` | `95d2b47` |
| App states: data-load failure view, save-image sheet (1080×1350 / 1080×1920), Arabic-correct surah counts, admin not-authorized; styled Arabic 404 | `public/index.html`, `public/admin/index.html`, `public/404.html` | `f8a647a` |
| QA tooling tracks the SW cache name from `sw.js`; parses the new Arabic count phrasing | `scripts/qa-phase6.mjs` | `1360e86` |

Quranic text was **never retyped**; only containers were restyled. `public/word/*.html` were
regenerated from the publisher and the Quranic runs were proven byte-identical
(`contentMissingBefore=0 contentMissingAfter=0`, `records=73`).

`public/_shade-cards-proposal.html` was moved out of the repo to `%USERPROFILE%\ghareeb-backups\`.

## 4. Arabic text added (verbatim)

App/admin/404: `حفظ كصورة` · `اختر المقاس ثم احفظ الصورة على جهازك` · `عادية · 1080×1350` ·
`ستوري · 1080×1920` · `حفظ على جهازي` · `تعذّر تحميل البيانات` ·
`تأكد من اتصالك بالإنترنت ثم أعد المحاولة.` · `قاعدة البيانات` · `النسخة الاحتياطية` ·
`تعذّر الوصول` · `إعادة المحاولة` · `كلمة واحدة` · `كلمتان` · `كلمات` ·
`غير مصرح لك بالدخول` · `هذا الحساب (... ) ليس ضمن المشرفين.` · `افتح في الموقع` · `تسجيل الخروج`.

Static pages: full verbatim legal copy (`functions/legal.js`) plus the site chrome strings.

## 5. Verification (run once)

- `npm test` (`node --test`): **78 tests, 77 pass, 1 fail**.
  The single failure is the `arabic-guard` baseline test (see §7) — expected, see the gate.
- `node scripts/ci/checks.mjs`: **PASSED** (google-fonts 0, redirects 71, sitemap, secrets 480 files, pwa, canonical).
- `node scripts/qa-phase6.mjs`: **PASSED (100)**.
- `node tools/contrast.mjs`: **ALL PASS** across the 20 looks (body ≥4.5, muted ≥3, accent ≥3, button ≥4.5).

## 6. Visual parity (run once)

Baselines regenerated from `design-spec-final.html`: **1106 images, 0 failed** (was 1020; +86 new frames).
`tools/compare.mjs` compared **924** look×viewport×screen combinations:

| < 1% | < 3% | < 5% | < 10% | ≥ 10% |
| --- | --- | --- | --- | --- |
| 75 | 458 | 666 | 802 | 122 |

Average mismatch by screen (mobile unless noted):

| screen | avg | max | reading |
| --- | --- | --- | --- |
| `sheet` | 32.0% | 50.4% | **design drift** — final spec uses a range slider for "شدة الزجاج" + order تلقائي/نهار/ليل; app uses 3 buttons |
| `savecard` (new) | 18.8–30.9% | 53.0% | new sheet; layout needs refinement |
| `surahs` | 19.9–21.6% | 47.5% | wording now matches the spec exactly (see below); remaining delta is row styling/scrolling |
| `ld` | 16.6% | 42.2% | transient loader; screenshot timing artifact |
| `word` | 12.4% | 14.8% | final spec adds "السورة السابقة" / "الكلمة التالية" links the app lacks |
| `fail` (new) | 5.3% | 8.0% | good match |
| `about/privacy/terms/rights`, `nf`, `day` | 1–4% | 6.5% | good match |

Worst 10: `shade-def-day-t-savecard 53.0%`, `shade-def-day-d-savecard 52.7%`,
`glass-neo-night-m-sheet 50.4%`, `glass-sun-night-m-sheet 49.5%`, `glass-def-day-d-savecard 49.2%`,
`glass-lav-night-m-sheet 48.4%`, `glass-min-night-m-sheet 48.2%`, `glass-lav-day-m-sheet 48.0%`,
`glass-def-night-m-sheet 48.0%`, `shade-neo-night-t-surahs 47.5%`.

**Confirmed design intent (validated against the spec, not the app):**
- The app's new surah-count wording matches the spec byte-for-byte:
  "3 كلمات", "8 كلمات", "كلمة واحدة", "كلمتان" (verified from the `surahs` frame).
- `fail` copy matches the spec (`⚠ تعذّر تحميل البيانات` / `تأكد من اتصالك…` / `قاعدة البيانات ✕ تعذّر الوصول` / `النسخة الاحتياطية ✕ تعذّر الوصول` / `إعادة المحاولة`).
- `savecard` copy matches the spec (`حفظ كصورة`, size labels, `حفظ على جهازي`).

**Material mismatches NOT fixed in this pass (flagged for a decision):**
1. Settings sheet `شدة الزجاج` — spec uses `<input type="range" min=1 max=5 step=1 value=3>` with
   `خفيف`/`قوي` end labels (class `gs`); the app uses a 3-button segmented control. Also the spec
   orders `المظهر` as `تلقائي, نهار, ليل`. Porting the slider needs new `.gs` CSS from the spec.
   The settings sheet was **not** in the Phase 8 deliverable list, so it was left for an explicit decision.
2. `savecard` sheet layout — implemented to the spec copy but pixels differ; needs a styling pass.
3. `word` page — spec adds `السورة السابقة` and `الكلمة التالية` controls the app does not have.
4. `ld` — parity artifact from loader timing under `reducedMotion:'reduce'`; not a real design bug.

## 7. Protected content + arabic-guard gate

- Protected SHA-256 (all **unchanged**; 3 tracked files git-clean, the private file present):
  - `public/words.json` `c96d158b315a1ca754c8dc0cebd905a25e6ac57abef15fd5557c04b12f243ad9`
  - `public/challenge.json` `5010809535cfb246400df1f3155e2a1319feb1e536916247f21b1d51874d514e`
  - `data/redirects.json` `bc958d7fb9329c81c85e13f461b00fe0fcb8fe8ee939fe429769469d0546b87f`
  - `data/challenge-notes-private.json` `808a272b24ac5d251849f7fb4e6cd067da11e3d44a9ed326a05b207f97240836`
- `arabic-guard` compares on-disk content to the local baseline fixture and reports:
  - **class1.changed = 73** (`public/word/*.html`) — caused by the requested word-page template change.
    `class1.missing = 0`, `class1.added = 0`; no protected data file changed.
  - **class2.changed** = `public/admin/index.html` (432 runs), `public/index.html` (517 runs).
  - **class2.added** = `public/404.html`, `public/about/index.html`, `public/privacy/index.html`,
    `public/rights/index.html`, `public/terms/index.html`.
  - **class2.missing = []**.
- Because **class1 changed**, the agreed rule (`regenerate only if class1 is unchanged`) means the
  baseline was **not** regenerated automatically — this is the one remaining gate.

## 8. Open gates

1. **arabic-guard baseline**: class1 changed for the 73 regenerated word pages (intended; Quranic runs
   proven identical). Approve regenerating `test/fixtures/arabic-baseline.json` so `npm test` goes green?
2. **Settings-sheet slider** (`شدة الزجاج`) + `المظهر` order: fix now in a follow-up pass, or leave?
3. **`savecard` / `word` layout refinements**: schedule a follow-up pass, or accept current state?
4. `push origin rebuild`? (not done)
5. Preview deploy? (not done)

No push, no deploy, no billing/Cloud Functions changes were made.
