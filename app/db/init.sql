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
CREATE OR REPLACE VIEW workload_view AS
SELECT family_id,
       actor_id AS member_id,
       date_trunc('day', occurred_at)::date AS day,
       count(*) FILTER (WHERE type = 'CareLogged')    AS care_count,
       count(*) FILTER (WHERE type = 'HandoffAcknowledged') AS handoff_count
FROM events
WHERE actor_id IS NOT NULL
GROUP BY family_id, actor_id, date_trunc('day', occurred_at)::date;
