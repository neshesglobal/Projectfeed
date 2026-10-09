-- Projectfeed core schema. IDs are Snowflake-style 64-bit, generated in the API.

CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ───────────────────────────── Identity ─────────────────────────────
CREATE TABLE users (
  id               bigint PRIMARY KEY,
  email            citext NOT NULL UNIQUE,
  password_hash    text NOT NULL,
  handle           citext NOT NULL UNIQUE,
  display_name     text NOT NULL,
  bio              text NOT NULL DEFAULT '',
  location         text NOT NULL DEFAULT '',
  website          text NOT NULL DEFAULT '',
  company          text NOT NULL DEFAULT '',
  role             text NOT NULL DEFAULT '',
  sectors          text[] NOT NULL DEFAULT '{}',
  avatar_media_id  bigint,
  banner_media_id  bigint,
  pinned_post_id   bigint,
  is_protected     boolean NOT NULL DEFAULT false,
  -- KYC seam: 0 registered, 1 ID verified, 2 organisation verified. Enforced by KYC_ENFORCED.
  kyc_level        smallint NOT NULL DEFAULT 0,
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','frozen','deleted')),
  followers_count  integer NOT NULL DEFAULT 0,
  following_count  integer NOT NULL DEFAULT 0,
  posts_count      integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  deleted_at       timestamptz
);
CREATE INDEX users_handle_trgm ON users USING gin ((handle::text) gin_trgm_ops);
CREATE INDEX users_name_trgm ON users USING gin (display_name gin_trgm_ops);

CREATE TABLE refresh_tokens (
  id           bigint PRIMARY KEY,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  family_id    bigint NOT NULL,
  token_hash   text NOT NULL UNIQUE,
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  user_agent   text
);
CREATE INDEX refresh_tokens_family ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user ON refresh_tokens (user_id);

-- ───────────────────────────── Graph ─────────────────────────────
CREATE TABLE follows (
  follower_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id)
);
CREATE INDEX follows_followee ON follows (followee_id, created_at DESC);

CREATE TABLE follow_requests (
  requester_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (requester_id, target_id)
);
CREATE INDEX follow_requests_target ON follow_requests (target_id, created_at DESC);

CREATE TABLE blocks (
  blocker_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE INDEX blocks_blocked ON blocks (blocked_id);

CREATE TABLE mutes (
  muter_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (muter_id, muted_id)
);

CREATE TABLE muted_words (
  id          bigint PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  word        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, word)
);

-- ───────────────────────────── Media ─────────────────────────────
CREATE TABLE media (
  id          bigint PRIMARY KEY,
  owner_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('image','video','gif')),
  storage_key text NOT NULL,
  thumb_key   text NOT NULL,
  width       integer NOT NULL,
  height      integer NOT NULL,
  alt_text    text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────────── Posts ─────────────────────────────
