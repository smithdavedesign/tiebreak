# tiebreak mobile: the native app for iPhone and Android

One Expo (React Native) codebase for iOS and Android. It's a client of the same API as the web app: the Next.js routes at the repo root, deployed on Vercel. So polls, votes, credits and Pro are shared between the app and the website.

| Screen | What it does |
|---|---|
| Feed (`src/app/index.tsx`) | Public polls you haven't voted on, one card at a time. Swipe left for A and right for B (3- and 4-option polls get buttons). The header shows your posting credits. |
| Poll (`src/app/p/[id].tsx`) | One poll, from the feed, a share link (`tiebreak://p/<id>`) or right after creating it. Vote, see the result once it closes, share the link, report. |
| New poll (`src/app/new.tsx`) | 2–4 options (text and/or an https image link), votes to decide, hours open, and who can vote: link only, the public feed (1 credit) or private (Pro). |
| You (`src/app/account.tsx`) | Credits, votes and plan. "Get Pro" opens the website's checkout in the browser. |

The account is anonymous, as on the web. The server mints an id on your first vote or poll and returns it in the `x-tiebreak-voter` header. The app keeps it in the device's secure storage (Keychain or Keystore) and sends it on every request. The web app keeps using its cookie.

## Run it on your phone ($0)

```sh
cd mobile
npm install
npx expo start          # prints a QR code
```

Install **Expo Go** from the App Store or Google Play, then scan the QR code. On iPhone you scan it with the Camera app. The app talks to the live API (`expo.extra.apiUrl` in `app.json`, `https://tiebreak-phi.vercel.app`). To point it at a local `npm run dev`, change that to your computer's LAN address.

**No phone, no Xcode or Android Studio:** `npm run web` opens the app in your browser at http://localhost:8081. Use Chrome's device toolbar (⌘⇧M in DevTools) to get a phone-sized screen. It's the same code, rendered with react-native-web against the live API. In development, requests go through the dev server's `/live-api` proxy (`metro.config.js`), because the API doesn't allow other origins, and the anonymous id is kept in `localStorage` (`src/lib/client.web.ts`). It's good for flows and layout. Swipe gestures, secure storage and the in-app browser only behave exactly as on a phone in Expo Go or a simulator.

## Checks

```sh
npm test               # API client, swipe rule, share links, create-form validation (jest-expo)
npm run typecheck
npm run export         # builds the iOS and Android bundles: catches anything that won't compile for a phone
npx expo-doctor        # dependency and config check
```

## Store builds: owner decisions, not done yet

- **Accounts.** The Apple Developer Program is $99/year and Google Play is a one-time $25. Builds themselves can run free on EAS (`npx eas build`, free tier) or locally with Xcode and Android Studio.
- **Pro and the store payment rules.** Apple, and Google for most countries, expect digital upgrades like Pro to be sold through in-app purchase. Linking out to a web checkout is allowed only in some regions, such as US iOS since 2025. Before submitting, either add in-app purchase (RevenueCat has a free tier) or hide the "Get Pro" button in store builds. Check the current guidelines at that point.
- **Opening share links in the app.** Links already open with `tiebreak://p/<id>`. Opening `https://tiebreak-phi.vercel.app/p/<id>` links in the app needs universal links (iOS) and app links (Android): an `apple-app-site-association` file and an `assetlinks.json` served by the web app, plus `associatedDomains` and `intentFilters` in `app.json`. It's best done on a custom domain.
- **Icons and splash screen.** These are still the Expo template's.
