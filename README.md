# tiebreak — swipe-to-decide polls for indecisive people and sellers

## Screenshots

![Start page with a poll filled in, desktop](docs/screenshots/home-desktop.png)
![Start page with a poll filled in, phone](docs/screenshots/home-mobile.png)

The core action, posting a poll: a question, two options and a vote target, no sign-up.

![Closed poll with the winner and vote split, desktop](docs/screenshots/result-desktop.png)
![Closed poll with the winner and vote split, phone](docs/screenshots/result-mobile.png)

Its result: two strangers voted on the shared link, the creator swiped the third vote, and the poll closed with the winner and the split (2 to 1).

![Pro page with the Buy button and the footer links, desktop](docs/screenshots/buy-desktop.png)
![Pro page with the Buy button and the footer links, phone](docs/screenshots/buy-mobile.png)

The Buy button ("Get Pro for $5", shown because `STRIPE_PAYMENT_LINK` is set, here to a placeholder) and the footer's Privacy and Terms links.

Regenerate them with `npm run screenshots` (set `CHROMIUM_PATH` to a Chromium binary; it starts the dev server on an in-memory database, with sample data and a placeholder payment link only).

People post two options, strangers swipe to pick one, and the poll closes at a vote target or deadline; sellers and creators pay a few dollars for a fast verdict instead of PickFu's $15+.

- [Research](RESEARCH.md) — findings and sources
- [PRD](PRD.md)
- [Roadmap](ROADMAP.md)
- [Native app](mobile/README.md): iPhone and Android (Expo), on the same API. Run it on your phone with Expo Go.

Effort: Medium · Confidence: Low

_Researched by the idea pipeline on 2026-10-11 ([original record](https://github.com/smithdavedesign/idea-factory/tree/main/ideas/tiebreak)); repo created on David's go-ahead 2026-10-11._

## Starter content (house polls)
The public feed is stocked with 40 funny "house" polls (`lib/house.ts`: horse-sized duck, is a hot dog a sandwich, …). Each question keeps one open public poll; when it closes, the next feed read posts a fresh copy, so the feed never runs dry. People's polls always come first, and anyone who voted on a house question doesn't see it again. Edit the list to change them; `HOUSE_POLLS=off` in the Vercel env turns them off.
