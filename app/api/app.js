// Amanah Care API. Command handler + read-model reads.
// Write path: validate member -> XADD to the events stream -> 202.
// Read path: read Postgres projections. Server never sees plaintext.
//
// createApp() takes its clients as arguments. server.js wires the real
// Postgres pool and Redis client. The test suite passes an in-memory
// Postgres and a fake stream, so every route runs in-process.
import express from 'express';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { mountSubscriptions, ensureDefaults } from './routes/subscriptions.js';
import { mountNotifications } from './routes/notifications.js';
import { LocalBus } from './bus.js';

const uuid = () => (globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(16).slice(2));

// Events that bootstrap identity and so cannot require an existing member row.
export const BOOTSTRAP = new Set(['FamilyCreated', 'MemberJoined']);
// Only the elder may change consent (SR-07, deferred, guard kept honest).
export const ELDER_ONLY = new Set(['ConsentChanged']);
// Event types a client may list by type. Rows carry routing fields + ciphertext only.
export const LISTABLE = new Set([
  'FamilyCreated', 'MemberJoined', 'PreferenceSet', 'RoutineSet',
  'CareLogged', 'HandoffOpened', 'HandoffAcknowledged', 'ConsentChanged',
  'EmergencyRaised', 'PatternAcknowledged', 'CareRetracted',
]);

// Express 4 does not catch rejected promises. Every async route goes through this.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const normLogin = (l) => String(l || '').trim().toLowerCase();
const hashPw = (pw, salt) => scryptSync(String(pw), salt, 32).toString('hex');

