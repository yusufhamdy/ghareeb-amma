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

- DONE: 8 (10, 22, 23, 24, 26, 27 + …). Full set: **10, 22, 23, 24, 26, 27** = 6 items.
- PARTIAL: **1, 5, 14, 19, 25** = 5 items.
- NOT DONE: **2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 15, 16, 17, 18, 20, 21** = 16 items.

In-scope for this phase (from the brief): STEP 3 → item 11 (+ item 5 order);
STEP 4 → items 6, 7, 8, 9, 14; STEP 5 → item 10 (finish to spec). All other
NOT DONE/PARTIAL items are reported but **out of Phase A scope** unless you say
otherwise.

---

## STEP 2 — arabic-guard classification

_(pending — see rule: if every changed run is a UI string, regenerate the
baseline; if any run touches verse/meaning/word/surah-name/data text, STOP and
show it.)_

## STEP 3 — glass intensity slider

_(pending)_

## STEP 4 — word page navigation

_(pending)_

## STEP 5 — save as image

_(pending)_

## STEP 6 — verification

_(pending)_

## STEP 7 — publish

_(pending — push `origin rebuild` + preview only, if STEP 6 is fully green.)_
