// projector/apply.js against the real schema in pg-mem.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, uuid } from './helpers.mjs';
import { applyEvent } from '../projector/apply.js';

const base = (over = {}) => ({
  id: uuid(), family_id: 'fam1', type: 'CareLogged', actor_id: 'm1', category: 'meds',
  from_id: '', to_id: '', handoff_id: '', key_version: '1', iv: 'aXY=', payload_cipher: 'Y3Q=',
  occurred_at: new Date().toISOString(), ...over,
});

describe('projector applyEvent', () => {
  let db;
  before(async () => {
    db = makeDb();
    await db.query("INSERT INTO families(id,key_check) VALUES('fam1','kc')");
  });

  test('stores an event row with routing fields and ciphertext', async () => {
    const f = base();
    await applyEvent(db, '1-0', f);
    const r = (await db.query('SELECT * FROM events WHERE id=$1', [f.id])).rows[0];
    assert.equal(r.stream_id, '1-0');
    assert.equal(r.type, 'CareLogged');
    assert.equal(r.category, 'meds');
    assert.equal(r.payload_cipher, 'Y3Q=');
    assert.equal(r.key_version, 1);
  });

  test('replaying the same event id is idempotent', async () => {
    const f = base();
    await applyEvent(db, '2-0', f);
    await applyEvent(db, '2-1', f);
    const r = await db.query('SELECT count(*)::int AS n FROM events WHERE id=$1', [f.id]);
    assert.equal(r.rows[0].n, 1);
  });

  test('empty strings from the stream become NULL / defaults', async () => {
    const f = base({ actor_id: '', category: '', key_version: '', iv: '', payload_cipher: '', occurred_at: '' });
    await applyEvent(db, '3-0', f);
    const r = (await db.query('SELECT * FROM events WHERE id=$1', [f.id])).rows[0];
    assert.equal(r.actor_id, null);
    assert.equal(r.category, null);
    assert.equal(r.key_version, 1);
    assert.equal(r.payload_cipher, null);
    assert.ok(r.occurred_at instanceof Date);
  });

  test('HandoffOpened creates an open handoff keyed by handoff_id', async () => {
    const hid = uuid();
    const f = base({ type: 'HandoffOpened', from_id: 'm1', to_id: 'm2', handoff_id: hid, category: '' });
    await applyEvent(db, '4-0', f);
    const h = (await db.query('SELECT * FROM handoffs WHERE id=$1', [hid])).rows[0];
    assert.equal(h.status, 'open');
    assert.equal(h.from_id, 'm1');
    assert.equal(h.to_id, 'm2');
    assert.equal(h.summary_cipher, 'Y3Q=');
    assert.equal(h.acked_at, null);
  });

  test('HandoffOpened without handoff_id falls back to the event id', async () => {
    const f = base({ type: 'HandoffOpened', from_id: 'm1', to_id: 'm2', handoff_id: '' });
    await applyEvent(db, '5-0', f);
    const h = (await db.query('SELECT * FROM handoffs WHERE id=$1', [f.id])).rows[0];
    assert.equal(h?.status, 'open');
  });

  test('HandoffAcknowledged flips open to acknowledged once, later acks do not move acked_at', async () => {
    const hid = uuid();
    await applyEvent(db, '6-0', base({ type: 'HandoffOpened', from_id: 'm1', to_id: 'm2', handoff_id: hid }));
    const t1 = '2026-09-05T10:00:00.000Z', t2 = '2026-09-05T11:00:00.000Z';
    await applyEvent(db, '6-1', base({ type: 'HandoffAcknowledged', actor_id: 'm2', handoff_id: hid, occurred_at: t1, iv: '', payload_cipher: '' }));
    await applyEvent(db, '6-2', base({ type: 'HandoffAcknowledged', actor_id: 'm2', handoff_id: hid, occurred_at: t2, iv: '', payload_cipher: '' }));
    const h = (await db.query('SELECT * FROM handoffs WHERE id=$1', [hid])).rows[0];
    assert.equal(h.status, 'acknowledged');
    assert.equal(new Date(h.acked_at).toISOString(), t1);
  });

  test('HandoffAcknowledged for an unknown handoff is a no-op, not an error', async () => {
    await applyEvent(db, '7-0', base({ type: 'HandoffAcknowledged', handoff_id: 'nope' }));
    const r = await db.query("SELECT count(*)::int AS n FROM handoffs WHERE id='nope'");
    assert.equal(r.rows[0].n, 0);
  });

  test('workload_view counts CareLogged and HandoffAcknowledged per member from metadata', async () => {
    const fam = 'famW';
    await db.query("INSERT INTO families(id,key_check) VALUES($1,'kc')", [fam]);
    for (let i = 0; i < 3; i++) await applyEvent(db, `8-${i}`, base({ family_id: fam, actor_id: 'a' }));
    await applyEvent(db, '8-9', base({ family_id: fam, actor_id: 'b', type: 'HandoffAcknowledged', handoff_id: 'x' }));
    const r = await db.query(
      `SELECT member_id, sum(care_count)::int AS care_count, sum(handoff_count)::int AS handoff_count
         FROM workload_view WHERE family_id=$1 GROUP BY member_id ORDER BY member_id`, [fam]);
    assert.deepEqual(r.rows, [
      { member_id: 'a', care_count: 3, handoff_count: 0 },
      { member_id: 'b', care_count: 0, handoff_count: 1 },
    ]);
  });
});
