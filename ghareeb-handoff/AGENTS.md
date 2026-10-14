# AGENTS.md: Ghareeb Al-Quran (غريب القرآن)

This file is binding. Read it fully before any work. If anything elsewhere conflicts with it, this file wins. If this file is silent, follow `design/design-spec.html`, then `reference/app`.

## 1. Project and owner
- Site: https://ghareebalquran.com (Firebase Hosting). An OLD site is live there now. Repo: [REPO_URL]. We are rebuilding it.
- Purpose: an Arabic (RTL) site that explains rare Quranic words: meaning, the ayah with the word highlighted, ayah number, and source. Current content: 28 surahs of Juz Amma, 73 words (`data/words.json`). The owner adds more through an admin page.
- Owner: Yusuf (yusufhamdy20@gmail.com). Reply to Yusuf in English only, short and concise. All code, comments, commits, docs and this file stay in English. Never put Arabic comments in code.
- Working style: do the work, do not ask questions already answered here. Ask only at Gates (section 14) or when a login or credential is missing (give the exact command).

## 2. Language rules for the SITE
- Every visible Arabic text is Modern Standard Arabic (الفصحى). No Egyptian dialect anywhere: buttons, toasts, errors, legal pages, meta tags, admin.
- Keep all UI strings in one file (`strings.ar`) for easy review. Strings in `reference/app` are already MSA.
- RTL everywhere. Digits are Western (1 2 3), never Arabic-Indic. No em-dashes in copy.
- All file names, folders, URLs and slugs are English (ASCII, lowercase, hyphens).

## 3. Stack
- Firebase Hosting (static, vanilla JS and CSS, no framework, no build step unless clearly justified).
- Firestore: `public/data` (surahs and words), `public/challenge` (30 day plan), `config/admins`, `admin/challengeNotes` (admin-only). Public read, admin write for `public/*`; see `reference/firebase-admin/firestore.rules` and extend it.
- Cloud Functions v2, region europe-west1: `seo` renders `/word/**`, the legal pages and `/sitemap.xml` from live data.
- Admin at `/admin/` with Google sign-in. Owner email is the default admin; the owner can add admins by email.
- PWA: manifest plus service worker (network-first for app files, data JSON and `challenge.json`; bump the cache version on every release).
- Node 20+. Tests for pure logic (normalization, slugs, release rule) with the built-in `node:test`.

## 4. Source of truth and reference material
1. `design/design-spec.html`: all 17 screens x 20 looks x 3 viewports as real HTML/CSS. Frames have `data-id` = `<style>-<palette>-<mode>-<viewport>-<screen>`.
2. `design/design-tokens.json` and `design/tokens.css`: exact values (colors, spacing, radii, nav motion, breakpoints). `design/tile-patterns/`: Shade tile images and rules.
3. `reference/app/index.html`: a complete working reference implementation (single file) of every screen, both styles, nav, settings, challenge, quiz, share card, legal pages, loader, 404. It reads `words.json` and `challenge.json`; port it to read Firestore (keep JSON as offline fallback). Its CSS is the exact CSS of the spec frames.
4. `reference/firebase-admin`: an older Firebase project (admin page, rules, `seo` function, brand icons). Use as the project base; its front-end is OLD and gets replaced by `reference/app`.
5. `data/`: `words.json`, `challenge.json` (30 days mapped to words), `redirects.json` (old Arabic URLs to new slugs), `challenge-notes-private.json` (PRIVATE, see section 10), original plan `.docx`.
6. `tools/`: Playwright baseline and compare scripts (section 13).