CREATE TABLE posts (
  id                  bigint PRIMARY KEY,
  author_id           bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text                text NOT NULL DEFAULT '',
  reply_to_id         bigint REFERENCES posts(id) ON DELETE SET NULL,
  reply_to_author_id  bigint REFERENCES users(id) ON DELETE SET NULL,
  quote_of_id         bigint REFERENCES posts(id) ON DELETE SET NULL,
  conversation_id     bigint NOT NULL,
  reply_audience      text NOT NULL DEFAULT 'everyone' CHECK (reply_audience IN ('everyone','following','mentioned')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  edited_at           timestamptz,
  edit_count          smallint NOT NULL DEFAULT 0,
  deleted_at          timestamptz,
  reply_count         integer NOT NULL DEFAULT 0,
  repost_count        integer NOT NULL DEFAULT 0,
  quote_count         integer NOT NULL DEFAULT 0,
  like_count          integer NOT NULL DEFAULT 0,
  bookmark_count      integer NOT NULL DEFAULT 0,
  view_count          integer NOT NULL DEFAULT 0,
  search              tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED
);
CREATE INDEX posts_author ON posts (author_id, id DESC);
CREATE INDEX posts_reply_to ON posts (reply_to_id, id);
CREATE INDEX posts_conversation ON posts (conversation_id, id);
CREATE INDEX posts_quote_of ON posts (quote_of_id) WHERE quote_of_id IS NOT NULL;
CREATE INDEX posts_recent ON posts (created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX posts_search ON posts USING gin (search);

CREATE TABLE post_media (
  post_id   bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id  bigint NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  position  smallint NOT NULL,
  PRIMARY KEY (post_id, media_id)
);

CREATE TABLE post_edits (
  post_id    bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  text       text NOT NULL,
  edited_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX post_edits_post ON post_edits (post_id, edited_at);

CREATE TABLE post_mentions (
  post_id  bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE post_tags (
  post_id     bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag         citext NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('hashtag','cashtag')),
  author_id   bigint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, tag, kind)
);
CREATE INDEX post_tags_tag ON post_tags (tag, kind, created_at DESC);
CREATE INDEX post_tags_recent ON post_tags (created_at DESC);

CREATE TABLE polls (
  post_id  bigint PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  options  text[] NOT NULL,
  ends_at  timestamptz NOT NULL
);
CREATE TABLE poll_votes (
  post_id       bigint NOT NULL REFERENCES polls(post_id) ON DELETE CASCADE,
  user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  option_index  smallint NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- ───────────────────────────── Engagement ─────────────────────────────
CREATE TABLE reposts (
  id          bigint PRIMARY KEY,           -- timeline ordering key
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, post_id)
);
CREATE INDEX reposts_user ON reposts (user_id, id DESC);
CREATE INDEX reposts_post ON reposts (post_id, created_at DESC);

CREATE TABLE likes (
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX likes_post ON likes (post_id, created_at DESC);
CREATE INDEX likes_user_time ON likes (user_id, created_at DESC);

CREATE TABLE bookmarks (
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX bookmarks_user_time ON bookmarks (user_id, created_at DESC);

CREATE TABLE post_views (
  user_id  bigint NOT NULL,
  post_id  bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

-- ───────────────────────────── Notifications ─────────────────────────────
CREATE TABLE notifications (
  id          bigint PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  actor_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     bigint REFERENCES posts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  read_at     timestamptz,
  UNIQUE NULLS NOT DISTINCT (user_id, type, actor_id, post_id)
);
CREATE INDEX notifications_user ON notifications (user_id, id DESC);

-- ───────────────────────────── Messaging ─────────────────────────────
CREATE TABLE conversations (
  id          bigint PRIMARY KEY,
  title       text,
  is_group    boolean NOT NULL,
  dm_key      text UNIQUE,                  -- "minId:maxId" for 1:1 dedupe
  created_by  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_members (
  conversation_id  bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id          bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted','request','left')),
  last_read_id     bigint NOT NULL DEFAULT 0,
  joined_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user ON conversation_members (user_id);

CREATE TABLE messages (
  id               bigint PRIMARY KEY,
  conversation_id  bigint NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text             text NOT NULL DEFAULT '',
  shared_post_id   bigint REFERENCES posts(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  edited_at        timestamptz,
  deleted_at       timestamptz
);
CREATE INDEX messages_conversation ON messages (conversation_id, id DESC);

CREATE TABLE message_media (
  message_id  bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  media_id    bigint NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  position    smallint NOT NULL,
  PRIMARY KEY (message_id, media_id)
);

-- ───────────────────────────── Lists ─────────────────────────────
CREATE TABLE lists (
  id           bigint PRIMARY KEY,
  owner_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  is_private   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lists_owner ON lists (owner_id);

CREATE TABLE list_members (
  list_id   bigint NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id   bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, user_id)
);

CREATE TABLE list_follows (
  list_id     bigint NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pinned      boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, user_id)
);

-- ───────────────────────────── Trust & safety ─────────────────────────────
CREATE TABLE reports (
  id           bigint PRIMARY KEY,
  reporter_id  bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type  text NOT NULL CHECK (target_type IN ('post','user','message')),
  target_id    bigint NOT NULL,
  reason       text NOT NULL,
  details      text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'open' CHECK (status IN ('open','actioned','dismissed')),
  priority     smallint NOT NULL DEFAULT 3,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reports_queue ON reports (status, priority, created_at);

-- ───────────────────────────── Event log (future ranking training data) ─────────────────────────────
CREATE TABLE events (
  id           bigserial PRIMARY KEY,
  user_id      bigint NOT NULL,
  type         text NOT NULL,
  post_id      bigint,
  surface      text NOT NULL,
  position     integer,
  duration_ms  integer,
  client_ts    timestamptz NOT NULL,
  received_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_user_time ON events (user_id, received_at DESC);

-- Feed preferences ("Not interested in this post")
CREATE TABLE feed_negative (
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id     bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id   bigint NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);
CREATE INDEX feed_negative_author ON feed_negative (user_id, author_id);
