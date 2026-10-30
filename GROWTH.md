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

## 2026-10-30: free Etsy listing photo test

**Mission:** a free Etsy listing photo tester: 2–4 photos in a mock Etsy search grid, then "Let strangers pick". REVENUE.md's paying buyer is an Etsy seller choosing a main photo, and search turns up no free Etsy-specific tool that compares candidates and collects votes (only PickFu, paid and Amazon-focused, and live split testers). Unlike the abandoned thumbnail-tool builds of 2026-10-20 to 10-22 (three tool pages in one PR), this is one page for one buyer, and its poll hand-off reuses the existing new-poll form.

**Hypothesis:** sellers who search for a way to test or compare Etsy listing photos land on the page, and some of them put their candidates to a vote.

**Decisions** (nobody to ask, so decided here)
- **One page:** `/tools/etsy-listing-photo-test`, server-rendered with its own title ("Free Etsy listing photo test: compare main photos · tiebreak"), description, canonical URL, share tags and one h1 ("Free Etsy listing photo test"). It's in `PUBLIC_PAGES`, so the sitemap lists it, and the footer links to it from every page so crawlers find it. The search pages of the SEO experiment and their `GUIDES` list are unchanged.
- **The crop:** each photo is cut to a square from the centre (`object-fit: cover`), as the mission asks. What shape Etsy's own search thumbnail is, the sources disagree: a WebSearch on 2026-10-30 found square, 4:3 and "it depends on page and device", all from third-party blogs. So the page doesn't say Etsy crops square. It says the test crops square, the grid is a mock and not Etsy, and to check the crop in Etsy's listing editor before publishing.
- **The grid:** four to a row on a desktop, two on a phone. Grey stand-ins for other listings fill it up to four tiles, and grey bars stand in for each result's title, shop and price, so there's no made-up text. Each photo has its letter (A–D) and a Remove button.
- **Which photos:** the ones a poll can take: JPEG, PNG or WebP, up to 5 MB, 4 at most (`takePhotos`, from the same `IMAGE_TYPES` and `MAX_IMAGE_BYTES` as the form and the server). Anything else is skipped, with its name and the reason. Photos can be picked (several at once) or dropped. "Let strangers pick" needs 2.
- **Nothing leaves the device on this page.** Tiles are drawn from object URLs. "Let strangers pick" hands the `File`s to the new-poll form on `/` (`lib/poll-handoff.ts`) and navigates there client-side. The form opens with them as options A–C (or A–D) and the question "Which photo would you click in Etsy search?", and says the photos upload when the poll is created. Creating it goes through the form's existing upload and `POST /polls` path, unchanged, so `activate` still fires on the `201`. The hand-off lives in page memory: URL parameters can't carry a photo that isn't uploaded, and sessionStorage can't hold 5 MB photos. If the visitor reloads `/` before creating the poll, the hand-off is gone and the form opens blank. Nothing was uploaded, so there's nothing to clean up. The earlier build uploaded from the tool; not doing that removes its double-upload race and keeps all photo traffic in one place.
- **"Strangers":** a first-time visitor has no posting credit, so the poll is link-only by default. The page says so plainly: share the link with shop followers, friends who shop on Etsy or a seller community that allows it, or vote on 5 polls in the feed to post it there.
- **The visit beacon, with a path for this page only.** The layout's `visit` (still once per browser session) now carries `"path": "/tools/etsy-listing-photo-test"` when the session lands on the photo test (`visitPath` in `lib/beacon.ts`). Every other visit is sent exactly as before, with no `path` field, so the search pages and the tool count apart. A session that starts on another page and then opens the tool sends no second visit. So the tool's count is the visitors it brought in, and nobody is counted twice. The privacy page now says a visit that starts on the photo test names that page.
- **One dev server for the browser tests.** Next 16 locks `.next` per `next dev` (`experimental.lockDistDir`, on by default), so a second browser-test file couldn't start its own. `tests/browser-app.ts` is a vitest `globalSetup` that starts one when `CHROMIUM_PATH` is set. Both browser files wait for it. `tests/photo-upload-browser.test.ts` lost only its own start-up code; its three tests are unchanged. The shared server runs with `NEXT_PUBLIC_VERCEL_ENV=production`, so the beacon code runs as it does live. Automated browsers still send nothing (`navigator.webdriver`), and the one test that clears that flag answers the signal endpoint itself, so no test reaches RepoHQ.
- **Setup-hook timeout 30 s → 60 s** (`vitest.config.ts`). Before this change, a full run here already lost one file to a 30 s timeout while its in-memory Postgres (PGlite, WASM) booted alongside every other file. With the dev server compiling alongside, a run lost two. Both files pass alone and in a full run at 60 s. No assertion changed.
- **Scope check:** 9 source files touched or added (the page, its client component, `lib/poll-handoff.ts`, `lib/beacon.ts`, `app/visit-beacon.tsx`, `lib/site.ts`, the form, the layout and the privacy page), plus CSS. That's one over the checklist's 8-file line, but only the page and its component are big; each of the others is a few lines the feature needs (the path, the hand-off, the link, the privacy line). One new module, no new service, dependency, key or `.provision` line. Not in scope: keeping the photos when the visitor goes Back from the form, dragging the crop, other marketplaces, the native app (`mobile/` is untouched), and shrinking photos before upload (the 4.5 MB Vercel gap from 2026-10-19 applies here too).

