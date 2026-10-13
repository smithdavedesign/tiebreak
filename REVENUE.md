# tiebreak: road to first revenue

**Bottom line:** the evidence that anyone will pay is weak (review score 4/10, and nobody has asked for this or paid). The product is built and live (https://tiebreak-phi.vercel.app), so the cheapest next step is a $5 test, not more building. Evidence strength: **low**. The pain is real (two Etsy threads). Willingness to pay is inferred only from PickFu's pricing.

## Who pays (forcing question 1: a person with a budget)
A solo Etsy seller (a one-person shop, roughly 10–200 listings) who is about to publish or change a main listing photo and can't decide between 2–4 candidates. They control a small budget (their own shop money, $5 is a rounding error), and the decision is theirs alone. Findable today: people who post "which picture is best?" in the Etsy Community forum and r/EtsySellers. Secondary: indie authors choosing a cover and YouTubers choosing a thumbnail, but sellers are the narrowest group I can actually locate.

I can't name a person. The honest statement is "someone who posts a photo-comparison thread this week". Finding one named seller who says yes is the first milestone.

## What they pay today (forcing question 2)
- **Free:** Etsy forum and Reddit threads, friends and family. Slow, no tally, replies disagree (the two Etsy threads in the research). This is the real competitor, and it costs $0.
- **PickFu:** official help center says $1 per response, $15 minimum per poll, with extras for targeting. PickFu+ starts at $99/month in prepaid credit or $999/year. Third-party pages (Capterra at $50, RevenueGeeks at $79/month) disagree with each other and with the official figures, so I'm using the official $15 floor. ([PickFu pricing](https://www.pickfu.com/help/how-does-pickfu-s-pricing-work), [Capterra](https://www.capterra.com/p/175737/Instant-Market-Research/))
- **Etsy-specific testing:** Sale Samurai quotes $19.99/month for an A/B listing tester, per a third-party review (unverified). That tests live traffic, which is a different thing from a pre-publish poll.
- **TubeBuddy Legend** for thumbnails, about $23–49/month (aggregator sources, conflicting).

So a paying buyer's reference points are $15 per poll (PickFu) and about $20/month (listing tools). A free substitute (forums) is always there. A $5 price sits under the PickFu floor, which is the only anchor with an official source.

## Narrowest version worth paying for (forcing question 4)
The review's own scope challenge says the stranger feed has a cold-start problem and that without it this is a nicer Strawpoll. So don't sell the feed. Sell one thing: **"Send me your 2–4 images, get a clear verdict by a deadline, for $5."**

The app already supports polls with a vote target, a close rule, a result page and a share link. Two ways to deliver the verdict, in order of preference:
1. **Concierge first (a few days, no new code):** the seller pays $5 via a Stripe payment link, sends their images, and David creates the poll in the live app and seeds votes by posting the link in a relevant community. Tally goes back to the seller. This tests willingness to pay before building billing. It is exactly the review's assignment D.
2. **Self-serve only after 3 people have paid:** wire the paid tier (private poll, higher vote target, CSV) behind a Stripe webhook. M3 code exists, but the webhook mapping in RepoHQ is not done.

## Price
**$5 once per poll**, as a Stripe Checkout payment link. Why: it is a third of PickFu's $15 floor, it matches the PRD's own success test ("3 of 20 pay $5 or more") and the review's "$5 pre-paid poll" evidence bar. I'm not proposing a subscription: usage is occasional (one decision at a time) and there is no evidence of repeat need. Revisit $12/month only if someone buys a second poll within 30 days.

## What must work before asking for money
- The live site loads; poll creation, voting, close and result page work on phone and desktop (done per the build notes, M1–M4 merged).
- Privacy and terms pages (done, live).
- A Stripe payment link for the $5 product, plus a one-line promise on the checkout page: "verdict within 48 hours or refund".
- A refund path (Stripe dashboard refund, by hand).
- A way to receive the images (reply email or form). Don't ask for images before payment on a public thread.
- Moderation: images from strangers. For the concierge version, David only posts images the seller sent, which keeps this manageable.

## How to get the first ten users (forcing question 3, by place)
1. Etsy Community "Etsy Success" threads titled like "Which picture is best?" (the two threads cited in the research are recent examples). Reply with a useful vote on their pair first, then offer the tally service. Check forum rules on promotion.
2. r/EtsySellers: answer photo-feedback posts the same way.
3. r/PartneredYoutube and r/NewTubers for thumbnails; r/selfpublish for covers. Offer a free poll to the first three posters in exchange for permission to cite results, then charge the next.
4. Direct messages to people from those threads who asked in the last 30 days.
Target: 5 free pilots (to learn what they ask for) and 5 asked to pay $5. Free pilots are for learning, not revenue; don't count them as demand.

## Risks
- **Free forums are good enough.** The pain is small and occasional; the status quo costs $0.
- **Cold start.** The paid verdict only works if David can actually deliver N votes. A poll that never closes means a refund. Votes come from the seller's own audience or the communities above, not an organic feed.
- **Trust.** Sellers may not act on anonymous votes. PickFu sells vetted demographics and written reasons; tiebreak has neither. If buyers ask for these, they want PickFu.
- **Platform-native testing** (YouTube thumbnail tests, Amazon experiments) shrinks the use case over time.
- **Community self-promotion rules** can get posts removed or accounts banned. Read each community's rules; lead with help, not a link.
- **Moderation and legal exposure** from stranger-uploaded images.
- **Pricing evidence is conflicted.** PickFu figures vary by source. Only the official page is used here.
- **Overlap** with David's ThisOrThat repo.

## Kill criteria
Stop after 14 days of active posting if any of these holds: fewer than 50 relevant sellers/creators saw the offer, no one pays $5 (zero paid out of 10 asked), most replies ask for demographics or written reasons, or polls rarely reach their vote target within 24 hours. If zero pay, don't build the self-serve tier; park the repo or fold the useful bits into ThisOrThat.

## Next actions for David
1. Create the Stripe product ($5, one time) and a payment link.
2. Put a "Get a verdict for $5" link on the live site and in the launch posts.
3. Post a helpful reply in 3 photo-comparison threads this week.
4. Record every ask, objection and payment in this folder.
