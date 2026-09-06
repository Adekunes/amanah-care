// Recommendations for today. Sibling module: talks to app.js only through
// window.amanah, like alerts.js. Rules over the decrypted record, on this
// phone; the server never learns which pattern fired. Never a diagnosis.
import { detect, parseTable } from './patterns.js';

const A = window.amanah;
const $ = (s) => document.querySelector(s);
const TIER = { URGENT_CONTACT: ['contact', 'Contact'], ATTENTION: ['attention', 'Attention'], NOTICE: ['notice', 'Notice'] };
let TABLE = null, busy = false;

async function table(){
  if(TABLE) return TABLE;
  const r = await fetch('recommendations.json', { cache: 'no-store' });
  TABLE = parseTable(await r.text());
  return TABLE;
}
// The last 14 days, decrypted here. Same shape as app.js careSince().
async function items14(){
  const since = new Date(); since.setHours(0, 0, 0, 0); since.setDate(since.getDate() - 13);
  const rows = await A.api(`/families/${A.me.family_id}/care?since=${encodeURIComponent(since.toISOString())}`);
  const out = [];
  for(const r of rows){ if(r.retracted) continue; const p = await A.decryptJSON(A.key, r.iv, r.payload_cipher);
    out.push({ id: r.id, actor_id: r.actor_id, category: r.category, text: p?.text ?? '', routine_id: p?.routine_id || null, occurred_at: r.occurred_at,
      blocked: r.type === 'CareBlocked', reason: p?.reason || null }); }
  return out;
}
// Acknowledgements are events too: encrypted { pattern_id, until }, by any caregiver.
async function acks(){
  const rows = await A.api(`/families/${A.me.family_id}/events?type=PatternAcknowledged`).catch(() => []);
  const out = [];
  for(const r of rows){ const p = await A.decryptJSON(A.key, r.iv, r.payload_cipher); if(p?.pattern_id && p?.until) out.push({ pattern_id: p.pattern_id, until: p.until }); }
  return out;
}
function hide(){ const b = $('#recs'); if(b){ b.classList.add('hide'); b.innerHTML = ''; } }

async function render(){
  const box = $('#recs'); if(!box || !A.me) return;
  if(A.isElder() || A.isServerView()) return hide();
  if(busy) return; busy = true;
  try {
    const [tbl, items, ak] = await Promise.all([table(), items14(), acks()]);
    const prefs = A.prefs || {};
    const active = detect(tbl, { now: new Date(), items, routine: A.routine, planFor: A.planFor, doneFor: A.doneFor, handoffs: A.handoffs,
      members: A.members, prefs, elderName: A.elderName, nameOf: A.nameOf, acks: ak }).slice(0, 5);
    const head = `<div class="card-head"><h2>Recommendations for today</h2><span class="muted">rules, not ML</span></div>
      <p class="muted">Counted from your own record, on this phone. Not medical advice.</p>`;
    if(!active.length){ box.innerHTML = `<div class="card">${head}<p class="muted">Nothing in the record calls for a suggestion today.</p></div>`; box.classList.remove('hide'); return; }
    const role = A.me.role === 'support' ? 'recommendation_pro' : 'recommendation_family';
    const cultural = ['lang', 'diet', 'prayer', 'modesty', 'fasting'].some((k) => prefs[k]);
    const contact = prefs.care_contact ? ` Care contact: ${A.esc(prefs.care_contact)}.` : '';
    box.innerHTML = `<div class="card">${head}${active.map(({ row, because }) => {
      const [cls, lab] = TIER[row.tier] || ['notice', row.tier];
      const acts = row[role]?.en || [];
      const note = cultural && row.cultural_adaptation && !/^none/i.test(row.cultural_adaptation) ? `<div class="note">${A.esc(row.cultural_adaptation)}</div>` : '';
      return `<div class="rec">
        <div class="rec-head"><span class="pill ${cls}">${lab}</span><b>${A.esc(row.pattern_label?.en || row.pattern_id)}</b></div>
        <div class="because">${A.esc(because)}</div>
        <ul>${acts.map((a) => `<li>${A.esc(a)}</li>`).join('')}</ul>
        ${note}
        <div class="esc">${A.esc(row.escalation_path)}${contact}</div>
        <div class="rec-foot"><span class="prov">${A.esc(row.provenance)}</span><button class="ghost small" data-ack="${A.esc(row.pattern_id)}" type="button">Acknowledge (24h)</button></div>
      </div>`; }).join('')}</div>`;
    box.classList.remove('hide');
    box.querySelectorAll('[data-ack]').forEach((b) => b.onclick = () => ack(b.dataset.ack, b).catch((e) => A.toast(e.message)));
  } finally { busy = false; }
}
async function ack(pattern_id, btn){
  btn.disabled = true;
  const until = new Date(Date.now() + 24 * 3600e3).toISOString();
  await A.postEncEvent('PatternAcknowledged', { pattern_id, until }, { actor_id: A.me.member_id });
  A.toast('Acknowledged for 24 hours');
  btn.closest('.rec')?.remove();
  setTimeout(() => render().catch(() => {}), 1500);
}
A.onHome(render);
