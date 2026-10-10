# Projectfeed

An X-class real-time social app for iOS and Android: a React Native (Expo) client plus a TypeScript API on PostgreSQL. It is built for a verified professional network (see `docs/PLAN.md`). KYC is wired in but switched off until the vendor flow ships (`docs/DEV_PLAN.md` §2).

| Doc | What it covers |
|---|---|
| [`docs/PLAN.md`](docs/PLAN.md) | Study of X's algorithm and UI/UX, plus the full product plan |
| [`docs/DEV_PLAN.md`](docs/DEV_PLAN.md) | Core development plan, KYC design, sprints, compliance |

## What's built

| Area | Features |
|---|---|
| Accounts | Email/handle sign-up and login, rotating refresh tokens with theft detection, password change, sign out everywhere, GDPR data export, in-app account deletion |
| Profiles | Name, bio, company/role, sectors, location, website, avatar and banner, pinned post, protected accounts, "Follows you" |
| Graph | Follow/unfollow, follow requests for protected accounts, remove follower, block (two-way), mute, muted words/#tags/$tags, who-to-follow |
| Posts | 280 weighted characters, @mentions, #hashtags, $cashtags, links, up to 4 images (EXIF stripped), polls, threads, replies with audience controls, quotes, reposts, edit within 30 minutes with history, delete |
| Feeds | **For You** (rule-based Feed Mixer modelled on X's open-source Home Mixer: in-network + "liked by" + sector + popular sources, then filters, scoring, author diversity and an out-of-network cap, with a "why you're seeing this" reason) · **Following** (chronological, with reposts) · pinned **Lists** as Home tabs · "New posts" pill |
| Photos | Up to 4 per post, camera capture, image descriptions (alt text), EXIF/GPS stripped, WebP re-encode, full-screen viewer with pinch-to-zoom and double-tap zoom |
| Video | Upload from the library or camera (up to 10 minutes / 512MB) with live upload progress; server transcodes to H.264/AAC MP4 (720p-class, faststart), generates a poster and strips all metadata including location; inline autoplay (muted, one at a time, the most visible card) with duration countdown and a sound toggle; video in DMs |
| Reels | Full-screen vertical swipe feed (own tab, and opened by tapping any video), ranked by watch completion and average watch time, then engagement, freshness, portrait format and author diversity; tap to pause, double-tap to like, action rail, progress bar, neighbours preloaded; watch time reported per view |
| Engagement | Likes, bookmarks, view counts, engagement lists, share, "Not interested" |
| Notifications | Grouped ("A and 3 others liked…"), All / Verified / Mentions tabs, unread badges |
| Search | Posts (Top/Latest/Media, operators `from:`, `filter:media`, `min_faves:`), people, typeahead, trends counted by distinct authors |
| Messages | 1:1 and group DMs, message requests from non-followers, images, shared posts, edit/delete, read state |
| Safety | Report posts/users/messages (OSA-aligned categories with priority queue), block/mute everywhere, suspended/frozen account handling, KYC gate (`KYC_ENFORCED`) |
| Event log | Impressions, dwell, clicks: the training data for the future ML ranker |
| Design | **Liquid Glass** language (see below); Midnight and Daylight themes; accessibility labels |

Screenshots (web build of the same app) are in `docs/screenshots/`.

## Design language: Liquid Glass

Inspired by Apple's Liquid Glass, and deliberately unlike X's flat black-and-white list:

- **Backdrop:** a deep violet gradient with soft light orbs (Midnight), or soft lavender (Daylight).
- **Chrome is real glass:** the floating capsule tab bar, search capsule, top-bar buttons, bottom sheets, toasts, the composer toolbar and the account panel.
  - iOS 26+: Apple's native Liquid Glass (`expo-glass-effect`).
  - Older iOS and web: system blur.
  - Android: a tinted translucent fill, because live blur is costly there.
- **Content is frosted, not blurred:** posts, trends and suggestion cards are translucent rounded cards with a specular edge. This follows Apple's guidance to keep glass on the navigation layer, and keeps long feeds smooth.
- **Shapes and type:** large bold titles, concentric radii, pill chips with a glowing violet active state, gradient primary buttons.
- **Feed density:** Compact by default (about 4 text posts per screen; repost and "why you're seeing this" labels fold into the meta line; view counts only on the post page). Dense (one continuous glass panel, about 5 per screen) and Comfortable are available under Settings → Appearance.
- **Gold is reserved for the ID-verified badge.**
- **Tokens:** all in `apps/mobile/src/theme/index.ts`; primitives in `src/components/glass.tsx`.

Screenshots are in `docs/screenshots/liquid-glass/`.

## Repository layout

```
apps/api       Fastify + PostgreSQL REST API (TypeScript), integration tests
apps/mobile    Expo / React Native app (iOS, Android; web for development)
packages/shared  Shared zod schemas, API types and text rules (character counting, entities)
docs/          Plans and screenshots
```

## Running locally

Prerequisites: Node 22+, pnpm 10, PostgreSQL 16 (with the `citext` and `pg_trgm` contrib extensions), and `ffmpeg`/`ffprobe` on the PATH for video processing.

```bash
pnpm install

# Database
createdb projectfeed
cp apps/api/.env.example apps/api/.env          # adjust DATABASE_URL if needed

# API (runs migrations on start), then demo data
pnpm --filter @projectfeed/api dev
pnpm --filter @projectfeed/api seed             # demo users, posts and reels (needs ffmpeg); login: demo / projectfeed-demo

# App
pnpm --filter @projectfeed/mobile start         # press i (iOS simulator), a (Android emulator) or w (web)
```

On a physical phone, point the app at your machine's LAN address:
`EXPO_PUBLIC_API_URL=http://192.168.x.x:4000 pnpm --filter @projectfeed/mobile start`.
The Android emulator reaches `localhost` automatically via `10.0.2.2`.

### Tests and checks

```bash
createdb projectfeed_test
pnpm --filter @projectfeed/api test        # 52 integration tests against a real Postgres (and real ffmpeg)
pnpm typecheck                              # API, shared and mobile
```

## Not built yet (by design)

- **KYC vendor flow** (Sumsub/Veriff SDK, webhooks, review queue). The `kyc_level` column, badge and `KYC_ENFORCED` gate are already in place.
- **Adaptive streaming**: video is a single 720p MP4 today; production should use a managed transcoder (Mux or Cloudflare Stream) for HLS adaptive bitrate. The media `status` contract stays the same.
- **Push notifications** (APNs/FCM), **WebSocket** delivery for DMs (the app polls for now), **S3** storage (local disk adapter today), **CSAM hash-matching** (the hook point is marked in `routes/media.ts`) and an **admin moderation console**.
- **AI features and ML ranking.** The Feed Mixer's stages are the seams for these.

### Must be in place before a public launch

The CSAM hash-matching and the Online Safety Act duties (risk assessment, age assurance via KYC, complaints process) must be in place before any public launch. See `docs/DEV_PLAN.md` §9.
