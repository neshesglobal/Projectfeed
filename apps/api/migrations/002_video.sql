-- Video & Reels: asynchronous media processing and watch-time statistics.

ALTER TABLE media
  ADD COLUMN status       text NOT NULL DEFAULT 'ready' CHECK (status IN ('processing','ready','failed')),
  ADD COLUMN duration_ms  integer,
  ADD COLUMN size_bytes   bigint,
  ADD COLUMN source_key   text,          -- original upload awaiting processing (deleted afterwards)
  ADD COLUMN error        text,
  ADD COLUMN processed_at timestamptz;

CREATE INDEX media_processing ON media (created_at) WHERE status = 'processing';

-- Aggregated watch statistics per video post, fed by client video_view events.
-- Completion rate is the strongest Reels ranking signal (as on every short-video platform).
CREATE TABLE video_stats (
  post_id      bigint PRIMARY KEY REFERENCES posts(id) ON DELETE CASCADE,
  plays        integer NOT NULL DEFAULT 0,
  watch_ms     bigint  NOT NULL DEFAULT 0,
  completions  integer NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup of recent video posts for the Reels feed.
ALTER TABLE posts ADD COLUMN has_video boolean NOT NULL DEFAULT false;
CREATE INDEX posts_video_recent ON posts (id DESC) WHERE has_video AND deleted_at IS NULL;
