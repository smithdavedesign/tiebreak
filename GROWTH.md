# Growth log

## 2026-10-13: funnel beacon

**Mission:** replace the visit beacon with the funnel beacon, so the funnel shows where visitors drop off.

**Core action:** creating a poll (the form on `/` getting a `201` from `POST /polls`). That's the first thing the primary payer (a seller or creator choosing between options) does; voting in the feed is the secondary, free-user action and isn't counted as activation.

**What changed**
- `lib/beacon.ts` (new): `shouldSend` is the pure send-or-not decision (production only, not `navigator.webdriver`, not opted out), `referrerFor` returns `document.referrer` only when its origin differs from `location.origin`, and `sendSignal(kind)` POSTs `{"slug": "tiebreak", "kind": …, "referrer": …}` to `https://idea-factory.1426davejobs.workers.dev/api/ideas/signal` (fire-and-forget, `keepalive`, `credentials: 'omit'`, no cookies).
- `visit`: once per browser session (sessionStorage), on every page. `VisitBeacon` moved from the home page into the root layout.
- `activate`: the first successful poll creation per browser (localStorage), in `app/create-poll-form.tsx`.
- `checkout`: every click on the Pro Buy button (`app/pro/upgrade-button.tsx`), before Checkout opens. If the Buy button moves, so must this call.
- Nothing is sent on preview deployments (`deployEnv()` isn't `production`: `NEXT_PUBLIC_DEPLOY_ENV`, set by `cf:build`, else Vercel's `NEXT_PUBLIC_VERCEL_ENV`; local dev has neither), when `navigator.webdriver` is true, or when localStorage `repohq:notrack` is set. If storage is blocked, nothing is sent rather than repeating a once-only event.
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

## 2026-10-23: poll share cards and "Make your own tiebreak"

**Mission:** poll share cards and a "make your own" loop for voters. The concierge plan and the launch posts both get votes by sharing poll links in communities and chats, where a link unfurled as plain text (every poll page used the site-wide picture). A card showing the actual candidates gets clicked, and every voter who arrives could make a poll of their own.

