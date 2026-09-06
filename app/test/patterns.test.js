// Recommendations engine (web/patterns.js) and the table it reads. Pure, no DOM.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detect, parseTable, fastingToday, AVAILABLE } from '../web/patterns.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TABLE = parseTable(fs.readFileSync(path.join(here, '..', 'web', 'recommendations.json'), 'utf8'));
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const NOW = new Date('2026-09-06T14:00:00');            // a Sunday, 14:00 local
const at = (daysAgo, hhmm) => { const d = new Date(NOW); d.setDate(d.getDate() - daysAgo); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString(); };
const R = (id, category, label, time, days = 'daily') => ({ id, category, label, time, days, who: '' });
const ROUTINE = [R('meds1', 'meds', 'morning meds', '08:00'), R('meal1', 'meal', 'breakfast', '08:30'), R('meal2', 'meal', 'lunch', '13:30'),
  R('meds2', 'meds', 'afternoon meds', '14:00'), R('walk', 'mobility', 'walk after Asr', '17:15'), R('meal3', 'meal', 'dinner', '19:00'),
  R('meds3', 'meds', 'night meds', '21:00'), R('doc', 'appointment', 'Dr follow-up', '10:30', 'wed')];
const planFor = (d) => ROUTINE.filter((i) => i.days === 'daily' || i.days === DAYS[new Date(d).getDay()]);
const doneFor = (item, items) => items.find((c) => c.routine_id === item.id || (c.category === item.category && item.label && String(c.text).toLowerCase().startsWith(item.label.toLowerCase())));
let n = 0;
const log = (daysAgo, hhmm, category, text, routine_id = null, actor = 'sisA') => ({ id: 'e' + (n++), actor_id: actor, category, text, routine_id, occurred_at: at(daysAgo, hhmm) });
// A calm week: everything logged on time, shared between two people.
function healthy() {
  const out = [];
  for (let k = 1; k <= 7; k++) {
    const a = k % 2 ? 'sisA' : 'fat';
    out.push(log(k, '08:05', 'meds', 'morning meds', 'meds1', a), log(k, '08:35', 'meal', 'breakfast', 'meal1', a), log(k, '13:35', 'meal', 'lunch', 'meal2', a),
      log(k, '14:05', 'meds', 'afternoon meds', 'meds2', a), log(k, '17:20', 'mobility', 'walk after Asr', 'walk', a), log(k, '19:05', 'meal', 'dinner', 'meal3', a),
      log(k, '21:05', 'meds', 'night meds', 'meds3', a), log(k, '10:00', 'mood', 'calm', null, a));
    if (new Date(at(k, '10:30')).getDay() === 3) out.push(log(k, '10:40', 'appointment', 'Dr follow-up', 'doc', a));
  }
  out.push(log(0, '08:05', 'meds', 'morning meds', 'meds1'), log(0, '08:35', 'meal', 'breakfast', 'meal1'), log(0, '13:35', 'meal', 'lunch', 'meal2'), log(0, '12:00', 'mobility', 'walk after Asr', 'walk', 'fat'));
  return out;
}
const names = { sisA: 'Sister A', fat: 'Fatima', abd: 'Abdullah' };
const ctx = (over = {}) => ({ now: NOW, items: healthy(), routine: ROUTINE, planFor, doneFor, handoffs: [], members: [{ id: 'sisA', role: 'family' }, { id: 'fat', role: 'family' }],
  prefs: {}, elderName: 'Ammi', nameOf: (id) => names[id] || id, acks: [], ...over });
const ids = (res) => res.map((r) => r.row.pattern_id);
const fired = (res, id) => res.find((r) => r.row.pattern_id === id);

