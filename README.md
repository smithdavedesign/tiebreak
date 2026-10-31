# tiebreak — swipe-to-decide polls for indecisive people and sellers

## Screenshots

![The share card of an open poll: its question and both uploaded mug photos](docs/screenshots/card-open.png)

What a poll's link now unfurls as in chats and on social sites (its `og:image` and `twitter:image`, drawn by `GET /p/:id/card` at 1200×630): the poll's own question and both of the seller's photos, not plain text.

![The same poll's card once it closed: the winner marked, 67% to 33%](docs/screenshots/card-result.png)

Once the poll closes, the same link's card shows the result: the winner framed and labelled, and each option's share of the 3 votes.

![A stranger who voted on the shared link, offered "Make your own tiebreak", desktop](docs/screenshots/voted-desktop.png)
![A stranger who voted on the shared link, offered "Make your own tiebreak", phone](docs/screenshots/voted-mobile.png)

A stranger opened the shared link and voted (the core action for a voter); the page now offers "Make your own tiebreak".

![The start page the link opens (/?ref=poll), desktop](docs/screenshots/home-desktop.png)
![The start page the link opens (/?ref=poll), phone](docs/screenshots/home-mobile.png)

Following it opens the start page at `/?ref=poll`, where they can post their own poll; the visit counter records the `ref=poll` tag.

Regenerate them with `npm run screenshots` (set `CHROMIUM_PATH` to a Chromium binary; it starts the dev server on an in-memory database, with sample data only; the two mug photos are drawn in the browser). The cards are images, so they're taken once, at desktop size.

![Etsy thumbnail preview with three mug photos in the search-grid mock at the 1:1 and 4:3 crops, desktop](docs/screenshots/tool-desktop.png)
![Etsy thumbnail preview with three mug photos listed and the 1:1 search grid, phone](docs/screenshots/tool-mobile.png)

The free Etsy thumbnail preview (`/tools/etsy-thumbnail-preview`): three listing photos added, each shown side by side in a search-grid mock at 1:1, 4:3 and 5:4 (5:4 is below the fold). The previews are drawn in the browser; nothing has been uploaded yet.

![The new-poll form after Let strangers pick, the three photos as options A–C, desktop](docs/screenshots/form-desktop.png)
![The new-poll form after Let strangers pick, the three photos as options A–C, phone](docs/screenshots/form-mobile.png)

"Let strangers pick" uploaded the three photos and opened the new-poll form with them as options A–C and the tool's question filled in; the seller added a label to each and set a 3-vote target.

![Closed three-photo poll with the winning photo and the vote split, desktop](docs/screenshots/result-desktop.png)
![Closed three-photo poll with the winning photo and the vote split, phone](docs/screenshots/result-mobile.png)

The poll it posted, closed: two strangers voted on the shared link, the creator tapped the third vote, and the result shows the winning photo and the split (2, 0, 1).

These tool shots came from the thumbnail-tools PR (#13); `npm run screenshots` now regenerates the share-card flow above. `tests/thumbnail-tools-browser.test.ts` drives all three tools in Chromium.

People post two options, strangers swipe to pick one, and the poll closes at a vote target or deadline; sellers and creators pay a few dollars for a fast verdict instead of PickFu's $15+.

- [Research](RESEARCH.md) — findings and sources
- [PRD](PRD.md)
- [Roadmap](ROADMAP.md)
- [Native app](mobile/README.md): iPhone and Android (Expo), on the same API. Run it on your phone with Expo Go.

Effort: Medium · Confidence: Low

_Researched by the idea pipeline on 2026-10-11 ([original record](https://github.com/smithdavedesign/idea-factory/tree/main/ideas/tiebreak)); repo created on David's go-ahead 2026-10-11._

## Starter content (house polls)
The public feed is stocked with 40 funny "house" polls (`lib/house.ts`: horse-sized duck, is a hot dog a sandwich, …). Each question keeps one open public poll; when it closes, the next feed read posts a fresh copy, so the feed never runs dry. People's polls always come first, and anyone who voted on a house question doesn't see it again. Edit the list to change them; `HOUSE_POLLS=off` in the Vercel env turns them off.
