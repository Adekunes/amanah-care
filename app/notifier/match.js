// Amanah Care notifier, matching logic. Pure functions, no db and no
// decryption here — apply.js does the I/O. Kept in sync by hand with
// app/api/routes/subscriptions.js (no cross-imports between services,
// per spec/NOTIFY-SPEC.md §1).

// Canonical ordered list of subscription kinds. Order matters: when an
// event satisfies more than one kind for the same member, the FIRST kind
// in this list wins and only one notification row is written for them.
export const KINDS = [
  'handoff.to_me',
  'handoff.accepted',
  'care.meds',
  'care.meal',
  'care.prayer',
  'care.mobility',
  'care.mood',
  'care.appointment',
  'care.transport',
  'care.note',
  'care.*',
  'prefs',
  'routine',
  'member',
  'emergency',
];

// member_id -> rank, lower rank wins ties. Built once from KINDS.
const RANK = new Map(KINDS.map((kind, i) => [kind, i]));

// Which kinds a given event could satisfy, in KINDS order. Returns []
// for event types nobody can subscribe to.
export function kindsFor(fields) {
  switch (fields.type) {
    case 'HandoffOpened':       return ['handoff.to_me'];
    case 'HandoffAcknowledged': return ['handoff.accepted'];
    case 'PreferenceSet':       return ['prefs'];
    case 'RoutineSet':          return ['routine'];
    case 'MemberJoined':        return ['member'];
    case 'EmergencyRaised':     return ['emergency'];
    case 'CareLogged':
    case 'CareBlocked': {
      // fields.category is the clear routing field (see db/init.sql). Only
      // offer the specific kind if it is one of the eight real categories;
      // care.* always applies to any CareLogged or CareBlocked (a card moved
      // to Done or to Blocked) regardless of category.
      const specific = `care.${fields.category}`;
      return KINDS.includes(specific) ? [specific, 'care.*'] : ['care.*'];
    }
    default: return [];
  }
}

// subs: [{ member_id, kind }] for the event's family (all its subscribers,
// any kind). extra.handoff_from_id: the handoffs.from_id row for a
// HandoffAcknowledged event (looked up by the caller, apply.js).
// extra.members: every member id for the event's family (looked up by
// apply.js), used only for the always-on 'emergency' kind.
// Returns [{ member_id, kind }], at most one entry per member.
export function recipients(fields, subs, extra = {}) {
  const candidates = new Set(kindsFor(fields));
  if (candidates.size === 0) return [];

  // Emergency alerts reach every family member regardless of subscriptions
  // (spec/NOTIFY-SPEC.md §1, the always-on kind). kindsFor only ever offers
  // 'emergency' alone (for EmergencyRaised), so this never mixes with the
  // per-subscription matching below.
  if (candidates.has('emergency')) {
    return (extra.members || [])
      .filter((member_id) => member_id !== fields.actor_id)
      .map((member_id) => ({ member_id, kind: 'emergency' }));
  }

  const best = new Map(); // member_id -> best-ranked matching kind so far
  for (const sub of subs) {
    if (!candidates.has(sub.kind)) continue;
    if (sub.member_id === fields.actor_id) continue; // never notify the actor
    // handoff.to_me is only for the person the handoff was sent to; the
    // wider family may subscribe but must not be told about every handoff.
    if (sub.kind === 'handoff.to_me' && sub.member_id !== fields.to_id) continue;
    // handoff.accepted is only for the person who opened the handoff.
    if (sub.kind === 'handoff.accepted' && sub.member_id !== extra.handoff_from_id) continue;

    const prev = best.get(sub.member_id);
    if (prev === undefined || RANK.get(sub.kind) < RANK.get(prev)) best.set(sub.member_id, sub.kind);
  }
  return [...best].map(([member_id, kind]) => ({ member_id, kind }));
}
