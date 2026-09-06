// Walidayn projector. One consumer group on the events stream.
// Reads entries, hands each to applyEvent() (see apply.js), acks on success.
import { createClient } from 'redis';
import pg from 'pg';
import { applyEvent } from './apply.js';

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

// Announces each applied event on family:<id> for the API's live streams.
const bus = { publish: (family, msg) => redis.publish(`family:${family}`, JSON.stringify(msg)) };

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
        await applyEvent(db, msg.id, msg.message, bus);
        await redis.xAck(STREAM, GROUP, msg.id);
      } catch (e) {
        console.error('[projector] apply failed, will retry', msg.id, e.message);
        // no ack -> stays in the pending list, retried on restart
      }
    }
  }
}