## 5. Styles, palettes, modes
- Two styles, chosen by the visitor in Settings: **Glass** (default) and **Shade**. Nothing else.
- Modes: Day, Night, Auto (follows the device; default Auto).
- Five palettes for BOTH styles: Default (الافتراضي), Lavender (لافندر), Sunset (غروب), Neon (نيون), Mint (نعناع). Palette x mode x style = 20 looks. Exact colors: `design/design-tokens.json`.
- Settings sheet rows: Style (زجاج | ظلال), Mode (نهار | ليل | تلقائي), Glow palette (both styles), Glass intensity (Glass ONLY: light 8px, medium 22px, strong 36px blur; default medium), Stop motion toggle, Sound toggle. Saved in `localStorage` key `gq-set`.
- Glass: soft glass only on floating elements (header gear button, search bar, floating nav) and light glass cards; two slow-drifting blurred blobs behind. No grain, no big geometric shapes behind cards.
- Shade: no blur, no glass. Flat surfaces, one color per palette, tiles fading from the palette color into the surface; headings in Amiri Quran 400; small labels and numerals in IBM Plex Mono. Surah tiles, challenge day tiles and the word card follow `design/design-spec.html` exactly. Tile image rules: `design/tile-patterns/README.md`.
- Every gradient must finish fading BEFORE any text begins. Never let text cross a gradient seam. Gradient backgrounds on bordered elements must use `no-repeat` and `border-box` (a past bug showed the gradient repeating under a translucent border).
- Contrast: WCAG AA (4.5:1 body text, 3:1 large) in all 20 looks. If a color fails, adjust slightly and log it in `DECISIONS-LOG.md`.

## 6. Responsive layout (exact)
- Breakpoints: mobile up to 600px, tablet 601 to 1024px, desktop 1025px and up. Spec viewports: 400, 820, 1440.
- Content max width: tablet 760px, desktop 1080px. Page gap 18px. Touch targets at least 44px.
- Tablet: challenge grid 10 columns, quiz options 2x2, surah and result lists 2 columns, word page 2 columns (from 800px).
- Desktop: lists 3 columns (Shade surah tiles 4), search and social strip centered at max 720px, settings sheet becomes a centered modal 480px wide.
- Floating navigation capsule: 4 tabs with icon and label: بحث، السور، التحدي، اختبر نفسك. Position: bottom center on mobile and tablet, top center (18px) on desktop. Height 64px, width min(440px, 100% - 40px).
- Nav motion (exact values in tokens): solid indicator slides under the active tab (transform, 450ms, cubic-bezier(.34,1.4,.64,1)); active icon gets stroke 2.3, light fill and a 400ms pop; press scales to .9; red dot on the challenge tab when a newly released day was not yet seen; hides on scroll down after 140px and returns on scroll up; vibrate(8) where supported (not iOS). Page transitions: tab changes fade 250ms; detail pages (word, surah, day) slide in from the left 18px over 300ms. Respect `prefers-reduced-motion` and `prefers-reduced-transparency`.

