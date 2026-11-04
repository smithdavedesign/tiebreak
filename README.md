# tiebreak — swipe-to-decide polls for indecisive people and sellers

## Screenshots

![The new-poll form with three book-cover photos and "Publish the result when it closes" ticked, desktop](docs/screenshots/form-publish-desktop.png)
![The same form on a phone, with the box ticked](docs/screenshots/form-publish-mobile.png)

The core action with the new opt-in: an author posts three cover candidates and ticks **Publish the result when it closes** (off by default; a private Pro poll can't have it, and the API answers 400 to both).

![The closed poll's own page: the winner, the split and "The result is published" linking to its public page, desktop](docs/screenshots/poll-closed-desktop.png)

Five strangers voted on the shared link and the poll closed at its 5-vote target; its page now links to the published result.

![The public result page /results/which-cover-for-my-cozy-mystery-novel-…: the question as its heading, the winner and every cover's votes, desktop](docs/screenshots/result-page-desktop.png)
![The same public result page on a phone](docs/screenshots/result-page-mobile.png)

The result it gets, at `/results/<the question's words>-<poll id>`: titled with the poll's question, the winner (3 of 5 votes, 60%), each cover whole beside its share, then "Make your own tiebreak".

![GET /sitemap.xml answering 200, the result page listed after the site's public pages](docs/screenshots/sitemap-desktop.png)

`/sitemap.xml` lists that page after the site's public pages. Open, un-opted, private and reported polls never show up there, and their `/results/` address is a 404.

Regenerate them with `npm run screenshots` (set `CHROMIUM_PATH` to a Chromium binary; it starts the dev server on an in-memory database, with sample data only; the three covers are drawn in the browser, with made-up titles). The sitemap has no page of its own, so its shot is the real request and response on a plain page.

People post two options, strangers swipe to pick one, and the poll closes at a vote target or deadline; sellers and creators pay a few dollars for a fast verdict instead of PickFu's $15+.

- [Research](RESEARCH.md) — findings and sources
- [PRD](PRD.md)
- [Roadmap](ROADMAP.md)
- [Native app](mobile/README.md): iPhone and Android (Expo), on the same API. Run it on your phone with Expo Go.

Effort: Medium · Confidence: Low

_Researched by the idea pipeline on 2026-10-11 ([original record](https://github.com/smithdavedesign/idea-factory/tree/main/ideas/tiebreak)); repo created on David's go-ahead 2026-10-11._

## Starter content (house polls)
The public feed is stocked with 40 funny "house" polls (`lib/house.ts`: horse-sized duck, is a hot dog a sandwich, …). Each question keeps one open public poll; when it closes, the next feed read posts a fresh copy, so the feed never runs dry. People's polls always come first, and anyone who voted on a house question doesn't see it again. Edit the list to change them; `HOUSE_POLLS=off` in the Vercel env turns them off.

## Hosting on Cloudflare Workers (being prepared)

The Vercel team is soft-blocked until 2026-11-30, so tiebreak can also run on Cloudflare Workers (free plan) through
the OpenNext adapter. Vercel ignores all of it (`wrangler.jsonc`, `open-next.config.ts`, the `cf:build`/`preview`/`deploy`
scripts), so both hosts build from the same code until the switch.

```bash
npm run cf:build                                   # next build, then .open-next/worker.js + static assets
npx wrangler dev                                   # run the built Worker locally (workerd); secrets from .dev.vars
provision cloudflare deploy tiebreak "$PWD"         # deploy with the broker (token from the keychain)
provision cloudflare secret tiebreak DATABASE_URL  # and STRIPE_PAYMENT_LINK, STRIPE_WEBHOOK_SECRET
```
`NEXT_PUBLIC_*` values are baked in at build time: build production with `NEXT_PUBLIC_SITE_URL=<its address>`.
`cf:build` sets `NEXT_PUBLIC_DEPLOY_ENV=production` itself, so the visit beacon counts the Worker's visitors
(`lib/beacon.ts` `deployEnv()`; on Vercel it reads `NEXT_PUBLIC_VERCEL_ENV`). On Workers each query or transaction
gets its own Postgres connection (`lib/db.ts`), since a socket can't outlive the request that opened it.
Screenshots of the built Worker running locally are in `docs/screenshots/cloudflare-local/`.
