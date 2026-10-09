# Projectfeed — Core Development Plan (v1, no AI)

> **Build status (9 Oct 2026):** core modules M1, M3–M5, M7–M12, M14, M15 and the reporting part of M13 are built (see `README.md`). KYC (M2) is deferred at the founder's request; the `kyc_level` field, badge and `KYC_ENFORCED` gate are in place so the vendor flow can be added later without a refactor. **Deviations from §3, chosen for MVP speed:** REST on Fastify instead of NestJS/GraphQL; timelines read from Postgres instead of Redis fan-out (move to Redis at roughly 10k DAU); DMs poll instead of WebSocket; images only (video via Mux next); local disk storage behind an S3-ready interface.

Prepared 9 October 2026. This document builds on `docs/PLAN.md` and supersedes its phasing for core features.

**Scope:** every core (non-AI) function of an X-class app on iOS and Android, with **mandatory KYC and ID verification for every user**. The AI features (explain/summarise, AI moderation triage, ML ranking) are deferred. The architecture leaves a defined place for each of them (see §12).

---

## 0. Verdict on universal KYC

**I agree with the decision, for a specific reason:** it turns the platform's main weakness (no network yet) into its selling point. A feed where every account is a verified real person has no bots, no impersonators, and far less fraud. That is exactly what commodity and trade professionals cannot get on X, Telegram or LinkedIn. It also hands us the **UK Online Safety Act age-assurance duty almost for free**: Ofcom lists photo-ID matching with a liveness check as "highly effective age assurance", so we can run an 18+ service.

**What it costs us, stated plainly:**

| Cost | Size | Mitigation |
|---|---|---|
| Sign-up drop-off | 20–40% of starters typically abandon at the ID step | A fast flow (under 2 minutes), clear "why we verify" messaging, and a read-only preview while verification is pending |
| Per-user fee | About £0.80–£2.50 per verification (indicative; negotiate volume) | Budget about £2 per signup, including retries |
| Special-category data (UK GDPR Art. 9) | Face biometrics used for identification are special-category data | Explicit consent, a **mandatory DPIA**, the vendor stores the raw images and we store only the result |
| Exclusion | Users without a passport, ID card or driving licence | Accept the full vendor document list (200+ countries); manual review route |
| App Store review | Apple's reviewer cannot pass KYC | Provide a pre-verified demo account in App Store Connect review notes |

**Sanctions — a point you must not miss.** Once we hold verified identities, we **know** who our users are. Providing paid services or monetisation to an OFSI- or OFAC-designated person can breach asset-freeze rules. Every user is therefore screened against sanctions and PEP lists at onboarding and **monitored continuously**. (*PEP* = politically exposed person, a public official or close associate, who carries higher corruption risk.) A match freezes the account pending review. This is designed in below.

---

## 1. Scope

### In scope (this plan)

