-- Push notifications (delivered through Expo's push service to APNs and FCM).

-- One row per device. A token moves to whoever signs in on that device last.
CREATE TABLE push_tokens (
  token         text PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform      text NOT NULL CHECK (platform IN ('ios','android')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_tokens_user ON push_tokens (user_id);

-- Per-user switches; keys missing from the object use the defaults in @projectfeed/shared.
ALTER TABLE users ADD COLUMN push_prefs jsonb NOT NULL DEFAULT '{}';

-- Written in the same transaction as the notification or message, so a rolled-back action never pushes.
-- The worker claims rows a second or so after they are written; a like undone in that window never pushes.
CREATE TABLE push_outbox (
  id               bigserial PRIMARY KEY,
  user_id          bigint NOT NULL,
  notification_id  bigint,
  message_id       bigint,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Stops repeat pushes for the same thing (likes on one post, follow/unfollow loops).
CREATE TABLE push_throttle (
  user_id  bigint NOT NULL,
  key      text NOT NULL,
  at       timestamptz NOT NULL,
  PRIMARY KEY (user_id, key)
);

-- Expo accepts a push first and reports delivery later; receipts tell us which devices are gone.
CREATE TABLE push_receipts (
  ticket_id   text PRIMARY KEY,
  token       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