describe('recommendation table', () => {
  test('every row has the schema, a valid tier, allowed signals, and 2 to 4 actions per role', () => {
    const allowed = new Set([...AVAILABLE, 'sensor', 'sleep', 'phone']);
    for (const row of TABLE) {
      for (const k of ['pattern_id', 'pattern_label', 'signal_source', 'detection_rule', 'confidence_caveats', 'tier', 'recommendation_family', 'recommendation_pro', 'cultural_adaptation', 'escalation_path', 'suppression_rule', 'provenance']) assert.ok(k in row, `${row.pattern_id} missing ${k}`);
      assert.ok(['NOTICE', 'ATTENTION', 'URGENT_CONTACT'].includes(row.tier), row.pattern_id);
      assert.ok(row.signal_source.length && row.signal_source.every((s) => allowed.has(s)), row.pattern_id);
      for (const lang of ['fr', 'en']) { for (const role of ['recommendation_family', 'recommendation_pro']) { const a = row[role][lang]; assert.ok(Array.isArray(a) && a.length >= 1 && a.length <= 4, `${row.pattern_id} ${role}.${lang}`); } }
      for (const lang of ['fr', 'en', 'ar']) assert.ok(row.pattern_label[lang], `${row.pattern_id} label ${lang}`);
      assert.ok(['public health guidance', 'geriatric care best practice', 'team judgement'].includes(row.provenance), row.pattern_id);
    }
    assert.equal(new Set(TABLE.map((r) => r.pattern_id)).size, TABLE.length);
  });
  test('no row names a condition, a medication, a dose, or an emergency room', () => {
    const forbidden = /dementia|démence|alzheimer|diabet|\bdose|dosage|\bmg\b|\bml\b|comprim|diagnos|emergency room|\bER\b|\burgences\b/i;
    for (const row of TABLE) {
      const text = JSON.stringify([row.recommendation_family, row.recommendation_pro, row.escalation_path, row.cultural_adaptation, row.pattern_label]);
      assert.equal(forbidden.test(text), false, `${row.pattern_id}: ${text.match(forbidden)?.[0]}`);
    }
  });
});

describe('fastingToday', () => {
  test('reads only the stored profile text', () => {
    assert.equal(fastingToday({ fasting: 'Sundays and Mondays' }, NOW), true);
    assert.equal(fastingToday({ fasting: 'lundi et jeudi' }, NOW), false);
    assert.equal(fastingToday({ fasting: 'dimanche' }, NOW), true);
    assert.equal(fastingToday({ fasting: 'Ramadan' }, NOW), true);
    assert.equal(fastingToday({ fasting: 'none' }, NOW), false);
    assert.equal(fastingToday({}, NOW), false);
    assert.equal(fastingToday(null, NOW), false);
  });
});

