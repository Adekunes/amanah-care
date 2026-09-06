// Recommendations engine. Pure functions, no DOM, runs on the phone over the
// decrypted record. Rules, counts and time windows only. No learning, no model.
// The server never learns which pattern fired.

export const AVAILABLE = new Set(['meal_log', 'med_log', 'mobility_log', 'mood_log', 'appointment_log', 'transport_log', 'note_log', 'handoff', 'routine', 'workload']);
export const MEAL_PATTERNS = new Set(['MEAL_SKIPPED_CONSECUTIVE', 'MEAL_REFUSED_REPEAT']);
const TIER_ORDER = { URGENT_CONTACT: 0, ATTENTION: 1, NOTICE: 2 };

const H = 3600e3, DAY = 86400e3, MIN = 60e3;
const hm = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayKey = (d) => new Date(d).toDateString();
const txt = (i) => String(i.text || '').toLowerCase();
const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
const fmtT = (d) => new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtD = (d) => new Date(d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
const inLast = (items, now, hours) => items.filter((i) => { const t = new Date(i.occurred_at); return t <= now && now - t <= hours * H; });
const onDay = (items, day) => items.filter((i) => dayKey(i.occurred_at) === dayKey(day));
const slotTime = (day, item) => { const t = new Date(startOfDay(day)); t.setMinutes(hm(item.time)); return t; };

// The table file starts with a block comment for humans; strip it, then parse.
export function parseTable(text) {
  return JSON.parse(String(text).replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ''));
}

const WEEKDAYS = {
  en: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
  fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'],
};
// Only the stored profile decides. Free text: "Mondays and Thursdays", "lundi et jeudi", "Ramadan", "none".
export function fastingToday(prefs, now) {
  const f = String(prefs?.fasting || '').toLowerCase().trim();
  if (!f || /^(none|no|non|aucun|aucune|jamais)$/.test(f)) return false;
  if (/ramadan|today|aujourd|every day|daily|chaque jour|tous les jours/.test(f)) return true;
  const d = new Date(now).getDay();
  return f.includes(WEEKDAYS.en[d]) || f.includes(WEEKDAYS.fr[d]);
}