**What changed**
- New: `app/tools/etsy-listing-photo-test/page.tsx` (the page and its copy), `app/tools/etsy-listing-photo-test/photo-test.tsx` (picker, drop zone, `takePhotos`, the mock grid, the hand-off), `lib/poll-handoff.ts`.
- `app/create-poll-form.tsx`: opens with a handed-over poll's photos and question, and a line saying they upload on create. Without a hand-off it's unchanged.
- `lib/beacon.ts`: `visitPath` and `sendSignal(kind, path?)`. `app/visit-beacon.tsx`: passes `visitPath(location.pathname)`.
- `lib/site.ts`: `ETSY_PHOTO_TEST_PATH`, added to `PUBLIC_PAGES`. `app/layout.tsx`: the footer link. `app/privacy/page.tsx`: photos tried in the test stay in the browser, and a visit landing on it names the page. `app/globals.css`: the tool's styles (the page gets a wider `main`).
- Checkout, Stripe, prices, `activate` and `checkout` are untouched.
- `npm run screenshots` now shows the photo test with three mug photos (wide, tall and square) in the grid, the form "Let strangers pick" opens, and the 3-photo poll it creates (6 PNGs). The old home/result shots were dropped to stay at the cap; their flow didn't change.

**Tests** (29 new, 383 in all, all passing with Chromium; `tsc` is clean. `next build`, CI's third web step, couldn't be run in this build sandbox, so CI is its first run. The existing tests are unchanged, except that `tests/launch.test.ts` lists the new page and `tests/photo-upload-browser.test.ts` uses the shared dev server.)
- `tests/etsy-photo-test.test.ts` (20): the path, `PUBLIC_PAGES` and the sitemap; title, description, canonical and one h1 naming the tool; the picker (`multiple`, the poll's types), the grid and the disabled button; the footer link; honest copy (says nothing uploads until the poll, the grid is a mock, no claim about Etsy's crop shape, no numbers, testimonials or demographics); `takePhotos` (types, HEIC and unlabelled files, the 5 MB boundary, the 4-photo cap); the hand-off (the form opens with A–C, the file names and the question, and opens blank once it's cleared); `visitPath`, the visit body with and without `path`, still once per session; the privacy line; and no file under `mobile/` differs from `main` (skipped where `main` isn't fetched, as in CI's shallow clone).
- `tests/etsy-photo-test-browser.test.ts` (7, Chromium; desktop 1280×800 and iPhone 13 at 390 px): the page's 200, `<title>` (unique among public pages), description and h1, and `/sitemap.xml`. Three photos (wide JPEG, tall PNG, square WebP) show as measured squares with `object-fit: cover`, inside the grid, side by side (one row on a desktop, two to a row on a phone), and Remove re-letters them. The network log shows no request to `/images` and no request body holding any photo's bytes, on the tool and on the form, until "Create poll". Then exactly three uploads (201), a poll page with all three photos served by tiebreak (200) in A–C order, and no sideways scrolling at 390 px. The beacon test shows a landing on the tool sends `{slug, kind: "visit", referrer, path}`, a landing on a search page sends no `path`, and opening the tool later in that session sends nothing.
- `tests/launch.test.ts`: the page joins the every-public-page checks (unique title and description, canonical, Open Graph).
- Mutation-checked, each reverted: the form ignoring the hand-off fails 3 tests, the beacon dropping the path fails 1, and the first CSS (the photo's own height stretched the tile) failed the square check at both sizes.

**Pre-landing review** (gstack checklist, against `git diff` and the new files)
- **Pass 1, CRITICAL: nothing open.**
  - No SQL, and no server code changed. The poll is created through the existing, tested routes.
  - No raw HTML. File names render as text, image sources are object URLs the page made itself, and `router.push` gets only the constant `/`.
  - Uploaded photos still go through the existing byte checks, clean-up and own-origin check.
  - Enum completeness: every `PUBLIC_PAGES` consumer was read (sitemap, robots, the launch and go-live tests). `SignalKind` is unchanged, and every `sendSignal` caller was read: `activate` and `checkout` send the same body as before.
  - No secrets. Test photos are drawn at runtime.
- **Informational, decided here:**
  - [P3] Going Back from the form to the tool shows an empty tool; reloading the form drops the hand-off (above).
  - [P3] `main:has(...)` widens the page; browsers without `:has` show the same grid in the narrower column.
  - [P2, carried] no rate limits on `POST /images`; the Vercel 4.5 MB request cap.

**Needs checking on RepoHQ's side:** the signal endpoint must keep the `path` field on `visit` events. If it drops unknown fields, the tool's visits still count as visits but can't be told apart.

**Metric:** visitors a week who land on the photo test, from RepoHQ's Ideas page for tiebreak: `visit` events with `path` = `/tools/etsy-listing-photo-test`. The baseline is 0 (the page is new); the target is 20 a week within 14 days of the merge. The `referrer` on those events shows how many come from search (google.com, bing.com, duckduckgo.com). Submit `/sitemap.xml` in Google Search Console if David has it, and check indexing with a `site:` search for the path; a new page can take weeks to be indexed, so a miss on day 14 doesn't prove the idea wrong. To see whether those visitors go on to post, count polls that kept the tool's question, in the Neon SQL editor (a lower bound, since people can edit the question):
```sql
SELECT count(*) AS polls,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM images i WHERE i.poll_id = p.id)) AS with_photos
  FROM polls p
 WHERE p.created_at >= '<merge date>' AND p.question = 'Which photo would you click in Etsy search?';
```
