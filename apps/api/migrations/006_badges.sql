-- Business / creator verification (paid), granted badges (public figure, government, news) and employee affiliations.

ALTER TABLE users
  ADD COLUMN account_type       text NOT NULL DEFAULT 'personal' CHECK (account_type IN ('personal','business')),
  ADD COLUMN badge              text CHECK (badge IN ('business','creator','public_figure','government','news')),
  ADD COLUMN badge_granted_at   timestamptz,
  ADD COLUMN affiliated_org_id  bigint REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE verification_applications (
  id              bigint PRIMARY KEY,
  user_id         bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('business','creator')),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  legal_name      text,
  reg_type        text,
  reg_number      text,
  country         char(2),
  website         text,
  signatory_name  text,
  signatory_role  text,
  category        text,
  links           text[] NOT NULL DEFAULT '{}',
  about           text,
  reviewer_id     bigint REFERENCES staff(id),
  review_note     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz
);
CREATE UNIQUE INDEX verification_one_pending ON verification_applications (user_id) WHERE status = 'pending';
CREATE INDEX verification_queue ON verification_applications (created_at) WHERE status = 'pending';

-- Paid plans. Badges for business/creator show only while a subscription is active.
-- provider 'manual' = invoiced and recorded by staff until in-app billing (Razorpay / Apple / Google) is wired.
CREATE TABLE subscriptions (
  id                  bigint PRIMARY KEY,
  user_id             bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan                text NOT NULL CHECK (plan IN ('business','creator')),
  status              text NOT NULL CHECK (status IN ('active','past_due','canceled')),
  provider            text NOT NULL DEFAULT 'manual',
  current_period_end  timestamptz NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX subscriptions_user ON subscriptions (user_id, current_period_end DESC);

CREATE TABLE affiliations (
  org_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active')),
  invited_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz,
  PRIMARY KEY (org_id, member_id)
);
CREATE INDEX affiliations_member ON affiliations (member_id);

ALTER TABLE posts ADD COLUMN paid_partnership boolean NOT NULL DEFAULT false;
