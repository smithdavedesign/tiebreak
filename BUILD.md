# tiebreak — build notes

## Plan

This is M3 of 3 in the MVP run: the paid tier. M1 and M2 were built earlier in this session, and their tests keep passing. One M2 test case changes on purpose (see Decisions). The owner's note about the lost 01:13 patch applies as before: the tree stays plain to `git add`, with no symlinks or nested repos and generated files git-ignored. The new route folder `app/polls/[id]/export` uses brackets, so see "Committing" below.

ROADMAP M3 exit criteria:
- **EC1.** A free account can't create a private poll (403). A paid account can.
- **EC2.** Export of a closed poll returns a CSV whose row count equals the vote count.

### Step 0: Scope challenge

1. **Existing code that solves part of this.**
   - **Identity.** The account is M2's anonymous `tb_voter` cookie. Stripe's `client_reference_id` carries it through Checkout, so paying needs no login.
   - **Visibility.** `visibility` is already an enum with an exhaustive `Record<Visibility, …>` price table. `private` is one more value plus one more row, and the compiler finds every consumer.
   - **"Not allowed yet" is already a 403.** M2 returns 403 for a public poll without a credit, and M3 reuses that pattern for "not Pro".
   - **Lazy close.** The export calls `getPoll()`, so a poll past its deadline closes before it's exported.
   - **Derived state.** M2 derives credits from rows, so M3 derives Pro the same way: `EXISTS (a payment for this account)`. There's no flag to keep in sync.
   - **Postgres built-ins.** A primary key on the Stripe session id makes fulfilment idempotent across webhook retries and the webhook/success-page race **[Layer 1]**.
   - **Stripe Checkout** hosts the payment page, card handling, receipts and email collection **[Layer 1]**. There's no billing UI to build.
2. **Minimum change set.**
   - **Schema:** `private` added to the visibility check, plus one `payments` table.
   - **Two new modules:**
     - `lib/stripe.ts`: three REST calls and webhook signature checks, with no DB access;
     - `lib/plans.ts`: plan lookup and idempotent fulfilment.
   - **One 20-line helper,** `lib/csv.ts`.
   - **`lib/polls.ts`:** the `private` visibility, results hidden from everyone but the creator, and `exportVotes()`.
   - **Three new routes:** `POST /checkout`, `POST /stripe/webhook` and `GET /polls/:id/export`. `GET /account` gains `plan`.
   - **Two new pages:**
     - `/pro`, for upgrading and returning from Checkout;
     - `/terms`, with terms, refunds and privacy. These have to exist before charging.
   - **UI:**
     - a private checkbox for Pro accounts (an upsell link for everyone else);
     - an export link on the creator's closed poll;
     - the private-result notice;
     - nav and footer links.
3. **Complexity check.** About 20 files are touched, so the smell triggers. The logic is in three small modules plus `lib/polls.ts`. The rest are Next.js conventions (one file per route or page) and edits to existing UI. There are no classes, and the only new service is Stripe, which the roadmap names.
   - **Considered and rejected:**
     - the `stripe` SDK (see 4);
     - a subscription, which brings lifecycle webhooks, a customer portal and cancellations;
     - an `accounts` table, since Pro is derived;
     - a separate `private: true` flag, which would allow the invalid combination "public and private".
4. **Search check.** WebSearch on docs.stripe.com:
   - **Webhook signatures.** Stripe documents the manual check: HMAC-SHA256 of `"{t}.{raw body}"` with the endpoint secret, only `v1` signatures, a constant-time comparison, and a 5-minute tolerance. It's built with `node:crypto` in about 25 lines.
     - **Why not the SDK:** we need three endpoints and one check, and the SDK is one more dependency to vet. Its HTTP client is also harder to stub than `fetch`.
     - **Footgun handled:** the signature covers the raw body, so the route reads `request.text()` before anything parses it.
   - **Fulfilment.** Stripe's "Fulfill orders" guide says to fulfil from both the webhook and the success-page landing, through one function that's safe to call repeatedly and concurrently, whenever `payment_status` isn't `unpaid`. Delayed payment methods add `checkout.session.async_payment_succeeded`. All of that is implemented, with idempotency from the primary key.
   - **`success_url` must contain the literal `{CHECKOUT_SESSION_ID}`.** It's built as a string, not through `URL`, which would percent-encode the braces. A test covers it.
   - **[EUREKA-lite] Shared Stripe accounts.** A webhook endpoint receives every checkout on the Stripe account, and David runs several ideas. A session from another product with a UUID reference would otherwise grant Pro to an arbitrary id. Sessions are tagged `metadata.app = "tiebreak"`, and fulfilment ignores anything else.
5. **TODOS.** There's no TODOS.md. Deferred items are listed below and under "What's left".
6. **Completeness.** Every error path is built and tested:
   - polls: 400, 403, 415;
   - export: 403, 404, 409;
   - checkout: 409, 415, 502, 503;
   - webhook: 400, 503.
   - Also covered: idempotent and concurrent fulfilment, the M2→M3 database upgrade, and CSV quoting and formula injection.
7. **Distribution.** It's the same web app on Vercel Hobby with no new artifact. The only new infrastructure is a Stripe account, requested for David in `.provision`. Stripe has no monthly fee: test mode is free, and live mode only takes a cut of each payment. So the $0 rule holds.

**In scope (M3):**
- Stripe Checkout for a one-time Pro upgrade, fulfilled from the webhook and from the return page;
- private polls (Pro only);
- CSV export of a closed poll (Pro, creator only);
- `/pro` and `/terms`.

**Deliberately not in M3:**
- **Higher vote targets.** The PRD lists them under the paid tier, but ROADMAP's M3 deliverables don't. Raising `MAX_TARGET` per plan is the follow-up.
- **Subscriptions, per-poll passes, coupons and quantity.**
- **Automatic refunds and revoking Pro.** The owner refunds in Stripe and deletes the payment row.
- **Account recovery and cross-device Pro.** Pro lives in the cookie, as credits do.
- **Stripe Tax and invoices.**
- **The Stripe SDK.**
- **A CI workflow and browser tests.**

### Decisions (nobody to ask, so decided here)

