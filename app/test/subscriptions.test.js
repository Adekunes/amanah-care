// api/routes/subscriptions.js + api/routes/notifications.js routes, in-process,
// on the real schema (pg-mem) + fake stream. Contract: spec/NOTIFY-SPEC.md §1, §4.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, uuid } from './helpers.mjs';
import { KINDS } from '../api/routes/subscriptions.js';

describe('subscriptions + notifications routes', () => {
  let t;
  before(async () => { t = await startApp(); });
  after(async () => { await t.close(); });

  // helpers.mjs only exposes get/post; PUT is needed here and only here.
  const put = (p, body) => fetch(t.base + p, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });

  // A fresh family with one member of the given role, created via POST /families.
  async function family(role = 'family') {
    const fid = uuid().slice(0, 8), mid = uuid();
    const r = await t.post('/families', { family_id: fid, key_check: 'kc', member: { id: mid, role } });
    assert.equal(r.status, 201);
    return { fid, mid, kc: 'kc' };
  }
  // A family + elder + one joined family-role member, wired for notification tests.
  async function familyWithSub(kinds) {
    const fid = uuid().slice(0, 8), elder = uuid(), sis = uuid();
    assert.equal((await t.post('/families', { family_id: fid, key_check: 'kc', member: { id: elder, role: 'elder' } })).status, 201);
    assert.equal((await t.post(`/families/${fid}/join`, { key_check: 'kc', member: { id: sis, role: 'family' } })).status, 201);
    assert.equal((await put(`/families/${fid}/members/${sis}/subscriptions`, { kinds })).status, 200);
    return { fid, elder, sis };
  }
  const canonical = (kinds) => KINDS.filter((k) => kinds.includes(k));

  describe('defaults (ensureDefaults, wired from app.js)', () => {
    test('POST /families gives a family-role member handoff.to_me + handoff.accepted + emergency', async () => {
      const { fid, mid } = await family('family');
      const body = await (await t.get(`/families/${fid}/members/${mid}/subscriptions`)).json();
      assert.equal(body.member_id, mid);
      assert.deepEqual(body.kinds, canonical(['handoff.to_me', 'handoff.accepted', 'emergency']));
    });

    test('POST /families gives an elder member no default subscriptions', async () => {
      const { fid, mid } = await family('elder');
      const body = await (await t.get(`/families/${fid}/members/${mid}/subscriptions`)).json();
      assert.deepEqual(body.kinds, []);
    });

    test('POST /join gives a family-role joiner the defaults, an elder joiner none', async () => {
      const { fid, kc } = await family('elder');
      const joiner = uuid(), elderJoiner = uuid();
      assert.equal((await t.post(`/families/${fid}/join`, { key_check: kc, member: { id: joiner, role: 'family' } })).status, 201);
      assert.equal((await t.post(`/families/${fid}/join`, { key_check: kc, member: { id: elderJoiner, role: 'elder' } })).status, 201);
      const jBody = await (await t.get(`/families/${fid}/members/${joiner}/subscriptions`)).json();
      assert.deepEqual(jBody.kinds, canonical(['handoff.to_me', 'handoff.accepted', 'emergency']));
      const eBody = await (await t.get(`/families/${fid}/members/${elderJoiner}/subscriptions`)).json();
      assert.deepEqual(eBody.kinds, []);
    });

    test('ensureDefaults includes emergency for a family member and not for an elder', async () => {
      const { fid, mid } = await family('family');
      const body = await (await t.get(`/families/${fid}/members/${mid}/subscriptions`)).json();
      assert.ok(body.kinds.includes('emergency'));

      const { fid: fid2, mid: eid } = await family('elder');
      const eBody = await (await t.get(`/families/${fid2}/members/${eid}/subscriptions`)).json();
      assert.equal(eBody.kinds.includes('emergency'), false);
      assert.deepEqual(eBody.kinds, []);
    });
  });

  describe('GET /families/:id/members/:mid/subscriptions', () => {
    test('403 when mid is not a member of the family', async () => {
      const { fid } = await family('family');
      const r = await t.get(`/families/${fid}/members/${uuid()}/subscriptions`);
      assert.equal(r.status, 403);
    });

    test('200 with an empty list when the member has no subscriptions', async () => {
      const { fid, mid } = await family('elder');
      const r = await t.get(`/families/${fid}/members/${mid}/subscriptions`);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { member_id: mid, kinds: [] });
    });
  });

  describe('PUT /families/:id/members/:mid/subscriptions', () => {
    test('400 when kinds is not an array', async () => {
      const { fid, mid } = await family('family');
      assert.equal((await put(`/families/${fid}/members/${mid}/subscriptions`, { kinds: 'care.meds' })).status, 400);
      assert.equal((await put(`/families/${fid}/members/${mid}/subscriptions`, {})).status, 400);
    });

    test('400 when any kind in the array is unknown', async () => {
      const { fid, mid } = await family('family');
      const r = await put(`/families/${fid}/members/${mid}/subscriptions`, { kinds: ['care.meds', 'not.a.kind'] });
      assert.equal(r.status, 400);
    });

    test('403 when mid is not a member of the family', async () => {
      const { fid } = await family('family');
      const r = await put(`/families/${fid}/members/${uuid()}/subscriptions`, { kinds: ['care.meds'] });
      assert.equal(r.status, 403);
    });

    test('accepts emergency as a known kind (still valid after the always-on rule)', async () => {
      const { fid, mid } = await family('family');
      const r = await put(`/families/${fid}/members/${mid}/subscriptions`, { kinds: ['emergency'] });
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { member_id: mid, kinds: ['emergency'] });
    });

    test('replaces the whole set and returns kinds in canonical order', async () => {
      const { fid, mid } = await family('family'); // starts with the default kinds (incl. emergency)
      const chosen = ['care.mood', 'care.meds', 'member']; // deliberately out of canonical order
      const r1 = await put(`/families/${fid}/members/${mid}/subscriptions`, { kinds: chosen });
      assert.equal(r1.status, 200);
      assert.deepEqual(await r1.json(), { member_id: mid, kinds: canonical(chosen) });

      // old defaults are gone: GET reflects the replacement, not a union
      const g1 = await (await t.get(`/families/${fid}/members/${mid}/subscriptions`)).json();
      assert.deepEqual(g1.kinds, canonical(chosen));

      const r2 = await put(`/families/${fid}/members/${mid}/subscriptions`, { kinds: [] });
      assert.equal(r2.status, 200);
      assert.deepEqual(await r2.json(), { member_id: mid, kinds: [] });
      const g2 = await (await t.get(`/families/${fid}/members/${mid}/subscriptions`)).json();
      assert.deepEqual(g2.kinds, []);
    });
  });

  describe('GET /families/:id/notifications', () => {
    test('400 without ?member', async () => {
      const { fid } = await family('family');
      assert.equal((await t.get(`/families/${fid}/notifications`)).status, 400);
    });

    test('newest first, joined with iv/payload_cipher from events, for a subscribed member other than the actor', async () => {
      const { fid, elder, sis } = await familyWithSub(['handoff.to_me', 'handoff.accepted', 'care.meds']);

      const r1 = await t.post('/events', { family_id: fid, type: 'CareLogged', actor_id: elder, category: 'meds', iv: 'iv-old', payload_cipher: 'ct-old', occurred_at: '2026-09-01T00:00:00Z' });
      const r2 = await t.post('/events', { family_id: fid, type: 'CareLogged', actor_id: elder, category: 'meds', iv: 'iv-new', payload_cipher: 'ct-new', occurred_at: '2026-09-02T00:00:00Z' });
      assert.equal(r1.status, 202);
      assert.equal(r2.status, 202);
      const oldId = (await r1.json()).id, newId = (await r2.json()).id;
      await t.project();

      const rows = await (await t.get(`/families/${fid}/notifications?member=${sis}`)).json();
      assert.equal(rows.length, 2);
      assert.equal(rows[0].event_id, newId); // newest first
      assert.equal(rows[1].event_id, oldId);
      assert.equal(rows[0].kind, 'care.meds');
      assert.equal(rows[0].type, 'CareLogged');
      assert.equal(rows[0].category, 'meds');
      assert.equal(rows[0].from_id, elder);
      assert.equal(rows[0].iv, 'iv-new');
      assert.equal(rows[0].payload_cipher, 'ct-new');
      assert.equal(rows[0].read_at, null);
    });

    test('unread=1 filters to notifications with read_at IS NULL', async () => {
      const { fid, elder, sis } = await familyWithSub(['care.*']);
      await t.post('/events', { family_id: fid, type: 'CareLogged', actor_id: elder, category: 'meal' });
      await t.post('/events', { family_id: fid, type: 'CareLogged', actor_id: elder, category: 'mood' });
      await t.project();

      const all = await (await t.get(`/families/${fid}/notifications?member=${sis}`)).json();
      assert.equal(all.length, 2);
      await t.post(`/families/${fid}/notifications/read`, { member_id: sis, event_ids: [all[0].event_id] });
      const unread = await (await t.get(`/families/${fid}/notifications?member=${sis}&unread=1`)).json();
      assert.equal(unread.length, 1);
      assert.equal(unread[0].event_id, all[1].event_id);
    });
  });

  describe('POST /families/:id/notifications/read', () => {
    test('400 without member_id', async () => {
      const { fid } = await family('family');
      assert.equal((await t.post(`/families/${fid}/notifications/read`, { event_ids: ['x'] })).status, 400);
    });

    test('400 without event_ids and without all', async () => {
      const { fid, mid } = await family('family');
      assert.equal((await t.post(`/families/${fid}/notifications/read`, { member_id: mid })).status, 400);
    });

    test('marks exactly the given event_ids read and returns { updated }', async () => {
      const { fid, elder, sis } = await familyWithSub(['care.*']);
      const a = await t.post('/events', { family_id: fid, type: 'CareLogged', actor_id: elder, category: 'meal' });
      const b = await t.post('/events', { family_id: fid, type: 'CareLogged', actor_id: elder, category: 'mood' });
      await t.project();
      const aId = (await a.json()).id, bId = (await b.json()).id;

      const r = await t.post(`/families/${fid}/notifications/read`, { member_id: sis, event_ids: [aId] });
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { updated: 1 });

      const rows = await (await t.get(`/families/${fid}/notifications?member=${sis}`)).json();
      const byId = Object.fromEntries(rows.map((x) => [x.event_id, x]));
      assert.ok(byId[aId].read_at);
      assert.equal(byId[bId].read_at, null);
    });

    test('all:true marks every unread notification read for that member', async () => {
      const { fid, elder, sis } = await familyWithSub(['care.*']);
      await t.post('/events', { family_id: fid, type: 'CareLogged', actor_id: elder, category: 'meal' });
      await t.post('/events', { family_id: fid, type: 'CareLogged', actor_id: elder, category: 'mood' });
      await t.project();

      const r = await t.post(`/families/${fid}/notifications/read`, { member_id: sis, all: true });
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { updated: 2 });
      const unread = await (await t.get(`/families/${fid}/notifications?member=${sis}&unread=1`)).json();
      assert.equal(unread.length, 0);
    });

    test('marking read twice the second time updates nothing', async () => {
      const { fid, elder, sis } = await familyWithSub(['care.*']);
      await t.post('/events', { family_id: fid, type: 'CareLogged', actor_id: elder, category: 'meal' });
      await t.project();
      await t.post(`/families/${fid}/notifications/read`, { member_id: sis, all: true });
      const r = await t.post(`/families/${fid}/notifications/read`, { member_id: sis, all: true });
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { updated: 0 });
    });
  });
});
