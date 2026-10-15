# PHASE A — status audit + Phase 8 gate closure

Branch: `rebuild` · Repo: `ghareeb-amma` · Report is the single living document for Phase A.

Method: read-only inspection of `public/index.html`, `public/admin/index.html`,
`tools/contrast.mjs`, `scripts/publish-build.mjs`. Evidence is quoted as
`file:line`; Arabic UI strings are quoted verbatim. Line numbers refer to the
state at the start of Phase A (commit `febe9f4`).

---

## STEP 0 — spec version

`design-spec-final.html` contains all four markers — the file is current:

| marker | line |
| --- | --- |
| `/* ===== v2 additions ===== */` | 135 |
| `/* ===== v3 fixes ===== */` | 188 |
| `/* ===== v4 fixes ===== */` | 219 |
| `/* ===== v5 fixes ===== */` | 263 |

Result: **OK — v5 present, proceed.**

---

## STEP 1 — status table

Legend: **DONE** = meets the spec acceptance as stated · **PARTIAL** = behaviour
exists but deviates from the spec · **NOT DONE** = absent.

| # | Item | Status | File:line | Evidence |
| --- | --- | --- | --- | --- |
| 1 | draw-a-word roulette (with sounds) | PARTIAL | `public/index.html:181` | `spin()` on the day screen cycles random words with `tick(520+…)` sounds then reveals `#dw`; the home `اسحب كلمة` button (`rnd()`, :155) navigates immediately — no roulette on the draw button. |
| 2 | sequential opening of challenge cards for multi-word days (`daymulti`) | NOT DONE | `public/index.html:179` | `dayView` renders `ws.map(wrow)` inside one `.list`; every word card is shown at once, no sequential reveal. Spec frame `…-daymulti`. |
| 3 | correct/wrong sounds per theme + check/cross icons | NOT DONE | `public/index.html:209`, `:76` | correct `tick(880,.12)` / wrong `tick(240,.15)` are identical for glass and shade; `.opt.ok`/`.opt.bad` carry no ✓/✗ glyph. |
| 4 | floating settings gear that follows scroll | NOT DONE | `public/index.html:140`, `:31` | gear is a header button (`.ib`, static); no `position:fixed`/sticky gear. |
| 5 | theme `auto` first (rightmost in RTL) and default | PARTIAL | `public/index.html:128`, `:157` | default `mode:'auto'` ✔; sheet order is `نهار, ليل, تلقائي`, so `تلقائي` is last/leftmost ✘. |
| 6 | prev/next word arrows + prev/next surah arrows | NOT DONE | `public/index.html:147` | the word view has no previous/next controls. |
| 7 | word card split (word+verse one card, meaning other, meaning enlarged) | NOT DONE | `public/index.html:147` | card 1 = word + `المعنى` + meaning at fixed `font-size:19px`; card 2 = `الآية` + verse + source. Spec puts word+verse together and the meaning in the other card, enlarged. |
| 8 | surah+verse pill, a link to the surah | NOT DONE | `public/index.html:147` | rendered as a plain `<div class="m">… · آية …</div>`, not a pill link. |
| 9 | order of the three buttons (other words / draw a word / save as image) | NOT DONE | `public/index.html:147`, `:203` | order is draw → save → other-words; spec order is other-words → draw → save. |
| 10 | save as image in two sizes | DONE | `public/index.html:185`–`:202` | `saveSheet` + `card()` render `عادية · 1080×1350` and `ستوري · 1080×1920`. App defaults to regular; spec default is story (STEP 5). |
| 11 | glass intensity slider with 5 levels | NOT DONE | `public/index.html:157`, `:129` | 3-button seg `خفيف/متوسط/قوي` (`gl` 0–2) writing `--bl` = 8/22/36 px; spec wants `<input type=range min=1 max=5>`, end labels `خفيف`/`قوي`, aria-label `شدة الزجاج`. |
| 12 | hover and press animations per theme | NOT DONE | `public/index.html:82` | only `:active` exists (nav tab `transform:scale(.9)`); no `:hover` rule anywhere in the file, no per-theme hover/press set. |
| 13 | social icons hover effect | NOT DONE | `public/index.html:86`, `:226` | `.so` links (Instagram/TikTok/YouTube) have no hover rule. |
| 14 | button icons with correct RTL direction (forward arrow at end pointing left; skip/exit/open mirrored) | PARTIAL | `public/index.html:139`, `:145` | the forward chevron `ICO.c` (`M15 5l-7 7 7 7`) points **left** and sits at the row **end** ✔; there are no skip/exit/open icon variants in the app to mirror. |
| 15 | verse highlight = bounded background box, no underline | NOT DONE | `public/index.html:49` | `mark{background:none;color:var(--ac);border-bottom:2px solid var(--ac)}` — underline, not a bounded box. |
| 16 | each search result / surah word row is its own card; search = one centered column on desktop | NOT DONE | `:146`, `:152`; `:40`–`:42`; `:89`–`:90` | rows live inside a single `.list` card with `.row+.row{border-top}`; `.rs` is `1fr 1fr` (≥601px) and `1fr 1fr 1fr` (≥1025px), not one column. |
| 17 | shade: surah picker cards as rectangles, light gradient, very light hover shadow | NOT DONE | `public/index.html:103`–`:104` | tiles are `aspect-ratio:1/1.05` with `background:var(--sf) var(--p0) center/cover` (image); no gradient, no hover shadow. |
| 18 | shade: 44px challenge day tiles, even 12px gaps | NOT DONE | `:71`, `:109`, `:178` | base tile `.dy{width:46px;height:46px}`; shade overrides to `width:100%!important`; grid is `repeat(6,1fr);gap:14px 0` (no column gap). |
| 19 | correct-answer option keeps filled background + readable text in all palettes | PARTIAL | `public/index.html:76`, `:112` | glass `.opt.ok` = `--btf` on `--ac`, covered by `tools/contrast.mjs` (≥4.5 across all 20 looks) ✔; shade `.opt.ok` = gradient `--tc`→`--sf` with `--tx` text is **not** covered by the tool ✘. |
| 20 | favicon | NOT DONE | `public/index.html:3`–`:10` | head has `<link rel="manifest">` but no `<link rel="icon">` / `apple-touch-icon`. |
| 21 | share image (og:image + meta tags) | NOT DONE | `public/index.html:3`–`:10` | no `og:`/`twitter:` tags in the SPA head. |
| 22 | unauthorized screen | DONE | `public/admin/index.html:123` | `if(!ADM)` renders `غير مصرح لك بالدخول`. |
| 23 | data-load failure screen | DONE | `public/index.html:230`, `:248` | `failView()` (`تعذّر تحميل البيانات`) rendered by the load `.catch()`. |
| 24 | 404 | DONE | `public/index.html:229`, `:150`; `public/404.html` | `nf404()` + `nf()` + the static `404.html`. |
| 25 | admin redesign (all tabs, login, delete confirm) | PARTIAL | `public/admin/index.html:124`, `:241`, `:253/:256/:262` | tabs = `السور / الكلمات / التحدي / المشرفون / أدوات` ✔; Google login ✔; deletes use the browser-native `confirm()`, not a redesigned confirm dialog. |
| 26 | surah page opened from a direct link | DONE | `public/index.html:146`, `:160` | `#/surah/<num>` handled by the router and `hashchange`. |
| 27 | search bar keeps its size when results appear | DONE | `public/index.html:35`, `:152` | `.sb` is a fixed `height:54px`; results render into `#res` below it. |

