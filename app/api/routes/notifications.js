// Notifications read model + read-marking. Contract: spec/NOTIFY-SPEC.md §4.
// Rows are metadata + ciphertext only; the client decrypts iv/payload_cipher.
export function mountNotifications(app, ctx) {
  const { db, wrap } = ctx;

  // Newest first. unread=1 -> only read_at IS NULL. limit default 50, max 200.
  app.get('/families/:id/notifications', wrap(async (req, res) => {
    const familyId = req.params.id;
    const memberId = req.query.member;
    if (!memberId) return res.status(400).json({ error: 'member required' });

    const unread = req.query.unread === '1';
    let limit = Number.parseInt(req.query.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) limit = 50;
    if (limit > 200) limit = 200;

    const cond = ['notifications.family_id = $1', 'notifications.member_id = $2'];
    const args = [familyId, memberId];
    if (unread) cond.push('notifications.read_at IS NULL');
    args.push(limit);

    const r = await db.query(
      `SELECT notifications.event_id, notifications.kind, notifications.type, notifications.category,
              notifications.from_id, notifications.handoff_id, notifications.occurred_at, notifications.read_at,
              events.iv, events.payload_cipher
         FROM notifications
         LEFT JOIN events ON events.id = notifications.event_id
        WHERE ${cond.join(' AND ')}
        ORDER BY notifications.occurred_at DESC
        LIMIT $${args.length}`,
      args);
    res.json(r.rows);
  }));

  // Mark read: either a specific list of event_ids or the whole unread set.
  app.post('/families/:id/notifications/read', wrap(async (req, res) => {
    const familyId = req.params.id;
    const { member_id, event_ids, all } = req.body || {};
    if (!member_id) return res.status(400).json({ error: 'member_id required' });
    const idsProvided = Array.isArray(event_ids);
    if (!idsProvided && all !== true)
      return res.status(400).json({ error: 'event_ids or all required' });

    let r;
    if (all === true) {
      r = await db.query(
        `UPDATE notifications SET read_at = now()
          WHERE family_id = $1 AND member_id = $2 AND read_at IS NULL`,
        [familyId, member_id]);
    } else if (event_ids.length === 0) {
      r = { rowCount: 0 };
    } else {
      r = await db.query(
        `UPDATE notifications SET read_at = now()
          WHERE family_id = $1 AND member_id = $2 AND read_at IS NULL AND event_id = ANY($3)`,
        [familyId, member_id, event_ids]);
    }
    res.json({ updated: Number(r.rowCount) || 0 });
  }));
}