1. Accounts & authentication
2. **KYC / ID verification + sanctions screening** (individuals), with an optional KYB tier for companies (*KYB* = Know Your Business, verifying a company's registration and its owners)
3. Profiles
4. Social graph (follow, block, mute)
5. Posting (text, images, video, GIF, polls, threads, replies, quotes, reposts, drafts, scheduling, edit)
6. Media pipeline
7. Timelines: Following (chronological) + For You (rule-based ranking, no ML)
8. Engagement (like, bookmark, share, views)
9. Notifications (in-app + push)
10. Search & Explore (users, posts, hashtags, trends)
11. Direct messages (1:1 and group)
12. Lists
13. Trust & safety: reporting, moderation console, appeals, CSAM hash-matching
14. Settings, privacy, GDPR rights (export, delete)
15. Event logging & analytics (the future ML data source)
16. Admin back office

### Deferred

AI features, ML ranking, Communities, Spaces, live video, Articles, Community Notes, Premium/subscriptions, ads, creator payouts, payments, end-to-end encrypted DMs (v1 DMs are encrypted in transit and at rest; E2EE comes later).

---

## 2. KYC & identity verification design

### 2.1 Vendor recommendation: **Sumsub** (alternatives: Veriff, Onfido/Entrust, Persona)

Why Sumsub for us:
- One SDK covers **ID document + liveness + face match + duplicate-face detection + sanctions/PEP/adverse-media screening + ongoing monitoring + KYB**, and has native iOS, Android and React Native SDKs.
- Strong document coverage across our target regions (Africa, Middle East and Asia included), where some US-centric vendors are weaker.
- KYB with UBO (ultimate beneficial owner) checks reuses Neshes DD logic for company badges.

Run a **2-week vendor bake-off** in Sprint 0: Sumsub against Veriff on pass rates using 30 real test identities from our target countries, cost per verification, and SDK quality. Do not sign a minimum-volume contract before that.

### 2.2 Verification levels

| Level | Requirement | Unlocks | Badge |
|---|---|---|---|
| **L0 — Registered** | Email/phone verified, account created | Read-only preview: view feeds, search; **cannot** post, reply, like, follow or DM | none |
| **L1 — ID Verified** (mandatory) | Government photo ID + liveness selfie + face match + age ≥ 18 + sanctions/PEP clear + no duplicate | Full platform | ✓ "ID verified" |
| **L2 — Organisation** (optional) | KYB: company registry, UBOs, authorised signatory (who must be an L1 user) | Organisation account, affiliate badges for staff | Organisation badge |

L0 is time-limited. If L1 is not completed in **14 days**, the account is suspended, and deleted after 30 more days.

### 2.3 KYC state machine

```
            start_kyc            vendor: GREEN + screening clear
 NOT_STARTED ───────► PENDING ─────────────────────────────────► VERIFIED
                         │  vendor: RED (retryable)                │ ongoing-monitoring hit /
                         ├──────────────► RETRY_REQUIRED ──► PENDING│ document expiry
                         │  vendor: RED (final) / duplicate         ▼
                         ├──────────────► REJECTED ──appeal──► MANUAL_REVIEW
                         │  sanctions/PEP possible match           │
                         └──────────────► MANUAL_REVIEW ──────────┴──► VERIFIED / REJECTED / FROZEN
```

Rules:
- **FROZEN** means a confirmed sanctions match. The account is invisible and read-only, no data is deleted, compliance is notified, and the "tipping-off" principle applies: the UI shows only "Account under review".
- **PEP match** does not mean a rejection. It sets the account to verified with an internal flag and an enhanced-monitoring tag.
- **Duplicate face** is rejected by default (one person, one personal account). Organisation accounts are separate L2 entities linked to an L1 owner.
- **Re-verification** is triggered by a legal name change, document expiry (if the vendor reports it), or suspected account takeover (new device + password reset + a high-value action).

### 2.4 Integration flow

1. The client calls `POST /kyc/session`. Our API creates a vendor applicant with an external ID equal to our `user_id`, and returns a short-lived SDK access token.
2. The client launches the native vendor SDK (document capture → liveness → submit). **No images pass through our servers.**
3. The vendor sends a webhook to `POST /webhooks/kyc` (HMAC-signed, idempotent, stored raw for audit). It is processed asynchronously.
4. A worker fetches the applicant result and maps it to our state machine. It writes `kyc_verifications`, updates `users.kyc_level`, and emits a `kyc.status_changed` event, which triggers a push notification and unlocks features.
5. The client polls `GET /kyc/status` and also receives a WebSocket push. Most results arrive in under 60 seconds; manual review can take hours.

### 2.5 What we store (data minimisation)

| We store | We do **not** store |
|---|---|
| Vendor applicant ID, status, level, review timestamps | ID images, selfie, biometric templates (the vendor holds these under a DPA) |
| Verified legal name (encrypted at field level), date of birth (encrypted), document country, document type | Document number (only a hash, if needed for duplicate checks) |
| Screening result category (clear / PEP / sanctions / adverse media) | Full screening dossiers (they stay in the vendor console) |
| Audit log of every status change and who made it | |

- Access to decrypted legal names is restricted to the `compliance` role and logged.
- **Retention:** the result is kept for the life of the account plus 5 years (our policy choice, to support fraud and legal defence; to be confirmed with counsel). The vendor deletes raw data according to our configured retention.

### 2.6 Public identity policy — **decision required**

- **Option A (recommended for the professional vertical):** the public display name must match the verified legal name, with a nickname optional. This gives maximum trust and suits professionals.
- **Option B:** a free display name, with only the "ID verified" badge shown publicly. This is more private, but impersonation is easier ("verified, but as whom?").

My recommendation is Option A, plus a separate brand/organisation account type for anything else.

---

## 3. Architecture & repository layout

**Monorepo** (pnpm + Turborepo):

```
Projectfeed/
├─ apps/
│  ├─ mobile/          React Native + Expo (iOS & Android)
│  ├─ api/             NestJS (TypeScript) modular monolith — GraphQL + REST
│  ├─ workers/         BullMQ job processors (fan-out, media, notifications, KYC webhooks, search indexing)
│  └─ admin/           Next.js back-office (moderation, KYC review, support)
├─ packages/
│  ├─ shared/          Types, validation (zod), constants, error codes
│  ├─ ui/              Design tokens + shared components (mobile)
│  └─ db/              Prisma/Drizzle schema & migrations
├─ infra/              Terraform, docker-compose for local dev
└─ docs/
```

**Runtime:** PostgreSQL 16 · Redis 7 (timelines, counters, queues, rate limits) · OpenSearch (search) · S3/R2 + CDN (images) · Mux (video) · Sumsub (KYC) · APNs/FCM via Expo Notifications · Sentry · PostHog.

**Hosting:** AWS eu-west-2 (London), for UK data residency, which also simplifies the GDPR story. Use managed services (RDS, ElastiCache, OpenSearch Service) and ECS Fargate for the API and workers. Separate dev, staging and prod environments.

**Cross-cutting rules:**
- **Authorisation guard on every mutation:** `requireKycLevel(L1)`. An L0 user can call read endpoints only.
- **IDs:** 64-bit Snowflake-style, time-sortable (no UUIDs on hot tables).
- **Events:** transactional outbox table → worker → Redis Streams (Kafka later). Every domain change emits an event.
- **Rate limits** per user and per IP, in Redis using a token bucket.
- **Idempotency keys** on all POSTs from mobile, so retries on flaky networks are safe.

---

## 4. Module specifications

Each module lists its functions, key endpoints, data, screens, and acceptance criteria (AC).

### M1. Accounts & Authentication

- **Functions:** sign-up with email or phone (OTP), Sign in with Apple, Google sign-in, password + **passkeys**, TOTP 2FA, session and device management, sign out of all devices, password reset, handle selection and change (with a 30-day cooldown), in-app account deletion (an Apple requirement).
- **Security:** Argon2id password hashing. Access JWT (15 min) + rotating refresh token (30 days, stored in secure storage). App Attest / Play Integrity at sign-up. Phone numbers checked for VoIP numbers (anti-bot). Breach-password check (HIBP k-anonymity).
- **Tables:** `users`, `auth_identities`, `sessions`, `devices`, `otp_challenges`.
- **Screens:** Welcome → Sign up → OTP → Password → Handle → **KYC intro** → Vendor SDK → Pending → Done.
- **AC:**
  - Sign-up to the KYC launch takes 90 seconds or less.
  - Refresh-token reuse revokes the whole session family.
  - Account deletion completes within 30 days, with a grace period for cancellation.

### M2. KYC & Compliance

As §2.

- **Endpoints:** `POST /kyc/session`, `GET /kyc/status`, `POST /webhooks/kyc`, `POST /kyc/appeal`. In admin: `GET /admin/kyc/queue`, `POST /admin/kyc/:id/decision`.
- **Tables:** `kyc_verifications`, `kyc_events` (audit), `screening_hits`, `org_verifications` (L2), `org_members`.
- **Screens:**
  - KYC intro: why, what's needed, privacy summary, explicit consent checkbox.
  - Pending.
  - Retry with the specific reason ("photo blurred", "document expired").
  - Rejected, with an appeal route.
  - Settings → Verification status.
- **AC:**
  - No L0 user can mutate anything (tested at the API layer, not just the UI).
  - Webhooks are idempotent: replaying a webhook 10× produces one state change.
  - A sanctions hit freezes the account within 60 seconds of the webhook.
  - A full audit trail exists for every decision.

### M3. Profiles

- **Functions:** display name (per the §2.6 policy), handle, avatar, banner, bio (160 characters), location, website, professional fields (company, role, sector tags such as Petroleum or Metals: useful for the vertical), pinned post, joined date, verification badge, follower and following counts.
- **Profile tabs:** Posts / Replies / Media / Likes (likes are private to the owner, as on X since 2024).
- **Private (protected) accounts** with follow requests.
- **AC:** profile load p95 under 300 ms; avatars and banners resized and served via the CDN.

### M4. Social Graph

- **Functions:**
  - Follow / unfollow; follow requests (approve or deny) for protected accounts; remove follower.
  - **Block:** two-way invisibility, and removes follows in both directions.
  - **Mute:** one-way and silent.
  - Muted words and hashtags (with duration and scope).
  - Followers / following lists, "Followed by people you know".
- **Who to follow (rule-based):** friends-of-friends weighted by mutual count, same sector tags, popular verified accounts in your region.
- **Tables:** `follows` (follower_id, followee_id, state, created_at; indexed in both directions), `blocks`, `mutes`, `muted_words`.
- **AC:**
  - A block takes effect across all surfaces (feeds, search, replies, DMs, notifications) within 5 seconds.
  - Counts are eventually consistent within 10 seconds and reconciled nightly.

### M5. Posting

- **Functions:**
  - Text up to 280 characters (setting configurable), with weighted length counting (URLs = 23, emoji, CJK), mentions, hashtags and cashtags (`$XAU` — useful for traders).
  - Up to 4 images, or 1 video, or 1 GIF (via GIPHY/Tenor), with alt text.
  - Polls (2–4 options, 5 minutes to 7 days).
  - Thread composer.
  - Reply audience control: Everyone / Following / Mentioned only.
  - Quote, repost / undo repost, delete.
  - **Edit** within 30 minutes, up to 5 edits, with visible history. (On X this is Premium-only; given KYC, we can offer it to everyone.)
  - Drafts (synced) and scheduled posts.
  - Link preview cards (server-side unfurl with an SSRF-safe fetcher).
  - Content warning / sensitive-media flag.
  - Language detection (rule-based library, not AI).
- **Tables:** `posts`, `post_media`, `post_edits`, `polls`, `poll_options`, `poll_votes`, `drafts`, `scheduled_posts`, `link_cards`, `hashtags`, `post_hashtags`, `mentions`.
- **Write path:**
  1. Validate.
  2. Insert the post + outbox event (one transaction).
  3. Worker: fan-out, mention notifications, search indexing, hash-matching of media, link unfurl.
- **AC:**
  - Post creation p95 under 400 ms.
  - The post appears in followers' Following feeds within 5 seconds (normal accounts).
  - Offline composer queues the post and retries with an idempotency key.

### M6. Media Pipeline

- **Images:** direct-to-S3 pre-signed upload → worker strips EXIF/GPS (privacy) → generates sizes (thumbnail, small, medium, large, original) in WebP/AVIF → blurhash placeholder.
- **Video:** direct upload to Mux → HLS adaptive bitrate → thumbnail. Limits: 2 min 20 s and 512 MB to start (configurable). Autoplay muted in the feed; full-screen immersive viewer.
- **Safety:** every image and video keyframe is hash-matched (PhotoDNA / IWF hash list) **before** it is published. A match blocks the upload, preserves evidence, files a report to NCA/NCMEC, and suspends the account.
- **AC:**
  - An image is visible within 3 seconds of the post on 4G.
  - EXIF location is never served.
  - A hash-match hit can never be published.

### M7. Timelines

- **Following tab:** reverse-chronological.
  - Fan-out-on-write into a Redis sorted set per user (capped at 800 entries). Accounts with 10k+ followers use fan-out-on-read and are merged at query time.
  - On a cache miss, rebuild from Postgres.
- **For You tab (rule-based ranker, no ML):** a pluggable **Feed Mixer** pipeline. It mirrors X's open-source `candidate-pipeline`, so ML can be dropped in later.
  - **Sources:** in-network (last 48 h) · second-degree (posts liked or reposted by people you follow) · trending in your sector tags · fresh posts from new verified users (cold-start boost).
  - **Filters:** blocked/muted, muted words, already seen, older than 48 h, deleted, under moderation hold.
  - **Score:**
    ```
    score = (1·likes + 2·reposts + 4·replies + 3·quotes + 2·bookmarks)
            × affinity(viewer, author)   // past interactions, decayed
            × freshness                  // half-life 6 h
            × oon_factor                 // 0.7 if not followed
            − penalty(reports, "not interested")
    ```
  - **Diversity:** at most 2 consecutive posts from the same author, with decaying repeats; at most 30% out-of-network.
  - **Blend:** a "Who to follow" card at position 6.
  - All weights live in a remote config table and can be changed without a release.
- **Pagination:** cursor-based. The "N new posts" pill is driven by WebSocket or a poll every 60 s.
- **Feed controls:** "Not interested", "Show fewer from @x", and "Why am I seeing this?" (shows which source and signals produced the post: our transparency advantage over X).
- **AC:**
  - Home feed p95 under 500 ms.
  - No blocked or muted content ever appears (covered by an automated test).
  - Fan-out keeps up with a 50k-follower post in under 60 seconds.

### M8. Engagement

- **Functions:** like/unlike, bookmark (+ folders), share (OS share sheet, copy link, send via DM), view counts (an impression counted once per user per post per 24 h), quote and repost counts, "liked by" and "reposted by" lists.
- **Counters:** Redis increments, flushed to Postgres in batches; reconciled nightly.
- **Client:** optimistic UI with rollback.
- **AC:** like p95 under 150 ms; no double counting under rapid tapping (idempotent toggles).

### M9. Notifications

- **Types:** like, repost, reply, mention, quote, follow, follow request, poll ended, DM, KYC status, moderation outcome, security alerts (new login).
- **Tabs:** All / Verified Orgs / Mentions.
- **Aggregation:** "@a and 12 others liked your post" (grouped by post and type within a time window).
- **Push:** Expo Notifications → APNs/FCM.
  - Per-type toggles, quiet hours, quality filter (only from people you follow / mutuals).
  - Frequency cap of 15 pushes per day, excluding DMs and security alerts.
- **Badge counts** synced across devices.
- **Tables:** `notifications`, `notification_settings`, `push_tokens`.
- **AC:**
  - Push delivered within 10 seconds of the triggering event (p95).
  - No notification from blocked or muted users.
  - Tapping a notification deep-links to the correct screen from a cold start.

### M10. Search & Explore

- **Search:** users (handle, name, company), posts (full text, Latest / Top / Media / People), hashtags, cashtags. Typeahead under 100 ms. Recent searches, saved searches.
- **Advanced operators:** `from:`, `to:`, `since:`, `until:`, `min_faves:`, `filter:media`, `lang:`.
- **Indexing:** OpenSearch, near-real-time (indexed within 5 seconds); blocked and protected content filtered at query time.
- **Trends (rule-based):**
  - A term or hashtag trends when its 1-hour volume is at least 3× its 7-day baseline at the same hour, with at least N unique **verified** authors. KYC makes trends far harder to game, which is another advantage.
  - Segmented by country and sector tag.
  - A manual admin blocklist.
- **Explore:** trending, topic tabs (by sector), top posts today.
- **AC:** search p95 under 400 ms; protected-account posts never appear to non-followers.

### M11. Direct Messages

- **Functions:**
  - 1:1 and group chats (up to 50); text, images, video, GIF, links, sharing posts; reactions; reply-to; edit within 15 min and delete for everyone; read receipts and typing indicators (both optional); mute and leave conversations.
  - **Message requests** from people you don't follow, separated, with "allow DMs from" settings.
  - Report conversation (with message evidence attached).
- **Transport:** WebSocket gateway (Socket.IO or a native WebSocket server behind a Redis adapter); push as the fallback.
- **Storage:** Postgres partitioned by conversation; encrypted at rest. **E2EE (Signal protocol / MLS) is Phase 2.** Be honest in the UI: do not call v1 DMs end-to-end encrypted.
- **Tables:** `conversations`, `conversation_members`, `messages`, `message_reactions`, `message_receipts`.
- **AC:**
  - Delivery under 500 ms p95 when online.
  - Messages are ordered correctly across devices.
  - A blocked user cannot message, and existing threads become read-only.

### M12. Lists

- **Functions:** create public or private lists, add/remove members, follow lists, list timeline (chronological), pin up to 5 lists as Home tabs (swipeable, like X).
- **AC:** pinned list tabs persist across devices.

### M13. Trust & Safety

- **User tools:**
  - Report a post, profile, DM or list, with a category taxonomy aligned to the OSA illegal-harm categories plus platform rules (spam, harassment, fraud/scam: critical for a trading audience, impersonation).
  - Block, mute, hide reply.
  - Sensitive-media interstitial.
- **Moderation console** (admin app):
  - Priority queues (CSAM/terror → immediate; fraud; harassment; other).
  - Actions: label, limit reach, remove, suspend, freeze, ban.
  - Every action carries a **statement of reasons** (required by the DSA, good practice under the OSA).
  - Repeat-offender strike tracking.
- **Rule-based automation (no AI):**
  - Blocklisted URLs/domains.
  - Keyword lists for scam patterns ("guaranteed returns", "MT103 copy", "dip and pay", "send USDT").
  - Rate limits on new accounts (first 7 days: e.g. 50 posts/day, 20 DMs to non-followers/day).
  - Velocity alerts.
- **Appeals:** the user appeals from the notice; reviewed by a different moderator; SLA of 7 days.
- **Transparency:** the user sees their account status and strike history in Settings.
- **AC:**
  - Every report is acknowledged instantly and triaged within the SLA (CSAM within 1 h; others within 24 h).
  - Every action is audited and reversible.

### M14. Settings, Privacy & GDPR

- **Settings:**
  - Account: email, phone, password, passkeys, 2FA, sessions.
  - Privacy: protected posts, DM permissions, discoverability by email/phone, photo tagging.
  - Content: muted words, sensitive media.
  - Notifications.
  - Display: dark/dim/light, text size.
  - Language.
  - Verification status.
- **GDPR:**
  - "Download your data": an async job that assembles a JSON + media zip and emails a link.
  - Delete account, with cascading erasure, and a vendor deletion request for KYC data unless retention applies.
  - Consent records.
  - Cookie/analytics consent: PostHog off until opted in, where required.
- **AC:** data export within 72 hours; deletion fully propagates (posts, media, search index, caches) within 30 days.

### M15. Event Logging & Analytics (the future ML foundation)

- **Client and server events:** `impression` (post_id, surface, position, ms visible), `click` (target), `dwell` (ms), `like`, `reply`, `repost`, `quote`, `bookmark`, `share`, `profile_visit`, `follow`, `not_interested`, `mute`, `block`, `report`, `video_view` (seconds watched).
- **Pipeline:** client batching → `/events` ingest → stream → S3 Parquet (data lake) + PostHog for product analytics.
- **Dashboards:**
  - Product: DAU/WAU/MAU, D1/D7/D30 retention, posts per DAU.
  - KYC funnel: start → submit → approve, by country.
  - Safety: report rate, time to action.
- **AC:** under 1% event loss; schema versioned. **This is the data the deferred ML ranker will train on; it ships in Sprint 3, not later.**

### M16. Admin Back Office

- **Next.js app** behind SSO + hardware-key 2FA, with role-based access: `support`, `moderator`, `compliance`, `admin`.
- **Tools:** user lookup, KYC review queue, sanctions-hit handling, moderation queues, trend blocklist, feature flags and remote config (feed weights), push broadcast, audit log viewer.
- **AC:**
  - Every admin action is logged with actor, reason and before/after values.
  - Compliance data is visible only to the `compliance` role.

---

## 5. Mobile app structure (React Native / Expo)

- **Navigation (Expo Router):**
  - Bottom tabs: **Home · Search · Notifications · Messages**, plus a fifth slot reserved for a future AI/Markets tab.
  - Left drawer: Profile, Bookmarks, Lists, Verification, Settings, account switcher.
  - Compose floating button.
- **Core libraries:** FlashList (feeds), Reanimated 3 + Gesture Handler, expo-image (caching + blurhash), expo-video, TanStack Query (server cache, optimistic mutations, persisted with MMKV), Zustand, react-hook-form + zod, Sumsub React Native SDK, Sentry, i18next.
- **Design system:** tokens for colour (dark / dim / light), spacing (4-pt grid), typography (Inter), radii, and motion. Components: PostCard, ActionBar, Avatar, Badge, Composer, MediaGrid, VideoPlayer, Sheet, Toast, Skeleton, EmptyState.
- **Deep links / universal links:** `projectfeed.app/@handle`, `/post/:id`, `/lists/:id`.
- **Accessibility:** VoiceOver/TalkBack labels, dynamic type, 44 pt touch targets, reduced-motion support, WCAG AA contrast in all themes.
- **Offline:** cached feed renders instantly; actions are queued.

---

## 6. Sprint plan (2-week sprints)

| Sprint | Weeks | Deliverables |
|---|---|---|
| **S0** | 1–2 | Monorepo, CI/CD (GitHub Actions + EAS), environments, Terraform base, design system v0, **KYC vendor bake-off**, DPIA started, OSA risk assessment started |
| **S1** | 3–4 | M1 auth (email/phone/Apple/Google, sessions), app shell + navigation, admin skeleton |
| **S2** | 5–6 | **M2 KYC end-to-end** (SDK, webhooks, state machine, L0 gating, admin review queue, screening), M3 profiles |
| **S3** | 7–8 | M5 posting (text, images, replies, quotes, reposts), M6 image pipeline + hash-matching, **M15 event logging** |
| **S4** | 9–10 | M4 graph (follow, protected accounts, block, mute, muted words), M7 Following timeline + fan-out |
| **S5** | 11–12 | M8 engagement, M7 For You (Feed Mixer + rule ranker), "new posts" pill, post detail + reply threads |
| **S6** | 13–14 | M9 notifications (in-app + push, aggregation, settings), deep links |
| **S7** | 15–16 | M13 trust & safety (reports, moderation console, actions, appeals, scam rules), M14 settings + GDPR export/delete |
| **S8** | 17–18 | M10 search (users, posts, hashtags, typeahead), polls, drafts, link cards |
| — | 19–20 | **Hardening:** load tests, pen-test, accessibility audit, App Store/Play review prep → **closed beta (MVP)** |
| **S9** | 21–22 | M6 video (Mux) + immersive viewer, GIFs, edit post |
| **S10** | 23–24 | M11 DMs (1:1, requests, media, receipts) |
| **S11** | 25–26 | M11 group DMs, M12 Lists + pinned tabs |
| **S12** | 27–28 | M10 trends + Explore, scheduled posts, who to follow, threads composer polish |
| **S13** | 29–30 | L2 organisation verification (KYB), "Why am I seeing this?", beta feedback fixes |
| — | 31–32 | Hardening, second pen-test, store submission → **public launch (core complete)** |

**Result:** a closed beta at about **month 5**, and the core feature set complete for public launch at about **month 8**.

**Team assumed:** tech lead, 2 backend, 2 React Native, 1 designer, 1 QA, 0.5 DevOps, 0.5 trust & safety/compliance. With fewer people, scale the timeline proportionally; do not cut S7 or the hardening sprints.

---

## 7. Definition of Done (every story)

- Code reviewed; unit and integration tests pass; coverage of 70% or more on the API's domain logic.
- API authorisation test: L0, blocked user, and protected-account cases.
- Works on iOS (latest − 1) and Android 10+, including a low-end Android device (3 GB RAM).
- Dark, dim and light themes; screen-reader labels; dynamic type.
- Events instrumented (M15); errors reported to Sentry; feature behind a flag.
- No PII in logs.

---

## 8. Testing & QA plan

| Layer | Tooling | Focus |
|---|---|---|
| Unit / integration | Jest + Testcontainers (real Postgres/Redis) | Domain rules, permissions, the KYC state machine |
| API contract | GraphQL schema checks in CI | No breaking changes for shipped app versions |
| E2E mobile | Maestro | Sign-up → KYC (vendor sandbox) → post → like → notification → DM |
| KYC | Vendor sandbox test identities | Approve / retry / reject / duplicate / sanctions hit / PEP / webhook replay / out-of-order webhooks |
| Load | k6 | Feed read 10× peak; a 50k-follower fan-out; DM burst |
| Security | OWASP MASVS + ASVS, external pen-test before beta and before launch | Auth, IDOR (insecure direct object reference: e.g. reading someone else's DMs by changing an ID), webhook spoofing, SSRF in link unfurl |
| Abuse | Scripted red-team | Spam bursts, mass-follow, scam-keyword evasion |

---

## 9. Compliance workstream (runs in parallel; owner: founder + counsel)

| Item | Due |
|---|---|
| DPIA (KYC biometrics, feed profiling) | Before S2 build is used with real users |
| OSA illegal-content risk assessment + children's access assessment (18+ via KYC) | Before closed beta |
| Privacy policy, terms, community guidelines, KYC consent text | Before closed beta |
| Vendor DPAs (Sumsub, Mux, AWS, PostHog) + international transfer assessments | Before closed beta |
| ICO registration (data protection fee) | Now |
| IWF membership / hash-list access; NCA reporting route | Before closed beta |
| Named OSA senior manager; complaints procedure | Before public launch |
| Sanctions-hit handling procedure (freeze, review, escalation to OFSI if required) | Before closed beta |

---

## 10. Indicative budget (core build to public launch, about 8 months)

| Item | Estimate |
|---|---|
| Team (UK/EU blended, about 8.5 FTE × 8 months) | £400k–£600k (nearshore: £180k–£300k) |
| KYC (e.g. 10k verifications incl. retries) | £15k–£25k |
| Infrastructure (AWS, Mux, OpenSearch, Sentry, PostHog) | £1.5k–£4k/month during beta |
| Pen-tests (×2) | £15k–£30k |
| Legal / compliance (policies, DPIA, OSA) | £15k–£40k |

These are order-of-magnitude figures; re-quote against real bids.

---

## 11. Decisions needed now

1. **Public name policy:** Option A (legal name shown) or B (verified badge only). I recommend A (§2.6).
2. **L0 read-only preview:** yes (better conversion) or no (no access until verified). I recommend yes, limited to 14 days.
3. **KYC vendor:** approve the Sumsub-vs-Veriff bake-off.
4. **Who pays for KYC:** absorb it (free sign-up) or charge a one-off verification fee. I recommend absorbing it at launch, because a fee kills growth.
5. **Launch geography:** UK-only beta first (simplest regulatory footprint), then your trade corridors.
6. **Build model:** in-house hires, agency or nearshore.

---

## 12. Hooks left for deferred AI (no work now, just reserved seams)

- Feed Mixer `Scorer` interface → ML ranker (LightGBM, then a sequence model) trained on M15 events.
- Feed Mixer `Source` interface → embedding retrieval (pgvector).
- Moderation queue `classifier` slot → AI triage.
- Post actions menu has a reserved slot for "Explain / Summarise"; the fifth bottom tab is reserved.
