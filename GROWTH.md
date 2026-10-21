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

## 2026-10-21: free thumbnail preview tools

**Mission:** a free side-by-side thumbnail preview tool for Etsy listing photos, book covers and YouTube thumbnails. Buyers search for free thumbnail-preview tools, and the ones out there show one image at a time with no vote. tiebreak's previews 2–4 candidates side by side and hands them to a poll in one click.

**Hypothesis:** a search-landing tool (something people use, not an article) brings visitors from searches like "Etsy thumbnail preview", "book cover thumbnail test" and "YouTube thumbnail preview", and some of them take the one-click step to a poll. It's a different kind of page from the three search pages in the running SEO experiment, and its visits are counted apart from theirs.

**Decisions** (nobody to ask, so decided here)
- **One route, three tools.** `app/tools/[tool]` with the three slugs from `lib/tools.ts` (`generateStaticParams`, `dynamicParams = false`): each page is prerendered as static HTML with its own title, description, canonical URL and h1, and any other `/tools/<slug>` is a 404. A registry instead of three near-identical page files.
- **What each tool shows, from the mission.** Etsy: every image at the 1:1, 4:3 and 5:4 crops, in a search-grid mock (3 images → 9 tiles). Book covers: every cover whole at about 160 px and about 80 px tall, in a row. YouTube: every image at 16:9 in a desktop-grid tile and in a phone-feed tile. Tiles are lettered A–D like the poll's options.
- **Honest copy.** The page says the mocks are simplified (size and crop, not any site's exact layout) and that tiebreak isn't affiliated with Etsy, YouTube or any store. No claim about a platform's exact thumbnail sizes, no numbers, quotes or user counts. The Etsy lede uses the forum's own words ("which picture is best?", RESEARCH.md). The "what to look for" bullets restate the existing search pages' checklists.
- **Nothing leaves the device until the button.** Previews are object URLs of the picked files. The picker is disabled until the page is interactive, so a file picked during loading isn't silently dropped. A poll takes 2–4 options, so a fifth image is left out with a note, and the button needs two.
- **"Let strangers pick" uses the existing upload.** It sends each image to `POST /images` (all at once, with that endpoint's 5 MB limit, byte check, metadata clean-up and storage cap). A refused image says why in its own slot and nothing opens; images already stored aren't sent again on the retry.
- **The hand-off is a URL plus memory.** The tool opens `/?tool=<slug>&photo=<id>…`. The home page keeps only well-formed photo ids, each once, at most four, and the form starts with them as options A–D and the tool's question ("Which listing photo should I use?" and so on). The thumbnails come from the same files, handed over in memory (`lib/photo-handoff.ts`), because an upload isn't served until a poll uses it (that rule keeps tiebreak from being a free anonymous image host). After a reload the option says "Uploaded photo" instead of drawing it, and posting still works.
- **The poll is the form's usual one:** link-only by default, so it's free; posting to the public feed still costs a credit. The button label is the mission's; the hint under it says you share the link and people swipe.
- **The visit beacon now carries the page's path** (`path`, e.g. `/tools/etsy-thumbnail-preview`) on `visit` events. It's the path only, never the query string, because the form's query carries photo ids. A visit is still sent once per browser session, so it's credited to the page the session started on, which for a search-landing page is the one that matters. `activate` and `checkout` are unchanged. The privacy page says so.
- **The footer links the three tools** on every page, so crawlers reach them by links as well as through the sitemap. The search pages themselves are unchanged.
- **Test infrastructure:** Next 16 allows one `next dev` per project directory (`.next/dev/lock`), and both browser test files start one. `vitest.config.ts` now has two projects, `unit` and `browser`, and runs browser files one at a time (checked: run in parallel, the second dev server exits). With Chromium the full suite now takes 50–85 s here (it was about 40 s). CI has no `CHROMIUM_PATH`, so it skips both browser files as before.
- **No new dependency, service, key or `.provision` line.** Checkout, Stripe, prices and the Buy button are untouched.
- **Housekeeping:** a scratch folder from a visual check (`.scratch/`, sample images and a script) couldn't be deleted in this sandbox, so `.gitignore` now lists it. Delete it freely.

**What changed**
- `lib/tools.ts` (new): the three tools (name, title, description, copy, question, views) and `optionRange`.
- `app/tools/[tool]/page.tsx` (new): the server-rendered page. `app/tools/[tool]/thumbnail-preview.tsx` (new): the picker, the list, the mocks (`PreviewMocks`) and "Let strangers pick".
- `lib/photo-handoff.ts` (new): the in-memory hand-off of the picked files to the form.
- `app/page.tsx`: reads the hand-off query and shows a notice ("Your 3 images from the Etsy thumbnail preview are options A–C…"). `app/create-poll-form.tsx`: starts from the hand-off. An option can hold an already uploaded photo without its file, and `uploadError` is shared with the tool. `lib/images.ts`: `isImageId`.
- `lib/beacon.ts`: `path` on `visit`. `lib/site.ts`: the three paths in `PUBLIC_PAGES`, so they're in `/sitemap.xml`. `app/layout.tsx`: the footer's "Free tools" links. `app/privacy/page.tsx`: the path, and the fact that tool images stay on the device. `app/globals.css`: the tool page and mocks.
- Tests (52 new, 406 in all, all passing; no existing assertion changed or removed):
  - `tests/thumbnail-tools.test.ts` (31, always run): the three paths and only those; static params and 404s; each page's title, description and canonical; uniqueness against every other page; one h1 naming the tool; sitemap, `PUBLIC_PAGES` and robots; footer and cross-links; no invented claims. The mocks: 9 Etsy tiles at the three ratios, covers at 160 and 80 px uncropped, YouTube at 16:9 in grid and feed, blob: sources only, and 2 and 4 candidates. The form's hand-off: A–C prefilled with the question, bad, duplicate and extra ids dropped, and the blank form otherwise. The beacon's path for each tool and search page, never the query, once per session. The privacy copy.
  - `tests/thumbnail-tools-browser.test.ts` (15, Playwright with Chromium, desktop 1280×800 and iPhone 13 at 390 px, against the dev server):
    - each tool answers 200 with its own `<title>`, meta description and h1, `/sitemap.xml` lists all three, and an unknown slug is a 404;
    - Etsy's 9 tiles measure 1:1, 4:3 and 5:4, with no POST or `/images` request while previewing;
    - the covers measure about 160 and 80 px tall, side by side;
    - YouTube measures 16:9 in grid and feed;
    - for every tool at both sizes, "Let strangers pick" gives three 201 uploads, then the form with A–C thumbnails and the question, then a posted poll whose three photos load (200), with nothing uploaded twice;
    - the 2–4 limits, and a refused upload (415) shown in its slot and retried without re-sending;
    - each tool page's visit beacon carries its own path (the signal URL is answered inside the test browser, so nothing is sent to RepoHQ).
  - `tests/launch.test.ts`: its every-public-page checks now include the three tools (it's keyed on `PUBLIC_PAGES`).
  - Mutation-checked, then reverted: without the beacon's `path`, 4 tests fail; uploading on pick instead of on the button fails the Etsy browser test at both sizes.
- `npm run build` passes (the three tools are SSG), and so does `npm run typecheck -- --noUnusedLocals --noUnusedParameters`.
- `npm run screenshots`: the Etsy tool with three mug photos, the prefilled new-poll form, and the posted poll, at desktop and phone size (6 PNGs). They replace the photo-upload shots: the form and poll page are the same, now reached from the tool.

**Pre-landing review** (gstack checklist, against `git diff` and the new files)
- **Pass 1, CRITICAL: nothing open.**
  - No new SQL; uploads go through the existing `POST /images`, with its lock and cap.
  - No raw HTML. The query's `photo` values must match the id pattern before they're used, and `tool` is only looked up in `TOOLS`. File names render as text, and image sources are the visitor's own `blob:` URLs or tiebreak's paths. The navigation is same-origin.
  - New values traced: the view layouts (`grid`, `feed`, `shelf`) through `sizeIn`, the section class and the CSS; the three new `PUBLIC_PAGES` through the sitemap, robots and `tests/launch.test.ts`'s exhaustive record.
  - Photo ids in the form's URL stay in the browser's history. They don't leak: the beacon sends the path only, cross-site requests carry only the origin as referrer (the browser default), and poll images load with `no-referrer`. Once the poll is posted they're public anyway.
- **Fixed during review:** two exported types nothing imported (`Prefill`, `PreviewCandidate`); two over-long lines; the book-cover lede said readers "ever" see covers small first, which is now "often".
- **Open, decided here:**
  - [P2] (confidence 6/10) **RepoHQ has to accept the extra `path` field on `visit`.** The mission asks for it, but this repo can't check the endpoint. After the deploy, open a tool page in a normal browser and check that RepoHQ's Ideas page counts the visit. If it doesn't, remove the one `path` line in `lib/beacon.ts`.
  - [P3] (confidence 5/10) **A crafted `/?photo=…` link prefills someone else's form** with photos they can't see ("Uploaded photo"). Posting needs them to press Create. The ids are random and only the uploader knows them, so the only photos that can be put there are the link sender's own. Accepted.
  - [P3, carried] no rate limits (BUILD.md's P1). The tools add no new write path beyond `POST /images`, which keeps its 200 MB cap.

**Metric:** unique visitors a week, from RepoHQ's Ideas page for tiebreak (the `visit` events). The baseline is 1 a week (6 the week before, 7 all time); the target is 50 a week within 14 days of the merge. The tools' own share is the `visit` events whose `path` starts with `/tools/`, and their `referrer` shows how many came from search (google.com, bing.com, duckduckgo.com). The search pages' visits carry their own paths from now on, so the two experiments can be read apart. Secondary: `activate` from the polls the tools hand off. New pages can take more than 14 days to be indexed, so before reading a miss as a failure, check indexing (`site:tiebreak-phi.vercel.app/tools`), and submit `/sitemap.xml` in Google Search Console if David has it.
