// Walidayn on Vercel: the whole api as one serverless function.
// Same createApp() as the containers; the stream is applied inline (projector
// and notifier run in-process on every write, like dev/stack.mjs); Postgres is
// Neon through DATABASE_URL; the schema is applied once per instance. Live
// updates over SSE do not fit a function, so /live answers 404 and the phones
// fall back to their 4-second poll.
import pg from 'pg';
import { createApp } from '../../api/app.js';
import { applyEvent } from '../../projector/apply.js';
import { notify } from '../../notifier/apply.js';
import { LocalBus } from '../../api/bus.js';
import INIT_SQL from '../../db/init.sql';

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL;
const db = new pg.Pool({ connectionString: url, max: 3, ssl: /localhost|127\.0\.0\.1/.test(url || '') ? false : { rejectUnauthorized: false } });
let ready = null;
const ensureSchema = () => (ready ||= db.query(INIT_SQL).catch((e) => { ready = null; throw e; }));

let n = 0;
const redis = { async xAdd(_stream, _id, fields) { const id = `${Date.now()}-${n++}`; await applyEvent(db, id, fields); await notify(db, id, fields); return id; } };
const app = createApp({ db, redis, bus: new LocalBus() });

export default async function handler(req, res) {
  if (!url) { res.statusCode = 500; return res.end(JSON.stringify({ error: 'DATABASE_URL is not set' })); }
  try { await ensureSchema(); } catch (e) { res.statusCode = 500; return res.end(JSON.stringify({ error: 'schema: ' + e.message })); }
  req.url = req.url.replace(/^\/api(?=\/|$)/, '') || '/';
  if (/^\/families\/[^/]+\/live/.test(req.url)) { res.statusCode = 404; return res.end('no live stream on this host; the app polls'); }
  return app(req, res);
}
