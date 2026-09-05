// Amanah Care projector. One consumer group on the events stream.
// Copies each event into Postgres (idempotent upsert by event id) and keeps
// the handoffs read model current. Never decrypts anything.
import { createClient } from 'redis';
import pg from 'pg';

const STREAM = 'events';
const GROUP = 'projector';
const CONSUMER = 'projector-1';

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', (e) => console.error('[projector] redis', e.message));
await redis.connect();

// Create the consumer group once. MKSTREAM makes the stream if absent.
try {
  await redis.xGroupCreate(STREAM, GROUP, '0', { MKSTREAM: true });
  console.log('[projector] group created');
} catch (e) {
  if (!String(e.message).includes('BUSYGROUP')) throw e;
  console.log('[projector] group exists');
}

async function applyEvent(id, f) {
  // Idempotent: same event id replays harmlessly (AR-04, crash-safe upsert).
  await db.query(
    `INSERT INTO events(id,stream_id,family_id,type,actor_id,category,from_id,to_id,handoff_id,key_version,iv,payload_cipher,occurred_at,signal)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO NOTHING`,
    [f.id, id, f.family_id, f.type, f.actor_id || null, f.category || null,
     f.from_id || null, f.to_id || null, f.handoff_id || null,
     parseInt(f.key_version || '1', 10), f.iv || null, f.payload_cipher || null,
     f.occurred_at || new Date().toISOString(), f.signal || null]);

  if (f.type === 'HandoffOpened') {
    await db.query(
      `INSERT INTO handoffs(id,family_id,from_id,to_id,status,opened_at,iv,summary_cipher)
       VALUES($1,$2,$3,$4,'open',$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [f.handoff_id || f.id, f.family_id, f.from_id, f.to_id,
       f.occurred_at || new Date().toISOString(), f.iv || null, f.payload_cipher || null]);
  }

  if (f.type === 'HandoffAcknowledged') {
    await db.query(
      `UPDATE handoffs SET status='acknowledged', acked_at=$2
         WHERE id=$1 AND status='open'`,
      [f.handoff_id, f.occurred_at || new Date().toISOString()]);
  }
}

console.log('[projector] consuming...');
for (;;) {
  let resp;
  try {
    resp = await redis.xReadGroup(GROUP, CONSUMER,
      [{ key: STREAM, id: '>' }], { COUNT: 20, BLOCK: 5000 });
  } catch (e) { console.error('[projector] read', e.message); continue; }
  if (!resp) continue;
  for (const stream of resp) {
    for (const msg of stream.messages) {
      try {
        await applyEvent(msg.id, msg.message);
        await redis.xAck(STREAM, GROUP, msg.id);
      } catch (e) {
        console.error('[projector] apply failed, will retry', msg.id, e.message);
        // no ack -> stays in the pending list, retried on restart
      }
    }
  }
}
