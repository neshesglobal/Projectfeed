-- "About this account": where an account really is, from signals a VPN can't fake.
--   1. ID country     — from the KYC check (document issuing country). Strongest signal.
--   2. Phone country  — country code of the OTP-verified phone number.
--   3. Connection country — majority country over 30 days, EXCLUDING VPN / proxy / Tor / hosting addresses.
-- Country level only. No GPS, no city. Raw IP addresses are never stored: only daily per-country counts.

ALTER TABLE users
  ADD COLUMN id_country          char(2),
  ADD COLUMN id_verified_at      timestamptz,
  ADD COLUMN phone_country       char(2),
  ADD COLUMN conn_country        char(2),       -- current "usually connects from"
  ADD COLUMN conn_country_since  timestamptz,
  ADD COLUMN handle_changed_at   timestamptz;

-- Daily connection counts per country. anonymous = VPN, proxy, Tor or hosting provider.
CREATE TABLE connection_signals (
  user_id    bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day        date NOT NULL,
  country    text NOT NULL DEFAULT '',          -- '' = unknown
  anonymous  boolean NOT NULL,
  hits       integer NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, day, country, anonymous)
);

CREATE TABLE conn_country_history (
  user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_country  char(2),
  to_country    char(2) NOT NULL,
  changed_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conn_country_history_user ON conn_country_history (user_id, changed_at DESC);

CREATE TABLE handle_history (
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  old_handle  citext NOT NULL,
  new_handle  citext NOT NULL,
  changed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX handle_history_user ON handle_history (user_id, changed_at DESC);
