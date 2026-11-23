# Sudoku Vault: Logical Puzzles

Offline-first Sudoku for Android, built with Expo SDK 58, React Native 0.88 and TypeScript.
No accounts, no backend. The only feature that uses the network is the optional rewarded ad.

Ways to play: Play Now (4×4, 6×6 and 9×9), Levels (30 stages per difficulty: Easy on 4×4, Medium on 6×6, Hard and
Expert on 9×9, each with a time limit, a mistake limit and time-based stars),
Daily Puzzle, Weekly Challenge, Speed Round, Challenge a Friend, variants, technique packs, practice drills,
and puzzles the player types in.

## Run it

```bash
npm install
npx expo start          # scan the QR code with Expo Go (SDK 58)
```

Expo Go does not contain the AdMob SDK, so there the app runs with **simulated** rewarded ads
(`ADS_DEV_MOCK=1` in `.env`) or, with that flag off, with ads shown as unavailable. Everything else is real.

To exercise real AdMob test ads and the consent form you need a development build:

```bash
npx eas-cli@latest build --profile development --platform android   # cloud build, no local JDK needed
# or, with a JDK 17 and the Android SDK installed locally:
npx expo run:android
```

## Checks

```bash
npm run check             # typecheck + lint + tests + puzzle validation
npm run typecheck
npm run lint
npm test
npm run validate:puzzles  # build-time pool validation; exits non-zero on any bad puzzle
npm run generate:puzzles  # adds puzzles to src/data/puzzles.json up to the targets in the script; never changes existing ids
```

Last run: typecheck clean, lint clean, **181 of 181 tests passed**, puzzle validation passed,
`expo-doctor` 20 of 20, Android JS bundle exports, and `expo prebuild` writes the AdMob app ID into the manifest.

### Verified puzzles

| Difficulty | Puzzles | Solution path needs |
| --- | --- | --- |
| Easy | 150 | hidden singles only, 32+ givens |
| Medium | 150 | naked and hidden singles |
| Hard | 150 | locked candidates and/or naked or hidden pairs |
| Expert | 100 | naked or hidden triples, X-Wings, Swordfish and/or XY-Wings |

Every puzzle is checked for valid givens and exactly one solution by a brute-force solver that shares no
code with the technique engine, then re-graded by replaying its logical solution path. Practice has 12
drills each for naked singles, hidden singles and locked candidates. The Daily Puzzle rotates through the
450 Easy, Medium and Hard puzzles. Hard and Expert levels use a fixed set of 30 puzzles each, taken from the first
80 Hard and the first 50 Expert puzzles, so growing the pool never changes a level. Easy and Medium levels use 30
generated 4×4 and 30 generated 6×6 puzzles in `src/data/miniLevels.json` (`npm run generate:minis`).

Level limits (set in `LEVEL_TIMES` and `LEVEL_MISTAKES`): Easy 2 minutes, 3 mistakes (3 stars within 0:30, 2 within 1:00);
Medium 4 minutes, 5 mistakes (1:00 and 2:00); Hard 8 minutes, 8 mistakes (3:00 and 5:00); Expert 10 minutes, 10 mistakes
(4:00 and 6:00). One star for finishing in time.

## What the tests cover

All automated, in Node, against a real SQLite database (the same SQL the app runs) and a deterministic mock ad provider. No live ad is ever requested.

- First launch with no network, completing a puzzle offline, restore after restart (board, notes, undo history, elapsed time, hint state)
- Notes, smart notes and single-action undo; read-only givens; mistake counting
- Free hint, free reopen for an unchanged board, credit spending, no charge when blocked or unsupported, rollback when credits run out
- Daily determinism, midnight rollover, a puzzle staying with its start date, one completion per session and per date
- Earned reward, early dismissal, no fill, offline, load and show failures, timeout, duplicate callbacks, reward arriving after close, rapid taps, consent ineligibility, spending a credit offline after earning it online
- Ad configuration: test IDs by default, build failure for missing, malformed or test IDs in production
- Levels: 30 distinct puzzles per difficulty on the right board size, each with one solution; time limits and time-based stars; unlock order; ending on mistakes or time; continuing with one extra mistake or extra time per ad
- Rewards: experience and player levels, one-time credit rewards (daily, streak, level milestones, badges), never paid twice
- Streaks: on-time dailies only, repair of yesterday through one ad, applied once per ad
- Ad rewards: extra time and extra mistakes with their caps, on both board sizes and never for daily, weekly or challenge games; the Speed Round extension counted once; the daily gift once per day; doubling a game's credits once; board theme unlocks that survive a reset
- Auto-filled notes, colour marks, reset (keeps credits and paid rewards) and backup export and restore (credits excluded)

### Not verified on a device

No phone was connected and the emulator could not start (system drive full), so none of the following was run:

