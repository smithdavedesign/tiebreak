# Verdict: pass — score 4/10

Tiebreak is a two-sided cold-start problem. The one paying segment (sellers and creators) is unproven, and its best substitute, PickFu, wins on vetted panels that a stranger-swipe feed can't offer.

## Forcing questions

### Q1 Demand reality — 3/10
Evidence is two Etsy forum threads where sellers ask strangers to rank photos (RESEARCH.md). That shows a pain exists. It doesn't show anyone wants a tool, and nobody has paid or asked for one. Nothing here counts as demand yet.
- PickFu's per-poll pricing shows sellers will pay for verdicts. That is a different product (vetted panel plus written reasons).
- Consumer demand is the weakest part: Agree sells for $3 one-time and Wishbone relies on sponsors.
- Stronger evidence would be a seller pasting a real image pair and asking for it today, or a pre-paid $5 poll.

### Q2 Status quo — 5/10
Sellers use forum threads, Reddit, friends and family, and sometimes PickFu. The workaround is slow and gives no tally, but it is free and tolerable. Paying sellers already have PickFu at $15+, or TubeBuddy for thumbnails. The pain is real but small (one decision, occasionally), and no one has said they would pay to remove it. The pricing sources conflict ($15 vs $50 per PickFu poll, and the aggregators are affiliate sites).

### Q3 Desperate specificity — 3/10
The named buyer is "solo Etsy or Amazon seller, indie author, YouTube creator". That is a category, not a person. There is no named human, and no consequence beyond "a slightly better listing photo". Sellers who care a lot about conversion already use paid tools. A person who would be upset if this vanished doesn't exist yet, because it hasn't launched.

### Q4 Narrowest wedge — 4/10
A single "A vs B, N votes, verdict" link is small and buildable in a weekend (ROADMAP M1). But the wedge has no voters of its own. The sharper wedge is a seller sends the link to their own audience, so it needs no stranger feed. At that point it is a free-tier Strawpoll/Google Forms alternative with a nicer swipe UI. That is easy to copy and hard to charge for.

### Q5 Observation (can't answer pre-product)
In M1, watch whether a seller gets a verdict from their own audience with no feed at all. Watch:
- whether voters finish the swipe;
- whether the seller shares the link unprompted;
- whether they make a second poll;
- whether anyone asks about reasons or demographics (a sign they want PickFu instead).

### Q6 Future-fit — 3/10
AI image generation makes producing options cheaper, so more A/B choices exist. But AI listing-photo and thumbnail testers, and platform-native tests (YouTube's built-in thumbnail testing, Amazon Manage Your Experiments), push the verdict into the platforms. That makes a stranger-poll tool less necessary over three years.

## Premises
1. Sellers and creators will pay $5–$9 per poll for stranger votes. Unsupported: PickFu's value is a vetted panel plus written reasons, and Tiebreak has neither.
2. The consumer free loop will seed enough voters. Unsupported: Wishbone and similar apps show consumer poll apps are crowded and monetise through sponsors.
3. "Vote 5, post 1" bootstraps the feed. Plausible but untested, and it makes the product a social app that needs real traffic before it works.
4. Sellers trust anonymous votes enough to act on them. Open, per the PRD itself.
5. The pain is real. Supported by the Etsy threads, though weakly (two threads, no counts).

## Alternatives
- **A. Minimal: audience-only poll links.** The seller shares a link to their own followers, with no public feed. Effort S, risk low. This drops the cold start but is a thin product.
- **B. Extend ThisOrThat** (David's existing repo, "maintaining", health 27/100). Add a deadline, a vote target and a share link there, rather than a new repo. Effort S, reuses the code. It stays consumer-only, which is the unmonetisable segment.
- **C. Ideal: a full swipe marketplace** with a feed, credits and a paid tier (the PRD). Effort L, risk high because of moderation and cold start.
- **D. Lateral: skip the product and run a concierge test.** Offer to run a manual seller poll (Reddit/Etsy forum votes, tallied by hand) for $5. This tests the willingness to pay before any code.

Recommendation: if David wants this at all, start with D, then fold the result into ThisOrThat (B). Don't build C.

## Scope challenge (SCOPE REDUCTION)
The narrowest version worth testing is one shareable A/B poll with a close rule and a result page, used by sellers on their own audiences. Everything in M2/M3 (feed, credits, moderation, Stripe, CSV) is deferred until someone pays. This is also close to existing code (ThisOrThat), so building a new product is a rebuild.

## M1 feasibility
- One person can build M1 in a weekend: Next.js, Supabase or Neon free, framer-motion. Every M1 exit criterion is a plain API test.
- $0: yes. Vercel Hobby and a free Postgres.
- The one test that proves M1: three distinct voters POST votes, the poll closes with the majority winner, and a repeat voter gets a 409.
- The real unknown isn't technical: it is whether anyone pays.

## Risks
- Cold start: with no voters a poll never closes.
- Stranger-vote quality, and no reasons given.
- Image moderation of stranger uploads (a solo-developer burden, and illegal content is a risk).
- Platform-native testing replaces the use case.
- Overlap with ThisOrThat, which already has low health, so a second app adds maintenance overhead.
- Competes with a funded incumbent (PickFu) on its home ground.

## Kill criteria
Drop it if any holds after a two-week test:
- fewer than 50 visitors judged, or under 5% waitlist signup from seller communities;
- no seller offers $5 or pre-pays one poll;
- most sellers ask for vetted demographics or written reasons;
- public polls rarely reach their vote target within 24 hours.

## What M1 users should be watched doing
A seller posting a real image pair, sharing the link, and seeing whether the verdict changes the listing. Watch whether they come back with a second poll, and what they ask for next (reasons, demographics, privacy).

## The assignment
Don't build. Post in one Etsy seller forum offering a hand-tallied A/B verdict for $5. If three sellers send real image pairs, revisit.
