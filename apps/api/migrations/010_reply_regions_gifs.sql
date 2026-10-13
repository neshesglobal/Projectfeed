-- Reply controls: "accounts you follow and who they follow", and limiting replies to regions.
ALTER TABLE posts DROP CONSTRAINT posts_reply_audience_check;
ALTER TABLE posts ADD CONSTRAINT posts_reply_audience_check
  CHECK (reply_audience IN ('everyone','following','following_network','mentioned'));
-- NULL = replies from everywhere. Otherwise the replier's region (from their verified ID country) must be listed.
ALTER TABLE posts ADD COLUMN reply_regions text[];

-- GIFs from a GIF library (GIPHY or Tenor) are hotlinked from the provider's CDN, as their terms require,
-- so storage_key/thumb_key hold the provider URLs and gif_provider records where they came from.
ALTER TABLE media ADD COLUMN gif_provider text;
