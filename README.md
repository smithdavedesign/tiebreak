# tiebreak — swipe-to-decide polls for indecisive people and sellers

## Screenshots

![Start page with a photo picked for each option, thumbnails showing, desktop](docs/screenshots/home-desktop.png)
![Start page with a photo picked for each option, thumbnails showing, phone](docs/screenshots/home-mobile.png)

The core action, posting a poll, now with photos: each option has "Upload a photo" (JPEG, PNG or WebP, up to 5 MB), and the picked photo shows as a thumbnail in its option before anything is sent.

![The new poll's swipe card with both uploaded photos, desktop](docs/screenshots/poll-desktop.png)
![The new poll's swipe card with both uploaded photos, phone](docs/screenshots/poll-mobile.png)

The poll it posted: both photos were uploaded with the poll and now load from tiebreak itself, on the card people swipe.

![Closed poll with the winning photo and the vote split, desktop](docs/screenshots/result-desktop.png)
![Closed poll with the winning photo and the vote split, phone](docs/screenshots/result-mobile.png)

Its result: two strangers voted on the shared link, the creator swiped the third vote, and the poll closed with the winning photo and the split (2 to 1).

Regenerate them with `npm run screenshots` (set `CHROMIUM_PATH` to a Chromium binary; it starts the dev server on an in-memory database, with sample data only; the two mug photos are drawn in the browser).

People post two options, strangers swipe to pick one, and the poll closes at a vote target or deadline; sellers and creators pay a few dollars for a fast verdict instead of PickFu's $15+.

- [Research](RESEARCH.md) — findings and sources
- [PRD](PRD.md)
- [Roadmap](ROADMAP.md)
- [Native app](mobile/README.md): iPhone and Android (Expo), on the same API. Run it on your phone with Expo Go.

Effort: Medium · Confidence: Low

_Researched by the idea pipeline on 2026-10-11 ([original record](https://github.com/smithdavedesign/idea-factory/tree/main/ideas/tiebreak)); repo created on David's go-ahead 2026-10-11._

## Starter content (house polls)
The public feed is stocked with 40 funny "house" polls (`lib/house.ts`: horse-sized duck, is a hot dog a sandwich, …). Each question keeps one open public poll; when it closes, the next feed read posts a fresh copy, so the feed never runs dry. People's polls always come first, and anyone who voted on a house question doesn't see it again. Edit the list to change them; `HOUSE_POLLS=off` in the Vercel env turns them off.
