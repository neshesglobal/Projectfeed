# Projectfeed — X-Class Social App: Study & Build Plan (iOS + Android)

Prepared 9 October 2026. This is commercial and technical reference material. The legal and regulatory sections need sign-off from a UK solicitor and a compliance adviser before launch.

---

## Strategy update (13 October 2026): an India-first, general-audience platform

The founder has decided to open Projectfeed to everyone rather than only commodity professionals. Our point of difference is **safety through verified identity**: every account that posts has passed a KYC check. That supersedes the "vertical first" recommendation in §0.2. Commodity and business users stay a launch focus, not the boundary.

What changes:
- **Market.** India first. The space Koo left when it shut down in July 2024 is open. Translation into the 22 scheduled languages is built (`docs/TRANSLATION.md`).
- **Point of difference.** Verified identity, made visible:
  - **About this account** shows the country of the verified ID, which a VPN can't change.
  - Paid **business and creator badges**, plus employee affiliations.
  - Granted (never sold) **public figure, government and news** badges.
  - A **private trust score** that limits the reach of abusive accounts.
  - **Community Notes** for misleading content.
  
  All of these are built; see `docs/TRUST_AND_IDENTITY.md`.
- **Founder decisions** recorded there:
  - Every account shows its actual country, with no exceptions.
  - The trust score is private: no public "social score".
  - Badges for public figures are never sold.
