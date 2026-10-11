# tiebreak — research

## Summary
Indecisive people (and small sellers/creators) post two options; strangers swipe left/right to pick one; the poll closes at N votes or a deadline. The consumer version is a crowded, hard-to-monetise social app; the paid wedge is sellers and creators who already pay for fast "which one wins" verdicts on images and titles.
Free consumer use is the growth loop; paid use is the business.

## Evidence of the problem
- Etsy sellers repeatedly post photo candidates in the community forum and ask strangers to rank them, and the replies disagree: https://community.etsy.com/t5/Etsy-Success/Which-picture-do-you-think-is-best/m-p/57028318 and https://community.etsy.com/t5/Etsy-Success/Quicky-question-photo-comparison/m-p/49663478/highlight/true
- Forum threads are slow and unstructured (a handful of replies, no tally, no deadline), which is the gap a swipe poll with a vote target fills.
- Swipe-to-vote is an established format for group decisions (the Agree app) and for political questions (VoteSwiper, CandiDate): https://alternativeto.net/software/agree/about

## Who pays
- Buyer: solo e-commerce sellers (Etsy/Amazon), authors choosing covers, YouTube creators choosing thumbnails.
- Price point: $5–$9 per poll, or $12/mo for a handful of polls. That is below PickFu's price.
- Evidence they pay today: PickFu charges per poll starting at $15, with no subscription, and lists e-commerce sellers, authors and app developers as users: https://www.pickfu.com/help/what-is-pickfu . Third-party listings quote $50 per poll and PickFu+ at $99/mo, so the real price is uncertain: https://www.capterra.com.sg/software/175737/instant-market-research
- Creators pay for thumbnail testing: TubeBuddy's A/B testing is on its Legend plan, about $23/mo billed annually or $49/mo monthly (sources conflict, and the aggregators are affiliate sites): https://inspiretothrive.com/tubebuddy/
- Brands have paid for polls on Wishbone, which monetised through sponsored polls: https://digiday.com/brands/brands-stump-teen-votes-wishbone
- Consumers are unlikely to pay. Agree sells for a one-time $3: https://alternativeto.net/software/agree/about

## Competitors & alternatives
| Name | Price | Gap |
|---|---|---|
| PickFu | from $15/poll (listings say $50) | Written responses from a paid panel; slow and costly for a quick A/B. Not a consumer app. |
| Agree | $3 one-time, free tier | Private groups only, so no stranger votes. |
| Wishbone | Free, ad and sponsor funded | Teen audience, entertainment polls, no deadline or vote target. |
| TubeBuddy Legend | ~$23–49/mo | YouTube only, tests live traffic, slow. |
| Etsy forums / Reddit | Free | No tally, replies disagree, slow. |

## Technical notes
- Swipe UI: a React or PWA card stack (framer-motion or a swipe library). No native app is needed for M1.
- Poll close rule: close at N votes or at the deadline, whichever comes first, enforced server-side.
- Vote integrity: one vote per device or account per poll, and rate limiting. Voters are anonymous.
- Cold start is the hard part: voters need something to swipe. Seed the feed with the creator's own audience link and a "vote on 5 to post 1" credit loop.
- Storage: Postgres on a free tier (Supabase or Neon).

## Risks & open questions
- Two-sided cold start: no voters means a poll never closes.
- Stranger votes may be low quality, and PickFu's value is vetted demographic panels plus reasons.
- Consumer indecision polls may be fun but unmonetisable.
- Safety and moderation: image uploads from strangers need reporting and filtering.
- Unknown: whether sellers trust an anonymous crowd over their own audience.

## Sources
- https://alternativeto.net/software/agree/about
- https://www.pickfu.com/help/what-is-pickfu
- https://www.capterra.com.sg/software/175737/instant-market-research
- https://inspiretothrive.com/tubebuddy/
- https://digiday.com/brands/brands-stump-teen-votes-wishbone
- https://community.etsy.com/t5/Etsy-Success/Which-picture-do-you-think-is-best/m-p/57028318
- https://community.etsy.com/t5/Etsy-Success/Quicky-question-photo-comparison/m-p/49663478/highlight/true
