# tiebreak — swipe-to-decide polls for indecisive people and sellers

## Screenshots

![Etsy thumbnail preview with three mug photos in the search-grid mock at the 1:1 and 4:3 crops, desktop](docs/screenshots/tool-desktop.png)
![Etsy thumbnail preview with three mug photos listed and the 1:1 search grid, phone](docs/screenshots/tool-mobile.png)

The free Etsy thumbnail preview (`/tools/etsy-thumbnail-preview`): three listing photos added, each shown side by side in a search-grid mock at 1:1, 4:3 and 5:4 (5:4 is below the fold). The previews are drawn in the browser; nothing has been uploaded yet.

![The new-poll form after Let strangers pick, the three photos as options A–C, desktop](docs/screenshots/form-desktop.png)
![The new-poll form after Let strangers pick, the three photos as options A–C, phone](docs/screenshots/form-mobile.png)

"Let strangers pick" uploaded the three photos and opened the new-poll form with them as options A–C and the tool's question filled in; the seller added a label to each and set a 3-vote target.

![Closed three-photo poll with the winning photo and the vote split, desktop](docs/screenshots/result-desktop.png)
![Closed three-photo poll with the winning photo and the vote split, phone](docs/screenshots/result-mobile.png)

The poll it posted, closed: two strangers voted on the shared link, the creator tapped the third vote, and the result shows the winning photo and the split (2, 0, 1).

Regenerate them with `npm run screenshots` (set `CHROMIUM_PATH` to a Chromium binary; it starts the dev server on an in-memory database, with sample data only; the three mug photos are drawn in the browser). The book-cover and YouTube tools aren't in the shots; `tests/thumbnail-tools-browser.test.ts` drives all three in Chromium.

People post two options, strangers swipe to pick one, and the poll closes at a vote target or deadline; sellers and creators pay a few dollars for a fast verdict instead of PickFu's $15+.

- [Research](RESEARCH.md) — findings and sources
- [PRD](PRD.md)
- [Roadmap](ROADMAP.md)
- [Native app](mobile/README.md): iPhone and Android (Expo), on the same API. Run it on your phone with Expo Go.

Effort: Medium · Confidence: Low

_Researched by the idea pipeline on 2026-10-11 ([original record](https://github.com/smithdavedesign/idea-factory/tree/main/ideas/tiebreak)); repo created on David's go-ahead 2026-10-11._

## Starter content (house polls)
The public feed is stocked with 40 funny "house" polls (`lib/house.ts`: horse-sized duck, is a hot dog a sandwich, …). Each question keeps one open public poll; when it closes, the next feed read posts a fresh copy, so the feed never runs dry. People's polls always come first, and anyone who voted on a house question doesn't see it again. Edit the list to change them; `HOUSE_POLLS=off` in the Vercel env turns them off.
