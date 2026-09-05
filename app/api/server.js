// Amanah Care API entry point. Wires the real clients into createApp().
import { createClient } from 'redis';
import pg from 'pg';
import { createApp } from './app.js';

const PORT = process.env.PORT || 4000;

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', (e) => console.error('[api] redis', e.message));
await redis.connect();

const app = createApp({ db, redis });
app.listen(PORT, () => console.log(`[api] listening on ${PORT}`));
