// Live updates: the bus, the projector's announcement, and the SSE stream.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { LocalBus } from '../api/bus.js';
import { applyEvent, announcement } from '../projector/apply.js';
import { makeDb, startApp, uuid } from './helpers.mjs';
import { makeKey, keyCheck } from '../web/crypto.js';

describe('live updates', () => {
  test('LocalBus delivers to subscribers of that family only, until unsubscribed', async () => {
    const bus = new LocalBus();
    const a = [], b = [];
    const offA = await bus.subscribe('famA', (m) => a.push(m));
    await bus.subscribe('famB', (m) => b.push(m));
    await bus.publish('famA', { id: 1 });
    await bus.publish('famB', { id: 2 });
    await offA();
    await bus.publish('famA', { id: 3 });
    assert.deepEqual(a, [{ id: 1 }]);
    assert.deepEqual(b, [{ id: 2 }]);
  });

  test('announcement carries routing metadata only, never the payload', () => {
    const a = announcement({ id: 'e', family_id: 'f', type: 'CareLogged', category: 'meds', actor_id: 'm', iv: 'x', payload_cipher: 'secret', occurred_at: '2026-09-05T10:00:00.000Z' });
    assert.deepEqual(Object.keys(a).sort(), ['actor_id', 'category', 'from_id', 'handoff_id', 'id', 'occurred_at', 'to_id', 'type']);
    assert.equal(JSON.stringify(a).includes('secret'), false);
    assert.equal(a.from_id, null);
  });

  test('applyEvent announces after writing, and stays silent without a bus', async () => {
    const db = makeDb();
    await db.query("INSERT INTO families(id,key_check) VALUES('f','k')");
    const bus = new LocalBus(); const got = [];
    await bus.subscribe('f', (m) => got.push(m));
    const f = { id: 'e1', family_id: 'f', type: 'CareLogged', actor_id: 'm1', category: 'meal', occurred_at: new Date().toISOString() };
    await applyEvent(db, '1-0', f, bus);
    await applyEvent(db, '1-1', { ...f, id: 'e2' });
    assert.equal(got.length, 1);
    assert.equal(got[0].id, 'e1');
    assert.equal(got[0].category, 'meal');
  });

  test('GET /families/:id/live says hello, then streams each announced event for that family', async () => {
    const t = await startApp();
    const key = await makeKey(); const kc = await keyCheck(key);
    const fid = uuid().slice(0, 8), other = uuid().slice(0, 8), m = uuid(), m2 = uuid();
    await t.post('/families', { family_id: fid, key_check: kc, member: { id: m, role: 'family' } });
    await t.post('/families', { family_id: other, key_check: kc, member: { id: m2, role: 'family' } });
    const ac = new AbortController();
    const res = await fetch(`${t.base}/families/${fid}/live`, { signal: ac.signal });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/event-stream/);
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = '';
    const readUntil = async (needle) => { for (let i = 0; i < 20 && !buf.includes(needle); i++) { const { value, done } = await reader.read(); if (done) break; buf += dec.decode(value); } };
    await readUntil('event: hello');
    await t.post('/events', { family_id: other, type: 'CareLogged', actor_id: m2, category: 'mood' });
    await t.post('/events', { family_id: fid, type: 'CareLogged', actor_id: m, category: 'meds', iv: 'aXY=', payload_cipher: 'c2VjcmV0' });
    await t.project();
    await readUntil('"category":"meds"');
    assert.match(buf, /data: \{"id":"[^"]+","type":"CareLogged","category":"meds"/);
    assert.equal(buf.includes('mood'), false);          // other family's event never crosses over
    assert.equal(buf.includes('c2VjcmV0'), false);      // no ciphertext on the wire
    ac.abort();
    await t.close();
  });
});