| Question | Decision | Why |
|---|---|---|
| Pricing model | One Stripe payment makes the account Pro, with no expiry. The price lives in Stripe (`STRIPE_PRICE_ID`, a one-time price). Suggested: **$9**. | The kill criterion is "no seller pays $5". REVIEW Q2 says use is occasional ("one decision, occasionally"), which suits one payment better than a subscription. A subscription needs renewal and cancellation webhooks and a portal. $9 meets the PRD's "$5 or more" and is under one PickFu poll ($15+). Per poll vs monthly stays an open PRD question: changing it means a new Stripe price plus a small code change. |
| What is "a paid account"? | An account id with at least one recorded payment. `plan` is `free` or `pro`, derived on read, and only ever goes from free to pro. | One source of truth. Because Pro can't be lost mid-request, checking it needs no lock. |
| What does `private` mean? | Link-only like `unlisted`, and never in the feed. Only the creator sees the winner and the split, even after it closes. Others see the status, the vote count and their own vote. | M2 said `private` must mean more than `unlisted`. A seller doesn't want competitors or the public to see which photo won. Invite lists were rejected because they need identities. |
| What a private poll costs | Pro, and no posting credit. Pro doesn't grant feed credits either: a Pro account still needs a credit to post publicly. | Paying shouldn't let anyone skip the feed's give-to-get rule, or the feed fills with paid polls nobody voted for. |
| Request and response shape | `POST /polls {visibility: "private"}` from a free account gets `403 {error, plan: "free"}`. Checks run in order: 415, then 400, then 403. | Same pattern as M2's no-credit 403. Invalid input gets the same answer whatever the plan. |
| **Changed M2 test case** | `tests/feed-credits.test.ts` listed `'private'` among invalid visibilities (400). M2 deliberately left `private` for M3. EC1 now makes it valid, so that case uses `'Private'` instead. That's still a 400 and now checks case sensitivity. The 403 and 201 cases are tested in `tests/m3-exit-criteria.test.ts`. | The roadmap supersedes the M2 placeholder. No assertion was dropped: the list has the same number of invalid values. |
| Where `plan` goes in the API | `GET /account` returns `{account, plan}`. The M2 `account` object is unchanged. | M2 clients and tests compare `account` exactly. A sibling key adds information without changing it. |
| Hidden results | For anyone but the creator, a private poll reports `winner: null` and `tally: null`, even once closed. API clients tell this apart from a tie by `visibility: "private"` and `mine: false`. No new field. | Enforced in one place (`viewOf`), so every path is covered: GET, the vote response and the page. |
| Export | `GET /polls/:id/export` → `200 text/csv` (attachment, `no-store`). Checks run in order: 404, then 403 (not the creator), then 403 (not Pro), then 409 (still open). A poll past its deadline is closed first. | The roadmap only asks about closed polls. Exporting an open poll would reveal the running tally, which M1 hides until close. |
| CSV format | Columns `vote,voted_at,option,option_text,option_image_url`, one row per vote in vote order. There's a header row, which isn't counted as a vote row. CRLF line endings and RFC 4180 quoting. A UTF-8 BOM so Excel reads non-ASCII text. Cells starting with `= + - @` (or a tab/CR) get a `'` prefix. Voter ids are **never** exported. | Sellers open it in Excel or Sheets. The cookie id is the voter's account, a bearer secret. Option text is user input, so it gets formula-injection guarding. |
| Whose polls can be exported | Any poll the Pro account created, including polls made before paying, and any visibility. | Pro is an account plan, not a per-poll flag. |
| Checkout | `POST /checkout {}` (JSON-only) → `200 {url}`, and the page sends the browser there. It mints the cookie if missing, because payment attaches to the account. `409` if already Pro, `503` if Stripe isn't configured, `502` if Stripe fails. | JSON-only blocks cross-site posts, as for every POST here. The 409 prevents paying twice. |
| Session parameters | `mode=payment`, the price with quantity 1, `client_reference_id=<account>`, `metadata[app]=tiebreak`, `success_url=/pro?session_id={CHECKOUT_SESSION_ID}`, `cancel_url=/pro`. | Stripe's documented pattern. The metadata tag is the shared-account guard. |
| Fulfilment | One function, `fulfilCheckout(session)`. It records a payment when `metadata.app` is `tiebreak`, `client_reference_id` is a valid account id, and `payment_status` is `paid` or `no_payment_required`. It runs `INSERT … ON CONFLICT (session_id) DO NOTHING`. It's called from the webhook (`checkout.session.completed`, `checkout.session.async_payment_succeeded`) and from `/pro?session_id=…`, which retrieves the session from Stripe with the secret key. It stores the buyer's email, amount and currency. | Follows Stripe's guide. The return page uses Stripe's own copy of the session, never the URL's claims, so a forged `session_id` can't grant Pro. The email is how a buyer is found for a refund. |
| Webhook replies | `503` when `STRIPE_WEBHOOK_SECRET` is unset, so Stripe keeps retrying until it's configured. `400` for a missing or bad signature, or a non-JSON body. `200 {received: true}` for everything else, including ignored events and sessions. | A 4xx/5xx makes Stripe retry, which is right for "not configured yet" and wrong for events we deliberately ignore. |
| Price on `/pro` | Read from Stripe (`GET /v1/prices/:id`, `no-store`) on each render and formatted with the currency's own decimals. If that fails, the page says "price shown at checkout". | The page and Checkout can't disagree. Stripe's account activation expects prices on the site. |
| Terms | `/terms` covers what Pro is, payment, a 14-day refund on request, acceptable use, privacy (what's stored, that Stripe handles cards, no ads or trackers) and contact. Contact is `CONTACT_EMAIL` if set, otherwise "reply to your Stripe receipt". **David should read it before going live.** | Stripe activation and buyers both need terms, a refund policy, privacy and a contact. |
| Losing Pro with the cookie | Said plainly on `/pro` and `/terms`: Pro belongs to this browser. If it's lost, reply to the receipt for a refund. | Same trade-off as M2 credits, now with money attached, so it's disclosed before payment. |

### 1. Architecture review

```
 Browser                          Next.js route / page                       lib                         External / Postgres
 /pro  "Upgrade" ── POST /checkout ──▶ checkout/route.ts ──▶ getPlan() ─────────▶ plans.ts ──┐
                                                         └─▶ createCheckoutSession ▶ stripe.ts ─┼──▶ api.stripe.com (fetch, secret key)
 Stripe Checkout (hosted) ◀── 302 to session.url                                              │
 Stripe ── POST /stripe/webhook ──▶ stripe/webhook/route.ts ─▶ readWebhook() ──▶ stripe.ts     │   (HMAC check, no network)
                                                         └─▶ fulfilCheckout() ─▶ plans.ts ──┼──▶ payments (session_id PK)
 /pro?session_id=… (return) ─────▶ pro/page.tsx ──────────▶ confirmCheckout() ─▶ plans.ts ──┤      ▲ retrieve session first
 / form ─ POST /polls {private} ─▶ polls/route.ts ────────▶ createPoll() ─────▶ polls.ts ──┼──▶ polls (visibility +private)
 /p/:id ─ GET /polls/:id/export ─▶ polls/[id]/export ─────▶ exportVotes() ────▶ polls.ts ──┘   votes  (rows → csv.ts)
```

Paying (both paths end in the same idempotent insert):
```
POST /checkout ─▶ Stripe session {client_reference_id: account, metadata.app: tiebreak} ─▶ {url}
buyer pays on checkout.stripe.com
  ├─ Stripe ─▶ POST /stripe/webhook   verify HMAC(t.body) ─▶ fulfilCheckout(event.data.object)
  └─ browser ─▶ GET /pro?session_id=cs_…  GET /v1/checkout/sessions/cs_… ─▶ fulfilCheckout(session)
fulfilCheckout: app tag ✓, account id ✓, payment_status ≠ unpaid ✓
  INSERT INTO payments … ON CONFLICT (session_id) DO NOTHING      -- retries and races are no-ops
plan = EXISTS (SELECT 1 FROM payments WHERE account_id = me)       -- free → pro, never back
```

- **Boundaries.**
  - `lib/stripe.ts` is the only file that knows Stripe: its URLs, form encoding, env names and signature scheme. It has no DB access.
  - `lib/plans.ts` holds the plan rule and fulfilment.
  - `lib/csv.ts` is pure.
  - Routes only parse HTTP, as before.
  - The secret key never leaves the server. Client components only get a formatted price string.
- **Coupling.**
  - There are no new npm dependencies.
  - `polls.ts` → `plans.ts` → `stripe.ts`. Nothing points back, so there are no cycles.
  - Client code imports only types and `lib/limits.ts`.
- **Data flow and bottlenecks.**
  - Plan checks are one indexed `EXISTS` (`payments(account_id)`).
  - Export is one ordered read of at most `MAX_TARGET` (100) votes.
  - `/pro` makes one Stripe call per render, plus one more on a Checkout return.
  - Nothing here sits on the vote path.
- **Scaling and single points of failure.**
  - If Stripe is down, upgrading fails with a clear 502 while everything else keeps working.
  - Without webhooks, the return page still fulfils.
  - Without the return page (the tab is closed), the webhook does.
- **Security.**
  - **Webhook.** HMAC with constant-time compare, a ±300s tolerance, and `v1` only. That blocks downgrade to `v0` and replays outside the window, and fulfilment is idempotent inside it.
  - **Return page.** It trusts only Stripe's API response, and the session id must match `^cs_[A-Za-z0-9_]+$` before it's used in a URL.
  - **Ownership.**
    - Export checks `creator_id` on the server.
    - Private results are hidden in `viewOf`.
    - Voter ids never reach the CSV.
    - `creator_id` still never leaves the server.
  - **Requests.** `POST /checkout` is JSON-only and has no body parameters, so its account comes only from the cookie.
- **Production failure scenarios.**
  1. *The buyer's tab closes before the redirect.* The webhook fulfils. Tested.
  2. *The webhook arrives late or is misconfigured.* The return page fulfils from Stripe's API. Tested.
  3. *The webhook and the return page fulfil at the same moment.* The primary key keeps one row. Tested concurrently.
  4. *A payment happens before `STRIPE_WEBHOOK_SECRET` is set.* The webhook returns 503 and Stripe retries for up to 3 days, while the return page still fulfils. Tested.
  5. *A checkout from another product on the same Stripe account.* No `app` tag, so it's ignored with 200. Tested.
  6. *A delayed payment method (bank debit).* `completed` arrives `unpaid` and is ignored. `async_payment_succeeded` fulfils. Tested.
  7. *Stripe is down or the price id is wrong.* Checkout gets 502 and the page shows the error. `/pro` shows "price shown at checkout". Tested.
  8. *The buyer clears cookies.* Pro is lost. This is disclosed up front, and the refund path is the receipt (Review, P2).
  9. *The first deploy runs against an M2 database.* The constraint swap and the new table run once under the schema lock, after which the sentinel skips them. Tested from an M2-shaped database.
  10. *A creator puts `=HYPERLINK(…)` in an option.* The CSV cell is prefixed with `'`. Tested.

### 3. Test plan

Vitest calls the real route handlers and page functions against in-process PGlite, as in M1 and M2. Stripe is faked at the `fetch` boundary, with env values built at runtime from a prefix and filler. Tests never need a real key.

| Exit criterion / codepath | Test |
|---|---|
| **EC1** A free account (no cookie, a fresh cookie, or one with posting credits) gets 403 `{plan: "free"}` for a private poll, and no private poll is created | `tests/m3-exit-criteria.test.ts` |
| **EC1** The same account pays: `POST /checkout` → a signed `checkout.session.completed` webhook → `plan: "pro"` → a private poll gets 201, and it isn't in the feed | same file |
| **EC2** A closed poll with 3 votes exports 3 data rows (plus the header) whose options match the votes | same file |
| **EC2** Closed by the deadline with 1 vote → 1 row; `no_result` → 0 rows | same file |
| Checkout: 415; cookie minted and used as `client_reference_id`; exact Stripe form (mode, price, quantity, metadata, literal `{CHECKOUT_SESSION_ID}`, cancel URL, Bearer key); 409 when Pro (Stripe not called); 503 without the key or price; 502 on a Stripe error or network failure | `tests/paid-tier.test.ts` |
| Webhook: 200 and Pro, with email, amount and currency stored; replay → one row; missing, wrong-secret, tampered, stale, future or `v0`-only signature → 400; a rotated secret (two `v1`) → 200; 503 without the secret; non-JSON → 400; unpaid → ignored, then `async_payment_succeeded` → Pro; `no_payment_required` → Pro; other event types, foreign sessions, bad account ids and malformed objects → 200, ignored | same file |
| Private polls: 400 before 403; `'Private'` → 400; a new account gets the cookie with its 403; Pro spends no credit and doesn't bypass credits for public polls; never in the feed; after close only the creator sees the winner and tally (GET, anonymous GET, the closing vote's response); votes on it still earn credits | same file |
| Export: 404 for unknown or malformed ids; 403 for non-creators (even Pro), anonymous callers and free creators; 409 while open; a poll past its deadline closes, then exports; headers; exact header row and cells; no voter ids; works on unlisted, public and private polls and on polls made before paying | same file |
| `GET /account` has `plan` (`free` anonymous or new, `pro` after paying) and leaves `account` unchanged | same file |
| Fulfilment race: webhook and return page at once → one payment | same file |
| Signature check (pure): valid, tampered, wrong secret, stale, future, `v0` only, rotated, garbage header, non-numeric `t` | `tests/stripe-csv.test.ts` |
| CSV (pure): quoting, quotes, CRLF and newlines, formula prefixes, nulls and numbers, BOM | same file |
| Price formatting (pure): USD, a zero-decimal currency (JPY), EUR | same file |
| Upgrading an M2-shaped database: existing polls keep their visibility; `private` works afterwards; the check still rejects unknown values; a second instance does one catalog read | `tests/m3-schema-upgrade.test.ts` |
| Pages, server-rendered as in M2: `/pro` (free with price and upgrade button, price fallback, Pro, return with a paid session → fulfilled, return with an unpaid session → "confirming", a malformed session id → no Stripe call); `/terms` (refunds, privacy, contact fallback and `CONTACT_EMAIL`); `/` (private checkbox for Pro, upsell for free); `/p/:id` (private result hidden from voters and shown to the creator, export link for a Pro creator, upsell for a free creator, nothing for others, the private "just created" notice) | `tests/pro-pages.test.ts` |

