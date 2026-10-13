-- Private trust score (0–100). Never shown publicly: it quietly drives reach, reply ranking and DM limits,
-- and each user sees their own score and its reasons on Account status.
ALTER TABLE users
  ADD COLUMN trust_score       smallint NOT NULL DEFAULT 50,
  ADD COLUMN trust_updated_at  timestamptz;
CREATE INDEX users_trust_stale ON users (trust_updated_at NULLS FIRST) WHERE status <> 'deleted';
