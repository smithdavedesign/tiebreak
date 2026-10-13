# Launch-ready: tiebreak

Public-launch pass, 2026-10-13. It builds on the first go-live pass (2026-10-12) and the funnel beacon
(GROWTH.md). What the product does is unchanged: post 2–4 options, share the link, people swipe, the poll
closes at its vote target or deadline, and Pro ($5, paid once) adds private polls and CSV export.

**Core action** (what counts as "activate"): **creating a poll**, meaning the form on `/` gets a `201` from
`POST /polls`. That's the first thing the paying user (a seller or creator choosing between options) does.
Voting in the feed is the free user's action and isn't counted.

## What's in place

| Requirement | Where |
| --- | --- |
| A unique `<title>` and meta description on every public page (`/`, `/feed`, `/pro`, `/privacy`, `/terms`) | `pageMetadata()` in `lib/site.ts`, called by each page |
| A canonical URL, `og:url`, Open Graph and Twitter large-card tags per page | same helper. Each page sets its own, so none inherits the home page's URL or title |
| 1200×630 share image, drawn in code at build time | `app/opengraph-image.tsx`, listed by every page that sets `openGraph` (`SHARE_IMAGE`) |
| JSON-LD `SoftwareApplication` with an `Offer` of $5 USD, paid once | `JSON_LD` in `lib/site.ts`, rendered by `app/layout.tsx` |
| `robots.txt` (allows indexing, points at the sitemap) and `sitemap.xml` (the five public pages) | `app/robots.ts`, `app/sitemap.ts` |
| `/privacy`: what's stored, its one cookie, the three beacon events, contact through GitHub issues | `app/privacy/page.tsx` |
| `/terms`: no warranty, "$5, paid once", REVENUE.md's "verdict within 48 hours or a refund" (plus the existing 14-day refund), contact through GitHub issues | `app/terms/page.tsx` |
| Footer links to both pages | `app/layout.tsx` |
| Buy button ("Get Pro for $5") going to `STRIPE_PAYMENT_LINK`, hidden when it's unset | `app/pro/page.tsx`, `paymentsReady()` in `lib/stripe.ts` |
| Visit beacon: `visit` (once per session, every page), `activate` (first poll created, once per browser), `checkout` (Buy click). Sends nothing for webdriver, outside production, or with `repohq:notrack` set | `lib/beacon.ts`, `app/visit-beacon.tsx`, `app/create-poll-form.tsx`, `app/pro/upgrade-button.tsx` |
| Provisioning request for the pipeline | `.provision` |
| Screenshots: start page, core action result, Buy button with footer, at desktop and phone sizes | `docs/screenshots/`, `npm run screenshots`, top of README |

### Changed in this pass
- **Per-page share tags.** Before this pass, `/feed`, `/pro`, `/privacy` and `/terms` inherited the layout's
  `og:url` (`/`) and `og:title` (the home title), and the layout's `canonical: '/'` leaked into pages without
  their own (404s, poll pages). Each page now sets all of them. Next.js drops a file-based OG image once a page
  sets its own `openGraph`, so the image is listed explicitly. Poll share links had already lost it; they get it back too.
- **Price $5, paid once** (REVENUE.md) is one constant, `PRICE` in `lib/site.ts`, used by the JSON-LD, the terms,
  the Pro page's description and the button label.
- **The Buy button hides itself** until payments are set up, with a plain "Pro isn't on sale yet" line instead.
  Before this pass it always showed and answered "Payments are not set up yet" when clicked.
- **Terms:** the price and REVENUE.md's refund line. **Privacy:** a short "Cookies" section (one cookie,
  `tb_voter`, needed for the site to work). Both now point to GitHub issues and warn that issues are public.
- **Screenshots:** the script now shows the Buy button and footer (`buy-*.png`) instead of the mid-vote card.
  It removes PNGs it no longer takes, and it keeps `DATABASE_URL` and every `STRIPE_*` variable from this
  shell out of the app it starts. Before, a shell holding the production `DATABASE_URL` would have written
  sample polls into the live database.

### Decisions (nobody to ask, so recorded here)
- **"Hidden when the variable is unset."** The button shows when Checkout can actually start: with
  `STRIPE_PAYMENT_LINK`, or with the older `STRIPE_SECRET_KEY` + `STRIPE_PRICE_ID` checkout the code still
  supports (and existing tests cover). Production uses only the link, so there the button is hidden exactly
  when `STRIPE_PAYMENT_LINK` is unset.