## 7. Pages and behavior
- Home: search (live, diacritics-insensitive, matches word and meaning, ranked: exact, prefix, contains, meaning), "اسحب كلمة" random draw (never the same word twice in a row), "تصفح بالسورة" link, social strip, challenge ring card. NO root (جذر) search anywhere.
- Social strip (home only, under search and actions, NOT dismissible, no close mark): three small icons (Instagram https://instagram.com/yusuf.hamdy, TikTok https://www.tiktok.com/@yusuf.hamdy, YouTube https://youtube.com/@yusuf_hamdy; no tracking parameters) and the line "لمشاهدة شروح الكلمات في مقاطع قصيرة، تابعنا". No social icons in the footer.
- Surahs: only surahs that exist in the data, mushaf order, each with the number of words we have (not total ayah count). Surah page lists its words.
- Word page: word, meaning, ayah with highlighted word and number, source, "اسحب كلمة أخرى", "كلمات أخرى من نفس السورة" (only if the surah has more words), a reel button "شاهد شرح الكلمة في مقطع قصير" only when the word has a `reel` link, share card download, and "أبلغ عن خطأ في هذه الكلمة" (mailto to yusufhamdy20@gmail.com with the word in the subject).
- Share card: canvas 2160x3840 PNG, palette colors, word, meaning, ayah, site name; uses the word's tile pattern in Shade. `navigator.share` with a file where supported, otherwise download.
- Quiz: 10 random questions; ayah with highlighted word; 4 meaning options (never equal to the correct one); options in a column with 12px gaps (2x2 grid from 601px); correct and wrong states; light haptic on correct; result screen with a score ring.
- Loading screen: first visit only (`localStorage` `gq-ld`), logo plus a moving line, fades out when data is ready.
- 404: custom page with "404", message, home button and random-word button; unknown `/word/*` URLs return status 404 with this page.
- Footer (every page): text only. Legal links: عن الموقع، سياسة الخصوصية، شروط الاستخدام، الحقوق والمصادر, and `© <current year> غريب القرآن` (year computed automatically in client and in the `seo` function). Legal pages are real static URLs (`/about`, `/privacy`, `/terms`, `/rights`) with the draft texts from `reference/app` (Yusuf reviews them before launch).
- Word cards: no cramped text. Spacing inside the word card: 12px between word and label, 8px between label and meaning, meaning line-height 1.9.

## 8. Challenge (30 days)
- Day page heading: "اليوم N" with a small "من 30". Opening a day plays a short roulette (about 1.4s, ticks, final chime) then shows that day's words (skipped with reduced motion or when toggling done). Button "تم إنجاز اليوم" toggles done; per-day reel button hidden when `reel` is empty.
- Grid circles ALWAYS show the day number. States: done = filled/tile plus small check badge and still openable; available = plain; today = accent ring with glow; locked = dimmed with lock badge, not openable (toast "اليوم N يفتح بعد X ساعة"). Legend under the grid: مكتمل، متاح، اليوم، مقفول.
- Release is GLOBAL (same day for everyone). `public/challenge.startDate` ("YYYY-MM-DD", Africa/Cairo, day 1 opens 00:00 Cairo) and optional `releasedUpTo`. `released = releasedUpTo ?? daysSince(startDate)+1`, clamped 0..30. Before the start every day is locked and the screen shows the start date. Past days are always open. Admin edits both fields.
- Progress (done days) in `localStorage` `gq-prog` per device; last seen released day in `gq-seen`. No visitor accounts.

## 9. Data model
- `public/data`: `{ surahs: [ { surah: "سورة الناس", no: 114, words: [..], meanings: [..], ayahs: [ { label: "4", segments: [ { num, before, hl, after } ] } ], source: "..." } ] }` (arrays parallel by index). Store a stable English `slug` per word.
- `public/challenge`: `{ startDate: null|"YYYY-MM-DD", releasedUpTo: null|number, days: [ { d: 1, w: [[surahNo, normalizedWord], ...], reel: "" } ] }`. Words are matched by surah number plus normalized word.
- One shared Arabic normalization function (client, `seo` function, admin; unit-tested): strip diacritics and Quranic marks, unify alef forms, ى to ي, ة to ه, ؤ to و, ئ to ي, collapse spaces.
- Meanings in the data may start with the word and a colon; strip that prefix when displaying (see `reference/app`).

## 10. Private notes (important)
Each challenge day has a private reflection line ("التدبر") written by Yusuf for himself. It must NEVER appear on the public site, in `challenge.json`, in `public/challenge`, in client code, pages, SEO output, search, or share cards. Store it only in the admin-only Firestore doc `admin/challengeNotes` (rules: read and write for admins only) and show it only in the admin Challenge tab as a private note per day. Seed it from `data/challenge-notes-private.json`; that file is never deployed to Hosting. Final check: grep the built site and public Firestore docs for any text from that file.

## 11. SEO and URLs
- Word pages: `/word/<surah-slug>-<ayah>.html` (add `-2`, `-3` if the same ayah has more words), for example `/word/an-nas-4.html`. Surah slugs are in `reference/app` (`SE` list in the build) and `data/redirects.json` shows the scheme.
- Old Arabic URLs 301 to the new ones using `data/redirects.json` (71 entries). One old word was deleted for good: it is not in the data, the sitemap or the redirects, and gets the custom 404.
- `/sitemap.xml`: home, all word pages, legal pages. `robots.txt` as in `data` (keep the sitemap line). Each word page: title, description, canonical, Open Graph, the highlighted ayah, link back to the app (`/#/word/<id>`), links to other words of the same surah.

## 12. Fonts, performance, accessibility
- Self-host ALL fonts (no Google Fonts requests): KFGQPC Uthmanic Hafs for Quranic text, words, surah names and logo (WOFF2 from the official King Fahd Complex source, keep its license in the repo; fallback Amiri Quran); IBM Plex Sans Arabic; IBM Plex Mono (Shade). `font-display: swap`. Visually check all 73 words for broken marks.
- Gradients and tile images only; no animated canvas or WebGL. Tile images are lazy WebP (60 files, about 90 KB total).
- Semantic HTML, focus-visible outlines, labels on icon buttons, keyboard operable, `lang="ar" dir="rtl"`, `prefers-reduced-motion` and `prefers-reduced-transparency` honored. Lighthouse accessibility 90 or higher.

## 13. Pixel parity process
Start matching the spec while implementing each shared component and screen; Phase 5 is a consolidated verification/fix pass, not the first time visual matching happens.
Goal: the built site matches the spec frames in layout, spacing, size and color for all 20 looks, 17 screens and 3 viewports. Use `tools/` (see `tools/README.md`): generate `design/baseline` PNGs, run `compare`, fix the worst diffs first, repeat. Quranic glyph shapes may differ (font); everything else must match. Log accepted differences in `DECISIONS-LOG.md`.

## 14. Workflow, access and Gates
- Work on branch `rebuild`. Before modifying anything, verify the current repository, remote URL, Firebase project ID, hosting configuration, and current production state. Do not assume the current working directory or project ID.
- Preserve the old site: create a recoverable Git tag `old-site-backup` where possible and archive the old `public/` before replacing it. Never delete the only copy of existing files or reviewed content.
- The owner explicitly authorized broad access for this rebuild, including file creation/editing/deletion, Git and GitHub operations, live Firestore data, Firestore rules, Cloud Functions, Firebase Hosting, and the production domain. Keep all work phase-gated: no production data/rules/functions/hosting/domain changes before Phase 7. Phase 7 is authorized when the owner sends its prompt.
- Before any Phase 7 production migration, export live Firestore data and verify the backup exists. Review the target project ID and the planned data/rules/functions changes in the phase report before applying them. Preserve existing production data unless the migration has been mapped and backed up.
- Never print, log, or commit tokens, credentials, private keys, `.env` files, or Firebase secrets. Keep local secrets in `.gitignore`.
- `data/challenge-notes-private.json` contains private owner-only reflections. Do not commit it to GitHub, copy it into tracked `handoff/`, include it in Hosting/build output, or place its contents in public Firestore documents. Keep a local-only copy, add the filename/path to `.gitignore`, and seed only the admin-only `admin/challengeNotes` document in the authorized migration phase. Confirm no private text appears in public artifacts.
- One phase prompt at a time: do ONLY that phase, write `PHASE-N-REPORT.md` (changes, commands, checks, open issues, production impact), commit the phase work on `rebuild`, summarize in 3 concise lines in English, and STOP. Do not start the next phase without the owner sending its prompt.
- For ordinary ambiguity, follow this file, then `design/design-spec.html` and `design/design-tokens.json`, then `reference/app`; log the decision in `DECISIONS-LOG.md` and continue. Stop only the specific operation if it risks loss of reviewed religious content, exposes private data/secrets, or cannot safely identify the target production project.
- Testing policy: perform only targeted checks needed while implementing. Match the spec from the first implementation of each component/screen. Perform one consolidated visual comparison at Phase 5 and one consolidated functional/accessibility/security QA pass at Phase 6; after fixes, rerun only affected checks. Do not rerun the complete suite at every phase.
- Phase 6 may deploy a Hosting preview channel only. Phase 7 performs the authorized production rollout, including required rules/functions/data migrations, Hosting deployment, domain verification, and merge to `main` after verifying the backup and live export.

## 15. QA checklist
Search works with and without diacritics; random draw never repeats the same word consecutively; surah list shows only data surahs with correct counts; word highlight and ayah number correct; all 30 challenge days show their words; locked, today, available and done states and the release rule behave correctly with different dates; progress persists after reload; private notes are not public; quiz distractors never equal the correct meaning; share card is 2160x3840; admin blocks non-admins (rules tested in the emulator); `/word/*`, `/sitemap.xml`, redirects and 404 work; offline fallback works; PWA installs; all 20 looks pass contrast; no layout break at 320, 400, 768, 820, 1024, 1280, 1440; keyboard navigation; reduced motion respected; pixel-parity report reviewed.
