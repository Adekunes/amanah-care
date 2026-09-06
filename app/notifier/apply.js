// Amanah Care notifier, the pure part. notify() reads one stream entry's
// fields, works out who is subscribed to it (match.js), and writes one
// notification row per recipient (idempotent upsert by event id + member
// id, same shape as the projector's upsert by event id). It never
// decrypts anything — notifications carries routing metadata only, see
// db/init.sql. index.js owns the consume loop.
import { kindsFor, recipients } from './match.js';

// Fields arrive off the stream as strings; '' means absent, same as the
// projector treats them. Coerce here so match.js never sees ''.
const orNull = (v) => (v === '' || v === undefined ? null : v);

export async function notify(db, streamId, fields) {
  const f = {
    id: fields.id,
    family_id: orNull(fields.family_id),
    type: fields.type,
    actor_id: orNull(fields.actor_id),
    category: orNull(fields.category),
    to_id: orNull(fields.to_id),
    handoff_id: orNull(fields.handoff_id),
    occurred_at: orNull(fields.occurred_at) || new Date().toISOString(),
  };

  // Nothing can possibly subscribe to this type: skip the db round trips.
  if (kindsFor(f).length === 0) return 0;

  const { rows: subs } = await db.query(
    `SELECT member_id, kind FROM subscriptions WHERE family_id = $1`,
    [f.family_id]);

  // handoff.accepted notifies whoever opened the handoff, i.e. the
  // handoff's from_id — not carried on the HandoffAcknowledged event
  // itself, so look it up (spec/NOTIFY-SPEC.md §1, §3).
  let handoffFromId = null;
  if (f.type === 'HandoffAcknowledged' && f.handoff_id) {
    const { rows } = await db.query(
      `SELECT from_id FROM handoffs WHERE id = $1`, [f.handoff_id]);
    handoffFromId = rows[0]?.from_id || null;
  }

  // Emergency alerts reach every family member regardless of subscriptions
  // (spec/NOTIFY-SPEC.md §1); look up the family's full member roster.
  let members = null;
  if (f.type === 'EmergencyRaised') {
    const { rows } = await db.query(
      `SELECT id FROM members WHERE family_id = $1`, [f.family_id]);
    members = rows.map((row) => row.id);
  }

  const recips = recipients(f, subs, { handoff_from_id: handoffFromId, members });

  for (const r of recips) {
    // ON CONFLICT DO NOTHING: replaying the same event is harmless, same
    // idempotency contract as the projector's upsert.
    await db.query(
      `INSERT INTO notifications(event_id,member_id,family_id,kind,type,category,from_id,handoff_id,occurred_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (event_id, member_id) DO NOTHING`,
      [f.id, r.member_id, f.family_id, r.kind, f.type, f.category, f.actor_id, f.handoff_id, f.occurred_at]);
  }

  // "Attempted", not "inserted": a replay attempts the same rows again
  // even though ON CONFLICT drops them.
  return recips.length;
}