export function createApp({ db, redis, stream = 'events', bus = new LocalBus() }) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use((req, res, next) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', 'content-type');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  async function isMember(familyId, memberId) {
    if (!familyId || !memberId) return null;
    const r = await db.query('SELECT id, role FROM members WHERE id=$1 AND family_id=$2', [memberId, familyId]);
    return r.rows[0] || null;
  }

  // Latest event of one type for a family. The client decrypts it.
  async function latestOfType(familyId, type) {
    const r = await db.query(
      `SELECT id, iv, payload_cipher, key_version, occurred_at
         FROM events WHERE family_id=$1 AND type=$2
         ORDER BY occurred_at DESC LIMIT 1`, [familyId, type]);
    return r.rows[0] || null;
  }

  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Create a family. Client sends id, key_check, key_version, and the first member.
  app.post('/families', wrap(async (req, res) => {
    const { family_id, key_check, key_version = 1, member } = req.body || {};
    if (!family_id || !key_check || !member?.id || !member?.role)
      return res.status(400).json({ error: 'family_id, key_check, member{id,role} required' });
    await db.query(
      'INSERT INTO families(id,key_check,key_version) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING',
      [family_id, key_check, key_version]);
    await db.query(
      'INSERT INTO members(id,family_id,role) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING',
      [member.id, family_id, member.role]);
    await ensureDefaults(db, family_id, member.id, member.role);
    res.status(201).json({ family_id });
  }));

  // Join check: prove you hold H by matching key_check, then register the member.
  app.post('/families/:id/join', wrap(async (req, res) => {
    const familyId = req.params.id;
    const { key_check, member } = req.body || {};
    const fam = (await db.query('SELECT key_check, key_version FROM families WHERE id=$1', [familyId])).rows[0];
    if (!fam) return res.status(404).json({ error: 'no such family' });
    if (fam.key_check !== key_check) return res.status(403).json({ error: 'wrong key' });
    if (!member?.id || !member?.role) return res.status(400).json({ error: 'member{id,role} required' });
    await db.query('INSERT INTO members(id,family_id,role) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING',
      [member.id, familyId, member.role]);
    await ensureDefaults(db, familyId, member.id, member.role);
    res.status(201).json({ family_id: familyId, key_version: fam.key_version });
  }));

  // Append any event. Trusted client-declared actor_id (SR-11 stub, labelled).
  app.post('/events', wrap(async (req, res) => {
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
    const streamId = await redis.xAdd(stream, '*', fields);
    res.status(202).json({ id, stream_id: streamId });
  }));

  // Login ------------------------------------------------------------------------
  // First time: join with the code (proves H). Then register a login: the phone
  // sends H wrapped under the password; the server stores the wrap + a scrypt hash.
  app.post('/auth/register', wrap(async (req, res) => {
    const { family_id, member_id, key_check, login, password, wrap_salt, wrap_iv, wrapped_h } = req.body || {};
    const l = normLogin(login);
    if (!family_id || !member_id || !key_check || !l || !password || !wrap_salt || !wrap_iv || !wrapped_h)
      return res.status(400).json({ error: 'family_id, member_id, key_check, login, password, wrap_salt, wrap_iv, wrapped_h required' });
    if (l.length < 3 || l.length > 120 || /\s/.test(l))
      return res.status(400).json({ error: 'login must be 3 to 120 characters with no spaces' });
    const fam = (await db.query('SELECT key_check FROM families WHERE id=$1', [family_id])).rows[0];
    if (!fam || fam.key_check !== key_check) return res.status(403).json({ error: 'wrong key' });
    if (!(await isMember(family_id, member_id))) return res.status(403).json({ error: 'not a member of this family' });
    // One login may hold several families (a support worker serving many homes),
    // under one password: a second family must be registered with the same password.
    const existing = (await db.query('SELECT member_id, family_id, pw_salt, pw_hash FROM logins WHERE login=$1', [l])).rows;
    const sameFamily = existing.find((x) => x.family_id === family_id);
    if (sameFamily && sameFamily.member_id !== member_id) return res.status(409).json({ error: 'login already taken' });
    const other = existing.find((x) => x.family_id !== family_id);
    if (other && !timingSafeEqual(Buffer.from(hashPw(password, other.pw_salt), 'hex'), Buffer.from(other.pw_hash, 'hex')))
      return res.status(403).json({ error: 'this login already exists with a different password' });
    const pw_salt = randomBytes(16).toString('hex');
    await db.query('DELETE FROM logins WHERE member_id=$1', [member_id]);   // one login per member; re-register replaces it
    await db.query(
      `INSERT INTO logins(login,member_id,family_id,pw_salt,pw_hash,wrap_salt,wrap_iv,wrapped_h)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [l, member_id, family_id, pw_salt, hashPw(password, pw_salt), wrap_salt, wrap_iv, wrapped_h]);
    res.status(201).json({ login: l, member_id });
  }));

  // Returns the wrapped key material; the phone unwraps it with the password.
  app.post('/auth/login', wrap(async (req, res) => {
    const { login, password } = req.body || {};
    const l = normLogin(login);
    if (!l || !password) return res.status(400).json({ error: 'login and password required' });
    const rows = (await db.query(
      `SELECT l.member_id, l.family_id, l.pw_salt, l.pw_hash, l.wrap_salt, l.wrap_iv, l.wrapped_h, l.created_at, m.role, f.key_version
         FROM logins l JOIN members m ON m.id = l.member_id JOIN families f ON f.id = l.family_id
        WHERE l.login=$1`, [l])).rows;
    const ok = rows.filter((row) => timingSafeEqual(Buffer.from(hashPw(password, row.pw_salt), 'hex'), Buffer.from(row.pw_hash, 'hex')));
    if (!ok.length) return res.status(401).json({ error: 'wrong login or password' });
    ok.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    await db.query('UPDATE logins SET last_login_at=now() WHERE login=$1', [l]);
    const pick = (row) => ({ family_id: row.family_id, member_id: row.member_id, role: row.role, key_version: row.key_version,
                             wrap_salt: row.wrap_salt, wrap_iv: row.wrap_iv, wrapped_h: row.wrapped_h });
    // Every family this login can open, plus the first one at the top level for older clients.
    res.json({ ...pick(ok[0]), login: l, families: ok.map(pick) });
  }));

  // Read models -----------------------------------------------------------------

  // Latest PreferenceSet event for a family (client decrypts to render the strip).
  app.get('/families/:id/preferences', wrap(async (req, res) => {
    res.json(await latestOfType(req.params.id, 'PreferenceSet'));
  }));

  // Latest RoutineSet event: the elder's recurring plan (client decrypts).
  app.get('/families/:id/routine', wrap(async (req, res) => {
    res.json(await latestOfType(req.params.id, 'RoutineSet'));
  }));

  // Care items since a given time (client decrypts). LEFT JOINed with any
  // CareRetracted event for the same row: CareRetracted carries no payload
  // and reuses the `handoff_id` routing column (no schema change) to hold
  // the id of the CareLogged event it undoes, so a member can retract a
  // mistaken log without deleting the original event (event sourcing).
  // The join is against a GROUP BY handoff_id subquery, not EXISTS/DISTINCT
  // ON, so a second retraction of the same id cannot duplicate the row and
  // pg-mem (used by the tests) runs it unchanged.
  app.get('/families/:id/care', wrap(async (req, res) => {
    const since = req.query.since || '1970-01-01';
    const r = await db.query(
      `SELECT c.id, c.actor_id, c.category, c.iv, c.payload_cipher, c.key_version, c.occurred_at,
              (ret.handoff_id IS NOT NULL) AS retracted, ret.actor_id AS retracted_by
         FROM events c
         LEFT JOIN (
           SELECT handoff_id, min(actor_id) AS actor_id
             FROM events WHERE family_id=$1 AND type='CareRetracted'
             GROUP BY handoff_id
         ) ret ON ret.handoff_id = c.id
        WHERE c.family_id=$1 AND c.type='CareLogged' AND c.occurred_at >= $2
        ORDER BY c.occurred_at ASC`, [req.params.id, since]);
    res.json(r.rows);
  }));

  // Events of one type for a family (member names, plan history). Ciphertext only.
  app.get('/families/:id/events', wrap(async (req, res) => {
    const type = req.query.type;
    if (!type || !LISTABLE.has(type))
      return res.status(400).json({ error: 'type query required, one of: ' + [...LISTABLE].join(', ') });
    const r = await db.query(
      `SELECT id, type, actor_id, category, from_id, to_id, handoff_id, iv, payload_cipher, key_version, occurred_at
         FROM events WHERE family_id=$1 AND type=$2 ORDER BY occurred_at ASC LIMIT 500`,
      [req.params.id, type]);
    res.json(r.rows);
  }));

  // Handoffs, optionally filtered to a recipient. Drives the poll (FR-05).
  app.get('/families/:id/handoffs', wrap(async (req, res) => {
    const { to, status } = req.query;
    const cond = ['family_id=$1']; const args = [req.params.id];
    if (to)     { args.push(to);     cond.push(`to_id=$${args.length}`); }
    if (status) { args.push(status); cond.push(`status=$${args.length}`); }
    const r = await db.query(
      `SELECT id, from_id, to_id, status, opened_at, acked_at, iv, summary_cipher
         FROM handoffs WHERE ${cond.join(' AND ')} ORDER BY opened_at DESC`, args);
    res.json(r.rows);
  }));

  // Workload counts per member. Metadata only, no decryption (FR-09, AR-08).
  // Optional ?since=YYYY-MM-DD narrows it to recent days (the dashboard asks for the week).
  app.get('/families/:id/workload', wrap(async (req, res) => {
    const since = req.query.since || '1970-01-01';
    const r = await db.query(
      `SELECT member_id,
              sum(care_count)::int    AS care_count,
              sum(handoff_count)::int AS handoff_count
         FROM workload_view WHERE family_id=$1 AND day >= $2
         GROUP BY member_id ORDER BY care_count DESC`, [req.params.id, since]);
    res.json(r.rows);
  }));

  app.get('/families/:id/members', wrap(async (req, res) => {
    const r = await db.query('SELECT id, role, joined_at FROM members WHERE family_id=$1', [req.params.id]);
    res.json(r.rows);
  }));

  // Kill-switch view: raw rows so judges see only ciphertext (FR-18).
  app.get('/debug/events', wrap(async (_req, res) => {
    const r = await db.query(
      `SELECT family_id, type, actor_id, category, iv, payload_cipher, occurred_at
         FROM events ORDER BY occurred_at DESC LIMIT 50`);
    res.json(r.rows);
  }));

  // Live updates (FR-05 upgrade): one server-sent-events stream per family.
  // The projector announces an event after its read models are written; the
  // phone refetches what it shows. Metadata only, never a payload.
  app.get('/families/:id/live', async (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
              'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('event: hello\ndata: {}\n\n');
    const send = (msg) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(msg)}\n\n`); };
    const off = await bus.subscribe(req.params.id, send);
    const beat = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
    req.on('close', async () => { clearInterval(beat); await off(); });
  });

  // Alerts: subscriptions + notifications live in their own route modules.
  mountSubscriptions(app, { db, wrap, isMember });
  mountNotifications(app, { db, wrap, isMember });

  // Last resort: a failing query answers with JSON, never a hung request.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error('[api]', err.message);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}
