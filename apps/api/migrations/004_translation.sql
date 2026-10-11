-- Post translation: detected language per post, a translation cache and a daily usage budget.

ALTER TABLE posts ADD COLUMN lang text;   -- BCP-47 guess from the dominant script; NULL = unknown

-- Backfill existing posts with the same script heuristic the API uses (see packages/shared/src/languages.ts).
UPDATE posts SET lang = CASE
  WHEN text ~ '[ऀ-ॿ]' THEN 'hi'
  WHEN text ~ '[ঀ-৿]' THEN 'bn'
  WHEN text ~ '[਀-੿]' THEN 'pa'
  WHEN text ~ '[઀-૿]' THEN 'gu'
  WHEN text ~ '[଀-୿]' THEN 'or'
  WHEN text ~ '[஀-௿]' THEN 'ta'
  WHEN text ~ '[ఀ-౿]' THEN 'te'
  WHEN text ~ '[ಀ-೿]' THEN 'kn'
  WHEN text ~ '[ഀ-ൿ]' THEN 'ml'
  WHEN text ~ '[؀-ۿ]' THEN 'ur'
  WHEN text ~ '[A-Za-z]{3}' THEN 'en'
END
WHERE deleted_at IS NULL;

-- One translation per post, edit version and target language: each post is paid for once per language.
CREATE TABLE post_translations (
  post_id      bigint NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  version      smallint NOT NULL,          -- posts.edit_count at translation time; an edit invalidates
  target_lang  text NOT NULL,
  source_lang  text,
  provider     text NOT NULL,
  text         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, target_lang, version)
);

-- Characters sent to the provider per UTC day, for the spend cap (TRANSLATE_DAILY_CHAR_BUDGET).
CREATE TABLE translation_usage (
  day    date PRIMARY KEY,
  chars  bigint NOT NULL DEFAULT 0,
  calls  integer NOT NULL DEFAULT 0
);
