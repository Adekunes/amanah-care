-- Notifications: a second consumer group on the events stream (AR-05), plus the
-- two read models it needs. Safe to run repeatedly.
--
-- `signal` is a new CLEAR field on events, so the server can route a notification
-- without holding a key. It extends what the server can see (SR-05) by exactly one
-- enumerated value per event, opt-in from the client. The note itself stays sealed:
-- the server learns "a pickup was requested", never who, where, or why.

ALTER TABLE events ADD COLUMN IF NOT EXISTS signal TEXT;
CREATE INDEX IF NOT EXISTS events_signal_idx ON events(family_id, signal);

-- Who wants to hear about what. One row per member per signal.
CREATE TABLE IF NOT EXISTS subscriptions (
  family_id  TEXT NOT NULL REFERENCES families(id),
  member_id  TEXT NOT NULL REFERENCES members(id),
  signal     TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (family_id, member_id, signal)
);

-- One row per recipient per matching event. id is deterministic
-- (<event_id>:<member_id>) so a replayed stream entry cannot duplicate it.
CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  family_id   TEXT NOT NULL,
  member_id   TEXT NOT NULL,
  signal      TEXT NOT NULL,
  event_id    TEXT NOT NULL,
  actor_id    TEXT,
  category    TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS notifications_inbox_idx
  ON notifications(family_id, member_id, read_at, occurred_at DESC);
