// Amanah Care projector, the pure part. applyEvent() copies one stream entry
// into Postgres (idempotent upsert by event id) and keeps the handoffs read
// model current. It never decrypts anything. index.js owns the consume loop.
export async function applyEvent(db, streamId, f) {
  // Idempotent: same event id replays harmlessly (AR-04, crash-safe upsert).
  await db.query(
    `INSERT INTO events(id,stream_id,family_id,type,actor_id,category,from_id,to_id,handoff_id,key_version,iv,payload_cipher,occurred_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO NOTHING`,
    [f.id, streamId, f.family_id, f.type, f.actor_id || null, f.category || null,
     f.from_id || null, f.to_id || null, f.handoff_id || null,
     parseInt(f.key_version || '1', 10), f.iv || null, f.payload_cipher || null,
     f.occurred_at || new Date().toISOString()]);

  if (f.type === 'HandoffOpened') {
    await db.query(
      `INSERT INTO handoffs(id,family_id,from_id,to_id,status,opened_at,iv,summary_cipher)
       VALUES($1,$2,$3,$4,'open',$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [f.handoff_id || f.id, f.family_id, f.from_id, f.to_id,
       f.occurred_at || new Date().toISOString(), f.iv || null, f.payload_cipher || null]);
  }

  if (f.type === 'HandoffAcknowledged') {
    await db.query(
      `UPDATE handoffs SET status='acknowledged', acked_at=$2
         WHERE id=$1 AND status='open'`,
      [f.handoff_id, f.occurred_at || new Date().toISOString()]);
  }
}
