// Generates a SQL seed file: one week of care for a demo family.
//
//   node gen-demo-sql.js "<invite-code>" > ../db/seed-demo.sql
//
// The invite code carries the family key H, so it is passed in and never
// committed. Payloads are AES-GCM encrypted here exactly as the browser does,
// so the emitted SQL contains ciphertext only: no key, no readable care note.
//
// Timestamps are relative to now(), so the file always seeds "the last week"
// whenever it is run, not a set of dates that go stale.
import { webcrypto as wc } from 'node:crypto';

const code = process.argv[2];
if (!code) { console.error('usage: node gen-demo-sql.js "<invite-code>"'); process.exit(1); }

const inv = JSON.parse(Buffer.from(
  code.trim().replace(/^.*#/, '').replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
const FAM = inv.f;
const rawH = Buffer.from(inv.h, 'base64');
const subtle = wc.subtle;
const key = await subtle.importKey('raw', rawH, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
const keyCheck = [...new Uint8Array(await subtle.digest('SHA-256', rawH))]
  .map(b => b.toString(16).padStart(2, '0')).join('');

const q = (v) => v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;

// Postgres runs in UTC in the container, but the browser renders local time. So
// anchor on local midnight in the demo's timezone and convert back, otherwise a
// 6:40am Fajr entry displays at 2:40am. Override with DEMO_TZ.
const TZ = process.env.DEMO_TZ || 'America/Toronto';
const midnight = `date_trunc('day', now() AT TIME ZONE ${q(TZ)})`;
const local = (expr) => `((${expr}) AT TIME ZONE ${q(TZ)})`;
// Relative timestamp: N days back at H:MM local, never in the future.
const at = (d, h, m = 0) => {
  const base = `${midnight} - interval '${d} days' + interval '${h} hours ${m} minutes'`;
  return d === 0 ? `LEAST(${local(base)}, now() - interval '1 minute')` : local(base);
};

async function enc(obj) {
  const iv = wc.getRandomValues(new Uint8Array(12));           // fresh per payload (SR-10)
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key,
    new TextEncoder().encode(JSON.stringify(obj)));
  return { iv: Buffer.from(iv).toString('base64'),
           cipher: Buffer.from(ct).toString('base64') };
}

// Fixed ids so the demo login codes stay stable across regenerations.
const M = {
  ammi:   { id: '11111111-1111-4111-8111-000000000001', role: 'elder',   name: 'Ammi' },
  fatima: { id: '22222222-2222-4222-8222-000000000002', role: 'family',  name: 'Fatima' },
  yusuf:  { id: '33333333-3333-4333-8333-000000000003', role: 'family',  name: 'Yusuf' },
  amina:  { id: '44444444-4444-4444-8444-000000000004', role: 'support', name: 'Amina' },
};

const out = [];
const evs = [];
let seq = 0;
const eid = () => `demo-${FAM}-${String(++seq).padStart(3, '0')}`;

async function care(day, h, m, who, category, text) {
  const { iv, cipher } = await enc({ text });
  evs.push(`  (${q(eid())}, ${q(FAM)}, 'CareLogged', ${q(who.id)}, ${q(category)}, NULL, NULL, NULL, ${at(day,h,m)}, 1, ${q(iv)}, ${q(cipher)})`);
}
async function plain(type, who, payload, day, h, m) {
  const { iv, cipher } = await enc(payload);
  evs.push(`  (${q(eid())}, ${q(FAM)}, ${q(type)}, ${q(who.id)}, NULL, NULL, NULL, NULL, ${at(day,h,m)}, 1, ${q(iv)}, ${q(cipher)})`);
}

const handoffs = [];
const notifs = [];
async function handoff(day, h, m, from, to, summary, next, ackAfterMin) {
  const hid = `demo-${FAM}-ho-${String(handoffs.length + 1).padStart(2, '0')}`;
  const { iv, cipher } = await enc({ summary, next });
  evs.push(`  (${q(eid())}, ${q(FAM)}, 'HandoffOpened', ${q(from.id)}, NULL, ${q(from.id)}, ${q(to.id)}, ${q(hid)}, ${at(day,h,m)}, 1, ${q(iv)}, ${q(cipher)})`);
  if (ackAfterMin != null) {
    evs.push(`  (${q(eid())}, ${q(FAM)}, 'HandoffAcknowledged', ${q(to.id)}, NULL, NULL, NULL, ${q(hid)}, ${at(day, h, m + ackAfterMin)}, 1, NULL, NULL)`);
  }
  handoffs.push(`  (${q(hid)}, ${q(FAM)}, ${q(from.id)}, ${q(to.id)}, ${ackAfterMin != null ? "'acknowledged'" : "'open'"}, ${at(day,h,m)}, ${ackAfterMin != null ? at(day, h, m + ackAfterMin) : 'NULL'}, ${q(iv)}, ${q(cipher)})`);
  // These rows go straight to Postgres, so the notifier never sees them on the
  // stream. Write what it would have written, or a seeded handoff arrives with
  // no notification behind it.
  const nid = `${evs.length}-${hid}`;
  notifs.push(`  (${q(nid + ':' + to.id)}, ${q(FAM)}, ${q(to.id)}, 'handoff_opened', ${q(hid)}, ${q(from.id)}, NULL, ${at(day,h,m)}, ${ackAfterMin != null ? at(day, h, m + ackAfterMin) : 'NULL'})`);
}

// --- identity and preferences, dated at the start of the week ---
await plain('FamilyCreated', M.fatima, { elder_name: 'Ammi' }, 6, 7, 0);
for (const p of Object.values(M)) await plain('MemberJoined', p, { name: p.name }, 6, 7, 5);
await plain('PreferenceSet', M.ammi, {
  lang: 'Urdu, speaks Mirpuri at home',
  diet: 'halal, no gelatin, soft food since March',
  prayer: 'prays five times, do not schedule over Dhuhr',
  modesty: 'female caregiver only for washing and dressing',
}, 6, 7, 10);

// --- one week of care ---
const week = [
  // [day, [hour, min, who, category, text], ...]
  [6, [6,10,'fatima','prayer','Fajr prayed'], [8,0,'fatima','meds','meds given'], [8,40,'fatima','meal','ate full'],
      [13,15,'fatima','prayer','Dhuhr prayed'], [15,30,'fatima','mobility','walked'], [19,0,'fatima','meds','meds given'],
      [21,0,'fatima','mood','calm']],
  [5, [6,15,'fatima','prayer','Fajr prayed'], [8,5,'fatima','meds','meds given'], [9,0,'fatima','meal','ate half'],
      [11,30,'yusuf','appointment','pharmacy'], [13,20,'fatima','prayer','Dhuhr prayed'], [16,0,'fatima','mobility','physio done'],
      [19,10,'fatima','meds','meds given'], [21,30,'fatima','mood','tired']],
  [4, [6,20,'amina','prayer','Fajr prayed'], [8,0,'amina','meds','meds given'], [8,45,'amina','meal','refused food'],
      [12,0,'amina','mood','agitated'], [13,25,'fatima','prayer','Dhuhr prayed'], [17,0,'fatima','meal','ate half'],
      [19,0,'fatima','meds','meds skipped'], [22,0,'amina','mood','calm']],
  [3, [6,25,'fatima','prayer','Fajr prayed'], [8,0,'fatima','meds','meds given'], [8,50,'fatima','meal','ate full'],
      [10,0,'yusuf','transport','drop-off done'], [11,0,'yusuf','appointment','doctor'], [13,30,'fatima','prayer','Dhuhr prayed'],
      [18,0,'fatima','meal','ate full'], [19,0,'fatima','meds','meds given'], [21,0,'fatima','mood','cheerful']],
  [2, [6,30,'fatima','prayer','Fajr prayed'], [8,10,'fatima','meds','meds given'], [9,0,'fatima','meal','ate half'],
      [14,0,'fatima','mobility','rested'], [17,30,'fatima','prayer','Asr prayed'], [19,0,'fatima','meds','meds given'],
      [20,30,'fatima','mood','tired']],
  [1, [6,35,'amina','prayer','Fajr prayed'], [7,50,'amina','meds','meds given'], [8,40,'amina','meal','ate full'],
      [12,0,'amina','mobility','walked'], [13,40,'fatima','prayer','Dhuhr prayed'], [16,0,'fatima','appointment','clinic'],
      [19,0,'fatima','meds','meds given'], [21,15,'fatima','mood','calm']],
  [0, [6,40,'fatima','prayer','Fajr prayed'], [8,0,'fatima','meds','meds given'], [8,45,'fatima','meal','ate half'],
      [10,30,'fatima','mood','tired'], [12,30,'fatima','mobility','physio done']],
];
for (const [day, ...rows] of week)
  for (const [h, m, who, cat, text] of rows) await care(day, h, m, M[who], cat, text);

// --- handoffs across the week: two closed, one still waiting ---
await handoff(4, 20, 0, M.fatima, M.amina,
  'Fajr prayed, meds given, refused food at breakfast, agitated around noon',
  'Night meds at 10pm. She settles faster with the lamp on, not the ceiling light.', 12);
await handoff(3, 9, 30, M.fatima, M.yusuf,
  'Fajr prayed, meds given, ate full',
  'Doctor at 11am, take the repeat slip. Back before Dhuhr.', 8);
await handoff(0, 13, 0, M.fatima, M.yusuf,
  'Fajr prayed, meds given (8am), ate half, tired, physio done',
  'Dhuhr meds at 1pm, physio at 3pm. She has not drunk much today, keep offering.', null);

// --- emit ---
out.push(`-- Amanah Care demo seed: one week of care for family ${FAM}.
-- Generated by seed/gen-demo-sql.js. Ciphertext only: every care note, name,
-- preference and handoff summary is AES-GCM encrypted under that family's key,
-- which is not in this file. Without the key these rows are unreadable, which
-- is the point of the kill-switch demo (FR-18).
--
-- Timestamps are relative to now(), so this always seeds the last seven days.
-- Re-runnable: it clears this family's rows first.
--
--   docker compose exec -T postgres psql -U amanah -d amanah < db/seed-demo.sql

BEGIN;

DELETE FROM notifications WHERE family_id = ${q(FAM)};
DELETE FROM subscriptions WHERE family_id = ${q(FAM)};
DELETE FROM handoffs      WHERE family_id = ${q(FAM)};
DELETE FROM events        WHERE family_id = ${q(FAM)};
DELETE FROM members       WHERE family_id = ${q(FAM)};

INSERT INTO families (id, key_check, key_version) VALUES
  (${q(FAM)}, ${q(keyCheck)}, 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO members (id, family_id, role, joined_at) VALUES
${Object.values(M).map(p => `  (${q(p.id)}, ${q(FAM)}, ${q(p.role)}, ${at(6,7,5)})`).join(',\n')};

INSERT INTO events (id, family_id, type, actor_id, category, from_id, to_id, handoff_id, occurred_at, key_version, iv, payload_cipher) VALUES
${evs.join(',\n')};

INSERT INTO handoffs (id, family_id, from_id, to_id, status, opened_at, acked_at, iv, summary_cipher) VALUES
${handoffs.join(',\n')};

INSERT INTO notifications (id, family_id, member_id, signal, event_id, actor_id, category, occurred_at, read_at) VALUES
${notifs.join(',\n')};

COMMIT;`);
console.log(out.join('\n'));

// Pinned login codes, one per seeded member. Pinned means the code carries the
// member id, so logging in re-enters as that person instead of creating a new
// member with the same name. Printed to stderr, never written to a file: each
// code carries H, and H does not belong in the repo.
const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_');
console.error(`\ngenerated: ${evs.length} events, ${handoffs.length} handoffs, ${Object.keys(M).length} members\n`);
console.error('login links for the demo (stderr only, do not commit):');
for (const p of Object.values(M)) {
  const code = b64url({ f: FAM, h: inv.h, m: p.id, r: p.role, n: p.name });
  console.error(`\n  ${p.name} (${p.role})\n  http://localhost:8080/#${code}`);
}
console.error('');
