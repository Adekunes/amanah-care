// Amanah Care notifier. One consumer group on the events stream.
// Reads entries, hands each to notify() (see apply.js), acks on success.
import { createClient } from 'redis';
import pg from 'pg';
import { notify } from './apply.js';

const STREAM = 'events';
const GROUP = 'notifier';
const CONSUMER = 'notifier-1';

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', (e) => console.error('[notifier] redis', e.message));
await redis.connect();

// Create the consumer group once. MKSTREAM makes the stream if absent.
try {
  await redis.xGroupCreate(STREAM, GROUP, '0', { MKSTREAM: true });
  console.log('[notifier] group created');
} catch (e) {
  if (!String(e.message).includes('BUSYGROUP')) throw e;
  console.log('[notifier] group exists');
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
        await notify(db, msg.id, msg.message);
        await redis.xAck(STREAM, GROUP, msg.id);
      } catch (e) {
        console.error('[notifier] notify failed, will retry', msg.id, e.message);
        // no ack -> stays in the pending list, retried on restart
      }
    }
  }
}
