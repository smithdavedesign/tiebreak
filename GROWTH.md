# Growth log

## 2026-10-13: funnel beacon

**Mission:** replace the visit beacon with the funnel beacon, so the funnel shows where visitors drop off.

**Core action:** creating a poll (the form on `/` getting a `201` from `POST /polls`). That's the first thing the primary payer (a seller or creator choosing between options) does; voting in the feed is the secondary, free-user action and isn't counted as activation.

**What changed**
- `lib/beacon.ts` (new): `shouldSend` is the pure send-or-not decision (production only, not `navigator.webdriver`, not opted out), `referrerFor` returns `document.referrer` only when its origin differs from `location.origin`, and `sendSignal(kind)` POSTs `{"slug": "tiebreak", "kind": …, "referrer": …}` to `https://repohq.vercel.app/api/ideas/signal` (fire-and-forget, `keepalive`, `credentials: 'omit'`, no cookies).
- `visit`: once per browser session (sessionStorage), on every page. `VisitBeacon` moved from the home page into the root layout.
- `activate`: the first successful poll creation per browser (localStorage), in `app/create-poll-form.tsx`.
- `checkout`: every click on the Pro Buy button (`app/pro/upgrade-button.tsx`), before Checkout opens. If the Buy button moves, so must this call.
- Nothing is sent on preview deployments (`NEXT_PUBLIC_VERCEL_ENV` isn't `production`, which includes local dev), when `navigator.webdriver` is true, or when localStorage `repohq:notrack` is set. If storage is blocked, nothing is sent rather than repeating a once-only event.
- The privacy page now names the three events, the opt-out and the two local flags. It still says no cookies and no third-party analytics.
- The old event kind was `view`; it's now `visit`. Prices, payment links and keys are untouched.
- Tests: `tests/beacon.test.ts` (decision table, referrer rule, once-per-session/browser, no-send cases, payload, privacy copy).

**Needs checking on RepoHQ's side:** the signal endpoint must accept kinds `visit`, `activate` and `checkout`. This repo can't verify that. `NEXT_PUBLIC_VERCEL_ENV` needs Vercel's "Automatically expose System Environment Variables" on (the default); if it's off, nothing is sent.

**Metric:** the old beacon is the baseline (home-page views only; 6 visitors, 0 activations, 0 Buy clicks all time). Success is the funnel beacon live in production within 7 days of the merge: RepoHQ's Ideas page shows `visit`, `activate` and `checkout` counts for tiebreak. After that, read the visit → activate → checkout drop-off there, weekly. Distribution comes first until there are ~50 visitors a week, so no conversion changes follow from this.

## 2026-10-14: search pages

**Mission:** add two or three public pages that answer what the buyer searches before they would find tiebreak.

**Hypothesis:** pages that answer what the buyer searches bring visitors from search.

**Target searches** (from REVENUE.md's buyer, RESEARCH.md's competitors and Etsy threads, and a WebSearch check of what comes up for each; the web search shows the topics are searched, not how often, so no volume is claimed)
| Page | Searches it answers |
|---|---|
| `/pickfu-alternative` | "PickFu alternative", "cheap PickFu alternative", "PickFu alternative for a quick A/B test" |
| `/which-etsy-photo-is-best` | "which Etsy listing photo is best", "how to choose my Etsy main photo", "which picture do you think is best" (the Etsy forum's own phrasing) |
| `/choose-a-thumbnail-or-book-cover` | "how to choose between two thumbnails", "how to choose a book cover", "poll to pick a book cover or YouTube thumbnail" |

**What changed**
- Three pages, each a server-rendered article with its own title, meta description, canonical URL and share tags (via `pageMetadata`), one worked example (labelled as made up) and a closing "Post your poll" button to `/`: `app/pickfu-alternative`, `app/which-etsy-photo-is-best`, `app/choose-a-thumbnail-or-book-cover`. The shared block is `app/guide-parts.tsx`.
- `lib/guides.ts` lists them once; the footer (every page) and the home page link to all three. The paths are added to `PUBLIC_PAGES` in `lib/site.ts`, so the sitemap lists them.
- Copy decisions: the PickFu page uses only PickFu's official $1 per response / $15 minimum figures from REVENUE.md, links their pricing page and says to check it, and says plainly what tiebreak doesn't do (no paid panel, no demographic targeting, no written reasons). No statistics, quotes, testimonials or user counts. Etsy advice stays to the generic checklist (clear item, thumbnail size, room for crops, shop consistency); the 70%-of-frame and 65%-mobile figures from single-source blog posts were left out.
- Tests: `tests/search-pages.test.ts` (listed in the sitemap and `PUBLIC_PAGES`, canonical, title/description, one h1, a link to post a poll, worked example labelled, linked from home and footer, no invented-claim phrases); `tests/launch.test.ts`'s per-page checks now cover the three pages too (unique titles and descriptions, canonical, Open Graph).
- The beacon is untouched: the layout's `visit` fires on these pages too, and their "Post your poll" button leads to the home page form, where `activate` fires. Prices, payment links and keys are untouched.
- `npm run screenshots` now shows the home page, the result and a search page (6 PNGs, the cap); the Pro/Buy shot was dropped to stay under it, since the Buy button didn't change.

**Metric:** unique visitors a week, from RepoHQ's Ideas page for tiebreak (the `visit` events). Baseline 6 a week; target 50 a week within 28 days of the merge (by the weeks ending on day 28). The `referrer` on `visit` events shows how many come from search (google.com, bing.com, duckduckgo.com). Also submit `/sitemap.xml` in Google Search Console if David has it (not needed for the beacon measure). Search pages can take weeks to be indexed, so a miss at day 28 doesn't prove the idea wrong; check indexing first (`site:` search for the three paths).

## 2026-10-19: photo upload

**Mission:** upload photos as poll options. LAUNCH-KIT.md expects the first objection to be that options take an image link while sellers keep their photos on their phones. The preview tool and share cards planned next also need images that tiebreak hosts.

**Hypothesis:** if a seller can pick the two listing photos straight from their phone, more visitors post a poll.

**Decisions** (nobody to ask, so decided here)
- **Where photos live: the Neon Postgres the app already has** (an `images` table, `bytea`), served by the app at `/images/:id`. This needs no new service, key, dependency or `.provision` line, so it works the moment it's deployed and stays at $0 (Neon free tier). Vercel Blob would have meant a new package, a store David has to create, and a local fallback for dev and tests anyway. Photo URLs are absolute and on tiebreak's own domain (`https://<site>/images/<id>`), so the native app and the planned share cards can use them as they are.
- **Limits, from the mission:** JPEG, PNG or WebP, up to 5 MB, counted in decimal MB the way phones show file sizes (5,000,000 bytes). Over that the server answers 413, a type that isn't `image/*` gets 415, and so do bytes that aren't really a JPEG, PNG or WebP. What a file is comes from its bytes, not its label. A canvas over 64 megapixels gets 422 (a small file can hide a huge image that stalls phones); phone cameras' default photos are 12 to 50 megapixels.
- **Photos are cleaned before they're stored**, because they're shown to strangers. JPEG loses EXIF (GPS position, camera), XMP, IPTC, comments, extra pictures and bytes after the end; its orientation comes back as a one-tag EXIF, so phone photos stay upright (checked in Chromium). PNG and WebP keep only the chunks that draw the image. The privacy page says so. No dependency: about 150 lines in `lib/images.ts`.
- **Upload when the poll is posted, not when picked.** The thumbnail is drawn from the file in the browser, so it shows at once. When Create is pressed the photos upload in parallel, and only then is the poll posted. A refused photo shows its error inside its own option and no poll is created. A photo that did upload isn't sent again on a retry.
- **A photo is served only once a poll uses it** (before that, `404`, not cached), so tiebreak isn't a free anonymous image host. Photos no poll uses are deleted after a day. Deleting a poll (moderation, see BUILD.md) deletes its photos. Photos are cached for a day by browsers and Vercel's CDN, which also bounds how long a deleted one can still be served.
- **A storage cap of 200 MB** (`IMAGE_STORAGE_BUDGET_BYTES`), checked under a lock. Neon's free 0.5 GB holds everything, so once photos reach the cap, uploads answer 503 ("use an image link for now") rather than filling the database that polls and votes need. That's at least 40 photos at the 5 MB maximum, and more at typical phone sizes. If uploads take off, the next step is shrinking photos in the browser before upload, or moving them to a storage tier of their own.
- **No ownership check on photos.** Having a photo's URL is enough to use it in a poll. The browser test caught why: a first-time visitor's two parallel uploads each mint a new account (no cookie yet), so an "only the uploader" rule refused their own poll. An unused photo's id is random and known only to the browser that uploaded it, so the rule protected nothing.
- **Copy:** the home page intro now says options can be "text, or photos straight from your phone". Each option has "Upload a photo" with "JPEG, PNG or WebP, up to 5 MB". No numbers or claims beyond what the code does.
- **Known gap: Vercel caps a request body at 4.5 MB**, before the app sees it. In production a photo between 4.5 and 5 MB gets the host's 413, and the option says "That photo is too big to upload. Try a smaller copy of it." Shrinking photos in the browser would close it. It wasn't built, to keep to the mission's one change.
- **Not in scope:** uploading from the native app (it still takes links, and shows uploaded photos fine), rate limits (BUILD.md's open P1, unchanged).

**What changed**
- `lib/images.ts` (new): the byte check and clean-up (`inspectImage`), storage with the cap and the one-day clean-up (`storeImage`), serving (`readImage`), and the check and claim a new poll makes (`firstMissingUpload`, `claimUploads`).
- `app/images/route.ts` (new, `POST /images`) and `app/images/[id]/route.ts` (new, `GET /images/:id`, `nosniff`, cached a day).
- `lib/db.ts`: the `images` table (it references `polls` with `ON DELETE CASCADE`) and two indexes, added last, with the schema sentinel moved to the new index. `lib/limits.ts`: `IMAGE_TYPES`, `MAX_IMAGE_BYTES`. `lib/http.ts`: `readCapped` (stops reading a body at the cap) and `mediaTypeOf`, now shared with `readJson`.
- `lib/polls.ts`, `app/polls/route.ts`: an option's `imageUrl` may also be a photo URL on this site (plain http allowed for it in local dev only). The poll and its photos are written in one transaction. A gone photo gets `400 {error, option}`. Image links work exactly as before.
- `app/create-poll-form.tsx`, `app/globals.css`: a file input per option (`accept="image/jpeg,image/png,image/webp"`), its thumbnail, Remove photo / Change photo, the per-option error, and "Uploading photos…" on the button. `app/page.tsx`: the intro line. `app/privacy/page.tsx`: what's stored about photos, and that they load from tiebreak.
- The beacon is untouched. `activate` still fires on the `201` from `POST /polls`, which now comes after the uploads, so a poll that's refused for a photo sends nothing. Checkout, Stripe and prices are untouched.
- Tests (67 new, 354 in all, all passing; the 287 existing tests are unchanged, except that `tests/helpers.ts` now also truncates `images`):
  - `tests/images.test.ts`: what counts as a photo, the clean-up for each format, and the pixel cap.
  - `tests/photo-upload.test.ts`: the start page's file inputs; `POST /images` at the 5 MB boundary, with a streamed body, for each refused type, the cap and the clean-up; a poll with two uploaded photos whose options carry tiebreak URLs, whose page renders both `<img>`s, and both of which load (200); mixing a photo with a link; a gone photo; the first-visitor case; moderation deletes.
  - `tests/photo-upload-browser.test.ts`: Playwright (Chromium) at iPhone 13 width (390 px) against the dev server. It checks the thumbnails before submit, both photos loading from tiebreak with 200, the 413 and 415 refusals inline with no `POST /polls`, and a link next to a photo. It needs `CHROMIUM_PATH`, so CI, which doesn't set it, skips it.
  - `tests/scratch-debug.test.ts`: real Chromium-encoded JPEG, PNG and WebP still draw after the clean-up, and a JPEG with orientation 6 and GPS comes out upright without the GPS. The name is left over from debugging the browser test. The build sandbox couldn't rename or delete files; rename it freely.
- `npm run screenshots`: the start page with a photo picked for each option, the posted poll's swipe card with both photos, and the result with the winning photo (6 PNGs). The search-page shots were dropped to stay at the cap, since those pages didn't change. The sample photos are two mugs drawn in the browser.

**Pre-landing review** (gstack checklist, against `git diff` and the new files)
- **Pass 1, CRITICAL: nothing open.**
  - Every new statement is parameterised.
  - The storage-cap check and its insert run under one advisory lock.
  - A poll's photos are locked (`FOR UPDATE`), inserted and claimed in the poll's own transaction, so the one-day clean-up can't delete a photo mid-post.
  - No raw HTML. Photos are served only as the type their bytes were checked to be, with `nosniff`, and SVG is never accepted.
  - The new `missing_upload` result is handled by its one consumer (`app/polls/route.ts`). The image types are one list (`IMAGE_TYPES`) behind the picker's `accept`, the DB check and an exhaustive `Record` of cleaners.
  - No secrets are involved; test images are built at runtime.
- **Fixed during the build:**
  - The ownership rule that refused a first-time visitor's own poll (above; it has a regression test now).
  - PNG and WebP cleaning switched from dropping known metadata to keeping only known image chunks, since private chunks and content credentials can carry identity too.
  - Labels like `image/jpg` are accepted, because the bytes decide.
- **Open, decided here:**
  - [P1, carried] no rate limits: a script could fill the 200 MB photo cap, which pauses uploads but leaves polls and votes working.
  - [P2] strangers' photos are now hosted on tiebreak's own domain rather than hotlinked. The mitigations are the same as before: posting publicly costs 5 votes, 3 reports take a poll out of the feed, and deleting a poll deletes its photos. Glance at new public polls with photos while traffic is small.
  - [P2] the Vercel 4.5 MB cap (above).

**Metric:** the share of visitors who post a poll, from RepoHQ's Ideas page for tiebreak: unique `activate` ÷ unique `visit` over the 14 days after the merge. The baseline is 0.0% (7 visitors, 0 activations all time); the target is 10.0%. To see whether photos are what moved it, count the polls that used one, in the Neon SQL editor:
```sql
SELECT count(*) AS polls, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM images i WHERE i.poll_id = p.id)) AS with_photos
  FROM polls p WHERE p.created_at >= '<merge date>' AND p.creator_id IS DISTINCT FROM 'house';
```
(`'house'` is `HOUSE_ID` in `lib/house.ts`, the starter polls' creator, left out.) At under 50 visitors a week, a 10% rate is a handful of polls, so read the counts, not just the percentage.

## 2026-10-22: free thumbnail preview tools (Etsy, book cover, YouTube)

**Mission:** a free side-by-side thumbnail preview tool. Buyers search for free thumbnail-preview tools, and the ones that exist show one image at a time with no vote. tiebreak's tool previews 2–4 candidates side by side and hands them to a poll in one click. It's a search-landing tool, so it's a different kind of thing from the three content pages in the running SEO experiment.

**Hypothesis:** people who search for a thumbnail preview tool find one of the three pages, use it, and some of them put their candidates to a vote.

**Decisions** (nobody to ask, so decided here)
- **Three pages, one tool.** `/tools/etsy-thumbnail-preview`, `/tools/book-cover-thumbnail-test` and `/tools/youtube-thumbnail-preview` each have their own title, description, h1, copy and mock. They share one client component (`app/tools/thumbnail-tool.tsx`). `lib/tools.ts` lists them once for the footer, the beacon and the tests; the paths are also in `PUBLIC_PAGES`, so the sitemap lists them. The pages are static.
- **Mocks, from the mission:** Etsy shows each image in a search-grid mock at 1:1, 4:3 and 5:4 crops (centre-cropped, as `object-fit: cover` does). Book covers show uncropped, about 160 px and 80 px tall, side by side (the row scrolls sideways on a phone if they don't fit). YouTube shows each thumbnail at 16:9 in a desktop-grid tile and a phone-feed tile. The tiles show the option letter and grey bars, not a made-up title or price. The length badge on the YouTube tile is a placeholder (12:34) that shows which corner it covers.
- **Nothing leaves the device until "Let strangers pick".** Previews are drawn from object URLs. Only JPEG, PNG and WebP are taken, the types a poll photo can be (anything else is skipped with a note), and 4 at most, the most options a poll takes. The button needs 2 images, the fewest a poll takes.
- **"Let strangers pick" uploads, then opens the existing new-poll form.** The images go to `POST /images`, the same upload the form uses (now one shared `uploadPhoto` in `app/create-poll-form.tsx`). Then the form on `/` opens with them as options A, B, C (and D), plus a question that fits the tool, e.g. "Which photo would you click in Etsy search?". Posting the poll stays where it was, so `activate` still fires on its `201`. A refused image keeps you on the tool page, with the reason next to it and a line by the button. On a retry only the images not already up are uploaded, and the form doesn't upload them again.
- **The hand-off lives in page memory.** The tool hands the `File`s and their URLs to the form (`handOffToNewPoll`) and navigates there client-side, so the form shows the same thumbnails and Change/Remove photo work as usual. Considered and not used: URL parameters (an uploaded photo isn't served until a poll uses it, so the form couldn't show it) and sessionStorage (a 5 MB photo doesn't fit). Cost: reloading the form drops the hand-off. The uploaded photos then go unused and are deleted after a day, like any other unused upload.
- **The visit beacon, with a path for the tools only.** A tool page sends its own `visit` with `"path": "/tools/…"`, once per session per tool page. The layout's beacon skips tool pages, so a landing on one sends exactly one event, whichever effect runs first. The tool visit also marks the session as visited. Every other page's `visit` is unchanged: no `path`, once per session. So the search pages of the SEO experiment and the tools count apart (`path` present or not). One consequence: a session that starts on `/` or a search page and then opens a tool sends two visits, the second tagged with the tool. Poll pages never send a path, since their URL is a share link. The privacy page says a tool visit names its page.
- **Shared dev server for the browser tests.** Next 16 locks `.next` per project (`experimental.lockDistDir`, on by default), so a second browser-test file couldn't start its own `next dev`. `tests/browser-app.ts` is now a vitest `globalSetup` that starts one dev server when `CHROMIUM_PATH` is set, and both browser files use it. `tests/photo-upload-browser.test.ts` lost its own start-up code; its tests are unchanged. The server runs with `NEXT_PUBLIC_VERCEL_ENV=production` so the beacon code runs as it does live. Automated browsers still send nothing (`navigator.webdriver`), and the one test that clears that flag answers the signal endpoint itself. A side effect: with `CHROMIUM_PATH` set, any `vitest` run starts the dev server, even for one unrelated file.
- **Copy:** says what the tool does, what it doesn't upload, and gives three generic checks per page. No numbers beyond the tool's own crops and sizes, and no user counts, quotes or claims about how any platform ranks images. The book page reuses the search page's line that covers are "judged at a glance, by strangers, at a small size".
- **Scope check:** more than 8 files changed (three thin pages, one component, wiring, tests and docs), with no new service or dependency. Not in scope: dragging the crop, uploading from the tool in the native app, more platforms, and shrinking photos before upload (the 4.5 MB Vercel gap from 2026-10-19 applies here too).

**What changed**
- New: `lib/tools.ts`, `app/tools/thumbnail-tool.tsx` (the picker, the mocks in `Previews`, the hand-off) and the three `app/tools/*/page.tsx`.
- `app/create-poll-form.tsx`: `uploadPhoto` (moved out of the submit code, same behaviour) and `handOffToNewPoll`, which the form reads once when it opens.
- `lib/beacon.ts`: `sendSignal(kind, path?)`. `app/visit-beacon.tsx`: `countVisit` skips tool pages.
- `lib/site.ts`: the three paths in `PUBLIC_PAGES`. `app/layout.tsx`: a "Free tools" line in the footer. `app/privacy/page.tsx`: tool previews stay in the browser, and a tool visit names its page. `app/globals.css`: the tool styles (tool pages get a wider `main`).
- Checkout, Stripe, prices and the `activate`/`checkout` events are untouched.
- `npm run screenshots` now shows the Etsy tool with three mug photos, the form those three open, and the closed poll's result (6 PNGs). The book-cover and YouTube pages are covered by the browser test, not the shots.
- Tests (51 new, 405 in all, all passing; `tsc`, the unused-code typecheck and `next build` are clean):
  - `tests/thumbnail-tools.test.ts` (27): titles, descriptions, canonical URLs and one h1 per page, naming the tool; the sitemap, `PUBLIC_PAGES` and footer; the picker and the disabled button; honest copy; the mocks' tile counts (3 images → 9 Etsy tiles), crops, shelves and YouTube tiles; and the beacon's `path`, once per session per tool, in either effect order.
  - `tests/thumbnail-tools-browser.test.ts` (18, Chromium, desktop 1280×800 and iPhone 13 at 390 px): each page's 200, `<title>`, description and h1, and `/sitemap.xml`; 9 Etsy tiles at measured 1:1, 4:3 and 5:4 with no upload request; covers at 160 ± 2 and 80 ± 2 px tall, side by side; YouTube tiles at 16:9 in the grid and the feed; "Let strangers pick" on all three tools at both sizes (3 uploads, the form with A–C, a `201` from `POST /polls`, the poll showing the same photos in the same order); a refused 5 MB+ photo and the retry; each tool page sending one visit with its own path, and a search page's visit without one.
  - `tests/launch.test.ts` now covers the three pages in its every-public-page checks.
  - Mutation-checked (each reverted): dropping the hand-off fails 6 tests, dropping the path fails 4, wrong 5:4 or 80 px CSS fails 4, and the layout beacon not skipping tool pages fails 1.

**Pre-landing review** (gstack checklist, against `git diff` and the new files)
- **Pass 1, CRITICAL: nothing open.**
  - No SQL, and no server code changed.
  - No raw HTML. File names render as text, image sources are object URLs the page made itself, and `router.push` only gets the constant `/`.
  - Uploaded URLs go through the existing own-origin check in `POST /polls`.
  - Enum completeness: `ToolKind` maps to its mock through an exhaustive `Record` (it fell through to YouTube before the review). The new tool paths are in every list that holds public pages (`PUBLIC_PAGES`, the launch test's record). Every `sendSignal` caller was read: `activate` and `checkout` are unchanged.
  - No secrets, and test images are drawn at runtime.
- **Fixed during review:** the exhaustive mock map (above), and a refused upload now also says so by the button. On a phone the reason sits far above it. A test covers both.
- **Open, decided here:**
  - [P3] A very fast double tap on "Let strangers pick" can upload twice before the button disables (the form has the same pattern). The extra photos go unused and are deleted after a day.
  - [P3] The hand-off doesn't survive a reload of the form (above).
  - [P2, carried] no rate limits on `POST /images`.
- **Leftover file:** `scripts/look-tmp.mjs`, a throwaway script used once to look at the book-cover and YouTube pages. The sandbox doesn't allow deleting files, so it's listed in `.gitignore` instead. Delete the file and that line.

**Needs checking on RepoHQ's side:** the signal endpoint must keep the new `path` field on `visit` events. If it drops unknown fields, tool visits still count as visits but can't be told apart.

**Metric:** unique visitors a week to the three tool pages, from RepoHQ's Ideas page for tiebreak: `visit` events whose `path` starts with `/tools/`. The baseline is 0 (the pages are new). The target is 50 a week within 14 days of the merge. The `referrer` on those events shows how many come from search (google.com, bing.com, duckduckgo.com). Submit `/sitemap.xml` in Google Search Console if David has it, and check indexing with a `site:` search for `/tools/`. New pages can take weeks to be indexed, so a miss on day 14 doesn't prove the idea wrong.

To see whether tool visitors go on to post, count polls that kept a tool's question, in the Neon SQL editor. It's a lower bound, since people can edit the question:
```sql
SELECT question, count(*) FROM polls
 WHERE created_at >= '<merge date>'
   AND question IN ('Which photo would you click in Etsy search?', 'Which book cover would you pick up?', 'Which thumbnail would you click?')
 GROUP BY question;
```
