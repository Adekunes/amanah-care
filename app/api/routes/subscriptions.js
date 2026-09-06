// Alert subscriptions: which kinds of events a member wants to hear about.
// Contract: spec/NOTIFY-SPEC.md §1, §4. Table: subscriptions(member_id, family_id, kind),
// PK (member_id, kind). Duplicated (no cross-imports) as notifier/match.js KINDS.

export const KINDS = [
  'handoff.to_me', 'handoff.accepted',
  'care.meds', 'care.meal', 'care.prayer', 'care.mobility', 'care.mood', 'care.appointment', 'care.transport', 'care.note',
  'care.*', 'prefs', 'routine', 'member',
];

const KIND_SET = new Set(KINDS);
// New member defaults (§1). Elders get none; the UI hides the Alerts tab for them.
const DEFAULT_KINDS = ['handoff.to_me', 'handoff.accepted'];

// Any collection of kinds, ordered the canonical way (table order in §1).
const canonicalOrder = (kinds) => {
  const have = new Set(kinds);
  return KINDS.filter((k) => have.has(k));
};

// Called by app.js on family create and join (already wired there).
export async function ensureDefaults(db, familyId, memberId, role) {
  if (role === 'elder') return;
  for (const kind of DEFAULT_KINDS) {
    await db.query(
      'INSERT INTO subscriptions(member_id, family_id, kind) VALUES($1,$2,$3) ON CONFLICT (member_id, kind) DO NOTHING',
      [memberId, familyId, kind]);
  }
}

export function mountSubscriptions(app, { db, wrap, isMember }) {
  // { member_id, kinds: [...] } in canonical order, [] if none. 403 if mid is not a member.
  app.get('/families/:id/members/:mid/subscriptions', wrap(async (req, res) => {
    const { id: familyId, mid } = req.params;
    if (!(await isMember(familyId, mid))) return res.status(403).json({ error: 'not a member of this family' });
    const r = await db.query('SELECT kind FROM subscriptions WHERE member_id=$1 AND family_id=$2', [mid, familyId]);
    res.json({ member_id: mid, kinds: canonicalOrder(r.rows.map((row) => row.kind)) });
  }));

  // body { kinds: [...] } replaces the whole set (DELETE then INSERT).
  // 400 if kinds is not an array or contains an unknown kind; 403 if mid is not a member.
  app.put('/families/:id/members/:mid/subscriptions', wrap(async (req, res) => {
    const { id: familyId, mid } = req.params;
    const { kinds } = req.body || {};
    if (!Array.isArray(kinds) || kinds.some((k) => !KIND_SET.has(k)))
      return res.status(400).json({ error: 'kinds must be an array of known kinds' });
    if (!(await isMember(familyId, mid))) return res.status(403).json({ error: 'not a member of this family' });
    await db.query('DELETE FROM subscriptions WHERE member_id=$1 AND family_id=$2', [mid, familyId]);
    const unique = [...new Set(kinds)];
    for (const kind of unique) {
      await db.query(
        'INSERT INTO subscriptions(member_id, family_id, kind) VALUES($1,$2,$3) ON CONFLICT (member_id, kind) DO NOTHING',
        [mid, familyId, kind]);
    }
    res.json({ member_id: mid, kinds: canonicalOrder(unique) });
  }));
}