- The app UI on a phone or emulator, including layout on compact screens, TalkBack labels and performance on low-end hardware
- Google test rewarded ads and the UMP consent form in a native build
- Timer pause and resume around a real ad, and process-death restore on a real device (covered only at the storage level)
- The Daily Puzzle reminder notification, and saving and restoring a backup file through the system file picker

Please run through these on a development build before release.

## AdMob configuration

IDs come from environment variables, read in one place (`app.config.ts`); see `.env.example`.

| Variable | What it is | Where to find it |
| --- | --- | --- |
| `ADMOB_ANDROID_APP_ID` | **App ID**, format `ca-app-pub-…~…`. Baked into `AndroidManifest.xml` by the config plugin. | AdMob → Apps → your app → App settings |
| `ADMOB_REWARDED_UNIT_ANDROID` | **Rewarded ad unit ID**, format `ca-app-pub-…/…`. Used at runtime. | AdMob → Apps → your app → Ad units |
| `ADMOB_IOS_APP_ID`, `ADMOB_REWARDED_UNIT_IOS` | Optional iOS equivalents. | Same, for the iOS app |
| `ADS_MODE` | `test` (default) or `production`. | — |

- `ADS_MODE=test` uses Google's sample app ID and test rewarded unit, so it can never serve real ads.
- `ADS_MODE=production` (set by the `production` profile in `eas.json`) **fails the build** if an Android ID is missing, malformed, or a Google test ID.
- For EAS builds, set the production values as EAS environment variables for the production environment rather than committing them.

Reward rules, as implemented: one free hint per 9×9 game; one earned ad reward adds exactly 2 credits; 1 credit buys one hint.
The same rewarded unit also powers the other opt-in offers: one extra mistake or extra time in a Levels stage (each up to
2 per attempt), one extra mistake in a Play Now game with a mistake limit (up to 2 per game), a 30-second Speed Round
extension (once per round), doubling the hint credits a finished game paid (once per game), a daily gift of 3 credits
(once per day), unlocking a board theme (three themes are free), and repairing yesterday's missed daily streak. Every
offer is a button the player presses; no ad ever starts on its own. Credits are also earned by playing (daily puzzles, streaks, level milestones,
badges and player levels), each paid once under a fixed reward id.
Credits are granted only from the SDK's earned-reward event, recorded with a unique attempt ID in the same SQLite
transaction as the balance change. The balance is local convenience data: it is not server-verified and is lost on uninstall.

## What you still need to do

### AdMob

1. Create the Android app in AdMob and one **Rewarded** ad unit. Put the two IDs in the variables above.
2. **Privacy & messaging** (AdMob → Privacy & messaging): create and publish a *European regulations* message for this app. Without a published message the consent form never appears and EEA/UK users are not asked. Add a *US states* message if you want one.
3. In Privacy & messaging, also set the privacy policy URL the message links to.
4. Link the AdMob app to the Play Store listing once the app is published, and complete AdMob's payment and account verification.
5. Publish **app-ads.txt**: host the line AdMob gives you (AdMob → Apps → app-ads.txt) at `https://<your-domain>/app-ads.txt`, and set that same domain as the developer website in the Play listing.
6. Test consent on a dev build using a test device and the UMP debug geography before release.

### Google Play

1. Create the app in Play Console for the Android package `com.sudoku.studio` defined in `app.config.ts`, and set up signing (EAS manages it by default).
2. **Privacy policy**: required, because the ads SDK uses the advertising ID. Host one and add the URL in the Play Console. It should say the app has no accounts, stores game data only on the device, and uses Google AdMob for optional rewarded ads.
3. **Ads declaration**: answer *Yes, my app contains ads*.
4. **Advertising ID declaration**: answer *Yes*, use case *Advertising or marketing* (the Mobile Ads SDK adds the `AD_ID` permission).
5. **Data safety**: the app itself collects nothing, but declare what the Google Mobile Ads SDK collects. Use Google's published disclosure for the SDK as your source; it covers device or other IDs, approximate location, app interactions and diagnostics, shared for advertising.
6. **Target audience and content**: if you include children in the target audience, extra Families ad requirements apply that this build does not implement. Select 13+ unless you plan to add them.
7. Content rating questionnaire, store listing, and the release itself.

## Project layout

```
app.config.ts        Expo config and the only place AdMob IDs are resolved
src/engine/          Pure TypeScript: grid, brute-force solver, techniques, grading, hints, pool validation
src/game/            Sessions and undo, hint pricing, daily selection, drills, settings
src/storage/         Transactional SQLite wrapper and repository (schema version 1)
src/ads/             Provider interface, reward controller, Google provider, mock provider, config
src/state/           App store, play clock, actions
src/ui/, src/app/    Components and Expo Router screens
src/data/            Bundled, validated puzzles and drills
scripts/             Puzzle generator and validator
tests/               Vitest suites
```
