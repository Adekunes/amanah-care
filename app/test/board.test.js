// The board reducer (web/board.js). Pure, no DOM. To do by default, Done after
// CareLogged, Blocked after CareBlocked, back to To do after a retraction,
// and yesterday's moves never leak into today.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { boardFor, counts, rowIsCard, blockedText, DEFAULT_CARDS, COLUMNS } from '../web/board.js';

const NOW = new Date('2026-09-06T14:00:00');
const at = (daysAgo, hhmm) => { const d = new Date(NOW); d.setDate(d.getDate() - daysAgo); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0); return d.toISOString(); };
let n = 0;
const row = (daysAgo, hhmm, type, routine_id, extra = {}) => ({ id: 'e' + (n++), type, blocked: type === 'CareBlocked', routine_id, category: 'meds', actor_id: 'sisA', text: 'Medication', occurred_at: at(daysAgo, hhmm), retracted: false, ...extra });
const CARDS = DEFAULT_CARDS;
const state = (rows) => Object.fromEntries(boardFor(CARDS, rows, NOW).map((b) => [b.card.id, b.state]));

describe('board', () => {
  test('three columns, five default cards, one per category', () => {
    assert.deepEqual(COLUMNS.map((c) => c[0]), ['todo', 'done', 'blocked']);
    assert.equal(CARDS.length, 5);
    assert.equal(new Set(CARDS.map((c) => c.category)).size, 5);
  });
  test('no events: every card is To do', () => {
    assert.deepEqual(Object.values(state([])), ['todo', 'todo', 'todo', 'todo', 'todo']);
    assert.deepEqual(counts(boardFor(CARDS, [], NOW)), { todo: 5, done: 0, blocked: 0 });
  });
  test('CareLogged moves the card to Done, CareBlocked to Blocked, the deciding event is returned', () => {
    const rows = [row(0, '08:05', 'CareLogged', 'meds'), row(0, '12:40', 'CareBlocked', 'meals', { category: 'meal', reason: 'refused' })];
    const b = boardFor(CARDS, rows, NOW);
    assert.equal(b.find((x) => x.card.id === 'meds').state, 'done');
    assert.equal(b.find((x) => x.card.id === 'meals').state, 'blocked');
    assert.equal(b.find((x) => x.card.id === 'meals').ev.reason, 'refused');
    assert.deepEqual(counts(b), { todo: 3, done: 1, blocked: 1 });
  });
  test('a retracted move no longer counts: the card is back in To do', () => {
    assert.equal(state([row(0, '08:05', 'CareLogged', 'meds', { retracted: true })]).meds, 'todo');
    assert.equal(state([row(0, '08:05', 'CareBlocked', 'meds', { retracted: true })]).meds, 'todo');
  });
  test('the latest event of the day wins', () => {
    const rows = [row(0, '08:05', 'CareLogged', 'meds'), row(0, '09:00', 'CareBlocked', 'meds')];
    assert.equal(state(rows).meds, 'blocked');
    assert.equal(state(rows.reverse()).meds, 'blocked');
  });
  test('yesterday does not decide today: the day resets at local midnight', () => {
    assert.equal(state([row(1, '23:59', 'CareLogged', 'meds')]).meds, 'todo');
    assert.equal(state([row(0, '00:00', 'CareLogged', 'meds')]).meds, 'done');
    // and looking at yesterday shows yesterday's board
    const y = new Date(NOW); y.setDate(y.getDate() - 1);
    assert.equal(boardFor(CARDS, [row(1, '23:59', 'CareLogged', 'meds')], y)[0].state, 'done');
  });
  test('an older CareLogged without routine_id still matches its card by label, a blocked row never does', () => {
    const card = CARDS.find((c) => c.id === 'meds');
    assert.equal(rowIsCard({ routine_id: null, category: 'meds', text: 'medication given late' }, card), true);
    assert.equal(rowIsCard({ routine_id: null, category: 'meal', text: 'medication' }, card), false);
    assert.equal(rowIsCard({ routine_id: null, blocked: true, category: 'meds', text: 'Medication not done: asleep' }, card), false);
    assert.equal(rowIsCard({ routine_id: 'walk', category: 'meds', text: 'Medication' }, card), false);
  });
  test('the stored text of a blocked card carries the reason the rules read', () => {
    assert.equal(blockedText(CARDS[2], 'refused'), 'Meals not done: refused');
  });
});
