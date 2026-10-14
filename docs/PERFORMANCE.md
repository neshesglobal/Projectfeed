# Performance

## How it was measured

`apps/api/src/scripts/bench.mts` logs in as a user and times the main read endpoints against a database. The figure is the median of five runs after one warm-up run.

```
DATABASE_URL=postgres://… npx tsx src/scripts/bench.mts
```

**Dataset:** synthetic data generated at scale:

| Item | Count |
| --- | --- |
| Users | 20k |
| Posts | ~400k, spread over 30 days |
| Likes | ~12M |
| Follows | dense |
| Notes | located around one city |

**Environment:** the cloud development container, with the API and PostgreSQL 16 on the same machine. Treat the numbers as relative (before vs after), not as production latencies.

## Server: before and after (median ms)

| Endpoint | Before | After | Cause and fix |
| --- | ---: | ---: | --- |
| For You feed | 129 | 37 | The "popular" source ranked every post from the last 48 h on each request. It is the same for everyone, so it is now computed at most once a minute per server. |
| Discover | 271 | 42 | `power()` on `extract(epoch …)` ran in arbitrary-precision `numeric`. The ranking now uses `float8` and `exp()`. |
| Search posts, Top | 228 (max 599) | 10 | It scored every post matching the words. It now ranks the 1,000 most recent matches from the last 30 days. |
| Trends | 113 | 1 | It aggregated eight days of tags on every request. It is the same for everyone, so it is now cached for a minute. |
| Following / page 2 | 20 / 15 | 18 / 10 | Already index-driven; no change needed. |
| Discover nearby | 85 | 63 | Not changed. The synthetic notes all sit in one city, so the bounding box matches almost everything; see below. |
| Thread, profile, notifications, places, reels, me, unread | 2–10 | 2–10 | Already fast. |

**Responses are compressed** with brotli (quality 4) or gzip above 1 KB. A feed page is about 15 KB of JSON before compression, and JSON typically compresses by 70–85%. This matters more on mobile data than any of the query fixes above.

**Shared caches** live for `SHARED_CACHE_MS`, which defaults to 60 s. The tests set it to 0 so a post is visible as soon as it is written. In production, a new post can take up to a minute to reach Trends and the out-of-network "Popular" source. Following, profiles, threads and search are not cached.

## App

These changes have not been measured on a device; they cut requests rather than render time.

- **Background polling stops.** TanStack Query is now told when the app goes to the background (via `AppState`). Before this, the 30 s unread-count poll and the other polls kept running while the app was in the background.
- **Chat polling is much cheaper.** An open conversation used to refetch every loaded page of messages every 5 s. The bug in the old code also re-created that timer on each render. The app now asks for only the newest message every 5 s, and reloads the thread only when that message is one it hasn't shown yet. Polling stops when the screen isn't visible.
- **The inbox and the Home "new posts" check poll only while their tab is visible.** Tabs stay mounted, so before this they polled even when another tab was open.
- **Already in place:**
  - Media is served with `immutable` cache headers, and lists use thumbnails.
  - Feeds use FlashList.
  - Analytics events are batched every 10 s.

## Not done yet, in priority order

1. **CDN and object storage for media**, with HLS for video. Media is currently served by the API process, which will be the first bottleneck under real load.
2. **WebSockets or server-sent events for messages and notifications.** This replaces the remaining polls.
3. **Redis for the shared caches.** Each API server currently keeps its own cache, and there are no cross-server rate limits.
4. **A spatial index for Nearby.** Use PostGIS or a geohash column instead of a bounding box plus a haversine sort. This only matters once notes exist across many cities.
5. **Precomputed For You candidates** (fan-out on write). Needed only past roughly 100k daily users.
6. **Lighter post rows in the app.** Each post card creates about eight mutation hooks, and a like walks every cached list. One shared action handler per list would cut memory on long feeds.
7. **Read replicas** for the feed and search queries.
