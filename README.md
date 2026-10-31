# tiebreak — swipe-to-decide polls for indecisive people and sellers

## Screenshots

![The Etsy listing photo tester with three candidate mug photos as square tiles in the mock Etsy search grid, desktop](docs/screenshots/etsy-grid-desktop.png)
![The same three photos in the mock search grid, two to a row, phone](docs/screenshots/etsy-grid-mobile.png)

The free Etsy listing photo tester (`/tools/etsy-listing-photo-test`): a landscape, a portrait and a square photo, each cropped square under the seller's listing title and price, drawn on the device with nothing uploaded yet.

![The new-poll form that "Let strangers pick" opens, with the three photos as options A–C, desktop](docs/screenshots/etsy-poll-form-desktop.png)
![The new-poll form with the photos as options, phone](docs/screenshots/etsy-poll-form-mobile.png)

The core action: "Let strangers pick" opens the usual new-poll form with the photos as options A–C and the question filled in.

![The posted poll showing all three uploaded photos to vote on, desktop](docs/screenshots/etsy-poll-desktop.png)
![The posted poll with all three photos, phone](docs/screenshots/etsy-poll-mobile.png)

Its result: posting it uploads the three photos and opens the poll, where each one loads from tiebreak for strangers to pick from.

Regenerate them with `npm run screenshots` (set `CHROMIUM_PATH` to a Chromium binary; it starts the dev server on an in-memory database, with sample data only; the three mug photos are drawn in the browser).

People post two options, strangers swipe to pick one, and the poll closes at a vote target or deadline; sellers and creators pay a few dollars for a fast verdict instead of PickFu's $15+.

- [Research](RESEARCH.md) — findings and sources
- [PRD](PRD.md)
- [Roadmap](ROADMAP.md)
- [Native app](mobile/README.md): iPhone and Android (Expo), on the same API. Run it on your phone with Expo Go.

Effort: Medium · Confidence: Low

_Researched by the idea pipeline on 2026-10-11 ([original record](https://github.com/smithdavedesign/idea-factory/tree/main/ideas/tiebreak)); repo created on David's go-ahead 2026-10-11._

## Starter content (house polls)
The public feed is stocked with 40 funny "house" polls (`lib/house.ts`: horse-sized duck, is a hot dog a sandwich, …). Each question keeps one open public poll; when it closes, the next feed read posts a fresh copy, so the feed never runs dry. People's polls always come first, and anyone who voted on a house question doesn't see it again. Edit the list to change them; `HOUSE_POLLS=off` in the Vercel env turns them off.
