// The board. Pure functions, no DOM, shared by app.js and the tests.
// Five cards a day, three columns: To do, Done, Blocked. The state of a card
// on a given day is read from the day's events, on the phone, after
// decryption: the last event for that card that was not undone decides.
//   CareLogged   -> done      (counts for the workload, like before)
//   CareBlocked  -> blocked   (reason encrypted, never counted as done)
//   nothing      -> todo
// A card moved back to To do is a CareRetracted pointing at the event, so
// the record keeps the move, struck through. Tomorrow the day is empty, so
// every card is back in To do without anything being deleted or scheduled.

export const COLUMNS = [
  ['todo',    'To do'],
  ['done',    'Done'],
  ['blocked', 'Blocked'],
];

// The five cards a new family starts with. Category names match CATS in
// app.js, the alert kinds, the seed and the recommendation rules.
export const DEFAULT_CARDS = [
  { id: 'meds',    category: 'meds',          label: 'Medication',    time: '08:00', days: 'daily', who: '', icon: '💊' },
  { id: 'care',    category: 'personal care', label: 'Personal care', time: '10:00', days: 'daily', who: '', icon: '🧼' },
  { id: 'meals',   category: 'meal',          label: 'Meals',         time: '12:30', days: 'daily', who: '', icon: '🍲' },
  { id: 'prayers', category: 'prayer',        label: 'Prayers',       time: '13:05', days: 'daily', who: '', icon: '🕌' },
  { id: 'walk',    category: 'mobility',      label: 'Walk',          time: '17:15', days: 'daily', who: '', icon: '🚶' },
];
const ICON = { meds: '💊', 'personal care': '🧼', meal: '🍲', prayer: '🕌', mobility: '🚶', mood: '🙂', sleep: '🌙',
  readings: '📈', appointment: '🩺', transport: '🚗', note: '📝' };
export const iconFor = (item) => item.icon || ICON[item.category] || '•';

// Quick reasons a card is blocked. The text is what gets stored (encrypted)
// and what the recommendation rules read ("refused", "agitated").
export const BLOCK_REASONS = ['refused', 'asleep', 'agitated', 'other'];

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

// Does this row belong to this card? By routine_id first; a CareLogged from an
// older build may only carry the card's label in its text.
export function rowIsCard(row, card) {
  if (row.routine_id) return row.routine_id === card.id;
  return !row.blocked && row.category === card.category && !!card.label
    && String(row.text || '').toLowerCase().startsWith(card.label.toLowerCase());
}

// The blocked text stored with a CareBlocked event, and read back by the rules.
export const blockedText = (card, reason) => `${card.label} not done: ${reason}`;

// cards: routine items for the day. rows: decrypted care rows (any day),
// each { id, type|blocked, routine_id, text, category, actor_id, occurred_at, retracted }.
// Returns one entry per card: { card, state, ev } with ev the deciding event.
export function boardFor(cards, rows, day = new Date()) {
  const d0 = startOfDay(day);
  const d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
  const today = rows.filter((r) => { const t = new Date(r.occurred_at); return t >= d0 && t < d1 && !r.retracted; });
  return cards.map((card) => {
    const mine = today.filter((r) => rowIsCard(r, card)).sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));
    const ev = mine.at(-1) || null;
    const blocked = ev && (ev.blocked || ev.type === 'CareBlocked');
    return { card, state: ev ? (blocked ? 'blocked' : 'done') : 'todo', ev };
  });
}

export function counts(board) {
  const c = { todo: 0, done: 0, blocked: 0 };
  for (const b of board) c[b.state]++;
  return c;
}

// Days with at least one card decided, for "day 1, day 2, day 3" views.
export function daysWithMoves(rows) {
  return [...new Set(rows.filter((r) => !r.retracted).map((r) => startOfDay(r.occurred_at).toDateString()))]
    .sort((a, b) => new Date(b) - new Date(a));
}
export { sameDay };