## M2 plan (built earlier in this session)

<details><summary>The M2 plan, kept for reference</summary>

This is M2 of 3 in the MVP run: feed and credits. M1 was built earlier in this session, and its 65 tests keep passing. The owner's note about the lost 01:13 patch applies the same way it did for M1. The tree stays plain to `git add`: no symlinks and no nested repos, and generated files are git-ignored. The new route folder `app/polls/[id]/reports` uses brackets, so see "Committing" below.

ROADMAP M2 exit criteria:
- **EC1.** A new account has 0 posting credits and can't create a public poll. After 5 votes it has 1.
- **EC2.** A poll with 3 reports is hidden from the feed.

### Step 0: Scope challenge

1. **Existing code that solves part of this.**
   - **Identity.** M1 already gives every browser a server-issued, httpOnly, random-UUID cookie (`tb_voter`). M2 treats it as the account, so nothing new is needed for sign-up.
   - **Votes.** The M1 `votes` table already records every vote per voter. Credits are derived from it: no counter column and no backfill **[Layer 1]**.
   - **Swipe card.** The M1 picker (swipe for 2 options, grid for 3–4) is reused for the feed.
   - **Postgres built-ins replace custom code:**
     - a composite primary key `(poll_id, reporter_id)` gives one report per account;
     - `pg_advisory_xact_lock` serialises spending a credit **[Layer 1]**;
     - `ALTER TABLE … ADD COLUMN IF NOT EXISTS` upgrades an M1 database with no migration tool.
2. **Minimum change set.**
   - `polls` gets two columns: `visibility` (`unlisted` by default, or `public`) and `creator_id`.
   - One new table, `reports`.
   - One new module, `lib/credits.ts`.
   - Two new API routes: `POST /polls/:id/reports` and `GET /account`.
   - `GET /polls` is added to the existing route file and returns the public feed.
   - One new page, `/feed`.
   - UI changes: a "post to the public feed" checkbox on the create form, a report button, and a credit meter.
3. **Complexity check.** About 15 source files are touched, so the smell triggers. The logic is still in two modules: `lib/polls.ts` (feed, reports, poll creation with the credit check) and the new `lib/credits.ts` (one formula, one query, one lock). The other files are Next.js conventions: two route files, a page and its client view, and the existing pages. One more file, `app/poll-parts.tsx`, collects the picker, report button and credit meter that the poll page and feed share, so the feed doesn't import from another route's folder. There are no new classes or services.
   - **Considered and rejected:** returning credits inside the feed response instead of `GET /account`. It saves one 10-line file but couples two concepts, and EC1 needs a direct way to observe "has 0 credits".
4. **Search check.**
   - Neon's pooler runs PgBouncer in transaction mode. It doesn't support session-level advisory locks, but transaction-level `pg_advisory_xact_lock` is fine. Every lock here is transaction-scoped and is the first statement of its transaction.
   - Current advice for credit spending is a conditional `UPDATE … WHERE balance >= n` when a balance row exists, and an advisory lock when the thing to protect isn't one row. Credits here are derived, so there's no balance row, which makes the advisory lock the right tool **[Layer 1]**.
   - Only one code path spends a credit (creating a public poll), and it takes the lock.
   - **[EUREKA-lite] Don't count only feed votes.** The obvious rule is "5 votes in the feed earn 1 public post". At launch the feed is empty, so nobody could ever earn a credit and the feed would stay empty for good. Counting a vote on any poll you didn't create avoids this. A seller's audience voting on the seller's link earns credits, and those credits fill the feed. This is the cold-start answer REVIEW.md asks for, at no cost.
5. **TODOS.** There is no TODOS.md. Deferred items are listed below and under "What's left".
6. **Completeness.**
   - Every error path is built and tested: 400 (bad visibility), 403 (no credit), 404, 409 (repeat report), 415 (non-JSON).
   - The double-spend race is covered.
   - Upgrading an existing M1 database is covered.
7. **Distribution.** It's the same web app on Vercel Hobby with no new artifact. M2 needs no new infrastructure, so `.provision` doesn't change.

**In scope (M2):**
- the public feed (`GET /polls` and a `/feed` swipe page);
- "vote 5, post 1" credits on anonymous accounts (`GET /account`, plus a 403 on a public post without a credit);
- the report button and hiding a poll at 3 reports;
- a `visibility` choice at creation.

**Deliberately not in M2:**
- email, password or OAuth accounts (see Decisions);
- image moderation beyond reports: no SafeSearch, since Google Vision needs billing enabled, which breaks the $0 rule;
- a moderator UI (the owner reviews hidden polls in SQL);
- report reasons;
- refunding a credit when a poll is hidden;
- rate limiting and sybil resistance;
- private polls, Stripe and CSV (M3);
- a CI workflow and browser tests.

### Decisions (nobody to ask, so decided here)

