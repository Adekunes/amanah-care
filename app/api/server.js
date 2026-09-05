// Amanah Care API. Command handler + read-model reads.
// Write path: validate member -> XADD to the events stream -> 202.
// Read path: read Postgres projections. Server never sees plaintext.
import express from 'express';
import { createClient } from 'redis';
import pg from 'pg';

const PORT = process.env.PORT || 4000;
const STREAM = 'events';

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', (e) => console.error('[api] redis', e.message));
await redis.connect();

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => { res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'content-type');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204); next(); });

const uuid = () => (globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(16).slice(2));

// Events that bootstrap identity and so cannot require an existing member row.
const BOOTSTRAP = new Set(['FamilyCreated', 'MemberJoined']);
// Only the elder may change consent (SR-07, Deferred but guard kept honest).
const ELDER_ONLY = new Set(['ConsentChanged']);

async function isMember(familyId, memberId) {
  if (!familyId || !memberId) return null;
  const r = await db.query('SELECT id, role FROM members WHERE id=$1 AND family_id=$2', [memberId, familyId]);
  return r.rows[0] || null;
}

app.get('/health', (_req, res) => res.json({ ok: true }));

// Create a family. Client sends id, key_check, key_version, and the first member.
app.post('/families', async (req, res) => {
  const { family_id, key_check, key_version = 1, member } = req.body || {};
  if (!family_id || !key_check || !member?.id || !member?.role)
    return res.status(400).json({ error: 'family_id, key_check, member{id,role} required' });
  await db.query(
    'INSERT INTO families(id,key_check,key_version) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING',
    [family_id, key_check, key_version]);
  await db.query(
    'INSERT INTO members(id,family_id,role) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING',
    [member.id, family_id, member.role]);
  res.status(201).json({ family_id });
});

// Join check: prove you hold H by matching key_check, then register the member.
app.post('/families/:id/join', async (req, res) => {
  const familyId = req.params.id;
  const { key_check, member } = req.body || {};
  const fam = (await db.query('SELECT key_check, key_version FROM families WHERE id=$1', [familyId])).rows[0];
  if (!fam) return res.status(404).json({ error: 'no such family' });
  if (fam.key_check !== key_check) return res.status(403).json({ error: 'wrong key' });
  if (!member?.id || !member?.role) return res.status(400).json({ error: 'member{id,role} required' });
  await db.query('INSERT INTO members(id,family_id,role) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING',
    [member.id, familyId, member.role]);
  res.status(201).json({ family_id: familyId, key_version: fam.key_version });
});

// Append any event. Trusted client-declared actor_id (SR-11 stub, labelled).
app.post('/events', async (req, res) => {
  const e = req.body || {};
  if (!e.family_id || !e.type) return res.status(400).json({ error: 'family_id and type required' });

  if (!BOOTSTRAP.has(e.type)) {
    const m = await isMember(e.family_id, e.actor_id);
    if (!m) return res.status(403).json({ error: 'not a member of this family' });
    if (ELDER_ONLY.has(e.type) && m.role !== 'elder')
      return res.status(403).json({ error: 'only the elder may change consent' });
  }

  const id = e.id || uuid();
  const fields = {
    id, family_id: e.family_id, type: e.type,
    actor_id: e.actor_id ?? '', category: e.category ?? '',
    from_id: e.from_id ?? '', to_id: e.to_id ?? '', handoff_id: e.handoff_id ?? '',
    key_version: String(e.key_version ?? 1),
    iv: e.iv ?? '', payload_cipher: e.payload_cipher ?? '',
    occurred_at: e.occurred_at || new Date().toISOString(),
  };
  const streamId = await redis.xAdd(STREAM, '*', fields);
  res.status(202).json({ id, stream_id: streamId });
});

// Read models -----------------------------------------------------------------

// Latest PreferenceSet event for a family (client decrypts to render the strip).
app.get('/families/:id/preferences', async (req, res) => {
  const r = await db.query(
    `SELECT id, iv, payload_cipher, key_version, occurred_at
       FROM events WHERE family_id=$1 AND type='PreferenceSet'
       ORDER BY occurred_at DESC LIMIT 1`, [req.params.id]);
  res.json(r.rows[0] || null);
});

// Care items since a given time (client decrypts).
app.get('/families/:id/care', async (req, res) => {
  const since = req.query.since || '1970-01-01';
  const r = await db.query(
    `SELECT id, actor_id, category, iv, payload_cipher, key_version, occurred_at
       FROM events WHERE family_id=$1 AND type='CareLogged' AND occurred_at >= $2
       ORDER BY occurred_at ASC`, [req.params.id, since]);
  res.json(r.rows);
});

// Handoffs, optionally filtered to a recipient. Drives the poll (FR-05).
app.get('/families/:id/handoffs', async (req, res) => {
  const { to, status } = req.query;
  const cond = ['family_id=$1']; const args = [req.params.id];
  if (to)     { args.push(to);     cond.push(`to_id=$${args.length}`); }
  if (status) { args.push(status); cond.push(`status=$${args.length}`); }
  const r = await db.query(
    `SELECT id, from_id, to_id, status, opened_at, acked_at, iv, summary_cipher
       FROM handoffs WHERE ${cond.join(' AND ')} ORDER BY opened_at DESC`, args);
  res.json(r.rows);
});

// Workload counts per member. Metadata only, no decryption (FR-09, AR-08).
app.get('/families/:id/workload', async (req, res) => {
  const r = await db.query(
    `SELECT member_id,
            sum(care_count)::int    AS care_count,
            sum(handoff_count)::int AS handoff_count
       FROM workload_view WHERE family_id=$1
       GROUP BY member_id ORDER BY care_count DESC`, [req.params.id]);
  res.json(r.rows);
});

app.get('/families/:id/members', async (req, res) => {
  const r = await db.query('SELECT id, role, joined_at FROM members WHERE family_id=$1', [req.params.id]);
  res.json(r.rows);
});

// Events for one family, optionally by type. Names live in MemberJoined events,
// and /debug/events is capped at 50 rows across every family, so a family with a
// week of care would lose its names. This is the query the client should use.
app.get('/families/:id/events', async (req, res) => {
  const { type } = req.query;
  const args = [req.params.id];
  const cond = ['family_id=$1'];
  if (type) { args.push(type); cond.push(`type=$${args.length}`); }
  const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
  const r = await db.query(
    `SELECT id, type, actor_id, category, iv, payload_cipher, key_version, occurred_at
       FROM events WHERE ${cond.join(' AND ')}
       ORDER BY occurred_at DESC LIMIT ${limit}`, args);
  res.json(r.rows);
});

// Kill-switch view: raw rows so judges see only ciphertext (FR-18).
app.get('/debug/events', async (req, res) => {
  const r = await db.query(
    `SELECT family_id, type, actor_id, category, iv, payload_cipher, occurred_at
       FROM events ORDER BY occurred_at DESC LIMIT 50`);
  res.json(r.rows);
});

app.listen(PORT, () => console.log(`[api] listening on ${PORT}`));
