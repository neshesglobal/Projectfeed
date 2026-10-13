-- Community Notes: context added by contributors and shown only when people who usually disagree both rate it
-- helpful (bridging-based ranking, as in X's open-source Community Notes algorithm).

CREATE TABLE community_notes (
  id                 bigint PRIMARY KEY,
  post_id            bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id          bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  classification     text NOT NULL CHECK (classification IN ('misleading','not_misleading')),
  text               text NOT NULL,
  sources            text[] NOT NULL DEFAULT '{}',
  status             text NOT NULL DEFAULT 'needs_ratings' CHECK (status IN ('needs_ratings','helpful','not_helpful')),
  intercept          real,            -- helpfulness after removing viewpoint alignment
  factor             real,            -- the note's position on the learned viewpoint axis
  rating_count       integer NOT NULL DEFAULT 0,
  status_changed_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, author_id)
);
CREATE INDEX community_notes_post ON community_notes (post_id) WHERE status = 'helpful';
CREATE INDEX community_notes_queue ON community_notes (created_at) WHERE status = 'needs_ratings';

CREATE TABLE note_ratings (
  note_id     bigint NOT NULL REFERENCES community_notes(id) ON DELETE CASCADE,
  rater_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  helpful     real NOT NULL CHECK (helpful IN (0, 0.5, 1)),   -- not helpful / somewhat / helpful
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, rater_id)
);
CREATE INDEX note_ratings_rater ON note_ratings (rater_id);
