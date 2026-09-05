// Amanah Care notifier (AR-05). Second consumer group on the events stream.
//
// The projector builds read models; this one fans out notifications. Two groups
// on one stream means neither blocks the other and either can be replayed alone.
//
// It never decrypts. It routes on `signal`, a clear enumerated field the client
// opts into per event, so the server learns "a pickup was requested" and never
// the note attached to it.
import { createClient } from 'redis';
import pg from 'pg';

const STREAM = 'events';
const GROUP = 'notifier';
const CONSUMER = 'notifier-1';

// The only signals this service will act on. Anything else is ignored, so a
// client cannot invent a routing key the family never agreed to.
const SIGNALS = new Set([
  'pickup_needed', 'meds_skipped', 'meds_refused',
  'food_refused', 'mood_agitated', 'handoff_opened',
]);

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', (e) => console.error('[notifier] redis', e.message));
await redis.connect();

try {
  await redis.xGroupCreate(STREAM, GROUP, '0', { MKSTREAM: true });
  console.log('[notifier] group created');
} catch (e) {
  if (!String(e.message).includes('BUSYGROUP')) throw e;
  console.log('[notifier] group exists');
}

async function fanOut(f) {
  const signal = f.signal || (f.type === 'HandoffOpened' ? 'handoff_opened' : null);
  if (!signal || !SIGNALS.has(signal)) return 0;

  // A handoff notifies its recipient. Everything else notifies subscribers,
  // minus the person who logged it: nobody needs alerting to their own action.
  let targets;
  if (signal === 'handoff_opened') {
    targets = f.to_id ? [f.to_id] : [];
  } else {
    const r = await db.query(
      `SELECT member_id FROM subscriptions
         WHERE family_id = $1 AND signal = $2 AND member_id <> $3`,
      [f.family_id, signal, f.actor_id || '']);
    targets = r.rows.map(x => x.member_id);
  }
  if (!targets.length) return 0;

  // Deterministic id keeps a replayed stream entry from duplicating a row.
  for (const member_id of targets) {
    await db.query(
      `INSERT INTO notifications
         (id, family_id, member_id, signal, event_id, actor_id, category, occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO NOTHING`,
      [`${f.id}:${member_id}`, f.family_id, member_id, signal, f.id,
       f.actor_id || null, f.category || null,
       f.occurred_at || new Date().toISOString()]);
  }
  return targets.length;
}

console.log('[notifier] consuming...');
for (;;) {
  let resp;
  try {
    resp = await redis.xReadGroup(GROUP, CONSUMER,
      [{ key: STREAM, id: '>' }], { COUNT: 20, BLOCK: 5000 });
  } catch (e) { console.error('[notifier] read', e.message); continue; }
  if (!resp) continue;

  for (const stream of resp) {
    for (const msg of stream.messages) {
      try {
        const n = await fanOut(msg.message);
        if (n) console.log(`[notifier] ${msg.message.signal || msg.message.type} -> ${n} member(s)`);
        await redis.xAck(STREAM, GROUP, msg.id);
      } catch (e) {
        console.error('[notifier] apply', e.message);   // leave unacked for retry
      }
    }
  }
}
