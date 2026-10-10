-- Trust & safety: staff accounts, moderation actions, appeals, upload screening and an append-only access log.
--
-- Access model (see docs/MODERATION.md):
--   support < moderator < senior_moderator < compliance < admin
--   Public content is browsable by all moderators. Protected-account posts need senior_moderator + a
--   report/flag + a logged justification. DMs need compliance + a report or legal request + a logged
--   justification, and only the reported conversation context is shown — there is no inbox browsing.

-- ───────────────────────────── Staff ─────────────────────────────
CREATE TABLE staff (
  id             bigint PRIMARY KEY,
  email          citext NOT NULL UNIQUE,
  password_hash  text NOT NULL,
  display_name   text NOT NULL,
  role           text NOT NULL CHECK (role IN ('support','moderator','senior_moderator','compliance','admin')),
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz
);

-- ───────────────────────────── Users & posts ─────────────────────────────
ALTER TABLE users DROP CONSTRAINT users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check
  CHECK (status IN ('active','suspended','frozen','banned','deleted'));
ALTER TABLE users
  ADD COLUMN suspended_until timestamptz,
  ADD COLUMN strike_count    smallint NOT NULL DEFAULT 0;

ALTER TABLE posts
  ADD COLUMN removed_at      timestamptz,
  ADD COLUMN removed_reason  text,
  ADD COLUMN limited         boolean NOT NULL DEFAULT false,   -- excluded from For You, Reels, search and trends
  ADD COLUMN sensitive       boolean NOT NULL DEFAULT false;   -- media shown behind an interstitial
CREATE INDEX posts_removed ON posts (removed_at) WHERE removed_at IS NOT NULL;

-- ───────────────────────────── Reports ─────────────────────────────
ALTER TABLE reports DROP CONSTRAINT reports_target_type_check;
ALTER TABLE reports ADD CONSTRAINT reports_target_type_check CHECK (target_type IN ('post','user','message','media'));
ALTER TABLE reports ALTER COLUMN reporter_id DROP NOT NULL;   -- NULL = raised by the system (screening)
ALTER TABLE reports
  ADD COLUMN source       text NOT NULL DEFAULT 'user' CHECK (source IN ('user','screening','staff')),
  ADD COLUMN assigned_to  bigint REFERENCES staff(id),
  ADD COLUMN resolved_at  timestamptz,
  ADD COLUMN resolved_by  bigint REFERENCES staff(id),
  ADD COLUMN resolution   text;
CREATE INDEX reports_target ON reports (target_type, target_id);

-- ───────────────────────────── Actions, notices, appeals ─────────────────────────────
CREATE TABLE moderation_actions (
  id           bigint PRIMARY KEY,
  staff_id     bigint REFERENCES staff(id),            -- NULL = automated (screening)
  target_type  text NOT NULL CHECK (target_type IN ('post','user','media')),
  target_id    bigint NOT NULL,
  user_id      bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,   -- the affected account
  action       text NOT NULL CHECK (action IN (
                 'remove_post','restore_post','label_sensitive','unlabel_sensitive','limit_reach','unlimit_reach',
                 'warn','suspend','unsuspend','freeze','unfreeze','ban','unban','quarantine_media','release_media')),
  reason_code  text NOT NULL,
  statement    text NOT NULL DEFAULT '',               -- statement of reasons shown to the user
  report_id    bigint REFERENCES reports(id),
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_actions_user ON moderation_actions (user_id, id DESC);
CREATE INDEX moderation_actions_target ON moderation_actions (target_type, target_id, id DESC);

CREATE TABLE moderation_notices (
  id          bigint PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_id   bigint NOT NULL REFERENCES moderation_actions(id),
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_notices_user ON moderation_notices (user_id, id DESC);

CREATE TABLE appeals (
  id             bigint PRIMARY KEY,
  action_id      bigint NOT NULL UNIQUE REFERENCES moderation_actions(id),   -- one appeal per decision
  user_id        bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text           text NOT NULL,
  status         text NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','overturned')),
  decided_by     bigint REFERENCES staff(id),
  decision_note  text,
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX appeals_open ON appeals (created_at) WHERE status = 'open';

-- ───────────────────────────── Upload screening ─────────────────────────────
ALTER TABLE media DROP CONSTRAINT media_status_check;
ALTER TABLE media ADD CONSTRAINT media_status_check CHECK (status IN ('processing','ready','failed','quarantined'));

CREATE TABLE media_scans (
  id          bigint PRIMARY KEY,
  media_id    bigint NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  scanner     text NOT NULL,
  result      text NOT NULL CHECK (result IN ('clear','match','error')),
  match_list  text,
  match_ref   text,
  sha256      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_scans_media ON media_scans (media_id);

-- ───────────────────────────── Access log (append-only) ─────────────────────────────
CREATE TABLE access_log (
  id             bigint PRIMARY KEY,
  staff_id       bigint REFERENCES staff(id),
  action         text NOT NULL,          -- e.g. view_protected_post, view_dm_evidence, reveal_pii, moderation_action
  target_type    text,
  target_id      bigint,
  justification  text,
  report_id      bigint,
  ip             text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX access_log_staff ON access_log (staff_id, id DESC);
CREATE INDEX access_log_target ON access_log (target_type, target_id, id DESC);

CREATE FUNCTION access_log_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'access_log is append-only';
END $$;
CREATE TRIGGER access_log_no_update BEFORE UPDATE OR DELETE ON access_log
  FOR EACH ROW EXECUTE FUNCTION access_log_immutable();
CREATE TRIGGER access_log_no_truncate BEFORE TRUNCATE ON access_log
  FOR EACH STATEMENT EXECUTE FUNCTION access_log_immutable();
