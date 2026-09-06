// STUB. Agent A3 replaces this file. Contract: spec/NOTIFY-SPEC.md §1, §4.
export const KINDS = [
  'handoff.to_me', 'handoff.accepted',
  'care.meds', 'care.meal', 'care.prayer', 'care.mobility', 'care.mood', 'care.appointment', 'care.transport', 'care.note',
  'care.*', 'prefs', 'routine', 'member',
];
export async function ensureDefaults(_db, _familyId, _memberId, _role) {}
export function mountSubscriptions(_app, _ctx) {}