### STEP 1 tally

- DONE (6): **10, 22, 23, 24, 26, 27**
- PARTIAL (5): **1, 5, 14, 19, 25**
- NOT DONE (16): **2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 15, 16, 17, 18, 20, 21**

In-scope for this phase (from the brief): STEP 3 → item 11 (+ item 5 order);
STEP 4 → items 6, 7, 8, 9, 14; STEP 5 → item 10 (finish to spec). All other
NOT DONE/PARTIAL items are reported but **out of Phase A scope** unless you say
otherwise.

---

## STEP 2 — arabic-guard classification → regenerate

**Artifact:** `reference/arabic-guard-class2-diff.md` (untracked) holds the full
before → after list for every changed run.

**Method.** The test's positional `diffRuns` compares run *i* to run *i*, so a
single insertion cascades and inflates the counts (hence "432"/"517"). I
recomputed an **LCS-based** diff (insert/delete/edit) so unchanged runs — most
importantly the 28-surah name list at `public/index.html:134` — are *not*
flagged. True change set:

| file | baseline runs | actual runs | hunks | removed | added |
| --- | --- | --- | --- | --- | --- |
| `public/index.html` | 569 | 600 | 6 | 11 | 42 |
| `public/admin/index.html` | 522 | 529 | 3 | 2 | 9 |

**Classification — every changed run is a UI string.**

`public/index.html`
1. word-count phrasing: `… كلمة` (surahs list `:145`, surah header `:146`) replaced by `wc()` → `كلمة واحدة` / `كلمتان` / `كلمات` / `كلمة` (`:154`).
2. save-as-image sheet (`:185`): `حفظ كصورة`, `إلغاء`, `اختر المقاس ثم احفظ الصورة على جهازك`, `عادية`, `ستوري`, `حفظ على جهازي`.
3. word-page action: `تنزيل بطاقة الآية` → `حفظ كصورة` (`:199` → `:203`).
4. data-load failure view (`:230`): `تعذّر تحميل البيانات`, `تأكد من اتصالك بالإنترنت ثم أعد المحاولة`, `قاعدة البيانات`, `النسخة الاحتياطية`, `تعذّر الوصول`, `إعادة المحاولة`, `الرئيسية`.
5. removed old catch text `تعذر تحميل الكلمات. جرّب تحديث الصفحة.` (`:240`).

