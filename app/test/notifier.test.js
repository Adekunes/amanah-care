// notifier/match.js (pure matching) + notifier/apply.js (notify against pg-mem).
// Contract: spec/NOTIFY-SPEC.md §1, §3.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb, uuid } from './helpers.mjs';
import { KINDS, kindsFor, recipients } from '../notifier/match.js';
import { notify } from '../notifier/apply.js';

const CANONICAL_KINDS = [
  'handoff.to_me', 'handoff.accepted',
  'care.meds', 'care.meal', 'care.prayer', 'care.mobility', 'care.mood', 'care.appointment', 'care.transport', 'care.note',
  'care.*', 'prefs', 'routine', 'member',
];

describe('notifier/match', () => {
  test('KINDS is the canonical ordered list from the spec', () => {
    assert.deepEqual(KINDS, CANONICAL_KINDS);
  });

  describe('kindsFor', () => {
    test('CareLogged/meds -> care.meds, care.*', () => {
      assert.deepEqual(kindsFor({ type: 'CareLogged', category: 'meds' }), ['care.meds', 'care.*']);
    });
    test('CareLogged/transport -> care.transport, care.*', () => {
      assert.deepEqual(kindsFor({ type: 'CareLogged', category: 'transport' }), ['care.transport', 'care.*']);
    });
    test('HandoffOpened -> handoff.to_me', () => {
      assert.deepEqual(kindsFor({ type: 'HandoffOpened', from_id: 'a', to_id: 'b' }), ['handoff.to_me']);
    });
    test('HandoffAcknowledged -> handoff.accepted', () => {
      assert.deepEqual(kindsFor({ type: 'HandoffAcknowledged', handoff_id: 'h1' }), ['handoff.accepted']);
    });
    test('PreferenceSet -> prefs', () => {
      assert.deepEqual(kindsFor({ type: 'PreferenceSet' }), ['prefs']);
    });
    test('RoutineSet -> routine', () => {
      assert.deepEqual(kindsFor({ type: 'RoutineSet' }), ['routine']);
    });
    test('MemberJoined -> member', () => {
      assert.deepEqual(kindsFor({ type: 'MemberJoined' }), ['member']);
    });
    test('unknown event type -> []', () => {
      assert.deepEqual(kindsFor({ type: 'ConsentChanged' }), []);
      assert.deepEqual(kindsFor({ type: 'SomethingElse' }), []);
    });
  });

  describe('recipients', () => {
    test('never notifies the event actor, even if subscribed', () => {
      const fields = { type: 'CareLogged', category: 'meds', actor_id: 'a' };
      const subs = [{ member_id: 'a', kind: 'care.meds' }, { member_id: 'b', kind: 'care.meds' }];
      assert.deepEqual(recipients(fields, subs), [{ member_id: 'b', kind: 'care.meds' }]);
    });

    test('handoff.to_me only reaches fields.to_id, not other handoff.to_me subscribers', () => {
      const fields = { type: 'HandoffOpened', actor_id: 'a', from_id: 'a', to_id: 'b' };
      const subs = [
        { member_id: 'b', kind: 'handoff.to_me' },
        { member_id: 'c', kind: 'handoff.to_me' },
      ];
      assert.deepEqual(recipients(fields, subs), [{ member_id: 'b', kind: 'handoff.to_me' }]);
    });

    test('handoff.to_me: nothing when to_id itself is not subscribed', () => {
      const fields = { type: 'HandoffOpened', actor_id: 'a', from_id: 'a', to_id: 'b' };
      const subs = [{ member_id: 'c', kind: 'handoff.to_me' }];
      assert.deepEqual(recipients(fields, subs), []);
    });

    test('handoff.accepted only reaches extra.handoff_from_id, not other subscribers', () => {
      const fields = { type: 'HandoffAcknowledged', actor_id: 'b', handoff_id: 'h1' };
      const subs = [
        { member_id: 'a', kind: 'handoff.accepted' },
        { member_id: 'c', kind: 'handoff.accepted' },
      ];
      assert.deepEqual(recipients(fields, subs, { handoff_from_id: 'a' }), [{ member_id: 'a', kind: 'handoff.accepted' }]);
    });

    test('handoff.accepted: nothing without a matching extra.handoff_from_id', () => {
      const fields = { type: 'HandoffAcknowledged', actor_id: 'b', handoff_id: 'h1' };
      const subs = [{ member_id: 'a', kind: 'handoff.accepted' }];
      assert.deepEqual(recipients(fields, subs, {}), []);
      assert.deepEqual(recipients(fields, subs), []);
    });

    test('care.* catches any category', () => {
      const fields = { type: 'CareLogged', category: 'transport', actor_id: 'a' };
      const subs = [{ member_id: 'b', kind: 'care.*' }];
      assert.deepEqual(recipients(fields, subs), [{ member_id: 'b', kind: 'care.*' }]);
    });

    test('one entry per member, using the first matching kind in KINDS order regardless of subs order', () => {
      const fields = { type: 'CareLogged', category: 'meds', actor_id: 'a' };
      const subs = [
        { member_id: 'b', kind: 'care.*' },
        { member_id: 'b', kind: 'care.meds' },
      ];
      assert.deepEqual(recipients(fields, subs), [{ member_id: 'b', kind: 'care.meds' }]);
    });

    test('every subscriber receives prefs / routine / member notifications', () => {
      const subs = [{ member_id: 'b', kind: 'prefs' }, { member_id: 'c', kind: 'prefs' }];
      const rec = recipients({ type: 'PreferenceSet', actor_id: 'a' }, subs);
      assert.deepEqual(rec.map((r) => r.member_id).sort(), ['b', 'c']);
    });

    test('subscribers to unrelated kinds are not notified', () => {
      const fields = { type: 'CareLogged', category: 'meds', actor_id: 'a' };
      const subs = [{ member_id: 'b', kind: 'prefs' }, { member_id: 'c', kind: 'routine' }];
      assert.deepEqual(recipients(fields, subs), []);
    });
  });
});

