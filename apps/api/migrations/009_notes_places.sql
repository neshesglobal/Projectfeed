-- Notes (photo/video-first posts with a title), verified reviews, places and collections.
-- Saving to a collection also bookmarks the post, so bookmark_count is the note's save count.

-- Places are created by the people who review them (no paid place-search API): a named pin with the city filled
-- in by the phone's own reverse geocoder. Duplicates are merged on creation (same name nearby).
CREATE TABLE places (
  id            bigint PRIMARY KEY,
  name          text NOT NULL,
  category      text NOT NULL DEFAULT '',
  lat           double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng           double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  address       text NOT NULL DEFAULT '',
  city          text NOT NULL DEFAULT '',
  country       char(2),
  created_by    bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX places_lat_lng ON places (lat, lng);
CREATE INDEX places_name_trgm ON places USING gin (name gin_trgm_ops);

ALTER TABLE posts
  ADD COLUMN kind        text NOT NULL DEFAULT 'post' CHECK (kind IN ('post','note')),
  ADD COLUMN title       text,
  ADD COLUMN place_id    bigint REFERENCES places(id) ON DELETE SET NULL,
  ADD COLUMN is_review   boolean NOT NULL DEFAULT false,
  ADD COLUMN rating      smallint CHECK (rating BETWEEN 1 AND 5),
  ADD COLUMN visited_on  date;
CREATE INDEX posts_notes_recent ON posts (id DESC) WHERE kind = 'note' AND deleted_at IS NULL;
CREATE INDEX posts_place ON posts (place_id, id DESC) WHERE place_id IS NOT NULL;

-- The search vector covers note titles too.
ALTER TABLE posts DROP COLUMN search;
ALTER TABLE posts ADD COLUMN search tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || text)) STORED;
CREATE INDEX posts_search ON posts USING gin (search);

CREATE TABLE collections (
  id          bigint PRIMARY KEY,
  owner_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  is_private  boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);

CREATE TABLE collection_items (
  collection_id  bigint NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  post_id        bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  added_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, post_id)
);
CREATE INDEX collection_items_post ON collection_items (post_id);