- **New legal gates for India.** All need confirming with Indian counsel:
  - **IT Rules 2021.** Above 5 million users, we become a "significant social media intermediary". That brings a Chief Compliance Officer, a Grievance Officer and a nodal contact person, all resident in India, plus monthly compliance reports. In practice this likely means an Indian company.
  - **DPDP Act 2023** (India's data protection law):
    - notice and consent for KYC, location and phone data;
    - no behavioural tracking of children.
  - **Aadhaar Act.** Following the Supreme Court's Puttaswamy judgment, ID checks must go through consent-based routes: DigiLocker, Aadhaar offline e-KYC, or PAN.
  - **Consumer law and advertising.** The consumer authority's 2023 dark-patterns guidelines apply to paid badges, and the ASCI influencer guidelines apply to paid partnership posts (built).
- **The biggest risk is unchanged**: network effects. Launch into seeded communities: business owners and professionals, verified creators, and one or two languages or cities. Don't launch "everyone, everywhere".

---

## 0. Read this first: the honest verdict

1. **We can copy the features. We cannot copy the network.** X's value comes from roughly 500M users and their social graph, not from its code. A general-purpose clone launched cold will fail. Threads, Bluesky, Mastodon and Truth Social all copied the features. Only the apps that arrived with a seed audience grew.
2. **My recommendation:** build the full X-grade engine, but launch it into a **vertical**, meaning one professional community, before going broad. Neshes Global's own world is the obvious fit: commodity traders, brokers and procurement people. Their real-time market chatter currently happens on X, Telegram and WhatsApp, which are full of fraud. A vertical with verified identities (KYC-backed badges, from our DD work) is a real moat. A generic clone is not. The architecture below works for either path. Only the go-to-market changes.
3. **Scope reality:** "Everything X has" includes payments (X Money, which is a regulated activity), end-to-end encrypted chat, live audio, live video, an ads platform and an AI assistant. That is several companies' worth of product. This plan phases the work so that a shippable MVP comes out in about 6 months, and full parity follows over about 18–24 months.
4. **The UK Online Safety Act 2023 applies to us from day one** (Ofcom is the regulator). A user-to-user service needs risk assessments, illegal-content duties, child-safety and age-assurance measures, and reporting tools. This is a launch blocker, not a later phase. See §8.

---

## 1. How X's algorithm works (deep study)

### 1.1 Sources and generations

| Release | What it showed |
|---|---|
| `twitter/the-algorithm` (March 2023) | The legacy Scala/Java stack: Earlybird search index, RealGraph, SimClusters, TwHIN embeddings, a MaskNet "Heavy Ranker", and published engagement weights |
| **`xai-org/x-algorithm` (20 January 2026, Apache-2.0, with updates in May 2026)** | The **current** system, rewritten in Rust and JAX. Hand-engineered features were removed and replaced by a Grok-derived transformer that learns from your action sequence |

The 2026 repo is the reference for this plan. It is Apache-2.0, so we may legally study it and reuse it, with attribution. It **does not** include production weights, training data or most of the trust-and-safety pipeline.

### 1.2 The current "For You" pipeline (Home Mixer)

```
Request ─► 1 Query hydration ─► 2 Candidate sources ─► 3 Candidate hydration ─► 4 Pre-filters
        ─► 5 Scoring ─► 6 Top-K selection ─► 7 Visibility filtering ─► 8 Blending ─► Response
                                                                          └► 9 Side effects (async)
```

1. **Query hydration.** Fetches the viewer's recent **action sequence**, which is the model's main input: what you liked, replied to, dwelt on and skipped. It also fetches the follow graph, blocks, mutes, muted keywords, already-seen posts and followed topics.
2. **Candidate sources**, run in parallel:
   - **Thunder (in-network).** An in-memory store of recent posts from accounts you follow, fed by a Kafka stream, with sub-millisecond lookups.
   - **Phoenix retrieval (out-of-network).** A two-tower model: a user tower and a post tower each embed into the same vector space, and approximate nearest-neighbour search returns the closest posts. (*Two-tower* means two separate neural networks whose outputs are compared with a dot product. It is cheap enough to search millions of posts.)
   - **SimClusters.** Community clusters built from the engagement graph.
   - **Popular posts.** A shared list of trending recent posts.
3. **Candidate hydration.** Adds the text, media, author profile, labels, quoted post, language, engagement counts and subscription status.
4. **Pre-scoring filters.** Remove duplicates, posts older than about **48 hours**, your own posts, blocked or muted authors, muted keywords, already-seen and already-served posts, NSFW out-of-network posts, posts from new users with low engagement, and region-specific items (e.g. election filters).
5. **Scoring**, in three passes:
   - **PhoenixScorer.** A Grok-1-derived transformer predicts the **probability of each user action** for every candidate.
     - *Engagement:* favourite, reply, repost, quote, share, share via DM, share via copy link
     - *Clicks:* post, profile, link, photo expand, video open, quoted post
     - *Attention:* video quality view, dwell, dwell time, click dwell time, video continuation seconds, profile visit seconds
     - *Author:* follow author
     - *Negative:* not interested, mute author, block author, report, not dwelled
   - **RankingScorer.** Final score = Σ (weight × predicted probability). Negative actions carry large negative weights. The production weights are redacted. Their shape is visible in the 2023 release: like 0.5, repost 1, reply 13.5, reply that the author engages with 75, profile click 12, "good click" about 11, negative feedback −74, report −369. **Lesson: conversation and avoiding negative signals dominate. Likes are cheap.**
   - **Adjustments.** *Author diversity:* each further post from the same author is multiplied by a decaying factor. *Out-of-network discount:* posts from accounts you don't follow are scaled below 1. *New-author boost:* low-impression authors are lifted. **VMRanker** then re-ranks with a determinantal point process (DPP), a maths method that trades a little score for less repetition between neighbouring posts.
   - **Candidate isolation.** In the transformer, candidates cannot "see" each other. Each one attends only to the viewer's context. That makes scores deterministic and **cacheable**. This is an important engineering trick for us to copy.
6. **Selection.** Keep the top K posts.
7. **Visibility filtering.** Trust-and-safety rules decide whether a post may be shown at all, separately from where it ranks. Duplicate conversation branches are also collapsed.
8. **Blending.** Ads, "Who to follow" and prompts are interleaved at fixed or rule-based slots.
9. **Side effects.** After the response is sent, the system logs impressions, marks posts as served and refreshes caches.

### 1.3 Other ranked surfaces (same pattern, different sources)

- **Following tab.** Reverse-chronological from Thunder, with optional light ranking.
- **Search.** A real-time inverted index (X's legacy "Earlybird", which is Lucene-based) plus relevance ranking.
- **Explore and Trends.** Detects a spike in term or entity velocity compared with the baseline, segmented by location and topic, with spam and duplicate suppression.
- **Notifications.** Ranked and batched ("X and 12 others liked…"). Push notifications have a separate ranking model, and frequency caps protect against churn.
- **Replies under a post.** Ranked by quality: author's replies first, then followed and verified accounts, then by the model. Low-quality replies go behind "Show probable spam".
- **Who to follow.** Graph walks (friends-of-friends and SALSA/RealGraph-style) plus embedding similarity.

### 1.4 What we take from this

| X does | We do (scaled to our size) |
|---|---|
| Grok transformer over action sequences | **Phase 1:** a heuristic weighted score. **Phase 2:** a gradient-boosted ranker (LightGBM). **Phase 3:** a small sequence transformer, possibly seeded from the open Phoenix code |
| Thunder in-memory in-network store | Redis sorted sets per user (fan-out-on-write) |
| Phoenix two-tower ANN retrieval | pgvector, then a dedicated vector database (Qdrant) at scale |
| Kafka event backbone | Postgres outbox → Redpanda/Kafka once traffic justifies it |
| Multi-action prediction with negative weights | Log **every** action from day one. Training data cannot be backfilled |

**The non-negotiable lesson:** the event-logging schema (impressions, dwell, clicks, negatives) must ship in v1, even while ranking is still simple. Without that data, we can never train a model.

---

## 2. UI/UX study of X

### 2.1 Information architecture (mobile)

- **Bottom tab bar** (5 items): Home · Explore/Search · Grok · Notifications · Messages (Chat). Tapping the active tab again scrolls to the top and refreshes.
- **Left drawer**, opened from the avatar at top left: Profile, Premium, Bookmarks, Lists, Communities, Monetisation, Spaces, Settings & Privacy, and account switcher.
- **Floating compose button**, bottom right. A long press reveals Post / Space / Live / Photos.
- **Home header:** logo, plus swipeable tabs: *For You* · *Following* · pinned Lists. The header hides on scroll down and returns on scroll up.

### 2.2 Post card anatomy

Avatar · display name · verification badge (blue = Premium, gold = organisation, grey = government) · @handle · relative time · ⋯ menu.
Body: text up to 280 characters (Premium allows up to 25k, with "Show more"), mentions, hashtags, link card, up to 4 images or a video or GIF, poll, quote-post embed.
Action row: **Reply · Repost (sheet: Repost / Quote) · Like · Views · Bookmark · Share**. Counts are abbreviated (1.2K, 3.4M), and a like plays a micro-animation with haptics.
Extras: Community Notes banner, "Replying to @x", "Show this thread", "Grok: explain this post", "Translate post", "Edit history" (Premium).

### 2.3 Key interaction patterns to replicate

- Optimistic UI on every action (the count updates instantly, with rollback on failure).
- "N new posts" pill instead of auto-jumping the feed.
- Immersive vertical video viewer (TikTok-style swipe) when a video is opened.
- Long-press and context menus; swipe-to-reply in DMs.
- Thread composer: "+" chains posts; drafts; scheduling; reply-audience controls (Everyone / Following / Verified / Mentioned).
- Infinite scroll with skeleton loaders. Tab and scroll positions are preserved.
- **Design language:** pure black or "Lights out" dark mode, a dim mode, and light mode. Chirp typeface (we would use Inter). Single-colour iconography. Dense but high-contrast.

### 2.4 Where X's UX is weak (our opportunity)

Opaque ranking ("Why am I seeing this?" is thin), poor feed controls, reply-spam and bot problems, and weak notification controls. A trust layer (verified identities, transparent "Why this post" panels, topic dials) is a differentiator, especially for a professional vertical.

---

## 3. Feature inventory (what "core X" means) and phase mapping

| # | Feature area | Components | Phase |
|---|---|---|---|
| 1 | Accounts | Phone/email/Apple/Google sign-in, passkeys, 2FA, handle, profile (bio, banner, location, link, pinned post), multiple accounts | **MVP** |
| 2 | Posting | Text, images (4), GIF, video, polls, threads, quote, reply, repost, delete, drafts, alt text, reply controls | **MVP** (video in v1.1) |
| 3 | Social graph | Follow/unfollow, private accounts with follow requests, block, mute (users/words), remove follower | **MVP** |
| 4 | Feeds | For You (ranked), Following (chronological), profile tabs (Posts / Replies / Media / Likes) | **MVP** |
| 5 | Engagement | Like, bookmark (+ folders), share, view counts | **MVP** |
| 6 | Notifications | In-app (All / Verified / Mentions), push, rank and batch, per-type settings | **MVP** |
| 7 | Search & Explore | Users, posts, hashtags; Latest/Top/Media; trends; topics | **MVP** basic → v1.1 trends |
| 8 | Messaging | 1:1 and group DMs, media, reactions, read receipts, message requests | **v1.1**; E2EE in v2 |
| 9 | Safety | Report flows, block/mute, sensitive-media interstitials, moderation console, appeals | **MVP (legal requirement)** |
| 10 | Lists | Create, follow, pin as Home tab | v1.1 |
| 11 | Communities | Groups with own feed, moderators, rules | v2 |
| 12 | Spaces | Live audio rooms, speakers/listeners, recording | v2 |
| 13 | Live video | Broadcast and replay | v3 |
| 14 | Long-form | Articles (rich text), long posts, edit post with history | v2 |
| 15 | Community Notes | Crowd fact-check with bridging-based consensus (open algorithm) | v2 |
| 16 | Premium/subscriptions | Tiered paywall, badge, edit, longer posts, reduced ads, creator subscriptions | v2 |
| 17 | Creator monetisation | Revenue share, tips | v3 |
| 18 | Ads platform | Promoted posts, targeting, auction, advertiser dashboard | v3 |
| 19 | AI assistant | "Explain this post", thread summaries, reply drafting, translation (Claude API) | v1.1 → v2 |
| 20 | Payments (X Money equivalent) | Wallet, P2P | **Do not build in-house.** Partner with a regulated EMI. See §8 |
| 21 | Accessibility & i18n | VoiceOver/TalkBack, dynamic type, RTL, translation | MVP baseline |

---

## 4. Recommended technology

### 4.1 Mobile client: **React Native (Expo, TypeScript)**

We choose this over Flutter and over native Swift/Kotlin for four reasons:
- One codebase for iOS and Android, and TypeScript is shared with the web client and the Ops Hub React stack.
- **FlashList** handles high-performance feeds. Reanimated 3 handles 60fps gestures and animations. Expo Router handles navigation and deep links. EAS handles builds, OTA updates and store submission.
- Native modules are available where they matter: video (`react-native-video` / `expo-video` with HLS), camera, push (APNs/FCM via Expo Notifications), secure storage, and in-app purchase (RevenueCat).
- State and data: TanStack Query for the server cache, with optimistic mutations; Zustand for UI state; MMKV for the persistent offline cache.

**Fallback:** if live audio or video ever needs deep native control, write those screens as native modules. There is no need to rewrite the app.

### 4.2 Backend: **modular monolith first, services later**

| Layer | Choice | Why |
|---|---|---|
| API | TypeScript (NestJS) or Go, behind **GraphQL** (feed and profile) and REST (uploads, webhooks) | One team, one language with the client |
| Primary database | **PostgreSQL** (Neon/RDS) | Users, posts, graph, settings. Shard by user ID later (Citus) |
| Cache / timelines | **Redis** | Home timeline sorted sets (Thunder equivalent), counters, rate limits, sessions |
| Events | Postgres outbox → **Redpanda/Kafka** | Impressions, engagements, fan-out, notifications, ML logging |
| Search | **OpenSearch** (or Typesense early) | Posts, users, hashtags; near-real-time indexing |
| Vectors | **pgvector** → Qdrant | Post and user embeddings for out-of-network retrieval |
| Media | S3/R2 + CloudFront; **Mux** or Cloudflare Stream for video | Transcoding to HLS, adaptive bitrate, thumbnails |
| Real-time | WebSockets (or Ably/Pusher early) | DMs, live counts, "new posts" pill |
| Live audio/video | **LiveKit** (open-source WebRTC SFU) | Spaces and live video without building media servers |
| Push | APNs + FCM | Through a notification service with a ranker and frequency caps |
| ML | Python: LightGBM → PyTorch/JAX; feature store (Feast) | Ranking, retrieval, spam/abuse classifiers |
| AI features | **Claude API** (Sonnet for summaries/explain; Haiku for classification/moderation triage) | Grok-equivalent features |
| Moderation tools | Hive/AWS Rekognition + PhotoDNA/IWF hash-matching (CSAM) + Claude classification | Legal duty under the OSA |
| Infra | AWS or GCP, Terraform, Kubernetes later (Fly/Render early), Sentry, Grafana/Prometheus, PostHog | |

### 4.3 Timeline delivery strategy (the core scaling decision)

- **Fan-out-on-write** for normal accounts. When a user posts, the post ID is pushed into each follower's Redis timeline.
- **Fan-out-on-read** for celebrity accounts (above about 10k followers). Their posts are merged in at read time. This is X's original hybrid model and avoids writing to millions of timelines per post.
- Timelines are capped (about 800 IDs) and rebuilt from Postgres on a cache miss.

---

## 5. System architecture

```
 iOS / Android (React Native)          Web (Next.js, later)
            │  GraphQL / REST / WebSocket
            ▼
     API Gateway (auth, rate limiting, App Attest / Play Integrity)
            │
 ┌──────────┼──────────────────────────────────────────────┐
 │  Core monolith modules: Identity · Posts · Graph · Feed │
 │  Engagement · Notifications · DMs · Search · Moderation │
 └──────────┬───────────────┬───────────────┬──────────────┘
            │               │               │
      PostgreSQL         Redis       Event bus (outbox → Kafka)
            │                               │
     OpenSearch / pgvector        ┌─────────┼──────────┬──────────────┐
                                  ▼         ▼          ▼              ▼
                            Fan-out    Feature/ML   Trends &     Moderation
                            workers    logging      search idx   pipeline (async)
                                  │
                         Feed Mixer: sources → filters → scorer → diversity → blend
```

**Feed Mixer** is our Home Mixer equivalent. Build it as a pluggable pipeline from day one, with Source, Hydrator, Filter, Scorer, Selector and SideEffect interfaces, mirroring the `candidate-pipeline` abstraction in X's repo. Ranking can then be upgraded without rewrites.

### 5.1 Ranking roadmap

| Stage | Trigger | Method |
|---|---|---|
| R0 (MVP) | 0–10k users | Score = recency decay × (w₁·likes + w₂·replies + w₃·reposts + w₄·author affinity) − penalties; author diversity; out-of-network from popular posts and friends-of-friends |
| R1 | About 10k DAU, 4+ weeks of logs | LightGBM ranker predicting P(like), P(reply), P(dwell>5s), P(negative); weighted sum as in X |
| R2 | About 100k DAU | Two-tower retrieval for out-of-network content; embedding-based topic clusters; DPP/MMR diversity re-rank |
| R3 | 1M+ DAU | Sequence transformer over user action history (Phoenix-style, with candidate isolation for caching) |

---

## 6. Data model (core tables)

`users`, `profiles`, `auth_identities`, `sessions`, `devices` (push tokens)
`posts` (id = Snowflake-style 64-bit time-sortable, author_id, text, reply_to_id, quote_of_id, conversation_id, visibility, lang, created_at, edited_at)
`post_media`, `polls`, `poll_votes`, `post_edits`
`follows` (follower_id, followee_id, state), `blocks`, `mutes`, `muted_words`
`likes`, `reposts`, `bookmarks` (+ `bookmark_folders`), `lists`, `list_members`
`notifications`, `conversations`, `conversation_members`, `messages`
`reports`, `moderation_actions`, `appeals`, `labels`
**`events`** (append-only: user_id, post_id, action_type, surface, position, dwell_ms, ts). This is the ML training source.

---

## 7. Delivery roadmap

| Phase | Duration | Ships |
|---|---|---|
| **0. Discovery & design** | Weeks 1–6 | Positioning decision (vertical vs general), brand, design system (tokens, dark/dim/light), Figma for all MVP screens, OSA risk assessment, architecture spike |
| **1. MVP** | Months 2–6 | §3 MVP rows: auth, profile, post/thread/quote/reply, images, follow graph, For You (R0) + Following, likes/bookmarks/views, notifications + push, basic search, report/block/mute, moderation console, event logging, analytics. **Closed beta (TestFlight / Play internal testing)** |
| **1.1** | Months 7–9 | Video (Mux), DMs (non-E2EE), Lists, Explore & Trends, AI "explain/summarise", R1 ranker, public store launch |
| **2** | Months 10–15 | Communities, Spaces (LiveKit), Articles/long posts, edit post, Premium subscriptions (RevenueCat, IAP), Community Notes, E2EE DMs (Signal protocol / MLS), R2 retrieval |
| **3** | Months 16–24 | Live video, creator monetisation, self-serve ads platform, R3 ranker, web client parity, payments via a regulated partner |

### Team (minimum credible)

MVP: 1 tech lead/backend, 1 backend, 2 React Native, 1 product designer, 1 QA, a part-time trust & safety lead, a part-time PM (the founder can cover this). Phase 2 onward: add ML engineer, SRE, second designer, and moderation staff (outsourced is acceptable).

**Indicative cost:** MVP about **£350k–£550k** with a UK/EU team, or about £150k–£250k with a nearshore team, plus infrastructure of about £1–3k/month at beta scale. Full parity: £2–4M+ over 24 months. These are order-of-magnitude figures to be re-quoted against real bids.

---

## 8. Legal, regulatory and app-store gates (UK company)

| Requirement | What it means for us | When |
|---|---|---|
| **Online Safety Act 2023 (Ofcom)** | Illegal-content risk assessment, children's access assessment, **highly effective age assurance** if children are likely to access the service, content reporting and complaints, named senior accountable person, record-keeping | **Before public launch** |
| UK GDPR / DPA 2018 | Privacy policy, lawful basis, DPIA (profiling for feeds = high-risk processing), data-subject rights tooling (export/delete), ICO registration | MVP |
| EU DSA (if serving EU users) | Notice-and-action, statement of reasons, recommender transparency, and a **non-profiling feed option** (the Following tab satisfies this) | Before EU launch |
| Apple App Store Guideline 1.2 / Google UGC policy | Must have: filtering of objectionable content, report mechanism, block users, timely response, published contact info. **The app is rejected without these** | MVP |
| CSAM | Hash-matching (IWF/PhotoDNA), reporting to NCA/NCMEC | MVP |
| Payments / wallet | Holding user funds is FCA-regulated (EMI licence). **Use a licensed partner** (e.g. Stripe Connect, Modulr) | Phase 3 |
| Sanctions | Screen paid users and advertisers against OFSI/OFAC lists | When monetising |
| In-app purchase | Digital subscriptions sold in-app must use Apple/Google IAP (15–30% fee); the UK/EU/US anti-steering rules have changed. Take advice | Phase 2 |

---

## 9. Testing & QA

- Unit and integration tests on every module. Contract tests on GraphQL. Detox/Maestro end-to-end on core flows (sign-up → post → like → notification).
- Load tests (k6) on feed read and fan-out at 10× expected peak; a celebrity-post fan-out test.
- Ranking: offline evaluation (AUC/NDCG on held-out logs) plus online A/B tests with guardrail metrics (report rate, block rate, session length, D1/D7/D30 retention).
- Security: OWASP MASVS for mobile, pen-test before public launch, rate limits and bot defence (App Attest / Play Integrity, phone verification for new accounts).
- Device matrix: low-end Android (2–3GB RAM) feed scroll at 60fps is the hardest performance target.

---

## 10. Key risks

| Risk | Rating | Mitigation |
|---|---|---|
| Cold-start / no network effect | **Critical** | Vertical launch, seeded creators, import of contacts and follows, invite-only beta |
| Regulatory (OSA) non-compliance | **High** | Compliance by design; outside counsel; T&S lead from day one |
| Spam and bots | **High** | Phone verification, rate limits, new-account throttles, ML spam classifier by R1 |
| Moderation cost at scale | **High** | AI triage (Claude/Haiku) + human review queue + community notes |
| Scope creep toward "everything X has" before product-market fit | **High** | Hard phase gates tied to retention metrics (e.g. D30 ≥ 20% before Phase 2) |
| Infrastructure cost (video) | Medium | Managed video with per-minute pricing; transcode caps; lazy loading |
| App-store rejection | Medium | Guideline 1.2 checklist in the MVP definition of done |

---

## 11. Decisions needed from the founder

1. **Vertical vs general launch** (recommended: vertical, commodity/trade professionals, with KYC-verified badges).
2. Product name and brand ("Projectfeed" is the working title).
3. Build team: in-house hires vs agency vs nearshore.
4. Budget envelope for MVP and Phase 1.1.
5. Regions at launch (UK only first is simplest for regulation).

---

## Sources

- xai-org/x-algorithm (Apache-2.0, January 2026): https://github.com/xai-org/x-algorithm
- twitter/the-algorithm (2023 release): https://github.com/twitter/the-algorithm
- Technical read-throughs: https://ranksaga.com/blog/x-algorithm-2026/ · https://opentweet.io/blog/x-algorithm-open-source-github-2026 · https://wallaroomedia.com/x-algorithm-explained/ · https://keywordseverywhere.com/news/social-algorithm-updates/x-algorithm-open-source/
- 2026 product changes (XChat, X Money, Grok): https://mobileecosystemforum.com/2026/05/12/x-a-new-super-app-vision-xchat-launches-and-x-money-near-rollout/ · https://roboin.io/article/en/2026/06/26/x-money-launches-limited-beta-for-paid-users-in-the-us/ · https://www.heyorca.com/blog/x-twitter-social-news · https://techjournal.org/grok-xchat-group-chat
