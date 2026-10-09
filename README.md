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
| Engagement | Likes, bookmarks, view counts, engagement lists, share, "Not interested" |
| Notifications | Grouped ("A and 3 others liked…"), All / Verified / Mentions tabs, unread badges |
| Search | Posts (Top/Latest/Media, operators `from:`, `filter:media`, `min_faves:`), people, typeahead, trends counted by distinct authors |
| Messages | 1:1 and group DMs, message requests from non-followers, images, shared posts, edit/delete, read state |
| Safety | Report posts/users/messages (OSA-aligned categories with priority queue), block/mute everywhere, suspended/frozen account handling, KYC gate (`KYC_ENFORCED`) |
| Event log | Impressions, dwell, clicks: the training data for the future ML ranker |
| Design | Light, Dim and Lights-out themes; Neshes gold accent; accessibility labels; X-style layout |

Screenshots (web build of the same app) are in `docs/screenshots/`.

## Repository layout

```
apps/api       Fastify + PostgreSQL REST API (TypeScript), integration tests
apps/mobile    Expo / React Native app (iOS, Android; web for development)
packages/shared  Shared zod schemas, API types and text rules (character counting, entities)
docs/          Plans and screenshots
```

## Running locally

Prerequisites: Node 22+, pnpm 10, PostgreSQL 16 (with the `citext` and `pg_trgm` contrib extensions).

```bash
pnpm install

# Database
createdb projectfeed
cp apps/api/.env.example apps/api/.env          # adjust DATABASE_URL if needed

# API (runs migrations on start), then demo data
pnpm --filter @projectfeed/api dev
pnpm --filter @projectfeed/api seed             # demo login: demo / projectfeed-demo

# App
pnpm --filter @projectfeed/mobile start         # press i (iOS simulator), a (Android emulator) or w (web)
```

On a physical phone, point the app at your machine's LAN address:
`EXPO_PUBLIC_API_URL=http://192.168.x.x:4000 pnpm --filter @projectfeed/mobile start`.
The Android emulator reaches `localhost` automatically via `10.0.2.2`.

### Tests and checks

```bash
createdb projectfeed_test
pnpm --filter @projectfeed/api test        # 45 integration tests against a real Postgres
pnpm typecheck                              # API, shared and mobile
```

## Not built yet (by design)

- **KYC vendor flow** (Sumsub/Veriff SDK, webhooks, review queue). The `kyc_level` column, badge and `KYC_ENFORCED` gate are already in place.
- **Video** (Mux), **push notifications** (APNs/FCM), **WebSocket** delivery for DMs (the app polls for now), **S3** storage (local disk adapter today), **CSAM hash-matching** (the hook point is marked in `routes/media.ts`) and an **admin moderation console**.
- **AI features and ML ranking.** The Feed Mixer's stages are the seams for these.

### Must be in place before a public launch

The CSAM hash-matching and the Online Safety Act duties (risk assessment, age assurance via KYC, complaints process) must be in place before any public launch. See `docs/DEV_PLAN.md` §9.
