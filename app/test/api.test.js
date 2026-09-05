// api/app.js routes, in-process, on the real schema (pg-mem) + fake stream.
// Write side is checked on the stream; read side after project() runs the real projector.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, uuid, makeStream } from './helpers.mjs';
import { createApp } from '../api/app.js';
import { makeKey, keyCheck, encryptJSON, decryptJSON } from '../web/crypto.js';

describe('api', () => {
  let t;
  before(async () => { t = await startApp(); });
  after(async () => { await t.close(); });

  // A family with an elder and one family member, real key_check from a real key.
  async function family() {
    const key = await makeKey();
    const kc = await keyCheck(key);
    const fid = uuid().slice(0, 8), elder = uuid(), sis = uuid();
    assert.equal((await t.post('/families', { family_id: fid, key_check: kc, key_version: 1, member: { id: elder, role: 'elder' } })).status, 201);
    assert.equal((await t.post(`/families/${fid}/join`, { key_check: kc, member: { id: sis, role: 'family' } })).status, 201);
    return { key, kc, fid, elder, sis };
  }
  const enc = async (key, obj) => { const { iv, cipher } = await encryptJSON(key, obj); return { iv, payload_cipher: cipher }; };

  test('GET /health', async () => {
    const r = await t.get('/health');
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true });
  });

  test('CORS preflight answers 204 with permissive headers (web app runs on another port)', async () => {
    const r = await fetch(t.base + '/events', { method: 'OPTIONS' });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get('access-control-allow-origin'), '*');
    assert.match(r.headers.get('access-control-allow-methods'), /POST/);
  });

  describe('POST /families', () => {
    test('400 when required fields are missing', async () => {
      const r = await t.post('/families', { family_id: 'x' });
      assert.equal(r.status, 400);
      assert.match((await r.json()).error, /required/);
    });
    test('201 creates family + first member; repeat is idempotent', async () => {
      const fid = uuid().slice(0, 8), m = uuid();
      const body = { family_id: fid, key_check: 'kc', member: { id: m, role: 'family' } };
      assert.equal((await t.post('/families', body)).status, 201);
      assert.equal((await t.post('/families', body)).status, 201);
      const members = await (await t.get(`/families/${fid}/members`)).json();
      assert.equal(members.length, 1);
      assert.equal(members[0].role, 'family');
    });
  });

  describe('POST /families/:id/join', () => {
    test('404 unknown family', async () => {
      assert.equal((await t.post('/families/nope/join', { key_check: 'x', member: { id: 'a', role: 'family' } })).status, 404);
    });
    test('403 wrong key_check: holding the wrong H is proof you are not family', async () => {
      const f = await family();
      const r = await t.post(`/families/${f.fid}/join`, { key_check: 'wrong', member: { id: uuid(), role: 'family' } });
      assert.equal(r.status, 403);
    });
    test('400 missing member', async () => {
      const f = await family();
      assert.equal((await t.post(`/families/${f.fid}/join`, { key_check: f.kc })).status, 400);
    });
    test('201 returns key_version', async () => {
      const f = await family();
      const r = await t.post(`/families/${f.fid}/join`, { key_check: f.kc, member: { id: uuid(), role: 'support' } });
      assert.equal(r.status, 201);
      assert.deepEqual(await r.json(), { family_id: f.fid, key_version: 1 });
    });
  });

  describe('POST /events (command side)', () => {
    test('400 without family_id/type', async () => {
      assert.equal((await t.post('/events', { type: 'CareLogged' })).status, 400);
      assert.equal((await t.post('/events', { family_id: 'f' })).status, 400);
    });
    test('403 for a non-member actor', async () => {
      const f = await family();
      const r = await t.post('/events', { family_id: f.fid, type: 'CareLogged', actor_id: uuid() });
      assert.equal(r.status, 403);
      assert.match((await r.json()).error, /not a member/);
    });
    test('bootstrap events (MemberJoined, FamilyCreated) pass without a member row', async () => {
      const f = await family();
      const r = await t.post('/events', { family_id: f.fid, type: 'MemberJoined', actor_id: uuid(), ...(await enc(f.key, { name: 'New' })) });
      assert.equal(r.status, 202);
    });
    test('ConsentChanged: 403 from family, 202 from the elder', async () => {
      const f = await family();
      const a = await t.post('/events', { family_id: f.fid, type: 'ConsentChanged', actor_id: f.sis });
      assert.equal(a.status, 403);
      assert.match((await a.json()).error, /only the elder/);
      const b = await t.post('/events', { family_id: f.fid, type: 'ConsentChanged', actor_id: f.elder });
      assert.equal(b.status, 202);
    });
    test('202 appends to the stream with routing fields + ciphertext only', async () => {
      const f = await family();
      const c = await enc(f.key, { text: 'meds given' });
      const r = await t.post('/events', { family_id: f.fid, type: 'CareLogged', actor_id: f.sis, category: 'meds', ...c });
      assert.equal(r.status, 202);
      const body = await r.json();
      assert.ok(body.id && body.stream_id);
      const e = t.redis.entries.at(-1);
      assert.equal(e.stream, 'events');
      assert.equal(e.id, body.stream_id);
      assert.equal(e.message.id, body.id);
      assert.equal(e.message.type, 'CareLogged');
      assert.equal(e.message.actor_id, f.sis);
      assert.equal(e.message.category, 'meds');
      assert.equal(e.message.key_version, '1');
      assert.equal(e.message.iv, c.iv);
      assert.equal(e.message.payload_cipher, c.payload_cipher);
      assert.equal(e.message.from_id, '');
      assert.match(e.message.occurred_at, /^\d{4}-\d{2}-\d{2}T/);
    });
    test('keeps a client-supplied id and occurred_at (offline replay, idempotency)', async () => {
      const f = await family();
      const id = uuid(), at = '2026-09-01T08:00:00.000Z';
      const r = await t.post('/events', { id, occurred_at: at, family_id: f.fid, type: 'CareLogged', actor_id: f.sis, category: 'meal' });
      assert.equal((await r.json()).id, id);
      assert.equal(t.redis.entries.at(-1).message.occurred_at, at);
    });
  });

  describe('read models (after the projector runs)', () => {
    test('preferences and routine: null until set, then the latest', async () => {
      const f = await family();
      assert.equal(await (await t.get(`/families/${f.fid}/preferences`)).json(), null);
      assert.equal(await (await t.get(`/families/${f.fid}/routine`)).json(), null);
      const p1 = await enc(f.key, { lang: 'Urdu' });
      await t.post('/events', { family_id: f.fid, type: 'PreferenceSet', actor_id: f.elder, occurred_at: '2026-09-01T00:00:00Z', ...p1 });
      const p2 = await enc(f.key, { lang: 'Urdu', diet: 'halal' });
      await t.post('/events', { family_id: f.fid, type: 'PreferenceSet', actor_id: f.elder, occurred_at: '2026-09-02T00:00:00Z', ...p2 });
      const rt = await enc(f.key, { items: [{ id: 'r1', category: 'meds', label: 'morning meds', time: '08:00', days: 'daily' }] });
      await t.post('/events', { family_id: f.fid, type: 'RoutineSet', actor_id: f.sis, ...rt });
      await t.project();
      const pref = await (await t.get(`/families/${f.fid}/preferences`)).json();
      assert.equal(pref.payload_cipher, p2.payload_cipher);
      assert.deepEqual(await decryptJSON(f.key, pref.iv, pref.payload_cipher), { lang: 'Urdu', diet: 'halal' });
      const routine = await (await t.get(`/families/${f.fid}/routine`)).json();
      assert.equal((await decryptJSON(f.key, routine.iv, routine.payload_cipher)).items[0].label, 'morning meds');
    });

    test('care?since filters by time and returns ciphertext the client can decrypt', async () => {
      const f = await family();
      const old = await enc(f.key, { text: 'old' }), fresh = await enc(f.key, { text: 'fresh' });
      await t.post('/events', { family_id: f.fid, type: 'CareLogged', actor_id: f.sis, category: 'meal', occurred_at: '2026-09-01T09:00:00Z', ...old });
      await t.post('/events', { family_id: f.fid, type: 'CareLogged', actor_id: f.sis, category: 'meal', occurred_at: '2026-09-03T09:00:00Z', ...fresh });
      await t.project();
      const all = await (await t.get(`/families/${f.fid}/care`)).json();
      assert.equal(all.length, 2);
      const since = await (await t.get(`/families/${f.fid}/care?since=2026-09-02T00:00:00Z`)).json();
      assert.equal(since.length, 1);
      assert.deepEqual(await decryptJSON(f.key, since[0].iv, since[0].payload_cipher), { text: 'fresh' });
    });

    test('events?type lists one type for one family; 400 for missing or unknown type', async () => {
      const f = await family();
      const g = await family();
      await t.post('/events', { family_id: f.fid, type: 'MemberJoined', actor_id: f.sis, ...(await enc(f.key, { name: 'Sister A' })) });
      await t.post('/events', { family_id: g.fid, type: 'MemberJoined', actor_id: g.sis, ...(await enc(g.key, { name: 'Other' })) });
      await t.project();
      const rows = await (await t.get(`/families/${f.fid}/events?type=MemberJoined`)).json();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].actor_id, f.sis);
      assert.equal((await t.get(`/families/${f.fid}/events`)).status, 400);
      assert.equal((await t.get(`/families/${f.fid}/events?type=DropTable`)).status, 400);
    });

    test('handoffs: open after HandoffOpened, filter by to/status, acknowledged after ack', async () => {
      const f = await family();
      const hid = uuid();
      const summary = await enc(f.key, { summary: 'meds given, ate half', next: 'physio at 3' });
      await t.post('/events', { family_id: f.fid, type: 'HandoffOpened', actor_id: f.sis, from_id: f.sis, to_id: f.elder, handoff_id: hid, ...summary });
      await t.project();
      let rows = await (await t.get(`/families/${f.fid}/handoffs?to=${f.elder}&status=open`)).json();
      assert.equal(rows.length, 1);
      assert.equal(rows[0].id, hid);
      assert.equal(rows[0].from_id, f.sis);
      assert.deepEqual(await decryptJSON(f.key, rows[0].iv, rows[0].summary_cipher), { summary: 'meds given, ate half', next: 'physio at 3' });
      assert.equal((await (await t.get(`/families/${f.fid}/handoffs?to=${f.sis}`)).json()).length, 0);
      await t.post('/events', { family_id: f.fid, type: 'HandoffAcknowledged', actor_id: f.elder, handoff_id: hid });
      await t.project();
      rows = await (await t.get(`/families/${f.fid}/handoffs?status=acknowledged`)).json();
      assert.equal(rows.length, 1);
      assert.ok(rows[0].acked_at);
      assert.equal((await (await t.get(`/families/${f.fid}/handoffs?status=open`)).json()).length, 0);
    });

    test('workload counts per member come from metadata only', async () => {
      const f = await family();
      for (let i = 0; i < 2; i++) await t.post('/events', { family_id: f.fid, type: 'CareLogged', actor_id: f.sis, category: 'meds' });
      await t.post('/events', { family_id: f.fid, type: 'HandoffAcknowledged', actor_id: f.elder, handoff_id: 'h' });
      await t.project();
      const rows = await (await t.get(`/families/${f.fid}/workload`)).json();
      const bySis = rows.find((r) => r.member_id === f.sis), byElder = rows.find((r) => r.member_id === f.elder);
      assert.deepEqual([bySis.care_count, bySis.handoff_count], [2, 0]);
      assert.deepEqual([byElder.care_count, byElder.handoff_count], [0, 1]);
      // ?since narrows to recent days; a date in the future returns nothing
      const later = await (await t.get(`/families/${f.fid}/workload?since=2099-01-01`)).json();
      assert.deepEqual(later, []);
      const all = await (await t.get(`/families/${f.fid}/workload?since=2000-01-01`)).json();
      assert.equal(all.length, 2);
    });

    test('members lists ids and roles, never names (names live encrypted in events)', async () => {
      const f = await family();
      const rows = await (await t.get(`/families/${f.fid}/members`)).json();
      assert.equal(rows.length, 2);
      for (const r of rows) assert.deepEqual(Object.keys(r).sort(), ['id', 'joined_at', 'role']);
    });
  });

  describe('privacy: the server side never holds plaintext', () => {
    test('a logged note is absent from every row the server can return, and decrypts on the client', async () => {
      const f = await family();
      const secret = 'Ammi refused breakfast, said she felt dizzy';
      const c = await enc(f.key, { text: secret });
      await t.post('/events', { family_id: f.fid, type: 'CareLogged', actor_id: f.sis, category: 'meal', ...c });
      await t.project();
      const dumps = [
        await (await t.get('/debug/events')).text(),
        await (await t.get(`/families/${f.fid}/care`)).text(),
        await (await t.get(`/families/${f.fid}/events?type=CareLogged`)).text(),
        JSON.stringify((await t.db.query('SELECT * FROM events')).rows),
        JSON.stringify(t.redis.entries),
      ];
      for (const d of dumps) {
        assert.equal(d.includes(secret), false);
        assert.equal(d.includes('dizzy'), false);
      }
      const row = (await (await t.get(`/families/${f.fid}/care`)).json())[0];
      assert.deepEqual(await decryptJSON(f.key, row.iv, row.payload_cipher), { text: secret });
      assert.equal(await decryptJSON(await makeKey(), row.iv, row.payload_cipher), null);
    });
  });

  test('a failing query answers 500 JSON instead of hanging the request', async () => {
    const broken = { query: async () => { throw new Error('db down'); } };
    const app = createApp({ db: broken, redis: makeStream() });
    const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
    try {
      const r = await fetch(`http://127.0.0.1:${server.address().port}/families/x/members`);
      assert.equal(r.status, 500);
      assert.deepEqual(await r.json(), { error: 'internal error' });
    } finally { await new Promise((r) => server.close(r)); }
  });
});
