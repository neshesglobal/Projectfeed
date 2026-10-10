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
| Safety | Report posts/users/messages (OSA-aligned categories with priority queue), block/mute everywhere, KYC gate (`KYC_ENFORCED`) |
| Moderation | **Trust & Safety console** (`apps/admin`): priority report queue, public content and latest-uploads browsing, account lookup, remove/restore, sensitive labels, reach limits, warnings, suspensions (read-only), bans, appeals reviewed by a different moderator, five staff roles, **tiered access** to protected posts and DMs with a typed justification, and an **append-only access log**. Users get a statement of reasons and can appeal from **Settings → Account status**. See `docs/MODERATION.md` |
| Upload screening | Every photo and sampled video keyframe is hash-matched **before storage**; a match is quarantined (never stored), the account is frozen silently and a P0 report goes to compliance. Pluggable scanner (local hash list for development; PhotoDNA adapter stub) |
| Event log | Impressions, dwell, clicks: the training data for the future ML ranker |
| Design | **Liquid Glass** language (see below); Midnight, Dark and Daylight themes; accessibility labels |

Screenshots (web build of the same app) are in `docs/screenshots/`.

## Design language: Liquid Glass

Inspired by Apple's Liquid Glass, and deliberately unlike X's flat black-and-white list:

- **Three themes** (Settings → Appearance, with live previews):
  - **Midnight:** deep violet gradient with soft light orbs.
  - **Dark:** true dark mode, near-black with neutral graphite glass and violet only for accents. Easier on the eyes at night and OLED-friendly.
  - **Daylight:** soft lavender.
  - **Automatic** (default) follows the device: Daylight by day, and at night the user's choice of Midnight or Dark.
- **Chrome is real glass:** the floating capsule tab bar, search capsule, top-bar buttons, bottom sheets, toasts, the composer toolbar and the account panel.
  - iOS 26+: Apple's native Liquid Glass (`expo-glass-effect`).
  - Older iOS and web: system blur.
  - Android: a tinted translucent fill, because live blur is costly there.
- **Content is frosted, not blurred:** posts, trends and suggestion cards are translucent rounded cards with a specular edge. This follows Apple's guidance to keep glass on the navigation layer, and keeps long feeds smooth.
- **Shapes and type:** large bold titles, concentric radii, pill chips with a glowing violet active state, gradient primary buttons.
- **Feed density:** Dense by default: one continuous glass panel, about 5 text posts per screen. Users can switch to Compact (separate cards, about 4 per screen) or Comfortable (roomiest) under Settings → Appearance; the choice is saved on the device.
- **Gold is reserved for the ID-verified badge.**
- **Tokens:** all in `apps/mobile/src/theme/index.ts`; primitives in `src/components/glass.tsx`.

Screenshots are in `docs/screenshots/liquid-glass/`.

## Repository layout

```
apps/api       Fastify + PostgreSQL REST API (TypeScript), integration tests
apps/mobile    Expo / React Native app (iOS, Android; web for development)
apps/admin     Trust & Safety console (Vite + React), staff only
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
pnpm --filter @projectfeed/api seed             # demo users, posts, reels and a moderation queue (needs ffmpeg); login: demo / projectfeed-demo

# App
pnpm --filter @projectfeed/mobile start         # press i (iOS simulator), a (Android emulator) or w (web)
```

On a physical phone, point the app at your machine's LAN address:
`EXPO_PUBLIC_API_URL=http://192.168.x.x:4000 pnpm --filter @projectfeed/mobile start`.
The Android emulator reaches `localhost` automatically via `10.0.2.2`.

Moderation console (proxies to the API on port 4000):

```bash
pnpm --filter @projectfeed/admin dev            # http://localhost:5175
```

The seed creates one staff account per role, all with the password `projectfeed-staff`:
`support@`, `moderator@`, `senior@`, `compliance@` and `admin@staff.projectfeed.app`. Local development only.

### Tests and checks

```bash
createdb projectfeed_test
pnpm --filter @projectfeed/api test        # 70 integration tests against a real Postgres (and real ffmpeg)
pnpm typecheck                              # API, shared, mobile and admin
```

## Not built yet (by design)

- **KYC vendor flow** (Sumsub/Veriff SDK, webhooks, review queue). The `kyc_level` column, badge and `KYC_ENFORCED` gate are already in place.
- **Adaptive streaming**: video is a single 720p MP4 today; production should use a managed transcoder (Mux or Cloudflare Stream) for HLS adaptive bitrate. The media `status` contract stays the same.
- **Push notifications** (APNs/FCM), **WebSocket** delivery for DMs (the app polls for now) and **S3** storage (local disk adapter today).
- **A production hash-matching provider.** The screening pipeline is built and tested, but against a local hash list of benign test images. Real known-CSAM matching needs PhotoDNA (via IWF or NCMEC membership) or Thorn Safer under a signed agreement.
- **AI classifiers** for unknown abusive imagery, nudity, violence and spam. These plug into the same scanner interface.
- **Staff 2FA/SSO and IP allow-listing** for the console (password-only today).
- **AI features and ML ranking.** The Feed Mixer's stages are the seams for these.

### Must be in place before a public launch

- A production hash-matching provider and the NCA reporting process.
- The Online Safety Act duties: illegal-content and children's risk assessments, age assurance (via KYC), and a complaints process. The appeals flow covers part of the complaints process.
- A privacy policy that discloses moderator access (see `docs/MODERATION.md` §7).
- Staff 2FA.

See `docs/DEV_PLAN.md` §9.