const DETECTORS = {
  MEAL_SKIPPED_CONSECUTIVE(c) {
    const slots = [];
    for (const off of [1, 0]) {
      const day = new Date(startOfDay(c.now).getTime() - off * DAY);
      const dayItems = onDay(c.items, day);
      for (const it of c.planFor(day).filter((i) => i.category === 'meal')) {
        const t = slotTime(day, it);
        if (c.now - t < 90 * MIN || c.now - t > 24 * H) continue;
        slots.push({ it, t, done: !!c.doneFor(it, dayItems) });
      }
    }
    slots.sort((a, b) => a.t - b.t);
    for (let k = 1; k < slots.length; k++) {
      if (!slots[k].done && !slots[k - 1].done) {
        return { because: `${cap(slots[k - 1].it.label)} (${fmtT(slots[k - 1].t)}) and ${slots[k].it.label} (${fmtT(slots[k].t)}) have no log.`,
                 evidence: { slots: [slots[k - 1].it.label, slots[k].it.label] } };
      }
    }
    return null;
  },
  MEAL_REFUSED_REPEAT(c) {
    const r = inLast(c.items.filter((i) => i.category === 'meal' && txt(i).includes('refus')), c.now, 48);
    if (r.length < 2) return null;
    return { because: `Refused food logged ${r.length} times in 48 hours (${r.map((i) => `${fmtD(i.occurred_at)} ${fmtT(i.occurred_at)}`).join(', ')}).`, evidence: { count: r.length } };
  },
  MED_ROUTINE_NOT_LOGGED(c) {
    const day = new Date(startOfDay(c.now).getTime() - DAY);
    const dayItems = onDay(c.items, day);
    if (!dayItems.length) return null;                 // no record that day at all: NO_CONTACT_LOGGED covers it
    const missing = c.planFor(day).filter((i) => i.category === 'meds' && !c.doneFor(i, dayItems));
    if (!missing.length) return null;
    return { because: `${missing.map((i) => cap(i.label)).join(', ')} not logged yesterday (${fmtD(day)}).`, evidence: { missing: missing.map((i) => i.id) } };
  },
  MED_ROUTINE_LATE(c) {
    const byId = Object.fromEntries((c.routine || []).map((i) => [i.id, i]));
    const late = inLast(c.items.filter((i) => i.category === 'meds' && i.routine_id && byId[i.routine_id]), c.now, 7 * 24)
      .map((i) => { const it = byId[i.routine_id]; const t = new Date(i.occurred_at); const mins = t.getHours() * 60 + t.getMinutes() - hm(it.time); return { i, it, mins }; })
      .filter((x) => x.mins > 60);
    if (late.length < 2) return null;
    const e = late[0];
    return { because: `Logged more than an hour after its time ${late.length} times in 7 days (for example ${e.it.label} at ${fmtT(e.i.occurred_at)}, planned ${e.it.time}).`, evidence: { count: late.length } };
  },
  MOBILITY_NONE_LOGGED(c) {
    const planned = (c.routine || []).find((i) => i.category === 'mobility');
    if (!planned) return null;
    if (inLast(c.items.filter((i) => i.category === 'mobility'), c.now, 48).length) return null;
    return { because: `No mobility log in 48 hours; the routine has "${planned.label}".`, evidence: { planned: planned.id } };
  },
  MOOD_AGITATED_EVENINGS(c) {
    // A mood log, or a card blocked with an "agitated" reason (the board has no mood card).
    const m = inLast(c.items.filter((i) => (i.category === 'mood' || i.blocked) && /agit|upset|contrari|énerv|enerv/.test(txt(i)) && new Date(i.occurred_at).getHours() >= 17), c.now, 7 * 24);
    const days = new Set(m.map((i) => dayKey(i.occurred_at)));
    if (days.size < 3) return null;
    return { because: `Agitated or upset logged on ${days.size} evenings in 7 days, after 17:00 (${[...m].slice(-3).map((i) => `${fmtD(i.occurred_at)} ${fmtT(i.occurred_at)}`).join(', ')}).`, evidence: { days: days.size } };
  },
  APPOINTMENT_NOT_LOGGED(c) {
    for (let k = 1; k <= 14; k++) {
      const day = new Date(startOfDay(c.now).getTime() - k * DAY);
      const dayItems = onDay(c.items, day);
      if (!dayItems.length) continue;                  // the record did not exist that day
      const miss = c.planFor(day).filter((i) => i.category === 'appointment' && !c.doneFor(i, dayItems));
      if (miss.length) return { because: `${cap(miss[0].label)} on ${fmtD(day)} has no log.`, evidence: { item: miss[0].id, day: dayKey(day) } };
    }
    return null;
  },
  HANDOFF_NOT_ACCEPTED(c) {
    const open = (c.handoffs || []).filter((h) => h.status === 'open' && c.now - new Date(h.opened_at) > 30 * MIN);
    if (!open.length) return null;
    const h = open[0]; const mins = Math.round((c.now - new Date(h.opened_at)) / MIN);
    return { because: `Handoff from ${c.nameOf(h.from_id)} to ${c.nameOf(h.to_id)} has waited ${mins} minutes.`, evidence: { handoff_id: h.id, minutes: mins } };
  },
  CAREGIVER_LOAD_CONCENTRATED(c) {
    const week = inLast(c.items, c.now, 7 * 24);
    if (week.length < 20) return null;
    const counts = {};
    for (const i of week) counts[i.actor_id] = (counts[i.actor_id] || 0) + 1;
    const [top, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const share = n / week.length;
    if (share < 0.7) return null;
    return { because: `${c.nameOf(top)} logged ${n} of ${week.length} items in 7 days (${Math.round(share * 100)}%).`, evidence: { member_id: top, share } };
  },
  NO_CONTACT_LOGGED(c) {
    if (inLast(c.items, c.now, 48).length) return null;
    const last = [...c.items].sort((a, b) => new Date(b.occurred_at) - new Date(a.occurred_at))[0];
    return { because: last ? `No care log from anyone in 48 hours. Last one: ${fmtD(last.occurred_at)} ${fmtT(last.occurred_at)}.` : 'No care log from anyone in the last 14 days.', evidence: { last: last?.occurred_at || null } };
  },
};

// ctx = { now, items, routine, planFor(date), doneFor(item, items), handoffs, members, prefs, elderName, nameOf, acks }
export function detect(table, ctx) {
  const now = ctx.now instanceof Date ? ctx.now : new Date(ctx.now || Date.now());
  const c = { items: [], routine: [], handoffs: [], members: [], prefs: {}, planFor: () => [], doneFor: () => null,
              nameOf: (id) => String(id || '').slice(0, 6), ...ctx, now };
  const fasting = fastingToday(c.prefs, now);
  const acks = ctx.acks || [];
  const out = [];
  for (const row of table || []) {
    if (!Array.isArray(row.signal_source) || !row.signal_source.some((s) => AVAILABLE.has(s))) continue;
    const det = DETECTORS[row.pattern_id];
    if (!det) continue;
    if (fasting && MEAL_PATTERNS.has(row.pattern_id)) continue;
    if (acks.some((a) => a.pattern_id === row.pattern_id && new Date(a.until) > now)) continue;
    let r = null;
    try { r = det(c); } catch { r = null; }
    if (!r) continue;
    out.push({ row, because: r.because, evidence: r.evidence || {} });
  }
  return out.sort((a, b) => (TIER_ORDER[a.row.tier] ?? 9) - (TIER_ORDER[b.row.tier] ?? 9));
}
