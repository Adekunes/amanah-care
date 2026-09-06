-- Amanah Care schema. 4 tables + 1 view. Server holds ciphertext only.
-- Deviation note: MVP uses a single Redis stream `events` with family_id as a
-- field, not one stream per family (AR-02). One consumer group. Post-hackathon
-- change. Everything else matches REQUIREMENTS.md.

CREATE TABLE IF NOT EXISTS families (
  id           TEXT PRIMARY KEY,
  key_check    TEXT NOT NULL,          -- SHA-256 hex of raw H. Proves key, never reveals it.
  key_version  INT  NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id),
  role       TEXT NOT NULL CHECK (role IN ('elder','family','support')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Member display name is NOT here. It lives encrypted in the MemberJoined event.

CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,       -- client event uuid, used for idempotent upsert
  stream_id     TEXT,                   -- redis stream id (seq)
  family_id     TEXT NOT NULL,
  type          TEXT NOT NULL,
  actor_id      TEXT,
  category      TEXT,                   -- clear routing field for CareLogged
  from_id       TEXT,
  to_id         TEXT,
  handoff_id    TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  key_version   INT NOT NULL DEFAULT 1,
  iv            TEXT,                   -- base64 96-bit nonce, unique per ciphertext (SR-10)
  payload_cipher TEXT                   -- base64 AES-GCM ciphertext. Server cannot read.
);
CREATE INDEX IF NOT EXISTS events_family_idx ON events(family_id, occurred_at);
CREATE INDEX IF NOT EXISTS events_type_idx   ON events(family_id, type);

CREATE TABLE IF NOT EXISTS handoffs (
  id            TEXT PRIMARY KEY,
  family_id     TEXT NOT NULL,
  from_id       TEXT NOT NULL,
  to_id         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged')),
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  acked_at      TIMESTAMPTZ,
  iv            TEXT,
  summary_cipher TEXT
);
CREATE INDEX IF NOT EXISTS handoffs_to_idx ON handoffs(family_id, to_id, status);

-- Workload = metadata counts only. No ciphertext touched. History, not roster.
-- count(CASE ...) rather than count(*) FILTER: same result in Postgres, and it
-- also runs unchanged in the in-memory Postgres the test suite uses.
CREATE OR REPLACE VIEW workload_view AS
SELECT family_id,
       actor_id AS member_id,
       date_trunc('day', occurred_at)::date AS day,
       count(CASE WHEN type = 'CareLogged' THEN 1 END)          AS care_count,
       count(CASE WHEN type = 'HandoffAcknowledged' THEN 1 END) AS handoff_count
FROM events
WHERE actor_id IS NOT NULL
GROUP BY family_id, actor_id, date_trunc('day', occurred_at)::date;

-- Login after the first join. The invite code (QR) proves you hold H once; then
-- you log in with an email or a chosen login + password. wrapped_h is H encrypted
-- on the phone with a key derived from the password (PBKDF2, AES-GCM). The server
-- stores the wrapped copy and a scrypt hash of the password. It can verify the
-- password; it cannot open the wrap. Default demo password is 333 (SR-11 stub).
CREATE TABLE IF NOT EXISTS logins (
  login          TEXT PRIMARY KEY,               -- lowercased email or chosen login
  member_id      TEXT NOT NULL UNIQUE REFERENCES members(id),
  family_id      TEXT NOT NULL REFERENCES families(id),
  pw_salt        TEXT NOT NULL,
  pw_hash        TEXT NOT NULL,                  -- scrypt(password, pw_salt), hex
  wrap_salt      TEXT NOT NULL,                  -- PBKDF2 salt, base64
  wrap_iv        TEXT NOT NULL,                  -- AES-GCM IV, base64
  wrapped_h      TEXT NOT NULL,                  -- H under the password key, base64
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ
);

-- Alerts. A member subscribes to kinds of events; the notifier (its own consumer
-- group on the stream) writes one notification per subscriber per event. Both
-- tables hold routing metadata only. Kinds are listed in spec/NOTIFY-SPEC.md.
CREATE TABLE IF NOT EXISTS subscriptions (
  member_id  TEXT NOT NULL REFERENCES members(id),
  family_id  TEXT NOT NULL REFERENCES families(id),
  kind       TEXT NOT NULL,
  PRIMARY KEY (member_id, kind)
);
CREATE INDEX IF NOT EXISTS subscriptions_family_idx ON subscriptions(family_id);

CREATE TABLE IF NOT EXISTS notifications (
  event_id    TEXT NOT NULL,
  member_id   TEXT NOT NULL,             -- recipient
  family_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,             -- the subscription kind that matched
  type        TEXT NOT NULL,             -- event type
  category    TEXT,
  from_id     TEXT,                      -- actor of the event
  handoff_id  TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at     TIMESTAMPTZ,
  PRIMARY KEY (event_id, member_id)      -- replay-safe
);
CREATE INDEX IF NOT EXISTS notifications_member_idx ON notifications(family_id, member_id, read_at);
