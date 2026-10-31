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

## 2026-10-31: Etsy listing photo tester

**Mission:** a free Etsy listing photo tester: 2–4 photos in a mock Etsy search grid, then "Let strangers pick". The buyer in REVENUE.md is a solo Etsy seller choosing a main photo; search turns up PickFu (paid, Amazon-focused) and live split testers, nothing free that puts the candidates side by side and collects votes. One page for one buyer, unlike the three tool pages in one PR that failed (#11–#13), and the poll handoff reuses the existing new-poll form.

**Hypothesis:** sellers who search for a way to compare listing photos find this page, so it brings visitors the search pages haven't.

**Decisions** (nobody to ask, so decided here)
- **One page:** `/tools/etsy-listing-photo-test`, a server page and one client component (`app/tools/etsy-listing-photo-test/`). It's in `PUBLIC_PAGES`, so the sitemap lists it, and it has its own title, description, canonical URL and share tags (`pageMetadata`). It reads the visitor's credits and plan like the home page, so it's rendered per request.
- **The grid:** each photo is a square tile cropped from its centre (`object-fit: cover`), four to a row on wide screens and two on a phone, with an A–D letter, a remove button, and the listing title and price the seller can type in (both optional). The grid is wider than the text column on a desktop, so the tiles are about listing-thumbnail size. It's labelled as a mock-up, not Etsy itself.
- **Honest about the crop:** Etsy's own help page says the first photo is cropped square, portrait and landscape depending on where it shows, with a thumbnail tool to adjust them ([Etsy Help](https://help.etsy.com/hc/en-us/articles/115015663347-Requirements-and-Best-Practices-for-Images-in-Your-Etsy-Shop)). Third-party guides disagree on the search crop, so the page says the grid shows only the square crop and points to Etsy's tool. No numbers, quotes or user counts; the closing caveat (anonymous voters may not be buyers) is the Etsy guide page's own.
- **Photos stay on the device until a poll is posted.** Tiles are drawn from the files (object URLs). "Let strangers pick" opens the existing `CreatePollForm` on the same page, now with `initialPhotos` and `initialQuestion` props, so the photos are options A–C (or A–D) in order. They upload through the existing `POST /images` only when the form posts the poll, exactly as on the home page. No new route, API or table. A `File` can't travel in a URL and sessionStorage is too small for photos, so the form opens in place rather than on `/`. If the seller changes the photos after opening it, the form starts over with the new set.
- **Files left out up front, each with a note:** a type that isn't JPEG, PNG or WebP, a file over 5 MB (the server's limits, from `lib/limits.ts`), and anything past 4 photos. The server still checks the bytes when the poll is posted.
- **The question starts as "Which picture do you think is best for my Etsy listing?"**, the Etsy forum's own words (RESEARCH.md).
- **"Strangers":** a first-time visitor has no credits, so the poll is link-only. The page says to share the link with shop followers, friends who shop on Etsy or a community that allows it, and that voting on 5 polls in the feed lets them post it there. It doesn't promise an audience.
- **The visit beacon carries `path` only for pages counted apart** (`PATHS_COUNTED_APART` in `lib/beacon.ts`; only the tester). Other visits are unchanged, so poll links (`/p/<id>`) never go to RepoHQ. A tester visit counts once per session even when the session began on another page (its own sessionStorage flag), and then its referrer is null, since `document.referrer` still names where the session began. Landing on the tester is also the session's visit, so no second one follows from other pages. The tester calls the beacon itself on mount, because the layout's runs only on a full page load and a link from another page wouldn't count. The privacy page says so.
- **Links to it:** the footer (every page) and the Etsy photo guide (`/which-etsy-photo-is-best`). It isn't in `GUIDES`, since it's a tool, not a guide.
- **Browser tests run one file at a time.** Each Playwright file starts its own `next dev`, and Next 16 allows one per project folder (`.next/dev/lock`, 1 s retry), so two at once kill one of them. `vitest.config.ts` now has two projects: `unit` (everything else, in parallel, as before) and `browser` (`tests/*-browser.test.ts`, one file at a time, after the rest). No test changed for it.

