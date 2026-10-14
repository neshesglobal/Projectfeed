# Testing

| Layer | What | Command | Last result |
|---|---|---|---|
| Unit | Shared rules used by app and API: map links and distances, regions, post/note/place validation, sign-up rules, GSTIN/CIN/Udyam checks, language detection | `pnpm --filter @projectfeed/shared test` | 14/14 pass |
| Integration | Every API area against a real PostgreSQL and real ffmpeg: auth, posts, feeds, graph, media and video, Reels, messaging, lists, search, moderation and screening, translation, About this account, badges, trust, Community Notes, Discover, reply controls, GIFs | `pnpm --filter @projectfeed/api test` | 138/138 pass |
| Static | Type-check of API, shared, mobile and admin; web and admin production builds | `pnpm typecheck` | Clean |
| System | 29 user journeys driven in a browser against the running API and the web build of the app (same code as iOS/Android), plus the moderation console | `node e2e/system.mjs` | 29/29 pass, no page errors |

## System test journeys

Sign-up (including a rejected short password), the Home feed and filters, likes, bookmarks, and posting.
Posting covers a text post, reply limits with regions, a GIF post and a reply.
The run then covers following, About this account, Trends, and post and people search.
Discover covers the grid, Nearby with geolocation and the Reviews filter.
The note journey checks the verified-review label and that the Directions link is correct.
It also covers saving to a new collection, the place page, the location picker and a direct message.
The run finishes with Activity, reporting a post, editing a profile, the Daylight theme and the settings screens.
Last come the account menu, logging out, a rejected wrong password, logging back in and the moderation console showing the report.

Each step checks the result on the server through the API, not just the screen. Running it needs the API on :4000
(seeded), the web build served on :8081 (`npx expo export --platform web` and any static server) and the admin
console on :5175 (`vite preview`).

## Not covered by automated tests

- **Native iOS and Android rendering:** SF Symbols, Liquid Glass, haptics, Apple Maps and Google Maps SDK, the
  camera and the photo picker. These need a simulator or a device; checked by hand.
- **Video playback in the browser test:** headless Chromium has no H.264 codec.
- **Real GIPHY, Tenor and Google Translate calls:** these need API keys. Adapters are tested with mocked responses.
- **Load and performance testing.**
