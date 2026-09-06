// One login, several families: a support worker keeps one password across the homes she serves.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, uuid } from './helpers.mjs';
import { makeKey, exportKeyRaw, keyCheck, wrapKey, unwrapKey } from '../web/crypto.js';

describe('one login across several families', () => {
  let t;
  before(async () => { t = await startApp(); });
  after(async () => { await t.close(); });

  async function familyWith(role) {
    const key = await makeKey(); const kc = await keyCheck(key); const raw = await exportKeyRaw(key);
    const fid = uuid().slice(0, 8), elder = uuid(), m = uuid();
    await t.post('/families', { family_id: fid, key_check: kc, member: { id: elder, role: 'elder' } });
    await t.post(`/families/${fid}/join`, { key_check: kc, member: { id: m, role } });
    return { fid, kc, raw, m };
  }
  const register = async (f, login, password) => t.post('/auth/register', { family_id: f.fid, member_id: f.m, key_check: f.kc, login, password, ...(await wrapKey(f.raw, password)) });

  test('a second family with the same password registers; a different password is refused', async () => {
    const a = await familyWith('support'), b = await familyWith('support'), c = await familyWith('support');
    const login = 'layla-' + uuid().slice(0, 6);
    assert.equal((await register(a, login, '333')).status, 201);
    assert.equal((await register(b, login, '333')).status, 201);
    const r = await register(c, login, 'other');
    assert.equal(r.status, 403);
    assert.match((await r.json()).error, /different password/);
  });

  test('the same login inside one family still belongs to one member', async () => {
    const a = await familyWith('support');
    const login = 'dup-' + uuid().slice(0, 6);
    assert.equal((await register(a, login, '333')).status, 201);
    const other = { ...a, m: uuid() };
    await t.post(`/families/${a.fid}/join`, { key_check: a.kc, member: { id: other.m, role: 'family' } });
    assert.equal((await register(other, login, '333')).status, 409);
  });

  test('login returns every family, oldest first, each key unwrapping with the one password', async () => {
    const a = await familyWith('support'), b = await familyWith('support');
    const login = 'nurse-' + uuid().slice(0, 6);
    await register(a, login, '333');
    await register(b, login, '333');
    const r = await t.post('/auth/login', { login, password: '333' });
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.families.length, 2);
    assert.deepEqual(body.families.map((f) => f.family_id), [a.fid, b.fid]);
    assert.equal(body.family_id, a.fid);                       // top level = first family, for older clients
    assert.equal(await unwrapKey(body.families[0], '333'), a.raw);
    assert.equal(await unwrapKey(body.families[1], '333'), b.raw);
    assert.equal(body.families[0].role, 'support');
    assert.equal((await t.post('/auth/login', { login, password: '334' })).status, 401);
  });

  test('a family member with one family gets a one-element list', async () => {
    const a = await familyWith('family');
    const login = 'bro-' + uuid().slice(0, 6);
    await register(a, login, '333');
    const body = await (await t.post('/auth/login', { login, password: '333' })).json();
    assert.equal(body.families.length, 1);
    assert.equal(body.member_id, a.m);
  });
});