**What changed**
- New: `app/tools/etsy-listing-photo-test/page.tsx` (the page and its copy), `app/tools/etsy-listing-photo-test/photo-tester.tsx` (grid, picker, notes, the button and the form).
- `app/create-poll-form.tsx`: optional `initialPhotos` and `initialQuestion`; `Thumbnail` exported with a `className`. The home page uses it exactly as before.
- `lib/site.ts`: `ETSY_PHOTO_TEST_PATH`, added to `PUBLIC_PAGES`. `lib/beacon.ts`: `PATHS_COUNTED_APART` and the `path` rule above. `app/layout.tsx`, `app/which-etsy-photo-is-best/page.tsx`: a link each. `app/privacy/page.tsx`: the path on tester visits, and that tester photos aren't sent unless a poll is posted. `app/globals.css`: the grid.
- Checkout, Stripe, prices and the `activate` and `checkout` events are untouched. `activate` still fires on the `201` from `POST /polls`, which the tester's form sends the same way. Nothing under `mobile/` changed.
- Tests, written first:
  - `tests/etsy-photo-test.test.ts` (unit, runs in CI): the path is in `PUBLIC_PAGES` and the sitemap; canonical, title and description; one h1 naming the tool; the empty grid, the multi-photo picker and "Let strangers pick" off; the on-device line; the footer and guide links; no invented claims; the form taking 3 photos as A–C with the question; which files are left out; and the beacon (path on tester visits only, once per session after another landing page with a null referrer, no path on search pages, activate or checkout, nothing on previews or from automated browsers).
  - `tests/etsy-photo-test-browser.test.ts` (Playwright, Chromium, dev server; skipped without `CHROMIUM_PATH`, as in CI): 200 with its own `<title>`, meta description and h1, and listed in `/sitemap.xml`; 3 local photos (landscape, portrait, square) as 1:1 tiles side by side, with the network log showing no request carrying any photo's bytes until Create poll, then exactly three `POST /images`; "Let strangers pick" → the form with the photos as options A–C → the poll page showing all three from tiebreak, in order, at 1280×800 and on a 390 px iPhone 13; the 4-photo cap and notes; and the visit beacon with `path` on landing and after a link from the Etsy search page. The dev server runs with `NEXT_PUBLIC_VERCEL_ENV=production` so the beacon code runs, but every request to another host is answered locally or refused, and Chromium resolves no host but localhost, so no test event reaches RepoHQ.
  - `tests/launch.test.ts`: the tester added to its per-page map (all public pages), so the existing unique-title, description, canonical and Open Graph checks cover it.
- `npm run screenshots` now shows the tester: the grid with three sample mugs, the form "Let strangers pick" opens, and the poll it posts (6 PNGs, the cap). The older home, poll and result shots were replaced, since those pages didn't change.

**Pre-landing review** (gstack checklist, against `git diff` and the new files)
- **Pass 1, CRITICAL: nothing open.** No SQL, routes or server state changed. No raw HTML: file names, titles and prices render as React text. The one new value crossing a boundary is the beacon's `path`. It's sent only for a fixed list of public pages, and the privacy page names it. The mobile app sends no beacon.
- **Fixed during the build:** the file refusals and tile removal had no test (added, unit and browser). The form's heading sat flush against the top edge after the scroll (a scroll margin).
- **Open, decided here:**
  - [P2] a session that starts elsewhere and then opens the tester sends two `visit` events (one without a path, one with). RepoHQ reports unique visitors, from an IP hash, so this shouldn't count anyone twice. Check the first week's totals against the tester's.
  - [P2] RepoHQ must keep the new `path` field. If it drops unknown fields, tester visits still count as visits but can't be told apart.
  - [P3] tester polls aren't tagged; the default question is the only marker (below).

**Metric:** unique visitors a week to `/tools/etsy-listing-photo-test`: RepoHQ's `visit` events for tiebreak with `path` = `/tools/etsy-listing-photo-test`. Baseline 0 a week (the page is new); target 20 a week within 14 days of the merge. The same events' `referrer` shows search engines (google.com, bing.com, duckduckgo.com) against null (direct, or a link from another tiebreak page). To see whether those visitors post, count the polls that kept the tester's default question in the Neon SQL editor:
```sql
SELECT count(*) FROM polls
 WHERE created_at >= '<merge date>' AND question = 'Which picture do you think is best for my Etsy listing?';
```
Submit `/sitemap.xml` in Google Search Console if David has it. A new page can take weeks to be indexed, so check indexing (`site:` search for the path) before reading a miss at day 14 as a no.