| Question | Decision | Why |
|---|---|---|
| What is "an account"? | The anonymous device account M1 already issues: the httpOnly `tb_voter` cookie holding a random UUID. Credits, votes, reports and poll ownership attach to it. A new browser is a new account with 0 credits. | Email links and OAuth need a provider set up by hand (no $0 path from this sandbox). A sign-up wall before the first swipe would starve the feed, which is REVIEW's biggest risk. Password accounts without email are no harder to farm than cookies. **Trade-off:** clearing cookies loses credits. M3 can attach an email at Stripe checkout for recovery. |
| Public vs link polls | `visibility` is `unlisted` (the default, which is M1's link-only poll: free and unlimited) or `public` (in the feed and at its link; costs 1 credit). Anything else gets a 400. | M1's EC1 creates a poll without an account and has to keep passing. REVIEW's wedge, a seller polling their own audience, shouldn't need credits. `private` is left for M3, which must make it mean more than "unlisted". |
| Which votes earn credit | Votes on any poll you didn't create, public or unlisted. Votes on your own polls never count. | Counting only feed votes deadlocks at launch (see EUREKA-lite above). Excluding your own polls blocks the "make 5 free link polls and vote on each" loophole. |
| Credit math | Derived on read: `credits = max(0, floor(countedVotes / 5) − publicPollsPosted)`. Nothing is stored. | One source of truth with nothing to drift, and an M1 database needs no backfill. |
| Double spend | Posting a public poll takes `pg_advisory_xact_lock(ns, hashtext(account))`, recounts and inserts in one transaction. | Several simultaneous posts holding one credit must produce exactly one poll. |
| Order of checks on POST /polls | 415, then 400 (validation), then 403 (no credit). | Bad input is reported the same way whatever the balance. |
| No-credit response | `403 {error, account}` | "Not allowed yet" fits better than 402, and M3 uses 403 for private polls. The `account` lets the UI show how many votes are left. |
| Report | `POST /polls/:id/reports` with a JSON body (`{}`). Returns 201 `{reported: true}`. A repeat from the same account gets 409, an unknown poll 404, and a non-JSON body 415. The cookie is minted if missing. Reports work on any poll, open or closed. | The primary key stops one browser from hiding a poll on its own. JSON-only matters more here than for votes. A cross-site form post carries no `SameSite=Lax` cookie, so every visitor would count as a fresh reporter. JSON-only blocks that. |
| Hidden | A poll with 3 or more reports from distinct accounts drops out of the feed (worked out from the reports table). Its share link keeps working, and no reason is collected. | This is the exit criterion. Strangers can't take a creator's poll away from the creator's own audience. Reasons were cut to keep scope narrow. |
| Feed | `GET /polls` returns `{polls}` and sends `Cache-Control: no-store`. It lists open public polls whose deadline hasn't passed and that have fewer than 3 reports. It leaves out the viewer's own polls and any poll the viewer voted on or reported. Soonest deadline first, at most 20, tally hidden. | Polls about to expire get voters first. The viewer never sees a card they can't or shouldn't act on. |
| Feed page | `/feed` shows one card at a time with the M1 swipe card (or a grid for 3–4 options), Skip and Report. A credit meter on top shows progress toward the next public post. When the batch runs out it fetches more, and skipped cards stay skipped for the session. | Implements "swipe feed" from the PRD. |
| Account endpoint | `GET /account` returns `{account: {credits, countedVotes, publicPolls, votesToNextCredit}}` with `no-store`. It never sets a cookie. | It's the observable side of EC1. A read shouldn't mint identities. |
| Vote response | `201 {poll, account}` adds the voter's updated account. | Lets the feed and poll page update the credit meter without another request. |
| Poll view | Gets two new fields: `visibility`, and `mine` (true if the caller created it). `creator_id` is never exposed. | The poll page hides Report on your own poll and shows the right "your poll is live" notice. |
| Schema upgrade | The existing schema step adds columns with `ADD COLUMN IF NOT EXISTS`, creates `reports`, and builds three indexes, all under the M1 advisory lock. M1 polls become `unlisted` with no creator. Added in review: a catalog check (`to_regclass` on the newest index) skips all of this once the schema is current. | No migration step after the broker provisions Neon. `ALTER TABLE` locks `polls` exclusively even when there's nothing to add, so it shouldn't run on every cold start. |

### 1. Architecture review

```
 Browser                      Next.js route / page                     lib                              Postgres
 /feed (server render) ─────────────────────────────────────▶ listFeed(), getAccount() ─┐
 /feed card ── POST /polls/:id/votes ─▶ votes/route.ts ─────▶ castVote() + getAccount()  ├─▶ polls (+visibility, creator_id)
           └── POST /polls/:id/reports ▶ reports/route.ts ──▶ reportPoll()               │   votes
 / form ────── POST /polls {visibility}▶ polls/route.ts POST ▶ createPoll()──────────────┤   reports (poll_id, reporter_id) PK
 (any) ─────── GET /polls ────────────▶ polls/route.ts GET ─▶ listFeed()                 │
 (any) ─────── GET /account ──────────▶ account/route.ts ───▶ getAccount() (credits.ts) ─┘
```

Creating a public poll (`createPoll`, visibility `public`):
```
BEGIN
  SELECT pg_advisory_xact_lock(ns, hashtext(account))  -- one spend at a time per account
  counted = votes JOIN polls WHERE voter = me AND creator IS DISTINCT FROM me
  posted  = polls WHERE creator = me AND visibility = 'public'
  floor(counted/5) - posted < 1 → ROLLBACK → 403 {account}
  INSERT INTO polls (…, visibility 'public', creator_id me)
COMMIT → 201
```

- **Boundaries.** As in M1, routes only parse HTTP. `lib/http.ts` gains `identify()` and `remember()`, which read the account cookie or mint one and set it on the response. They replace the cookie code the votes route had inline, and the polls and reports routes now share it. `lib/credits.ts` holds the credit formula, the SQL query and the lock. `lib/polls.ts` holds the feed, reports and the credit-checked insert.
- **Coupling.** There are no new dependencies. `lib/credits.ts` depends only on `db` and `limits`. Client components import constants from `lib/limits.ts` and never import server code.
- **Data flow and bottlenecks.**
  - The feed is one query. Vote counts come from correlated subqueries, so there's no N+1 over the 20 cards.
  - It's filtered by the partial index `polls(closes_at) WHERE visibility='public' AND status='open'`.
  - Credits take two counts, using `votes(voter_id)` and `polls(creator_id)`.
  - Every count stays small at MVP scale. If an account ever had tens of thousands of votes, the count could be moved into a stored counter.
- **Scaling and single points of failure.** Unchanged from M1: Neon free tier, and lazy deadline close. The feed doesn't close expired polls; it just leaves them out, and they close the next time someone reads or votes on them.
- **Security.**
  - Everything is parameterised, including the lock namespace.
  - Report and create are JSON-only (CSRF).
  - `creator_id` never leaves the server; only `mine` does.
  - Reporters' identities aren't exposed, and the report count isn't either, so a troll can't see how close a poll is to being hidden.
  - **Known weakness:** accounts are free to mint, so a script can file 3 reports from 3 cookie-less requests, or farm credits. The Review covers this as an accepted P1.
- **Production failure scenarios.**
  1. *A double-click on "Create" for a public poll with 1 credit.* The advisory lock serialises the two requests: one gets 201, the other 403. Tested with concurrent requests.
  2. *The first deploy runs against an M1 database.* `ADD COLUMN IF NOT EXISTS` runs under the schema lock. M1 polls become unlisted and M1 votes count toward credits. Tested from an M1-shaped database.
  3. *The feed is empty at launch.* The page says so and links to creating a poll. Credits can still be earned on shared link polls (EUREKA-lite).
  4. *A troll files 3 reports with 3 fresh cookies.* The poll leaves the feed, but its link and votes still work. Accepted for the MVP, with rate limits as the follow-up (Review).
  5. *A user clears cookies.* Their credits are gone, since they live with the account. Documented, and M3 can add recovery.
  6. *A poll's deadline passes while it sits in someone's loaded feed.* The vote gets 410, and the feed page skips to the next card.

### 3. Test plan

Vitest calls the route handlers against in-process PGlite, as in M1. Clock-based cases use fake `Date` timers.

| Exit criterion / codepath | Test |
|---|---|
| **EC1** A new account (no cookie, or a fresh cookie) has 0 credits and a public post gets 403 with nothing created | `tests/m2-exit-criteria.test.ts` |
| **EC1** After 5 votes on others' polls the account has 1 credit (0 after each of votes 1–4). It posts one public poll, which shows up in another account's feed; the credit is spent, and a second post gets 403 | same file |
| **EC2** A public poll with 3 reports from 3 accounts is gone from the feed (for anonymous viewers and accounts alike), while 2 reports keep it listed | same file |
| Credits: votes on your own polls don't count; unlisted and public votes both count; 4 votes leave 1 to go; 10 votes give 2; spending recounts | `tests/feed-credits.test.ts` |
| Unlisted creation stays free for a new account and mints the cookie; `visibility` defaults to `unlisted`; `mine` is set for the creator only; `creator_id` is never in the JSON | same file |
| Visibility validation (`private`, `PUBLIC`, `null`, a number all get 400); validation runs before the credit check | same file |
| Concurrent public posts with one credit produce exactly one 201 | same file |
| `GET /account` never sets a cookie; a malformed cookie counts as a new account; `no-store` | same file |
| The vote response carries `account` (counts on others' polls, not on your own) | same file |
| Feed rules: unlisted, closed, past-deadline, own, voted-on and reported-by-me polls are left out; soonest deadline first; 20 per page; tally hidden; `no-store` | same file |
| Reports: 201 and the cookie minted; a repeat gets 409 with the count unchanged; unknown or malformed id gets 404; 415 and 400; the link and voting still work after 3 reports; unlisted polls can be reported | same file |
| Credit formula (pure): 0, 4, 5, 9 votes with 1 posted, 10 votes, and never negative | `tests/credits.test.ts` |
| Upgrading an M1-shaped database: M1 poll becomes `unlisted`, its vote counts toward credits, the feed works; a second instance is a no-op | `tests/schema-upgrade.test.ts` |
| Fast path once the schema is current: one catalog read, no DDL, so no table locks (added in review) | same file |
| Pages: `/feed` (first card, Skip, Report, meter, empty state, own poll left out), `/` (checkbox disabled or enabled by credits), `/p/:id` (Report hidden from the creator, "live in the public feed" notice, result page) | `tests/pages.test.ts`. It server-renders the real page functions against PGlite, with only `next/headers` and `next/navigation` stubbed. This replaced the dev-server smoke check, because the sandbox didn't allow starting a server |

</details>

## M1 plan (built earlier in this session)

<details><summary>The M1 plan, kept for reference</summary>

M1 of 3 (MVP run). Owner note: this is a re-run after the sandbox patch fix. The 01:13 run left no code in the repo, so this is a clean build of M1. Because that run's patch was lost to a `git add` error, this run keeps the tree simple to add: build output, dependencies and local data are git-ignored, and there are no symlinks or nested repos.

### Step 0: Scope challenge

1. **Existing code.** Nothing in this repo. REVIEW.md points at David's ThisOrThat repo, but that repo is outside this workspace and the owner approved a new one, so it isn't reused. Postgres built-ins replace custom code where they can:
   - a composite primary key `(poll_id, voter_id)` enforces one vote per voter **[Layer 1]**;
   - `SELECT … FOR UPDATE` on the poll row serialises the vote-and-close step **[Layer 1]**;
   - a `WHERE status = 'open'` guarded `UPDATE` makes the status change atomic **[Layer 1]**.
2. **Minimum change set (what M1 ships).**
   - Three API route handlers: `POST /polls`, `GET /polls/:id` and `POST /polls/:id/votes`. The paths match the roadmap exactly, with no `/api` prefix.
   - One domain module, `lib/polls.ts`, which holds validation, the close rule and SQL.
   - One small DB adapter, `lib/db.ts`, which chooses `pg` when `DATABASE_URL` is set and otherwise PGlite (in-process Postgres for tests and local dev).
   - Two pages: `/` (create a poll) and `/p/:id`, which is the share URL. It shows the swipe card while the poll is open and the result page once it closes.
3. **Complexity check.** 17 source and config files, so the smell triggers. Most are Next.js conventions (layout, CSS, three route files, next/ts/vitest config). The logic lives in 2 modules (`lib/polls.ts`, `lib/db.ts`), plus three small helpers (`http`, `swipe`, `limits`) and 2 client components. There are no classes or extra services. I accept the count instead of collapsing everything into one file, because each file is one Next convention or one concern.
4. **Search check.** Web search wasn't used. I read Next 16.4's bundled docs instead (`node_modules/next/dist/docs`), which match the installed version, plus the PGlite type definitions.
   - **No cron for deadlines [EUREKA-lite].** Vercel Hobby cron runs at most once a day, so a cron job can't enforce a 24h deadline on time. Polls close lazily instead: every read or vote checks the deadline (using the app clock) and closes the poll inside a transaction before answering. Nobody can see an open poll past its deadline, so this meets "server-side close at N votes or the deadline, whichever comes first" at $0.
   - **Pointer events instead of framer-motion [Layer 1].** A two-way swipe is about 30 lines with no dependency.
   - **Cache Components stays off.** It's opt-in in Next 16. Pages that read the voter cookie render per request.
   - **TypeScript 7.** It installed by default. `next build` type-checks with the local `tsc` CLI, which supports TS 7.
5. **TODOS.** There is no TODOS.md. Deferred work is listed below and in "What's left".
6. **Completeness.** All error paths are built and tested: 400 (bad input), 404, 409 (repeat voter), 410 (closed poll) and 415 (non-JSON). Ties and concurrent votes are handled.
7. **Distribution.** This is a web app on Vercel Hobby with no new artifact type. Deploys go through the Vercel project the broker creates. CI isn't part of M1; tests run locally with `npm test`.

**In scope (M1):**
- create a poll with 2–4 options (text and/or an https image URL), a vote target and a time limit;
- swipe voting page;
- server-side close at the target or the deadline;
- result page with winner, split and share link.

**Deliberately not in M1:**
- public feed, credits and report button (M2);
- accounts and auth (M2, which needs "a new account");
- Stripe, private polls and CSV (M3);
- image upload and moderation (options take an image URL; there are no uploads, so nothing to store or moderate);
- rate limiting;
- creator admin (closing or deleting a poll);
- framer-motion;
- a CI workflow.

### Decisions (nobody to ask, so decided here)

| Question | Decision | Why |
|---|---|---|
| Who is "a voter"? | An anonymous, httpOnly, SameSite=Lax cookie `tb_voter` holding a random UUID. The vote endpoint mints one if it's missing or malformed. | M1 has no accounts. One vote per browser per poll is the RESEARCH.md rule. Clearing cookies allows a second vote, which is accepted until M2 adds accounts. |
| Request shape | `POST /polls {question?, options: (string \| {text?, imageUrl?})[], target, durationHours}` and `POST /polls/:id/votes {option: <index>}` | Mirrors the exit criteria ("2 options, target 3, 24h limit"). |
| Limits | 2–4 options; target 1–100; durationHours 1–168 (integers); question ≤ 140 chars; option text ≤ 80 chars; image URLs https only, ≤ 2048 chars. | PRD says 2–4 options. M3's "higher vote targets" for paid users can raise `MAX_TARGET`. |
| Statuses | `open`, `closed` and `no_result` only. | These are exactly the roadmap's values. |
| Tie at close | `status: "closed"`, `winner: null`. The result page says "It's a tie". | Giving a 50/50 split a winner would mislead a seller. Adding a fourth status would grow the enum the roadmap defines. |
| Winner format | `winner` is the option index (0-based). The `options` array is in the response too. | Unambiguous and stable. |
| Tally while open | Hidden (`tally: null`); only `voteCount` is shown. The full split appears once closed. | Avoids bandwagon voting and keeps the verdict honest. |
| Repeat voter on a closed poll | 410 (the closed check comes before the duplicate check). | The status is the more useful answer. |
| CSRF / drive-by vote stuffing | POST endpoints only accept `Content-Type: application/json` (otherwise 415). | Cross-site HTML forms can't send JSON without a CORS preflight, which this app never grants. |
| Poll ids | 12-character base64url (72 random bits). | Polls are link-only in M1, so ids must not be guessable. |
| Schema setup | `CREATE TABLE IF NOT EXISTS` runs once per server instance under `pg_advisory_xact_lock`. | Nobody runs migrations after the broker provisions Neon. The lock prevents the race when two cold starts create tables at once. |
| Clock | All deadline comparisons use the app clock (`Date`), passed to SQL as parameters, never SQL `now()`. | One clock, and tests can fake it. |

### 1. Architecture review

```
 Browser                         Next.js (Node runtime, Vercel Hobby)                 Postgres
 ───────                         ────────────────────────────────────                 ────────
 /  create form ──POST /polls──────────▶ app/polls/route.ts ─────────┐
 /p/:id swipe ───POST /polls/:id/votes─▶ app/polls/[id]/votes/route.ts┼─▶ lib/polls.ts ─▶ lib/db.ts ─▶ Neon (DATABASE_URL)
 /p/:id result ──GET  /polls/:id ──────▶ app/polls/[id]/route.ts ────┤   validation,             └▶ PGlite (tests, local dev)
 /p/:id (server render) ─────────────── getPoll() directly ──────────┘   close rule, SQL
```

Vote transaction (`castVote`):
```
BEGIN
  SELECT … FROM polls WHERE id=$1 FOR UPDATE      -- serialises votes on this poll
  missing                    → 404
  status <> 'open'           → 410
  now >= closes_at           → close by deadline, COMMIT, 410
  option index out of range  → 400
  INSERT INTO votes … ON CONFLICT DO NOTHING      -- no row back → 409, count unchanged
  tally; voteCount >= target → UPDATE polls SET status, winner WHERE id=$1 AND status='open'
COMMIT → 201 {poll}
```

- **Boundaries.** Route handlers only parse HTTP: JSON, cookie, status codes. `lib/polls.ts` holds every rule and takes a `Sql` handle, so the rules run against real SQL in tests. `lib/db.ts` is the only file that knows about `pg` and PGlite. The DB handle is cached on `globalThis` so pages and route handlers share one pool, since Next bundles each route separately.
- **Coupling and dependencies.** next, react and pg in production; PGlite, vitest and typescript in dev. No framer-motion or Supabase SDK.
- **Data flow and bottlenecks.** A vote is one short transaction holding a single-row lock. Tallying is `GROUP BY` over at most 100 rows through the primary-key index.
- **Scaling and single points of failure.** Neon's free tier is the single point of failure and suspends when idle, so the first query after idle wakes it in about 1s. The pool is small (`max 5`), and the pooled connection string keeps serverless connection counts low.
- **Security.**
  - Parameterised SQL only.
  - React escapes all user text; image URLs must be `https:` and render with `referrerPolicy="no-referrer"`.
  - The voter cookie is httpOnly, and POST endpoints are JSON-only.
  - There is no auth in M1: anyone with the link can vote and see the result, which is the intended M1 product.
- **Production failure scenarios.**
  1. *Two voters cast the last vote at the same instant.* The row lock serialises them: the first closes the poll and the second gets 410. Covered by a concurrency test.
  2. *Two cold starts create tables at once.* An advisory lock around the DDL handles this.
  3. *Neon is unreachable or waking up.* The handler returns 500 and the client shows "try again". The cached connection promise resets on failure, so a later request can retry instead of reusing a rejected promise.
  4. *A poll never gets voters (the cold start from REVIEW.md).* The deadline closes it, as `no_result` if nobody voted.
  5. *A voter clears cookies and votes again.* Accepted in M1 and documented. M2 accounts fix it.
  6. *DATABASE_URL is missing in production.* The app throws a clear error instead of silently using an in-memory DB.

### 3. Test plan

Vitest calls the route handlers with Web `Request` objects against a fresh in-process Postgres (PGlite). Tests never read any real env value.

| Exit criterion / codepath | Test |
|---|---|
| EC1: POST /polls with 2 options, target 3, 24h → id and share URL | `tests/m1-exit-criteria.test.ts` (201, id, `shareUrl` = origin + `/p/:id`, closesAt = now + 24h, status open) |
| EC2: three voters → closed with the majority winner | same file (third vote's response and a later GET both say closed, winner 1, tally [1, 2]) |
| EC3: same voter again → 409, count unchanged | same file (same and different option both give 409; voteCount stays 1) |
| EC4: past deadline with 1 vote → closed and that winner; 0 votes → no_result | same file (clock faked past the deadline) |
| EC5: vote on a closed poll → 410 | same file (closed by target, closed by deadline, no_result) |
| Validation → 400; non-JSON → 415; bad JSON → 400 | `tests/polls-api.test.ts`, table-driven |
| Unknown or malformed id → 404 (GET and vote); option out of range → 400 | `tests/polls-api.test.ts` |
| Voter cookie minted when missing or malformed, and reused | `tests/polls-api.test.ts` |
| Tie at target and tie at deadline → closed, winner null | `tests/polls-api.test.ts` |
| Tally hidden while open; `myVote` reflects the cookie | `tests/polls-api.test.ts` |
| Concurrent votes never exceed the target | `tests/polls-api.test.ts` |
| Schema setup is idempotent | `tests/polls-api.test.ts` |
| Close rule (pure): no votes, single winner, ties, 4 options | `tests/close-rule.test.ts` |
| Swipe mapping (pure): threshold, direction | `tests/swipe.test.ts` |
| Pages render (`/`, `/p/:id`) | Manual smoke check with `next build` and the dev server, not automated in M1 |

### M1 review (as written at the end of M1)

Superseded by "## Review" below. Note one change: M1 expected "M2 accounts" to fix cookie-only voting, but M2's accounts are that same cookie.

- **Fixed in M1:**
  - a failed DB connect is no longer cached forever;
  - a connection whose `ROLLBACK` fails is discarded;
  - a stale swipe `dx` was fixed;
  - an unused parameter was removed;
  - `?new=1` is stripped from shared links;
  - limits were moved to `lib/limits.ts` so client bundles stay free of server code.
- **Open at the end of M1:**
  - [P1] cookie-only voter identity;
  - [P2] no rate limit on poll creation;
  - [P2] hotlinked, unmoderated images;
  - [P3] the concurrency test runs on PGlite;
  - [P3] no `attachDatabasePool`;
  - [P3] no automated page tests and no CSP.

</details>

## M4: native app (built 2026-10-12)

David's build note asked for a native app for Android and iPhone. The PRD written before that listed "native apps" as a non-goal, and a manual re-run of the MVP build passed a different note. So M1–M3 came out web-only. M4 adds the native side without replacing anything:
- **`mobile/`**: an Expo SDK 57 app (React Native 0.86, Expo Router, gesture-handler with Reanimated 4 for the swipe, SecureStore for the id). Screens and setup are in `mobile/README.md`.
- **API**: one addition. `voterOf(request)` in `lib/http.ts` reads the `x-tiebreak-voter` header before the cookie, and `remember()` returns a newly minted id in that header. Browsers can't set a custom header cross-site without a CORS preflight, which this API never grants, so the header isn't a forgery route. Four routes switched from reading the cookie to `voterOf`.
- **Kept apart**: `mobile/` is excluded from the root `tsconfig.json` and from Vercel (`.vercelignore`), so the web build doesn't compile React Native.

Checked:
- root: `npx vitest run` passes (215 tests, 4 of them new identity tests), `tsc` is clean and `next build` succeeds;
- `mobile/`: `npm test` passes (9), `tsc` is clean, `npx expo export` builds the iOS and Android bundles, and `expo-doctor` passes 21/21.

Not checked: it hasn't run on a real device or simulator, since this Mac has neither. Run it with Expo Go (`mobile/README.md`).

## What the product does now (M1 + M2 + M3)

- **Accounts are anonymous.** The first vote, poll, report or checkout a browser makes sets the httpOnly `tb_voter` cookie. That cookie is the account: it holds your votes, your polls, your reports, your posting credits and, since M3, your Pro plan. There's no sign-up.
- **The header** links to the Feed, New poll and **Pro** (new in M3). **New in M3:** a footer links to Terms, refunds & privacy.
- **`/`**: create a poll.
  - An optional question and 2–4 options. Each option has text, an https image link, or both.
  - A vote target (default 10) and a time limit from 1 hour to 7 days (default 24h).
  - **New in M2:** a checkbox, "Also post it to the public feed so strangers vote (uses 1 of your N credits)".
    - With 0 credits the box is disabled. The form explains that link-only polls are free, and that you earn a credit by voting on N more polls in the feed.
  - **New in M3:**
    - Pro accounts get a second checkbox, "Keep the result private: only you see the winner and the split (Pro)". Ticking it turns the public box off.
    - Free accounts see "Want the result kept private, or every vote in a spreadsheet? Get Pro" instead.
  - Creating a poll takes you to its share page.
- **`/pro`** (new in M3): the paid tier.
  - It lists what Pro adds: private polls and CSV export.
  - It shows the price as Stripe reports it, e.g. "$9.00, paid once. No subscription." If Stripe can't be reached, it says "price shown at checkout".
  - **Get Pro for $9.00** creates a Stripe Checkout Session and sends the browser to Stripe's hosted payment page.
  - The note under the button says plainly that Pro belongs to this browser, and to reply to the Stripe receipt for a refund if it's lost. It links to the terms.
  - **Coming back from Checkout** (`/pro?session_id=…`), the page confirms the payment with Stripe and shows "Payment received, thank you. You have Pro on this browser." If Stripe hasn't marked it paid yet (a delayed method), it says the payment is being confirmed. The webhook finishes the job either way.
  - A Pro account sees "You have Pro" and a "Create a private poll" button.
- **`/terms`** (new in M3): plain-language sections on the service, Pro, refunds (14 days, no questions asked), acceptable use, privacy and contact. Contact is `CONTACT_EMAIL` when it's set, otherwise "reply to your Stripe receipt".
- **`/feed`** (new): the public feed.
  - **Credit meter.** "N credits to post a public poll · M more votes to earn the next", with a progress bar and a "Post a public poll" link once you have a credit.
  - **One card at a time.** The swipe card from M1 for 2 options, a tap grid for 3–4.
    - **Skip** moves on, and the card stays skipped for the session.
    - **Report** asks you to confirm, then moves on.
  - **After a vote.** The meter updates, a note says "You picked A · … See the result when it closes" with a link to the poll, and the next card appears.
  - **Restocking.** The feed loads more polls when the batch runs out. When none are left it says "You're all caught up" and offers "Check again" and "Create a poll".
  - **What's listed.** Open public polls before their deadline with fewer than 3 reports, excluding your own polls and any you voted on or reported. Soonest deadline first.
- **`/p/:id`**: the share link, which works as both voting page and result page (M1).
  - **Open, not yet voted.** A two-option poll shows one card: drag left for A, right for B, tap a side, use the arrow keys, or press "Pick A/B". Polls with 3–4 options show a tap grid.
  - **Open, already voted.** Your pick, "N of target votes", time left, and a refresh button. The split stays hidden until the poll closes.
  - **Closed.** The winner (or "It's a tie" / "No votes came in"), a bar per option with count and percentage, and your own vote.
  - **Always.** The share link with a copy button.
  - **New in M2:**
    - a **Report** button with a confirm step (everyone except the creator sees it);
    - after you vote, the credit meter with links to the feed and to posting;
    - for a public poll, the creator's banner says it's live in the public feed.
  - The link keeps working after a poll is hidden from the feed.
  - **New in M3:**
    - **Private polls, for anyone but the creator.** Once closed, the page says "This poll has closed. Its creator keeps the result private." It shows your own vote but no winner or split. While open, after you vote, the page says the result is private.
    - **The creator** sees the full result, as with any poll. A new private poll's banner says "Only you will see the result".
    - **CSV.** On a closed poll, a Pro creator gets **Download votes (CSV)**. A free creator gets "Get Pro to download every vote as a CSV". Nobody else sees either.
- **JSON API.** Paths match the roadmap exactly, with no `/api` prefix.
  - `GET /polls` → `200 {polls}`: the feed as the caller sees it (at most 20, `no-store`, tally hidden).
  - `POST /polls` `{question?, options, target, durationHours, visibility?: "unlisted" | "public" | "private"}` → `201 {id, shareUrl, poll}`, or:
    - `400` for bad input;
    - `403 {error, account}` for a public poll without a credit;
    - `403 {error, plan: "free"}` for a private poll without Pro (new in M3);
    - `415` for a non-JSON body.
    - `visibility` defaults to `unlisted`. The account cookie is set if missing.
  - `GET /polls/:id` → `200 {poll}`, closing the poll first if it's past its deadline; or `404`.
  - `POST /polls/:id/votes` `{option}` → `201 {poll, account}`, or 400/404/409/410/415.
  - `POST /polls/:id/reports` `{}` → `201 {reported: true}`, or 400/404, 409 (already reported) and 415.
  - `GET /account` → `200 {account: {credits, countedVotes, publicPolls, votesToNextCredit}, plan: "free" | "pro"}`. It never sets a cookie. `plan` is new in M3.
  - **New in M3:**
    - `GET /polls/:id/export` → `200 text/csv` with `Content-Disposition: attachment; filename="tiebreak-<id>.csv"` and `no-store`. Otherwise:
      - `404` for an unknown poll;
      - `403` for anyone but the creator, or a creator without Pro;
      - `409` while the poll is open.
      - The CSV has the columns `vote,voted_at,option,option_text,option_image_url` and one row per vote (header row excluded) in vote order. It starts with a UTF-8 BOM, uses CRLF line endings, and guards formula cells. It never includes voter ids.
    - `POST /checkout` `{}` → `200 {url}` (Stripe Checkout), or:
      - `409` if already Pro;
      - `415` for a non-JSON body;
      - `502` if Stripe failed;
      - `503` if Stripe isn't configured.
      - The account cookie is set if missing.
    - `POST /stripe/webhook` (Stripe only) → `200 {received: true}`, `400` for a bad signature or body, `503` without `STRIPE_WEBHOOK_SECRET`.
  - `poll` = `{id, question, options[{text, imageUrl}], target, visibility, status: open|closed|no_result, winner, voteCount, tally, myVote, mine, createdAt, closesAt, closedAt}`.
    - `winner` and `tally` are `null` while open.
    - On a private poll they're also `null` for everyone but the creator (`mine: false`), even once closed.
- **Credit rule.** `credits = floor(votes on other people's polls / 5) − public polls posted`.
  - Votes on unlisted and private link polls count too, so a seller's audience can earn its way into the feed.
  - Votes on your own polls never count.
  - Pro doesn't grant credits, and private polls don't spend them.
- **Plan rule (M3).** An account is Pro once any Stripe payment is recorded for it. It never goes back to free on its own: a refund is undone by deleting the row (see "What's left").

## Run it locally ($0, no accounts)

```bash
npm install          # works with install scripts disabled
npm test             # 211 tests, about 16s; in-process Postgres (PGlite), Stripe faked at fetch
npm run dev          # http://localhost:3000 — uses in-memory PGlite when DATABASE_URL is unset
npm run typecheck    # tsc --noEmit (TypeScript 7)
npm run build        # production build plus type check
```

- `npm run dev` with no `DATABASE_URL` needs no setup. Data lives in memory and resets when the dev server restarts.
- **Trying the credit loop locally** needs two accounts, so use two browsers or a private window:
  1. Browser A creates 5 link-only polls.
  2. Browser B votes on all 5, and its meter shows 1 credit.
  3. B creates a poll with "Also post it to the public feed" checked.
  4. A opens `/feed` and sees B's poll.
  5. Three reports from three browsers take it out of the feed.
- **Trying Pro locally** needs a Stripe account in **test mode** (free, nothing is charged):
  1. In your own shell (never in a file in this repo), export three values:
     - `STRIPE_SECRET_KEY`: the test secret key from the Stripe dashboard;
     - `STRIPE_PRICE_ID`: a one-time test price;
     - `STRIPE_WEBHOOK_SECRET`: the value `stripe listen --forward-to localhost:3000/stripe/webhook` prints.
  2. Run `npm run dev`, open `/pro`, press **Get Pro** and pay with Stripe's test card 4242 4242 4242 4242.
  3. You land back on `/pro` with Pro active.
  4. Create a private poll, vote on it from a private window until it closes, then download the CSV.
  - Without those variables, `/pro` still renders, but **Get Pro** answers "Payments are not set up yet".
- To keep data across restarts, set `DATABASE_URL` in your shell to any Postgres you control. Tables are created automatically on the first request.
- `npm start` runs in production mode and refuses to start without `DATABASE_URL`, so a deployed app can never fall back to a throwaway in-memory database.
- Next 16.4's `next dev` writes `AGENTS.md`, which points coding agents at the version-matched docs in `node_modules/next/dist/docs`. It's kept for the M2/M3 builds.

## Deploy on a free tier

1. The pipeline runs `.provision` through the credential broker:
   - `neon db tiebreak` stores `DATABASE_URL` (Neon free tier, 0.5 GB).
   - `vercel project tiebreak` creates the Vercel Hobby project and gives it every stored value as env.
   - The `request` line asks David for a Stripe account (new in M3, see Infrastructure). Until those values exist, everything except **Get Pro** works, and checkout answers 503.
2. Deploy the repo to that project: connect the Git repo in Vercel, or run `vercel deploy --prod`. The framework preset is Next.js, with no build settings to change.
3. There's no migration step.
   - The first request creates the tables under an advisory lock.
   - On a database M1 already created, the same step adds the M2 columns, the `reports` table and the indexes. Existing polls become `unlisted`, and existing votes count toward credits.
   - On a database M2 created, it widens the visibility check to allow `private` and adds the `payments` table (new in M3).
   - After that, each new instance does one catalog read and skips the DDL.
4. Turning on payments (new in M3, done by David in Stripe, start in test mode):
   1. Create a product "tiebreak Pro" with a **one-time** price (suggested $9). Its id is `STRIPE_PRICE_ID`.
   2. Add a webhook endpoint at `https://<deployment>/stripe/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Its signing secret is `STRIPE_WEBHOOK_SECRET`.
   3. Store those two values and `STRIPE_SECRET_KEY` through the broker, so they reach Vercel env, then redeploy. Optionally set `CONTACT_EMAIL` too; `/terms` is static, so a change needs a redeploy.
   4. Fill in Stripe's public business details (support email). Read `/terms` before switching to live keys.
5. Check it:
   - open `/`, create a poll, open the share link in two browsers, and vote;
   - run the credit loop from "Run it locally" against the deployed URL;
   - in test mode, buy Pro with 4242 4242 4242 4242, create a private poll, close it, and download the CSV.
   - In Stripe → Webhooks, the delivery shows `200`.

Cost: $0 to run (Vercel Hobby, Neon free, Stripe with no monthly fee; Stripe keeps a per-payment fee from revenue only). No paid services, domains, cron jobs or image storage.

Committing:
- The dynamic-route folders are:
  - `app/p/[id]` and `app/polls/[id]`;
  - `app/polls/[id]/reports`, new in M2;
  - `app/polls/[id]/export`, new in M3.
- New plain folders in M3: `app/checkout`, `app/stripe/webhook`, `app/pro` and `app/terms`.
- Add the tree with `git add -A`. If files are added by explicit path, use `--literal-pathspecs` so `[id]` isn't read as a glob.
- `.gitignore` excludes `node_modules/`, `.next/`, `.vitest/`, `next-env.d.ts`, `*.tsbuildinfo` and `.env*`.
- `.vitest/` is new in M2. A test-results report was left there during the build, and the sandbox didn't allow deleting it. It only holds test names and results.

## Exit criteria

| M3 exit criterion | Status | Test |
|---|---|---|
| A free account cannot create a private poll (403) | ✅ pass | `EC1` in `tests/m3-exit-criteria.test.ts`. A fresh cookie, no cookie, and an account holding posting credits all get 403 with `plan: "free"`, and no private poll exists |
| …a paid account can | ✅ pass | `EC1`: the same account starts Checkout (`POST /checkout`), and starting it isn't enough (still 403). Once Stripe's signed `checkout.session.completed` webhook arrives, `GET /account` says `pro`, the private poll gets 201, and it stays out of the feed |
| Export of a closed poll returns a CSV whose row count equals the vote count | ✅ pass | `EC2`: a poll closed at target 3 exports 3 data rows (plus the header) with options A, B, B. A poll closed by its deadline with 1 vote exports 1 row, and a `no_result` poll exports 0 |

| M2 exit criterion | Status | Test |
|---|---|---|
| A new account has 0 posting credits and cannot create a public poll | ✅ pass | `EC1` in `tests/m2-exit-criteria.test.ts`: no cookie and a fresh cookie both show 0 credits and get 403; no poll is created and the feed stays empty |
| …after 5 votes it has 1 | ✅ pass | `EC1`: 0 credits after each of votes 1–4 and 1 after the 5th. The credit posts one public poll, which shows up in another account's feed, and a second post gets 403 |
| A poll with 3 reports is hidden from the feed | ✅ pass | `EC2`: still listed after 2 reports and gone after the 3rd, for anonymous viewers and accounts alike. Its share link still reads and takes votes |

| M1 exit criterion | Status | Test |
|---|---|---|
| POST /polls with 2 options, target 3 and a 24h limit returns an id and a share URL | ✅ pass | `EC1` in `tests/m1-exit-criteria.test.ts` |
| Three different voters POST /polls/:id/votes and the poll becomes closed with the majority winner | ✅ pass | `EC2` |
| A second vote from the same voter returns 409 and the count is unchanged | ✅ pass | `EC3` |
| Past the deadline: 1 vote closes as closed with that option as winner; 0 votes closes as no_result | ✅ pass | `EC4` (3 tests, including the exact deadline boundary) |
| A vote on a closed poll returns 410 | ✅ pass | `EC5` (4 tests: closed by target, closed by deadline on the vote itself, no_result, repeat voter) |

- **Tests.** `npm test` runs **211 tests in 14 files, and all pass**.
  - **M1: 65 tests**, assertions unchanged.
  - **M2: 55 tests.** One case changed on purpose: in `tests/feed-credits.test.ts`, the invalid-visibility list now uses `'Private'` instead of `'private'`, because M3 made `private` valid. That case still expects 400 and still has the same number of values (see Decisions).
  - **Helpers.** `tests/helpers.ts` gained the M3 helpers (fake Stripe, signing, checkout, export) and now truncates `payments` too.
  - **M3: 91 new tests:**
    - 4 exit-criteria tests;
    - 44 checkout, webhook, private-poll, export and plan API tests;
    - 24 pure tests (signature, CSV, price);
    - 4 M2→M3 schema-upgrade tests;
    - 15 page-render tests.
- **Build.** `npm run build` passes (Next 16.4, TypeScript 7), and so does `npm run typecheck -- --noUnusedLocals --noUnusedParameters`.
- **New routes in M3.** `/pro`, `/checkout`, `/stripe/webhook` and `/polls/[id]/export` are dynamic. `/terms` is static.
- **Mutation check.** These changes were made to confirm the tests catch them, then reverted:
  - showing private results to everyone: 1 test fails;
  - dropping the `metadata.app` check in fulfilment: 2 tests fail;
  - from M2, raising the hide threshold or counting votes on your own polls: 5 tests fail each.
- **Not done: a real Stripe round-trip and a dev-server smoke check.** The sandbox has no Stripe keys and no server. Stripe is faked at `fetch` with the documented request and response shapes, and the pages are server-rendered. Run the test-mode checkout in "Deploy on a free tier", step 5, before going live.

## What's left

The roadmap's three milestones are built. Before charging real money:
- **Stripe.** David provisions it (the `request` line), runs a test-mode purchase end to end, and reads `/terms`.
- **The price.** It's set in Stripe, suggested $9 one-time.
- **Live keys.** Switch to them after that, keeping the same env names.

Paid tier, by hand for now (Neon SQL editor):
```sql
-- Payments (and buyers' emails for refunds), newest first
SELECT session_id, account_id, email, amount_total, currency, paid_at FROM payments ORDER BY paid_at DESC;
-- Accounts that paid twice (two tabs): refund the extra session in Stripe
SELECT account_id, count(*) FROM payments GROUP BY account_id HAVING count(*) > 1;
```
- **A refund** is done in the Stripe dashboard. To also take Pro away, run `DELETE FROM payments WHERE session_id = 'cs_…'`. Private polls already created stay private.
- **Not built from the PRD's paid tier: higher vote targets.** ROADMAP's M3 doesn't list them. The follow-up is a per-plan `MAX_TARGET` in `lib/limits.ts`, checked with the plan after validation, the same way `private` is.
- **New DDL still goes last in `SCHEMA` (`lib/db.ts`),** with `SCHEMA_SENTINEL` pointed at the table or index it creates. It's now `payments_account_idx`.

- **Moderation, by hand for now.** The owner can list hidden polls in the Neon SQL editor:
  ```sql
  SELECT p.id, p.question, p.options, count(*) AS reports, max(r.created_at) AS last_report
    FROM polls p JOIN reports r ON r.poll_id = p.id
   GROUP BY p.id HAVING count(*) >= 3 ORDER BY last_report DESC;
  ```
  Removing a poll is `DELETE FROM polls WHERE id = '…'`, which cascades to its votes and reports. Note that this lowers its voters' counted votes.
- **Not planned in any milestone yet:**
  - rate limits and sybil resistance (see Review, P1);
  - report reasons and a moderator page;
  - image moderation beyond reports (Google Vision SafeSearch needs billing enabled, which breaks the $0 rule);
  - account recovery or merging across devices, now including Pro. The buyer's email is stored, so a "restore Pro by email" link is the natural next step;
  - subscriptions, per-poll pricing, coupons and automatic refund handling (a `charge.refunded` webhook);
  - creator controls (close or delete a poll);
  - image upload (options take links only);
  - browser end-to-end tests;
  - a CI workflow.
- **Product checks to watch.** These come from REVIEW.md Q5 and the PRD's metrics.
  - **From M1:**
    - do voters finish the swipe;
    - do sellers share the link unprompted;
    - does anyone make a second poll;
    - does anyone ask for reasons or demographics.
  - **New in M2:**
    - how many voters reach 5 votes;
    - does the feed ever fill;
    - the median number of swipes per session (PRD target: 10+);
    - the share of public polls that reach their target within 24h (PRD target: 50%);
    - reports per public poll.
  - **New in M3**, which is the PRD's money test: "3 of 20 sellers pay $5 or more". Watch:
    - visits to `/pro`;
    - checkouts started vs paid (Stripe dashboard);
    - private vs unlisted polls among Pro accounts;
    - CSV downloads;
    - refund requests;
    - whether buyers ask for per-poll pricing or a subscription instead.

## Infrastructure

Requested in `.provision`, one per line:

- `neon db tiebreak` → `DATABASE_URL` (Neon Postgres, free tier). Read only by `lib/db.ts`, through `process.env.DATABASE_URL`.
- `vercel project tiebreak` → the Vercel Hobby project, which receives every stored value (including `DATABASE_URL`) as env.
- **New in M3:** `request "Stripe account (test mode first, live after review) for tiebreak: …"` asks David for a Stripe account. It needs three values, stored as Vercel env:
  - `STRIPE_SECRET_KEY`: the API secret key, test mode first;
  - `STRIPE_PRICE_ID`: a **one-time** price for "tiebreak Pro", suggested $9;
  - `STRIPE_WEBHOOK_SECRET`: the signing secret of the endpoint `https://<deployment>/stripe/webhook`, listening to `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
  - All three are read only by `lib/stripe.ts`, through `process.env`, and never reach the browser.
  - No `vercel env` lines were added: `vercel project` already passes every stored value through. If the values are stored after the project exists, push each one with `vercel env tiebreak STRIPE_SECRET_KEY` (and likewise for the other two).
- **Optional, not a secret:** `CONTACT_EMAIL`, a support address shown on `/terms`. Without it, the page tells buyers to reply to their Stripe receipt.

Stripe has no monthly fee. Test mode is free, and live mode keeps a per-payment fee out of revenue, so the $0 rule holds. No other services or API keys are used. Tests fake Stripe at `fetch` with values built at runtime and never read a real credential.

## Review

This is M3's self-review against gstack's pre-landing checklist ("Review Categories", "Fix-First Heuristic"). The whole tree is still untracked, because the caller hasn't committed M1 or M2. `git status` shows only untracked paths and `git diff` is empty, so I read every file M3 created or changed instead:
- `lib/`: stripe, plans and csv (new); polls, db and limits;
- `app/`:
  - new: checkout, stripe/webhook, polls/[id]/export, pro (page and button), terms;
  - changed: the polls and account routes, the home page and create form, the poll page and view, poll-parts, layout, CSS;
- `tests/`.

**Pass 1 (CRITICAL): nothing open.**
- **SQL & data safety.**
  - Every new statement is parameterised: the plan `EXISTS`, the payment insert and the export read.
  - Fulfilment is one `INSERT … ON CONFLICT (session_id) DO NOTHING`.
  - The Pro check before creating a private poll is a read with no lock. That's safe because the plan only moves from free to pro, so there's no check-then-act window that matters.
  - The export is one ordered query of at most 100 rows, with no N+1.
- **Race conditions.**
  - The webhook and the return page fulfilling the same session at once leave one row. A concurrent test covers it.
  - Webhook redelivery is a no-op. Tested.
- **Trust boundary for external data.** Webhook payloads and retrieved sessions are shape-checked before anything is written. Every field's type is checked, `client_reference_id` must match the account-id pattern, `metadata.app` must be `tiebreak`, and `payment_status` must be settled.
  - **Signatures.** Checked over the raw body, constant-time, `v1` only, within ±300s.
  - **The return page** trusts only Stripe's API response, never the URL. A `session_id` must match `^cs_…` before it goes into a Stripe URL.
- **XSS and injection.**
  - No raw HTML. The export link uses a server-validated poll id, and `mailto:` uses the owner's own env value.
  - The CSV guards formula cells (`= + - @`, tab, CR) and quotes per RFC 4180.
  - `Content-Disposition` only ever holds a validated id.
- **Secrets.**
  - The `STRIPE_*` values are read only in `lib/stripe.ts` and are never sent to the client: pages get a formatted price string.
  - Logs carry only the HTTP status of a failed Stripe call.
  - No credential-shaped string is in the repo: test keys are built at runtime from a prefix and filler.
- **Enum completeness.** Traced by reading every consumer (the M2 checklist method):
  - **`private`:**
    - the DB check (an M2 database is upgraded too);
    - `VISIBILITIES` and `parseNewPoll`;
    - `REQUIRES`, an exhaustive record (credits 0, Pro yes);
    - the credits query (only `public` counts as spent);
    - the feed query and its partial index (`public` only);
    - `viewOf` (hidden result);
    - the poll page (`CREATED_NOTICE`, an exhaustive record, and `resultHidden`);
    - the create form;
    - the feed view (only ever gets public polls);
    - reports, which still work on any poll (intended).
  - **`plan`:** the account route, the 403 body, the checkout 409, `/pro`, the create form, the poll page export.
  - **Result-to-HTTP maps.** `ExportResult` maps to HTTP codes through an exhaustive record. `WebhookRead` and `CheckoutStart` are fully handled.
- **Shell injection and LLM output:** not applicable.

**Fixed during build and review (auto-fix class):**
- `WebhookRead` used one union member for two failure kinds, which broke narrowing in the route (the strict typecheck caught it). It's now split into separate members.
- Removed the unused `PLANS` export and made the signature tolerance constant module-private.
- The `lib/polls.ts` header comment said it held "every SQL statement", which hasn't been true since M2. Rewritten.
- The option letters (`ABCD`) had three copies. `OPTION_LETTERS` in `lib/limits.ts` is now the single source for the UI and the CSV.
- **Test harness:** `Response.text()` strips a leading BOM (per the Fetch spec), which hid the export's BOM. The export helper now decodes the bytes with `ignoreBOM`.
- **Mutation-checked:**
  - hiding private results: 1 test fails without it;
  - the `metadata.app` guard: 2 tests fail without it.
  - Both mutations were reverted.

**Open from M3 (ASK class, decided here because nobody can be asked):**
- **[P2] Pro is tied to the browser cookie** (confidence: 8/10). Files: `lib/plans.ts`, `app/pro/page.tsx`.
  - Clearing cookies or switching devices loses paid Pro.
  - **Decision:** disclose it before payment (`/pro`, `/terms`) and refund on request, since the buyer's email is stored.
  - **Next step:** a "restore Pro" link emailed to the address on the payment. That needs an email sender, so it's a `request` line when it's built.
- **[P2] `/terms` is a draft written during the build** (confidence: 7/10). File: `app/terms/page.tsx`.
  - It's plain-language and matches what the code does (stored data, Stripe, refunds), but nobody has reviewed it.
  - **Decision:** ship it so Stripe activation has a policy page. David reads it before switching to live keys.
- **[P3] Two open checkouts can both be paid** (confidence: 6/10, medium; verify it happens in practice). File: `app/checkout/route.ts`.
  - The 409 only stops a second checkout once the account is Pro. Two tabs opened before paying can each be paid.
  - **Decision:** rare. It's detectable with the duplicate-payments SQL under "What's left" and fixed with a refund.
  - **Fix if it shows up:** store the open session per account and return its URL instead of creating another.
- **[P3] `/pro` calls Stripe on every view** (confidence: 6/10, medium).
  - It reads the price, plus one session lookup on a Checkout return.
  - Stripe's read limits are far above MVP traffic. If `/pro` gets crawled or busy, cache the price per instance. The general rate-limit item below covers abuse.
- **[P3] No real Stripe round-trip has run** (confidence: 5/10, medium; verify on the first test-mode purchase). Files: `lib/stripe.ts`, `app/stripe/webhook/route.ts`.
  - Requests, responses and signatures follow Stripe's documentation and are tested with real HMACs against a fake at `fetch`. The sandbox has no Stripe account.
  - Step 5 of "Deploy on a free tier" is the check.

**Carried over from M2 (still open; see the M2 notes below):**
- **[P1] Free accounts make reports, credits and votes farmable.** It now also applies to `POST /checkout`, which creates a Stripe session per call. Per-IP rate limits on POST routes are still the fix.
- **[P2]** Image moderation is reports only.
- **[P2]** No credit refund when a poll is hidden.
- **[P2]** No rate limit on link polls.
- **[P3]** The advisory lock is untested under contention.
- **[P3]** The home page reads the DB. M3 added an indexed plan read, so it's now two.
- **[P3]** Feed order.
- **[P3]** Pooling and CSP.

<details><summary>M2 review (as written at the end of M2)</summary>

**Pass 1 (CRITICAL): nothing open.**
- **SQL & data safety.**
  - Every statement is parameterised, including the lock namespace and the schema sentinel. There's no string interpolation.
  - A public post runs its steps in one transaction:
    1. `pg_advisory_xact_lock(ns, hashtext(account))`;
    2. count credits;
    3. insert.
  - Under READ COMMITTED, each statement after the lock takes a new snapshot. So the second request sees the first one's committed poll and gets 403, which removes the TOCTOU window.
  - A report is a single `INSERT … SELECT … ON CONFLICT DO NOTHING` statement.
  - The feed is one query that counts votes with correlated subqueries, so there's no N+1.
- **Race conditions.**
  - Credit spending is serialised per account, and that's the only path that spends.
  - Duplicate reports are stopped by the primary key.
  - There's no find-or-create without a unique index, because there's no accounts table.
  - M1's vote and close locking is unchanged.
- **XSS.** No raw HTML. The feed's "see the result" link is built from a server-issued poll id.
- **Enum completeness.** The new `visibility` value is handled everywhere it's read:
  - the DB CHECK;
  - `parseNewPoll` (via `VISIBILITIES`);
  - `CREDIT_COST`, an exhaustive `Record`;
  - the credits and feed queries;
  - the partial index;
  - the poll page banner;
  - the create form.
  - `ReportResult` maps to HTTP codes through an exhaustively typed record, like `VoteResult` does.
- **LLM trust boundary and shell injection:** not applicable.

**Fixed during build and review (auto-fix class):**
- `createPoll` treated every visibility other than `public` as free, so a future `private` would have cost nothing. Each visibility now has a cost in a `Record<Visibility, number>`.
- Every cold start ran `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, which takes an ACCESS EXCLUSIVE lock on `polls` even when nothing changes. A catalog check now skips the DDL on a current schema, and a test covers it.
- `readJson`'s comment only mentioned votes; it now covers reports and polls too.
- Removed an unused import that the strict typecheck flagged.
- The swipe card, picker, report button and credit meter moved into `app/poll-parts.tsx`, so the feed doesn't import from another route's folder.

**Open (ASK class, decided here because nobody can be asked):**
- **[P1] Free accounts make reports and credits farmable** (confidence: 9/10). Files: `lib/http.ts` `identify()`, `app/polls/[id]/reports/route.ts`.
  - Accounts cost nothing to create, so a script can file 3 reports from 3 cookie-less requests and hide any public poll from the feed.
  - The same script can farm credits by voting 5 times per fresh cookie, which also stuffs votes. This is M1's P1. M1 expected M2 accounts to fix it, but they don't, because they're the same cookie.
  - **Decision:** accept for the two-week test cohort.
    - A hidden poll keeps working at its link.
    - The owner can review hidden polls with the SQL under "What's left".
    - Before any growth push, add per-IP rate limits on the POST routes (a Vercel firewall rate-limit rule, or an app counter keyed on a hashed `x-forwarded-for`).
    - Then count reports only from accounts with at least 5 counted votes.
- **[P2] Image moderation is reports only** (confidence: 7/10). Files: `app/feed/feed-view.tsx`, `app/poll-parts.tsx`.
  - Until 3 people report it, a public poll's hotlinked images show in strangers' feeds. REVIEW.md calls illegal content a real risk.
  - **Decision:** accept for the cohort, since posting publicly costs 5 votes first.
  - Cheapest next steps at $0: blur feed images until tapped, or make public polls text-only.
  - SafeSearch is out because it needs GCP billing.
- **[P2] No credit refund when a poll is hidden** (confidence: 7/10). File: `lib/credits.ts`.
  - A hidden public poll keeps its spent credit. **Decision:** keep it that way, because a refund would hand the credit back to the spammer.
- **[P2] Credits live in the cookie** (confidence: 7/10). File: `lib/credits.ts`.
  - Clearing cookies or switching devices loses credits and poll ownership, with no recovery.
  - **Decision:** accept until M3 attaches an email at checkout.
- **[P2] No rate limit on creating link polls** (confidence: 8/10). File: `app/polls/route.ts`. Carried over from M1.
  - Unlisted polls are still free and unlimited, so spam could fill Neon's 0.5 GB. They have no audience, so the risk stays the same as in M1.
- **[P3] Advisory lock untested under contention** (confidence: 6/10, medium; verify against real Postgres). Files: `tests/feed-credits.test.ts`, `tests/polls-api.test.ts`.
  - The concurrency tests run on PGlite, which runs transactions one at a time. That checks the logic but not the advisory lock under real contention.
  - The lock pattern is standard, and transaction-scoped locks are supported on Neon's PgBouncer pooler.
- **[P3] The home page now hits the database** (confidence: 6/10, medium). File: `app/page.tsx`.
  - `/` reads credits on every visit, so it's dynamic and wakes Neon. In M1 it didn't touch the database.
  - **Decision:** keep it, since it's one indexed count. The alternative is fetching `/account` from the client.
- **[P3] Feed order could starve long polls** (confidence: 5/10, medium). File: `lib/polls.ts` `listFeed`.
  - Soonest deadline first could starve long-deadline polls once more than 20 are open. At MVP volume every poll fits on the first page, so revisit with real data.
- **[P3] Pooling and headers** (confidence: 6/10). File: `lib/db.ts`. Carried over from M1.
  - There's no `attachDatabasePool` and no CSP headers.
  - M1's "pages have no automated tests" is partly closed: `tests/pages.test.ts` covers server-rendered HTML, but browser interaction is still untested.

</details>
