# Launch-ready: tiebreak

Done 2026-10-12, so idea-factory's go-live audit (`lib/golive.js`) passes on the live site. The product itself is unchanged.

## What was added
- **Search and sharing:**
  - every public page has its own title and description;
  - Open Graph and Twitter large-card tags, with a 1200×630 share image drawn in code (`app/opengraph-image.tsx`);
  - a canonical URL and JSON-LD (`SoftwareApplication`, listing web, iOS and Android);
  - poll share pages get their question as the title and are kept out of search (`noindex`), since they're people's links, not pages to find.
- **robots.txt and sitemap.xml** (`app/robots.ts`, `app/sitemap.ts`). The sitemap lists `/`, `/feed`, `/pro`, `/privacy` and `/terms`; the API and checkout are disallowed.
- **Privacy** (`/privacy`, new) and **Terms and refunds** (`/terms`, now with a no-warranty line). Both are linked from the footer and from the app's "You" screen.
- **Visit beacon:** the home page sends one anonymous view (`{slug, kind: "view", referrer}`) to RepoHQ's counter, so the Ideas page counts real visitors. It sets no cookie and sends no id, and the privacy page says so.
- **Site URL:** `lib/site.ts`. `NEXT_PUBLIC_SITE_URL` overrides it, which is what to set for a custom domain.
- **Payment link: none added.** There's no `REVENUE.md` price yet, and Pro already has its own Stripe checkout from M3.

## Check it
```sh
npx vitest run                                    # includes tests/go-live.test.ts
node -e 'require("/Users/davidsmith/idea-factory/lib/golive").auditLaunch("https://tiebreak-phi.vercel.app").then(r => console.log(r.passed + "/" + r.total, r.missing))'
```

## Left for David
- **Stripe:** live Pro needs `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID` and `STRIPE_WEBHOOK_SECRET` in the Vercel env (see BUILD.md › Infrastructure). Do it in test mode first.
- **Price:** decide it (the pipeline's checklist step "Price decided").
- **Custom domain** (optional): add it in Vercel, then set `NEXT_PUBLIC_SITE_URL`.
- **App stores:** Apple Developer ($99/year) and Google Play ($25 once). See `mobile/README.md`.
- **Contact email** (optional): set `CONTACT_EMAIL` in the Vercel env, and privacy and terms show it instead of GitHub issues.