describe('notifier/apply notify()', () => {
  async function seedFamily(db, fid) {
    await db.query('INSERT INTO families(id,key_check) VALUES($1,$2)', [fid, 'kc']);
  }
  async function seedMember(db, fid, mid, role = 'family') {
    await db.query('INSERT INTO members(id,family_id,role) VALUES($1,$2,$3)', [mid, fid, role]);
  }
  async function seedSub(db, fid, mid, kind) {
    await db.query('INSERT INTO subscriptions(member_id,family_id,kind) VALUES($1,$2,$3)', [mid, fid, kind]);
  }

  test('CareLogged: one notification row per subscriber, actor excluded, fields carried through', async () => {
    const db = makeDb();
    const fid = 'fam-notify-1';
    await seedFamily(db, fid);
    const actor = uuid(), sub1 = uuid(), sub2 = uuid();
    await seedMember(db, fid, actor, 'family');
    await seedMember(db, fid, sub1, 'family');
    await seedMember(db, fid, sub2, 'elder');
    await seedSub(db, fid, sub1, 'care.meds');
    await seedSub(db, fid, actor, 'care.meds'); // actor subscribed too; must still be excluded

    const eventId = uuid();
    const fields = {
      id: eventId, family_id: fid, type: 'CareLogged', actor_id: actor, category: 'meds',
      from_id: '', to_id: '', handoff_id: '', occurred_at: '2026-09-05T09:00:00.000Z',
    };
    const n = await notify(db, '1-0', fields);

    const rows = (await db.query('SELECT * FROM notifications WHERE event_id=$1', [eventId])).rows;
    assert.equal(rows.length, 1);
    assert.equal(n, rows.length);
    const [row] = rows;
    assert.equal(row.member_id, sub1);
    assert.equal(row.kind, 'care.meds');
    assert.equal(row.type, 'CareLogged');
    assert.equal(row.category, 'meds');
    assert.equal(row.from_id, actor);
    assert.equal(new Date(row.occurred_at).toISOString(), fields.occurred_at);
    assert.equal(row.family_id, fid);
  });

  test('replaying the same event id adds nothing (ON CONFLICT DO NOTHING)', async () => {
    const db = makeDb();
    const fid = 'fam-notify-2';
    await seedFamily(db, fid);
    const actor = uuid(), sub1 = uuid();
    await seedMember(db, fid, actor, 'family');
    await seedMember(db, fid, sub1, 'family');
    await seedSub(db, fid, sub1, 'care.*');

    const eventId = uuid();
    const fields = {
      id: eventId, family_id: fid, type: 'CareLogged', actor_id: actor, category: 'mood',
      from_id: '', to_id: '', handoff_id: '', occurred_at: new Date().toISOString(),
    };
    await notify(db, '2-0', fields);
    await notify(db, '2-1', fields); // same fields.id, replayed under a different stream id

    const r = await db.query('SELECT count(*)::int AS n FROM notifications WHERE event_id=$1', [eventId]);
    assert.equal(r.rows[0].n, 1);
  });

  test('no rows are written when nobody subscribes', async () => {
    const db = makeDb();
    const fid = 'fam-notify-3';
    await seedFamily(db, fid);
    const actor = uuid();
    await seedMember(db, fid, actor, 'family');

    const fields = {
      id: uuid(), family_id: fid, type: 'CareLogged', actor_id: actor, category: 'meal',
      from_id: '', to_id: '', handoff_id: '', occurred_at: new Date().toISOString(),
    };
    const n = await notify(db, '3-0', fields);
    const r = await db.query('SELECT count(*)::int AS n FROM notifications');
    assert.equal(r.rows[0].n, 0);
    assert.equal(n, 0);
  });

  test('HandoffOpened notifies only to_id when subscribed to handoff.to_me', async () => {
    const db = makeDb();
    const fid = 'fam-notify-4';
    await seedFamily(db, fid);
    const opener = uuid(), recipient = uuid(), bystander = uuid();
    await seedMember(db, fid, opener, 'family');
    await seedMember(db, fid, recipient, 'elder');
    await seedMember(db, fid, bystander, 'family');
    await seedSub(db, fid, recipient, 'handoff.to_me');
    await seedSub(db, fid, bystander, 'handoff.to_me');

    const hid = uuid();
    const eventId = uuid();
    const fields = {
      id: eventId, family_id: fid, type: 'HandoffOpened', actor_id: opener,
      from_id: opener, to_id: recipient, handoff_id: hid, category: '',
      occurred_at: new Date().toISOString(),
    };
    const n = await notify(db, '4-0', fields);
    const rows = (await db.query('SELECT * FROM notifications WHERE event_id=$1', [eventId])).rows;
    assert.equal(n, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].member_id, recipient);
    assert.equal(rows[0].kind, 'handoff.to_me');
    assert.equal(rows[0].handoff_id, hid);
    assert.equal(rows[0].from_id, opener);
  });

  test('HandoffAcknowledged resolves the recipient from a handoffs row inserted directly', async () => {
    const db = makeDb();
    const fid = 'fam-notify-5';
    await seedFamily(db, fid);
    const opener = uuid(), acker = uuid(), bystander = uuid();
    await seedMember(db, fid, opener, 'family');
    await seedMember(db, fid, acker, 'elder');
    await seedMember(db, fid, bystander, 'family');
    await seedSub(db, fid, opener, 'handoff.accepted');
    await seedSub(db, fid, bystander, 'handoff.accepted'); // subscribed, but not the handoff's from_id

    const hid = uuid();
    // The notifier is expected to look this up itself (spec §1, §3): "look up
    // handoffs.from_id by handoff_id". We only insert the row it must read.
    await db.query(
      `INSERT INTO handoffs(id,family_id,from_id,to_id,status,iv,summary_cipher)
       VALUES($1,$2,$3,$4,'acknowledged',$5,$6)`,
      [hid, fid, opener, acker, 'iv1', 'ct1']);

    const eventId = uuid();
    const fields = {
      id: eventId, family_id: fid, type: 'HandoffAcknowledged', actor_id: acker,
      category: '', from_id: '', to_id: '', handoff_id: hid,
      occurred_at: '2026-09-05T10:00:00.000Z',
    };
    const n = await notify(db, '5-0', fields);
    const rows = (await db.query('SELECT * FROM notifications WHERE event_id=$1', [eventId])).rows;
    assert.equal(n, 1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].member_id, opener);
    assert.equal(rows[0].kind, 'handoff.accepted');
    assert.equal(rows[0].type, 'HandoffAcknowledged');
    assert.equal(rows[0].handoff_id, hid);
  });

  test('HandoffAcknowledged for an unknown handoff notifies nobody (no crash)', async () => {
    const db = makeDb();
    const fid = 'fam-notify-6';
    await seedFamily(db, fid);
    const acker = uuid(), someone = uuid();
    await seedMember(db, fid, acker, 'elder');
    await seedMember(db, fid, someone, 'family');
    await seedSub(db, fid, someone, 'handoff.accepted');

    const fields = {
      id: uuid(), family_id: fid, type: 'HandoffAcknowledged', actor_id: acker,
      category: '', from_id: '', to_id: '', handoff_id: 'nope',
      occurred_at: new Date().toISOString(),
    };
    const n = await notify(db, '6-0', fields);
    const r = await db.query('SELECT count(*)::int AS n FROM notifications');
    assert.equal(r.rows[0].n, 0);
    assert.equal(n, 0);
  });
});