**Hypothesis:** a shared poll link that unfurls as a picture of the poll (its question and the seller's own photos) gets more clicks than a plain link, and a voter shown "Make your own tiebreak" right after voting posts a poll of their own, which they share again.

**Decisions** (nobody to ask, so decided here)
- **An explicit route, `GET /p/:id/card`, not the `opengraph-image.tsx` file convention.** Next's convention [Layer 1] would also work, but it gives the image a generated address and its own caching. With a route, the page lists one known URL in both `og:image` and `twitter:image` (with width, height and alt text), the card can be cached by the poll's state, and a failure can fall back. Poll pages are not blocked in `robots.txt` (only `/polls` is), so crawlers can fetch both the page and the card.
- **The card is drawn for nobody in particular.** No cookie is read, so everyone (and every crawler) gets the same picture, and a private poll's result never shows on it, even if its creator's browser asks. A closed private poll's card says "The result is private".
- **What the card shows:** the question, and each option as a tile with its letter: the photo (cropped to fit) for a photo option, the text for a text option. While open: "Tap to vote". Once closed: "Closed · 3 votes", the winner framed in green and labelled "Winner", and each option's percentage, vote count and bar; a tie says so and marks no winner; a poll nobody voted on says "No votes came in". Colours and font sizes follow the site (`app/globals.css`); the font is the Geist that ships with `next/og`.
- **The card's address carries the poll's state** (`/p/:id/card?v=open`, then `?v=closed`), so a chat app that cached the open card fetches the result as a new image. Any other address (an old `v`, a made-up query) gets a 307 to the current one, uncached. That way only one address per state is ever drawn, and a made-up query can't make the server draw the card and fetch its image links over and over. Caches may keep an open poll's card 5 minutes and a closed one a day (it never changes again; the day also bounds how long a card outlives a poll deleted by moderation, as for photos).
- **Photos on the card.** Photos uploaded to tiebreak are read from the database, not fetched. Image links are fetched once per drawing, with SSRF guards: https only; the host must resolve only to public addresses (private, loopback, link-local/cloud-metadata, carrier-grade NAT, multicast and reserved ranges are refused, including IPv4-mapped IPv6), checked again at each redirect (at most 3); 4 seconds in all; at most 5 MB, read with the same capped reader as uploads; no cookies. The bytes must then pass the upload check (`inspectImage`) as a JPEG or PNG. A card decodes at most 100 megapixels of photos in all (4 bytes a pixel, in memory); options past that show their text.
- **WebP photos show as the option's letter and text.** A spike found that the image renderer bundled with `next/og` (resvg) paints WebP as blank, both lossy and lossless, without an error. JPEG and PNG draw. Phones upload JPEG (iOS converts HEIC to JPEG for an upload), so most photos show.
- **Sideways phone photos are turned upright**, as browsers show them: `inspectImage` now also returns a JPEG's EXIF orientation (it already read it to keep photos upright), and the card turns the photo by it. The mirrored orientations (front cameras) are turned but not flipped back.
- **Long text never runs off the card.** The question's type size goes down with its length (60, 48, 40, 34 px), every text box has a fixed size and a line clamp ending in "…", and each text also clips to its box. The clip covers a satori quirk the tests found: it always adds one more letter before the "…", which can stick out when a single unbroken word (a pasted link) fills the line. The API caps questions at 140 characters; the card is tested at 200 so it holds past that (and with the widest letters).
- **If drawing fails**, the card is drawn again without photos (for example, a lossless JPEG the renderer can't read), and if that fails too, the route sends a 307 to the site's own card, uncached, so the next request tries again.
- **Who sees "Make your own tiebreak":** anyone but the poll's creator, once they have voted on it, or once it has closed (they arrived too late to vote). The creator already made one. It's a plain `<a href="/?ref=poll">`, not a Next `<Link>`: the full page load runs the layout's visit beacon on arrival. Copy: "**Stuck on a choice of your own?** Post 2–4 options and share the link. It's free." (an unlisted poll costs no credit and no Pro; the wording is the start page's own).
- **The beacon's `ref` tag.** A visit to a page whose address has `?ref=<tag>` carries `"ref": "<tag>"`. The tag must be 1 to 32 lower-case letters, digits or dashes, and anything else is dropped, so no other part of an address is ever sent. A tagged visit is sent once per session per tag, even if this session already sent a visit (the voter's poll-page visit came first), and it counts as the session's visit, so no untagged one follows. Untagged visits, `activate` and `checkout` send exactly what they did before (no `ref` key). The privacy page says so, and says the server fetches linked option images to draw the card.
- **No new dependency, service or key**, so no `.provision` line. Checkout, Stripe, prices and payment links are untouched.

**What changed**
- `lib/share-card.tsx` (new): the card's layout (`CARD`, `tileBoxes`, `resultBarBox`), `cardPath`, `cardAlt`, `CARD_CACHE`, the satori tree (`pollCardElement`), photo loading with the fetch guards (`loadThumbnails`), and `pollCardPng` with its fallback.
- `app/p/[id]/card/route.ts` (new): `GET /p/:id/card?v=<status>` → 200 PNG (`nosniff`, cached by state) | 307 to the current address | 404 (not cached).
- `app/p/[id]/page.tsx`: `og:image` and `twitter:image` point at the poll's card (1200×630, with alt text); a poll that doesn't exist keeps the site's card.
- `app/p/[id]/poll-view.tsx`, `app/globals.css`: the "Make your own tiebreak" block.
- `lib/beacon.ts`: `refFor`, and the tagged visit. `app/privacy/page.tsx`: the tag and the card.
- `lib/images.ts`: `inspectImage` also returns `orientation` (an added field; nothing else changed). `lib/http.ts`: `readCapped` also takes a fetched response.
- `vitest.config.ts`: two projects, so the two browser test files (each starts `next dev`, which holds a lock on `.next/`) run one at a time after the rest. CI, without `CHROMIUM_PATH`, skips them as before.
- The native app needs nothing: its Share sends the same `/p/:id` link, which now unfurls as the card.
- Tests (42 new, 396 in all, all passing; the 354 earlier ones are unchanged but one, below):
  - `tests/share-card.test.ts`: the tags (`og:image` and `twitter:image` with `summary_large_image`, the address changing on close, the site card for an unknown poll); the route (1200×630 PNG, headers, caching, 404s, the redirect, a private poll's card identical with and without its creator's cookie); what's drawn, read back from the PNG's pixels (the uploaded photo and a linked image in their tiles, text in a text tile, the winner's green frame, bars filled 67% and 33%, a tie, no votes, a private result, WebP, EXIF orientation, the no-photo fallback); the fetch guards (public IPv4 and IPv6 hosts and redirects fetched; private, loopback, link-local, mapped, unresolvable, plain-http and redirected-to-private never asked; non-images, over 5 MB, errors and redirect loops skipped); and the overflow test: 4 options of 80 characters with a 200-character question, open, closed and in the widest letters (and the widest letters with 2 options, the biggest type), each a valid PNG (every chunk's CRC, the zlib stream and each row's filter are checked) with nothing in the card's margin, the gap under the question or any tile's padding, plus a snapshot of where ink falls (`tests/__snapshots__/share-card.test.ts.snap`). `tests/png-pixels.ts` is the PNG reader these use.
  - `tests/make-your-own.test.ts`: the link on the rendered poll page (not before voting; after voting; on the result; for a late arrival; never for the creator), and the beacon: following it records `ref: "poll"` though the poll page already counted a visit; once per session; untagged events unchanged; nothing off production; bad tags dropped. Plus the privacy copy.
  - `tests/share-card-browser.test.ts` (Chromium, iPhone 13 width, against `next dev`): the poll page's real HTML has one `og:image`, its width and height, the alt text, `twitter:card` and `twitter:image`, and fetching that address gives a 1200×630 PNG with a real JPEG photo in its tile and a real WebP's option drawn as text; a sideways phone JPEG comes out upright; and a voter votes, clicks "Make your own tiebreak", lands on `/?ref=poll`, and the beacon's two visits are captured in the page (the second with `ref: "poll"`). Nothing reaches RepoHQ: the signal request is answered inside the page, and any request to RepoHQ is aborted.
  - Changed: `tests/launch.test.ts`'s poll-share-page test expected poll pages to list the site's picture; it now expects the poll's own card in both `og:image` and `twitter:image`, which is stricter.
- `npm run screenshots`: the open poll's card, the closed poll's card, the voter's page with "Make your own tiebreak" (desktop and phone) and the start page it opens (desktop and phone). The cards are images, so they're taken once, at desktop size; the older shots were replaced (6 PNGs, the cap).

**Pre-landing review** (gstack checklist, against `git diff` and the new files)
- **Pass 1, CRITICAL: nothing open.**
  - No new SQL; the card reads the poll with the existing parameterised `getPoll` (which may close an overdue poll under its row lock, as the page does) and photos with `readImage`.
  - No raw HTML. User text reaches the card only as text that satori draws as glyph outlines; the alt text goes through Next's metadata, which escapes it.
  - [Fixed] (confidence 8/10) `app/p/[id]/card/route.ts`: the card fetches image links server-side, so any query that skipped the CDN cache (`?v=<random>`) made the server draw the card and fetch someone else's image again. Only the current address is drawn now; anything else is a cheap, uncached 307.
  - SSRF: the guards above, with tests for each refusal. Satori's own fetching is never used (photos reach it as bytes).
  - Enum completeness: `CARD_CACHE` is a `Record<Status, …>`, so a new poll status can't skip a cache decision; the card's states cover open, closed with a winner, a tie, no votes and a hidden private result; `SignalKind` is unchanged.
- **Fixed during the build:** text that overflowed a tile's padding (found by the overflow test, above); WebP drawn as a blank tile (found by a spike); sideways phone photos.
- **Auto-fixed:** an unused test variable; the card now sends `nosniff`, like `/images/:id`.
- **Open, decided here:**
  - [P1, carried] no rate limits. Someone could post many polls whose image links point at one host, and ask for each card once per state; each draws and fetches once, then the CDN answers.
  - [P2] (confidence 6/10) DNS rebinding: a host could answer the guard's lookup with a public address and the fetch's with a private one. What comes back is only ever drawn as a JPEG or PNG on a public card, and Vercel's functions have no private network to reach.
  - [P2] emoji in a question make `next/og` fetch the emoji image from a CDN while drawing; if that fails, the site's card is sent instead, and the next request tries again.
  - [P3] a preview deployment's tags point at the production card (`metadataBase` is the site's address, as before), where its polls don't exist.
  - [P3] the card decodes each photo whole; four 12-megapixel photos is about 200 MB of memory and a second or two, after which the CDN serves it.

**Metric:** unique visitors a week, from RepoHQ's Ideas page for tiebreak (the `visit` events). The baseline is 0 this week (7 the week before); the target is 50 a week within 14 days of the merge (read the 7 days ending on day 14). To see what the change brought:
- Visits tagged `ref: "poll"` are voters who followed "Make your own tiebreak". **Needs checking on RepoHQ's side:** the signal endpoint must keep (and the Ideas page show) the new `ref` field; if it ignores it, those visits still count as visits. Its per-IP limit ("a few counts an hour") should let a tagged visit through after the poll page's.
- A visit's `referrer` shows clicks from sites that send one (reddit.com, facebook.com, t.co). Many chat apps (Discord, Slack, iMessage, WhatsApp) send none, so clicks on a card there count as direct visits.
- Check the card itself once deployed: paste a poll's link into Meta's Sharing Debugger (developers.facebook.com/tools/debug), or into a Discord or Slack message to yourself.
- Whether voters go on to post, in the Neon SQL editor:
```sql
SELECT
  (SELECT count(*) FROM votes v JOIN polls p ON p.id = v.poll_id
    WHERE v.created_at >= '<merge date>' AND v.voter_id IS DISTINCT FROM p.creator_id
      AND p.creator_id IS DISTINCT FROM 'house') AS votes_on_peoples_polls,
  (SELECT count(*) FROM polls p
    WHERE p.created_at >= '<merge date>' AND p.creator_id IS DISTINCT FROM 'house'
      AND EXISTS (SELECT 1 FROM votes v JOIN polls q ON q.id = v.poll_id
                   WHERE v.voter_id = p.creator_id AND v.created_at < p.created_at
                     AND q.creator_id IS DISTINCT FROM p.creator_id AND q.creator_id IS DISTINCT FROM 'house')) AS polls_by_earlier_voters;
```
`polls_by_earlier_voters` counts new polls whose creator had first voted on someone else's poll: the loop working. At these numbers, read the counts, not rates.

## 2026-11-01: vote from your newsletter

**Mission:** copyable email and Substack blocks with one link per option. Authors already ask their own lists to pick a cover by a deadline, and sellers and creators have email lists. A block of option images, each linking to its own vote, turns a reader's click into a tiebreak visit, and every poll creator into a way in.

**Hypothesis:** creators who paste the block into a newsletter bring their readers to tiebreak, where each reader's tap lands on the poll with their pick ready to confirm.

**Decisions** (nobody to ask, so decided here)
- **The link is exactly `/polls/<id>?pick=<A|B|C|D>&src=newsletter`, as the mission says.** `GET /polls/:id` is the JSON API (the native app and the poll page's Refresh use it), so a request with `pick` or `src` gets a `307` to `/p/<id>?pick=B&src=newsletter` instead. That answer reads and writes nothing (no database query, no vote, no account cookie), is `no-store`, and passes on only a letter A–D and the known source, so it can't redirect anywhere else. Considered and not used: links straight to `/p/<id>` (not the required form), a rewrite in `next.config` (unproven on the Workers adapter), and choosing by the `Accept` header (link scanners send anything).
- **Opening a link never votes.** Email link scanners and prefetchers open every link, so the page opens with the option preselected and one "Confirm vote" button; only that button votes, through the same `POST /polls/:id/votes` as always. A two-option poll gets the same confirm step, not the swipe card (which votes on a tap). Tapping another option changes the selection only. Someone who already voted sees "You picked" (a second confirm from another tab gets the API's 409, "You already voted on this poll."); a closed poll's link shows the result.
- **"Confirm vote" comes before the options.** The first screenshots had it below the fold on a phone, which is where most email is read; the browser test now checks it's on the first screen at both sizes.
- **After confirming, the address bar becomes `/p/<id>`**, so a reader who copies it shares the plain link: no preselected pick, and the next person isn't counted as a newsletter visit.
- **The panel is for the creator only, while the poll is open** (a closed poll can't take votes). "Creator" is decided as the API does it: the native app's `x-tiebreak-voter` header first, else the `tb_voter` cookie (`viewerOf` in `lib/http.ts`, now shared by `voterOf` and the page). A browser can't add that header to a page load, so on the web it's the cookie; the header gives nothing the API didn't already give its holder.
- **The HTML block:** one `<table>` with inline styles only (no `<script>`, `<style>` or classes, which email clients drop), the question on top, then one `<a href>` per option wrapping its photo (or its text, for a text option), its letter and label and a "Vote A" button, and a footnote: "Tap the one you'd pick, then confirm your vote on tiebreak." No other links, so there's exactly one per option. Three options sit in one row; two or four, two to a row. Every URL is absolute; user text is escaped, and photo URLs are normalised and escaped. "Copy HTML block" puts it on the clipboard twice: as rich HTML (it pastes as the table into an email) and as its source (for an email tool's HTML or code block). If the browser only takes plain text, the source alone; if the clipboard is blocked, "Show the code" opens with the block selected.
- **The Markdown block:** the question in bold, then per option an image line (when it has a photo) and a link line, each its own paragraph, then the footnote. Brackets and emphasis characters in text are escaped, and spaces and parentheses in URLs encoded, so a label can't break a link. A text option has its link line only.
- **A preview of the email block** sits in the panel, in a sandboxed frame: no scripts (nothing in it can run, escaping or not), no popups (its links do nothing when tapped), same-origin only so the page can size it, and no referrer to image hosts. No `dangerouslySetInnerHTML`.
- **Which address the links use:** the page's own origin once it has loaded, as the share link does (so a local or Workers copy links to itself), and the server's `SITE_URL` before that, passed down from the server: `VERCEL_PROJECT_PRODUCTION_URL` isn't in the browser bundle, so reading `SITE_URL` in the client could disagree with the server's render.
- **The beacon:** a page opened at `?src=newsletter` sends its visit with `"path": "/p/<id>"` and `"source": "newsletter"`, once per session per poll, even if this session already sent a plain visit, and it stands in for the session's first visit (the same rule as tool pages). Only the exact value `newsletter` counts (a list of one, `SOURCES` in `lib/beacon.ts`); anything else is a plain visit. `activate` and `checkout` send what they did before. The privacy page says a newsletter visit names its poll page.
- **Copy:** says what the blocks are and what a reader does. "For Substack and similar editors" is the mission's own phrase; see "Needs checking". No numbers, quotes or claims.
- **Scope check:** more than 8 files (the route, the page and its view, the panel, the block builder, the beacon, styles, privacy copy and tests), but no new service, class or dependency, and no `.provision` line. Checkout, Stripe and prices are untouched.

**What changed**
- New: `lib/newsletter.ts` (`voteLink`, `pickIndex`, `pollPageFor`, `newsletterHtml`, `newsletterMarkdown`) and `app/p/[id]/newsletter-panel.tsx`.
- `app/polls/[id]/route.ts`: the `307` for vote links. `app/p/[id]/page.tsx`: the viewer by header or cookie, `pick`, and the server's `SITE_URL`. `app/p/[id]/poll-view.tsx`: `ConfirmPick` and the panel. `lib/http.ts`: `viewerOf`. `lib/beacon.ts`: `SOURCES`, `sourceFor`, `sendSignal(kind, path?, source?)`. `app/visit-beacon.tsx`: `countVisit(pathname, search)`. `app/privacy/page.tsx`, `app/globals.css`, BUILD.md.
- Tests (38 new; 490 in 33 files, all passing with `CHROMIUM_PATH` set; 462 in the unit project, which is what CI runs, since it skips the browser files):
  - `tests/newsletter.test.ts` (34): the blocks (one table, inline styles only, no script or style, one link per option wrapping its image or text, absolute URLs, escaping, rows, the Markdown lines); the panel on the rendered page (creator by cookie and by header, with both blocks; nobody else; gone once closed); the vote link (`307`, no vote and no cookie however often it's opened, only valid values passed on, `404` for a bad id, the JSON API unchanged without a query); the page from a link (preselected with one "Confirm vote", two options too, bad letters ignored, one vote on confirm, `409` on a second, a voter's own pick, closed and past-deadline polls show the result); the beacon (path and source, once per poll per session, apart from plain visits, other values plain, `activate`/`checkout` unchanged, nothing off production); the privacy copy; and the native app's contract (its client asks `GET /polls/:id` with no query, and that still answers `200` JSON to its header).
  - `tests/newsletter-browser.test.ts` (4, Chromium at 1280×800 and iPhone 13, 390 px): the creator copies both blocks (the clipboard holds `text/html` and `text/plain`, and three links to the right addresses wrapping the uploaded photos); every link fetched as a scanner would leaves the count at 0; a reader opens B's link, lands on `/p/<id>?pick=B&src=newsletter` with B pressed, one "Confirm vote" on the first screen and no swipe buttons, and the beacon sends `{kind: "visit", path: "/p/<id>", source: "newsletter"}`; confirming makes the count 1 and cleans the address; a second tab's confirm gets `409` and the count stays 1; a closed poll's link shows the winner and no vote button.
  - Four test files that render the poll page (`make-your-own`, `pages`, `photo-upload`, `pro-pages`) had a `next/headers` mock with only `cookies`; each gained a `headers()` that returns no header. No assertion changed.
  - **Fixed on the way:** `tests/share-card-browser.test.ts` started its own `next dev`, which exits while the shared one (`tests/browser-app.ts`) holds the lock on `.next/`, so that file failed whenever `CHROMIUM_PATH` was set (CI doesn't set it). It now uses the shared server; its three tests are unchanged and pass.
  - Mutation-checked (each reverted): no `307` fails 4 tests, no `source` in the beacon fails 2, the panel shown to everyone fails 1, ignoring `pick` fails 2, and ignoring the header fails 2.
- **`mobile/`: nothing changed** (`git status` and `git diff` show no file under it). Criterion 5's test is the contract above rather than a "nothing under `mobile/` ever changes" git check, which would fail every future mobile PR. The mobile CI job (tsc, jest, expo export) runs on an unchanged `mobile/`.
- `npm run screenshots` now shows the author's panel with the copied HTML block, the reader's landing with B preselected, and the vote after confirming, each at desktop and phone size (6 PNGs). The older shots were replaced.
- Not run here: `next build`. The sandbox refused the command; `tsc --noEmit` (also with `--noUnusedLocals --noUnusedParameters`) is clean, the dev server compiled the changed poll page and API route in the browser tests (the privacy page is server-rendered in the unit tests), and CI runs the build.

**Pre-landing review** (gstack checklist, against `git diff` and the new files)
- **Pass 1, CRITICAL: nothing open.**
  - No new SQL. The vote link's `307` touches no table; votes still go through `castVote`, whose `ON CONFLICT (poll_id, voter_id) DO NOTHING` under the poll's row lock makes a second confirm a `409` atomically, from any number of tabs.
  - XSS: the HTML block is built from user text, all escaped (a test feeds it `<script>`, quotes and ampersands, and a quote inside a photo URL). The block is shown only inside a frame sandboxed without scripts, never with `dangerouslySetInnerHTML`.
  - Redirects: the `Location` is built from a checked poll id, a letter A–D and the fixed word `newsletter`, so it can't send anyone elsewhere.
  - Enum completeness: the new `source` is a closed list (`SOURCES`) read by one consumer (`countVisit`). Every `sendSignal` caller was read: the tools' path visits, `activate` and `checkout` send exactly what they did. Letters come from `OPTION_LETTERS` in the link, the redirect, the page and both blocks.
  - No secrets, and no test needs one.
- **Open, decided here:**
  - [P2] Many email clients hide remote images until the reader allows them. The links still work: each one wraps the option's letter, label and "Vote A" button too, and the image has alt text.
  - [P2] Votes from newsletter readers aren't marked in the database; only their visits are. Marking them would change the votes table, which is more than this one change.
  - [P3] The poll page crops photos square (unchanged), which cuts the top of tall book covers. The email block shows covers whole.
  - [P1, carried] no rate limits. The vote link adds nothing to rate-limit: it does no work.

**Needs checking:**
- On RepoHQ's side, the signal endpoint must keep the new `source` field. If it drops it, these visits still stand apart: they're the only poll-page visits that carry a `path` (`/p/…`).
- Paste the Markdown block into a Substack draft once. If Substack shows it as plain text rather than images and links, change the panel's "For Substack and similar editors" line; the HTML block pasted as rich text is the fallback to try there.

**Metric:** unique visitors a week who arrive from a newsletter vote link, from RepoHQ's Ideas page for tiebreak: `visit` events with `source: "newsletter"` (their `path` names the poll). The baseline is 0 a week; the target is 20 a week within 14 days of the merge (read the 7 days ending on day 14). It only moves once creators paste a block into a real newsletter, so it's also the measure for the concierge polls in REVENUE.md: David can paste the block for a seller or author who asks for votes from their own list. At these numbers, read the counts, not rates.