describe('detect', () => {
  test('a calm, shared, fully logged week fires nothing', () => {
    assert.deepEqual(ids(detect(TABLE, ctx())), []);
  });
  test('MEAL_SKIPPED_CONSECUTIVE: two past meal slots with no log, but not when only one is past', () => {
    const noMeals = healthy().filter((i) => !(i.occurred_at.startsWith(at(0, '00:00').slice(0, 10)) && i.category === 'meal'));
    const r = fired(detect(TABLE, ctx({ now: new Date('2026-09-06T16:00:00'), items: noMeals })), 'MEAL_SKIPPED_CONSECUTIVE');
    assert.ok(r); assert.match(r.because, /Breakfast .* and lunch .* have no log/);
    assert.equal(fired(detect(TABLE, ctx({ now: new Date('2026-09-06T10:30:00'), items: noMeals })), 'MEAL_SKIPPED_CONSECUTIVE'), undefined);
  });
  test('MEAL_REFUSED_REPEAT: two refusals in 48 h fire, one does not', () => {
    const two = [...healthy(), log(1, '13:36', 'meal', 'lunch (refused food)'), log(1, '19:06', 'meal', 'dinner (refused food)')];
    const r = fired(detect(TABLE, ctx({ items: two })), 'MEAL_REFUSED_REPEAT');
    assert.ok(r); assert.match(r.because, /Refused food logged 2 times in 48 hours/);
    assert.equal(fired(detect(TABLE, ctx({ items: [...healthy(), log(1, '13:36', 'meal', 'lunch (refused food)')] })), 'MEAL_REFUSED_REPEAT'), undefined);
  });
  test('MED_ROUTINE_NOT_LOGGED: a routine meds slot missing yesterday', () => {
    const items = healthy().filter((i) => !(i.routine_id === 'meds3' && i.occurred_at === at(1, '21:05')));
    const r = fired(detect(TABLE, ctx({ items })), 'MED_ROUTINE_NOT_LOGGED');
    assert.ok(r); assert.match(r.because, /Night meds not logged yesterday/);
  });
  test('MED_ROUTINE_LATE: two logs more than an hour late in 7 days', () => {
    const late = [...healthy(), log(1, '09:30', 'meds', 'morning meds', 'meds1'), log(3, '09:40', 'meds', 'morning meds', 'meds1')];
    assert.match(fired(detect(TABLE, ctx({ items: late })), 'MED_ROUTINE_LATE').because, /2 times in 7 days/);
    assert.equal(fired(detect(TABLE, ctx({ items: [...healthy(), log(1, '09:30', 'meds', 'morning meds', 'meds1')] })), 'MED_ROUTINE_LATE'), undefined);
  });
  test('MOBILITY_NONE_LOGGED: needs a routine mobility item and no log in 48 h', () => {
    const items = healthy().filter((i) => !(i.category === 'mobility' && new Date(i.occurred_at) > new Date(NOW - 48 * 3600e3)));
    assert.match(fired(detect(TABLE, ctx({ items })), 'MOBILITY_NONE_LOGGED').because, /No mobility log in 48 hours; the routine has "walk after Asr"/);
    const noWalk = ROUTINE.filter((i) => i.category !== 'mobility');
    assert.equal(fired(detect(TABLE, ctx({ items, routine: noWalk, planFor: (d) => noWalk })), 'MOBILITY_NONE_LOGGED'), undefined);
  });
  test('MOOD_AGITATED_EVENINGS: three evenings fire, two do not, mornings never count', () => {
    const three = [...healthy(), log(1, '18:40', 'mood', 'agitated'), log(3, '19:10', 'mood', 'upset (visitors)'), log(5, '18:30', 'mood', 'agitated')];
    assert.match(fired(detect(TABLE, ctx({ items: three })), 'MOOD_AGITATED_EVENINGS').because, /3 evenings in 7 days, after 17:00/);
    assert.equal(fired(detect(TABLE, ctx({ items: [...healthy(), log(1, '18:40', 'mood', 'agitated'), log(3, '19:10', 'mood', 'agitated')] })), 'MOOD_AGITATED_EVENINGS'), undefined);
    assert.equal(fired(detect(TABLE, ctx({ items: [...healthy(), log(1, '09:40', 'mood', 'agitated'), log(3, '09:10', 'mood', 'agitated'), log(5, '08:30', 'mood', 'agitated')] })), 'MOOD_AGITATED_EVENINGS'), undefined);
  });
  test('APPOINTMENT_NOT_LOGGED: a routine appointment on a past day with no log', () => {
    const items = healthy().filter((i) => i.category !== 'appointment');
    assert.match(fired(detect(TABLE, ctx({ items })), 'APPOINTMENT_NOT_LOGGED').because, /Dr follow-up on Wed/);
  });
  test('HANDOFF_NOT_ACCEPTED: open for more than 30 minutes', () => {
    const open = [{ id: 'h1', status: 'open', opened_at: at(0, '13:00'), from_id: 'sisA', to_id: 'fat' }];
    assert.match(fired(detect(TABLE, ctx({ handoffs: open })), 'HANDOFF_NOT_ACCEPTED').because, /from Sister A to Fatima has waited 60 minutes/);
    assert.equal(fired(detect(TABLE, ctx({ handoffs: [{ ...open[0], opened_at: at(0, '13:50') }] })), 'HANDOFF_NOT_ACCEPTED'), undefined);
    assert.equal(fired(detect(TABLE, ctx({ handoffs: [{ ...open[0], status: 'acknowledged' }] })), 'HANDOFF_NOT_ACCEPTED'), undefined);
  });
  test('CAREGIVER_LOAD_CONCENTRATED: one member at 70%+ of 20+ logs', () => {
    const solo = healthy().map((i) => ({ ...i, actor_id: 'sisA' }));
    assert.match(fired(detect(TABLE, ctx({ items: solo })), 'CAREGIVER_LOAD_CONCENTRATED').because, /Sister A logged \d+ of \d+ items in 7 days \(100%\)/);
    assert.equal(fired(detect(TABLE, ctx({ items: solo.slice(0, 12) })), 'CAREGIVER_LOAD_CONCENTRATED'), undefined);
  });
  test('NO_CONTACT_LOGGED: nothing from anyone in 48 h', () => {
    const old = healthy().filter((i) => new Date(i.occurred_at) < new Date(NOW - 49 * 3600e3));
    assert.match(fired(detect(TABLE, ctx({ items: old })), 'NO_CONTACT_LOGGED').because, /No care log from anyone in 48 hours/);
    assert.match(fired(detect(TABLE, ctx({ items: [] })), 'NO_CONTACT_LOGGED').because, /last 14 days/);
  });
  test('a stored fasting day suppresses meal patterns and nothing else', () => {
    const items = [...healthy().filter((i) => !(i.category === 'mobility' && new Date(i.occurred_at) > new Date(NOW - 48 * 3600e3))), log(1, '13:36', 'meal', 'lunch (refused food)'), log(1, '19:06', 'meal', 'dinner (refused food)')];
    const on = ids(detect(TABLE, ctx({ items, prefs: { fasting: 'Sundays' } })));
    assert.ok(!on.includes('MEAL_REFUSED_REPEAT') && on.includes('MOBILITY_NONE_LOGGED'));
    const off = ids(detect(TABLE, ctx({ items, prefs: { fasting: 'none' } })));
    assert.ok(off.includes('MEAL_REFUSED_REPEAT') && off.includes('MOBILITY_NONE_LOGGED'));
  });
  test('an acknowledgement hides a pattern until its time, then it returns', () => {
    const items = healthy().filter((i) => !(i.category === 'mobility' && new Date(i.occurred_at) > new Date(NOW - 48 * 3600e3)));
    assert.equal(fired(detect(TABLE, ctx({ items, acks: [{ pattern_id: 'MOBILITY_NONE_LOGGED', until: new Date(NOW.getTime() + 3600e3).toISOString() }] })), 'MOBILITY_NONE_LOGGED'), undefined);
    assert.ok(fired(detect(TABLE, ctx({ items, acks: [{ pattern_id: 'MOBILITY_NONE_LOGGED', until: new Date(NOW.getTime() - 3600e3).toISOString() }] })), 'MOBILITY_NONE_LOGGED'));
  });
  test('rows on unconnected signals and unknown pattern ids never fire', () => {
    const everything = ids(detect(TABLE, ctx({ items: [], handoffs: [{ id: 'h', status: 'open', opened_at: at(0, '10:00'), from_id: 'sisA', to_id: 'fat' }] })));
    for (const id of ['SENSOR_NIGHT_ACTIVITY', 'SLEEP_SHORT_REPEAT', 'PHONE_UNANSWERED']) assert.ok(!everything.includes(id), id);
    assert.deepEqual(detect([{ pattern_id: 'NOPE', signal_source: ['meal_log'], tier: 'NOTICE' }], ctx({ items: [] })), []);
    assert.deepEqual(detect([{ pattern_id: 'MOBILITY_NONE_LOGGED', signal_source: ['sensor'], tier: 'NOTICE' }], ctx({ items: [] })), []);
  });
  test('results are ordered contact first, then attention, then notice, each with a because line', () => {
    const res = detect(TABLE, ctx({ items: [log(3, '18:40', 'mood', 'agitated'), log(4, '18:40', 'mood', 'agitated'), log(5, '18:40', 'mood', 'agitated')] }));
    const order = { URGENT_CONTACT: 0, ATTENTION: 1, NOTICE: 2 };
    const tiers = res.map((r) => order[r.row.tier]);
    assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b));
    assert.equal(res[0].row.pattern_id, 'NO_CONTACT_LOGGED');
    for (const r of res) assert.ok(typeof r.because === 'string' && r.because.length > 10);
    assert.ok(ids(res).includes('MOOD_AGITATED_EVENINGS'));
  });
});
