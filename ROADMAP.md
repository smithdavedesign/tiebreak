# tiebreak — roadmap

## M1 — Poll, swipe, close (one weekend)
Deliverables: poll creation, swipe voting page, server-side close rule, result page.
Exit criteria (testable):
- POST /polls with 2 options, target 3 and a 24h limit returns an id and a share URL.
- Three different voters POST /polls/:id/votes and the poll status becomes closed with the winner equal to the majority option.
- A second vote from the same voter returns 409 and the count is unchanged.
- A poll past its deadline with 1 vote closes as closed with that vote's option as the winner, and a poll with zero votes closes as no_result.
- A vote on a closed poll returns 410.

## M2 — Feed and credits
Deliverables: public feed, "vote 5 to post 1" credits, report button.
Exit criteria:
- A new account has 0 posting credits and cannot create a public poll; after 5 votes it has 1.
- A poll with 3 reports is hidden from the feed.

## M3 — Paid tier
Deliverables: Stripe checkout, private polls, CSV export.
Exit criteria:
- A free account cannot create a private poll (403); a paid account can.
- Export of a closed poll returns a CSV whose row count equals the vote count.

## M4 — Native app for iPhone and Android
Added 2026-10-12 on David's request ("it needed to be a native app that could be used on Android or iOS iPhone"). M1–M3 stay as the backend and the web version.
Deliverables: an Expo (React Native) app in `mobile/` with the feed (swipe cards), the poll screen (vote, result, share, report), poll creation and the account screen, all talking to the existing API. Anonymous identity through an `x-tiebreak-voter` header kept in secure storage.
Exit criteria:
- The API identifies the same account by `x-tiebreak-voter` as by the `tb_voter` cookie. A vote by header shows as `myVote` to the cookie and vice versa, a second vote by header is a 409, and a new account's id comes back in the header (`tests/native-identity.test.ts`).
- The app's API client stores the minted id and sends it on every later request (`mobile/__tests__/api-test.ts`).
- Swiping follows the web rule: left past 80 px is A, right is B. Polls with 3 or 4 options vote by button.
- The create form rejects what the server's `parseNewPoll` rejects.
- `npx expo export` builds both the iOS and Android bundles, and `npx expo-doctor` passes.

## Suggested stack
- Next.js PWA: one codebase for swipe UI and API, easy free hosting.
- Supabase Postgres: free tier, built-in auth, row-level security.
- framer-motion: simple card swipe gestures.
- Stripe Checkout: paid tier without building billing.