- **The button goes to the link through `POST /checkout`, not a plain `<a href>`.** The server adds the buyer's
  anonymous account as `client_reference_id`, which is how the webhook knows whom to give Pro. The link stays
  server-side, so no `NEXT_PUBLIC_` copy is needed.
- **What $5 buys.** REVENUE.md prices "a verdict" at $5 once, and the app already sells Pro, so the $5 link buys Pro.
  The concierge service REVENUE.md describes (David creates and seeds the poll by hand) sits on top and needs no code.
- **Price label.** In payment-link mode without `STRIPE_PRICE_LABEL`, the Pro page shows $5 (REVENUE.md) rather
  than "price shown at checkout". If `STRIPE_PRICE_LABEL` is set, it wins.
- **The 48-hour refund line** is a promise David keeps by hand (a Stripe dashboard refund). It's already
  covered by the existing "14 days, no questions asked" refund.

## Check it
```sh
npm ci --ignore-scripts
npm test             # 269 tests; tests/launch.test.ts covers this pass (pages render, per-page tags,
                     # JSON-LD offer, footer links, a real 1200×630 PNG, the Buy button hidden without the link)
npm run typecheck
npm run build        # then look at .next/server/app/privacy.html: title, canonical, og:*, twitter:*, JSON-LD
CHROMIUM_PATH=/path/to/chromium npm run screenshots
```
On the live site, after deploying:
```sh
curl -s https://tiebreak-phi.vercel.app/robots.txt
curl -s https://tiebreak-phi.vercel.app/sitemap.xml
curl -s -A Twitterbot https://tiebreak-phi.vercel.app/pro | grep -oE '<(title|link rel="canonical"|meta (property|name)="(og|twitter):)[^>]*>'
```
Paste the home page into Google's Rich Results Test to see the `SoftwareApplication` offer. For the beacon,
open the live site in a normal window and watch DevTools › Network for a `POST` to
`repohq.vercel.app/api/ideas/signal`. Then set `localStorage.setItem('repohq:notrack', '1')` in your own
browser so your visits aren't counted.

Not verified from here: the `<head>` of the dynamic pages (`/`, `/feed`, `/pro`) as Next serves them. They use
the same helper as `/privacy` and `/terms`, whose built HTML was checked. The live `curl` above confirms it.

## Left for David
1. **Stripe payment link → `STRIPE_PAYMENT_LINK`.** `.provision` asks the credential broker for "Stripe payment
   link for tiebreak: $5 once, per REVENUE.md". Once the link is in the Vercel env as `STRIPE_PAYMENT_LINK`
   (production), redeploy and the Buy button appears. Until then it stays hidden. If you make the link
   yourself, paste it into Vercel › Settings › Environment Variables.
2. **So a payment grants Pro automatically** (otherwise payments still arrive, but Pro must be granted by hand or refunded):
   - give the payment link the metadata `repo` = `tiebreak` (the webhook ignores other apps' payments);
   - add a Stripe webhook to `https://tiebreak-phi.vercel.app/stripe/webhook` for `checkout.session.completed`
     and `checkout.session.async_payment_succeeded`, and put its signing secret in the Vercel env as
     `STRIPE_WEBHOOK_SECRET`;
   - optional: set the link's after-payment redirect to
     `https://tiebreak-phi.vercel.app/pro?session_id={CHECKOUT_SESSION_ID}` (the buyer sees "confirming your
     payment", then Pro once the webhook lands), and set `STRIPE_PRICE_LABEL` if the link isn't $5.

   `~/ai-stack/bin/provision stripe tiebreak <price> --success-path "/pro?session_id={CHECKOUT_SESSION_ID}" --webhook /stripe/webhook`
   (from the 2026-10-12 notes; `<price>` is $5 in whatever form the tool takes) does all of this in one step:
   link, metadata, webhook, and the env vars.
3. **If you change the price,** change `PRICE` in `lib/site.ts` too, so the terms and search listing match the link.
4. **Custom domain** (optional): add it in Vercel, then set `NEXT_PUBLIC_SITE_URL` so canonical URLs, the
   sitemap and share cards use it.
5. **Contact email** (optional): set `CONTACT_EMAIL` and privacy and terms show it instead of GitHub issues.
6. **App stores** (optional, unchanged): Apple Developer ($99/year), Google Play ($25 once). See `mobile/README.md`.
7. **RepoHQ side:** the signal endpoint must accept `visit`, `activate` and `checkout` (see GROWTH.md).