`public/admin/index.html`
1. unauthorized message `الحساب … غير مصرح له بالدخول.` → `… هذا الحساب ليس ضمن المشرفين. افتح في الموقع.` (`:121` → `:123`).

**Added class2 files** (all UI/legal, no data): `public/404.html`,
`public/about/index.html`, `public/privacy/index.html`, `public/rights/index.html`,
`public/terms/index.html`.

**False positives.** Six runs were auto-flagged `DATA?` — `في`, `ثم`, `على`,
`من`, `م`+`ن`, `على` — they are single common words that also occur inside
meanings. None is a verse, a full meaning, a diacritic Quranic word, or a surah
name. Same for the added-file flags (`لا`, `ولا`, `أو`, `إلى`, `هذه`, `أن`, `كل`,
`عند`, `إذا`, `دون`, `جميع`, `فيما`, `الله`, `التفسير`, `الميسر`, `وكتب`, `المصدر`).

**class1 (whole-file) result:** the four protected data hashes are UNCHANGED
(`public/words.json` `c96d158b…`, `public/challenge.json` `50108095…`,
`data/redirects.json` `bc958d7f…`, `data/challenge-notes-private.json`
`808a272b…`). The 73 `public/word/*.html` hashes refresh, which is the
already-proven markup-only change.

**Action taken:** regenerated `test/fixtures/arabic-baseline.json`
(class1 = 82 files, class2 = 146 files) and committed it. `npm test` → **78/78
pass**.

> Note: `reference/` is a class2 scan root, so this new report file is itself
> captured by the baseline. The committed fixture already references other
> untracked local files (`reference/firebase-admin/*`, `ghareeb-handoff/*`), and
> the guard self-skips in a partial checkout, so this is consistent with the
> existing design.

## STEP 3 — glass-intensity slider → DONE

**Files**
- `tools/glass-levels.js` (new) — single source of truth for the 5 levels.
- `public/index.html` — `saturate(var(--sat,160%))`; `.gs` range styles; `GLLV` table + `rgba()`; `applySet` now writes `--bl/--sat/--gb/--gbr` from the level; settings-sheet slider replacing the 3-button seg; theme order `تلقائي/نهار/ليل`; an `input` listener; legacy-value migration via a `gv` flag.
- `public/sw.js` — cache `ghareeb-pwa-v8` → `v9`.
- `tools/contrast.mjs` — added a composited-surface audit at levels 1 & 5.
- `test/glass-slider.test.js` (new) — unit migration test + Chromium DOM test.
- `test/fixtures/arabic-baseline.json` — regenerated (new runs are UI only).

**Levels** — `blur px | saturate % | fill α day/night | rim α day/night`

| lvl | blur | sat | fill | rim |
| --- | --- | --- | --- | --- |
| 1 (خفيف) | 4px | 140% | .88 / .26 | .55 / .10 |
| 2 | 12px | 160% | .80 / .22 | .63 / .13 |
| 3 (default) | 22px | 180% | .72 / .18 | .71 / .16 |
| 4 | 34px | 200% | .64 / .15 | .79 / .19 |
| 5 (قوي) | 48px | 220% | .56 / .12 | .87 / .22 |

**Behaviour** — applies instantly (`setProperty` on `<html>`, no reload); persists in the existing `gq-set` key (now with `gv:2`); restores on load; legacy `0/1/2` map to `1/3/5`. Default level 3 preserves the old "medium" blur (22px). `prefers-reduced-transparency` still falls back to solid (unchanged `.g` rule). The control is rendered only for the glass style.

**Acceptance**
- `node --test test/glass-slider.test.js` → **2/2 pass**: the live page writes `--bl` = 4/12/22/34/48 px, `--sat` = 140–220 %, and the exact fill/rim alphas; the five blurs are distinct; the slider is `input[type=range] min=1 max=5 step=1` with `aria-label="شدة الزجاج"`; level 5 survives a reload; the control disappears for shade.
- `node tools/contrast.mjs` → **ALL PASS**, now including the surface audit (level 1 & 5 for glass, both levels for shade). Lowest readings: body 7.15 (glass-min-night L1), muted 3.60.
- arabic-guard → class1 (protected content) clean; `index.html` class2 change = mode reorder + `متوسط` → `شدة` `الزجاج` (UI only).

> The glass fill is always white composited over `--bg`; over the dark background it still reads dark, which is what keeps `--tx` AA at every level. Decorative `#bg` blobs are excluded from the contrast surface (pointer-events:none corner decoration).

## STEP 4 — word page navigation

_(pending)_

## STEP 5 — save as image

_(pending)_

## STEP 6 — verification

_(pending)_

## STEP 7 — publish

_(pending — push `origin rebuild` + preview only, if STEP 6 is fully green.)_
