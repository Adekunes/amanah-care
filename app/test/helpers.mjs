// Test harness. Real schema (db/init.sql) loaded into pg-mem, a fake Redis
// stream that records xAdd calls, and project() which pushes those entries
// through the real projector code. Every test runs the real routes in-process.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newDb, DataType } from 'pg-mem';
import { createApp } from '../api/app.js';
import { applyEvent } from '../projector/apply.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const INIT_SQL = fs.readFileSync(path.join(here, '..', 'db', 'init.sql'), 'utf8');

export function makeDb() {
  const mem = newDb();
  // pg-mem lacks date_trunc; the view needs it. Day boundary in UTC is fine for tests.
  mem.public.registerFunction({
    name: 'date_trunc', args: [DataType.text, DataType.timestamptz], returns: DataType.timestamptz,
    implementation: (unit, ts) => { const d = new Date(ts); if (unit === 'day') d.setUTCHours(0, 0, 0, 0); return d; },
  });
  mem.public.none(INIT_SQL);
  const { Pool } = mem.adapters.createPg();
  return new Pool();
}

export function makeStream() {
  const entries = [];
  let n = 0;
  return {
    entries,
    async xAdd(stream, _id, fields) {
      const id = `${Date.now()}-${n++}`;
      entries.push({ stream, id, message: { ...fields } });
      return id;
    },
  };
}

// Drain the fake stream through the real projector into the db.
export async function project(db, redis) {
  for (const e of redis.entries.splice(0)) await applyEvent(db, e.id, e.message);
}

export async function startApp(over = {}) {
  const db = over.db || makeDb();
  const redis = over.redis || makeStream();
  const app = createApp({ db, redis });
  const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const get = (p) => fetch(base + p);
  const close = () => new Promise((r) => server.close(r));
  return { db, redis, base, post, get, close, project: () => project(db, redis) };
}

export const uuid = () => globalThis.crypto.randomUUID();
