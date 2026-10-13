# Discover: notes, verified reviews, places and collections

Discover is the photo-first side of Projectfeed, inspired by RedNote (Xiaohongshu). The timeline (Home) is for
conversation; Discover is for things worth saving: a café, a trek, a street-food stall, a shopping guide.

Because every Projectfeed account has passed an ID check, **every review is a verified review**. That is the
point of difference against Google Maps and Zomato reviews, where anonymous and paid reviews are common.

## Navigation

| Tab | What it is |
|---|---|
| Home | Timeline (For you / Following / Lists). Messages moved to the header (paper-plane icon, unread badge). |
| **Discover** (new) | Two-column masonry grid of notes. Topics: For you, Nearby, Reviews, Food, Travel, Guides, Shopping, Business. `+` opens the note composer. |
| **Trends** (was Explore) | What's happening, trending reels, who to follow, topic chips. |
| Reels | Unchanged. |
| Activity | Notifications. |

## Notes

A note is a post with `kind = 'note'`:

- **1–10 photos, or one video** (up to 10 minutes). The first photo is the cover in the grid.
- **Title** (2–60 characters) and **text** (up to 1,000 characters, with #hashtags and @mentions).
- An optional **place**, an optional **review** (1–5 stars and a month visited), and an optional **Paid
  partnership** label (verified businesses and creators only, as on posts).

Notes appear in Discover and also in Home timelines, where the card shows the title, stars and place. Comments are
ordinary replies, so moderation, Community Notes, translation, reporting and blocking all apply unchanged.

### Discover ranking

```
score = ln(2 + likes + 2·saves + 3·comments) × 0.5^(age / 48h) × (0.6 + 0.008 × author trust score)
```

Saves count double and comments triple, because they show stronger intent than a like. Freshness halves every two
days. The author's private trust score (see `TRUST_AND_IDENTITY.md`) scales reach between 0.6× and 1.4×.
Reach-limited, removed and sensitive notes, and notes from protected accounts, are never recommended in Discover.

**Nearby** sorts by distance within 25 km of the phone's location. The location is sent for that request only and
is never stored or shown.

## Places and maps (free)

The product only needs to **show a map** and **open directions**, so no paid maps API is used.

| Need | How | Cost |
|---|---|---|
| Map on the note and place pages, pin picker | `react-native-maps`: Apple Maps (MapKit) on iPhone, Google Maps SDK on Android | Free (Apple: no key; Google: map loads in the Maps SDK for Android are not charged, though Google requires a billing account on the project) |
| Directions | Deep link into the phone's own Maps app: `maps.apple.com/?daddr=` on iPhone, `google.com/maps/dir/?api=1&destination=` on Android | Free, no key |
| Current location, city name | `expo-location`: OS location and the OS reverse geocoder | Free |
| Place search | Our own `places` table, created by users | Free |

We deliberately do **not** use Google Places autocomplete or the Places/Directions web APIs, which are billed per
request. Instead:

- Reviewers pick from **places already on Projectfeed near them** (sorted by distance, filterable by name), or
  **add a new place** by dragging the map under a pin, typing a name and choosing a category. The city is filled in
  from the phone's geocoder and can be edited.
- **Duplicates are merged on the server**: a new place within 75 m of an existing one with a similar name
  (`pg_trgm` similarity > 0.5) returns the existing place instead. Each account can add 20 places a day.
- A place's **rating is calculated live** from its reviews, so removing a review in moderation (or suspending its
  author) updates the rating immediately.

### Setup for the Android map

Apple Maps needs no setup. For Android:

1. In Google Cloud, enable **Maps SDK for Android** and create an API key restricted to the Android app
   (package `com.neshesglobal.projectfeed` plus the signing certificate's SHA-1). Do not enable the Places or
   Directions APIs.
2. Build with `GOOGLE_MAPS_ANDROID_KEY=<key>` set (EAS secret or local env). `apps/mobile/app.config.js` injects it
   at build time; it is never committed.

The web build draws a stylised map placeholder instead of loading map tiles.

## Collections

- A user's saves can be organised into **collections** (for example "Goa trip"), public or private.
- Saving into a collection also bookmarks the note, so **All saves** always contains everything.
- Removing a bookmark also removes the note from that user's collections.
- Collections are listed from the account menu (**Collections**); public collections are visible to others via
  `GET /v1/users/:id/collections`.

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/v1/notes` | Create a note (verified accounts) |
| GET | `/v1/feed/discover?topic=&lat=&lng=&cursor=` | `topic`: `for-you`, `nearby` (needs lat/lng), `reviews`, or a hashtag |
| GET | `/v1/search/notes?q=` | Words in the title or text, or `#tag`; returns `related` hashtags |
| GET | `/v1/places/nearby?lat=&lng=&q=&radius=` | For the location picker |
| POST | `/v1/places` | Returns `{ place, existing }`; `existing` is true when merged into a duplicate |
| GET | `/v1/places/:id` · `/v1/places/:id/notes?reviews=1` | Place with live rating; its notes or reviews |
| GET/POST/PATCH/DELETE | `/v1/me/collections[/:id]` | Your collections |
| POST/DELETE | `/v1/me/collections/:id/items[/:postId]` | Add or remove a note |
| GET | `/v1/posts/:id/saved-in` · `/v1/collections/:id` | Which of your collections hold a post; a collection's notes |

Schema: `apps/api/migrations/009_notes_places.sql`. Tests: `apps/api/test/discover.test.ts`.

## Review integrity

- Reviews are tied to a verified identity, and the visit month is shown.
- A visit date in the future is rejected.
- Paid or incentivised reviews must carry the Paid partnership label (ASCI influencer guidelines). Reporting a
  review for being undisclosed promotion uses the existing report flow.
- **Before launch:** add a "one review per place per person" rule (or show only the latest), and consider holding
  back reviews from accounts created in the last few days, to blunt review bombing.

## Screenshots

`docs/screenshots/discover/`: Discover grid, Nearby, a note with its map and directions, a place page, the review
composer, the location picker and new-place pin, collections, note search, Trends and the Home header.
