// Amanah Care: Alerts tab. Subscriptions editor + notification feed, wired
// only through window.amanah — no imports from app.js (SR spec §5).
const A = window.amanah;
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

// Canonical kind order, duplicated from the API/notifier on purpose — no
// cross-imports between services (NOTIFY-SPEC §1).
const KINDS = ['handoff.to_me','handoff.accepted','care.meds','care.meal','care.prayer',
  'care.mobility','care.mood','care.appointment','care.transport','care.note','care.*',
  'prefs','routine','member'];
const LABELS = {
  'handoff.to_me':'Handoffs to me', 'handoff.accepted':'My handoff accepted',
  'care.meds':'Meds logged', 'care.meal':'Meals logged', 'care.prayer':'Prayers logged',
  'care.mobility':'Mobility logged', 'care.mood':'Mood logged',
  'care.appointment':'Appointments logged', 'care.transport':'Pickups and drop-offs',
  'care.note':'Notes', 'care.*':'Any care logged', 'prefs':'Preferences changed',
  'routine':'Routine changed', 'member':'Someone joined',
};

let ALERTS = [];   // last loaded notification rows, newest first
let sig = null;     // unread count + newest event_id, so polling never flickers

function verbFor(row, p){
  switch(row.type){
    case 'HandoffOpened': return 'handed off to you';
    case 'HandoffAcknowledged': return 'accepted your handoff';
    case 'CareLogged': return 'logged ' + (p?.text || row.category || 'care');
    case 'PreferenceSet': return 'updated the preferences';
    case 'RoutineSet': return 'changed the routine';
    case 'MemberJoined': return 'joined';
    default: return LABELS[row.kind] || row.kind;
  }
}
// who + verb; MemberJoined shows the joiner's own decrypted name when we have it.
function titleFor(row, p){
  if(row.type === 'MemberJoined') return `${A.esc(p?.name || A.nameOf(row.from_id))} joined`;
  return `${A.esc(A.nameOf(row.from_id))} ${A.esc(verbFor(row, p))}`;
}
function whatFor(row, p){
  if(row.type !== 'HandoffOpened' || !p) return '';
  const bits = [];
  if(p.summary) bits.push(p.summary);
  if(p.next) bits.push('Next: ' + p.next);
  return bits.join(' · ');
}

// ---- subscriptions editor ----
async function loadSubs(){
  const me = A.me;
  const r = await A.api(`/families/${me.family_id}/members/${me.member_id}/subscriptions`).catch(()=>({kinds:[]}));
  const on = new Set(r?.kinds || []);
  $('#alerts-subs').innerHTML = KINDS.map(k =>
    `<label><input type="checkbox" value="${A.esc(k)}" ${on.has(k)?'checked':''}> ${A.esc(LABELS[k])}</label>`
  ).join('');
}
async function saveSubs(){
  const me = A.me;
  const kinds = $$('#alerts-subs input:checked').map(i => i.value);
  await A.api(`/families/${me.family_id}/members/${me.member_id}/subscriptions`,
    { method:'PUT', body: JSON.stringify({ kinds }) });
  A.toast('Alerts saved');
}

// ---- alert feed ----
function sigOf(rows){ const unread = rows.filter(r=>!r.read_at).length; return `${unread}|${rows[0]?.event_id||''}`; }
async function fetchAlerts(){
  const me = A.me;
  return A.api(`/families/${me.family_id}/notifications?member=${me.member_id}&limit=50`).catch(()=>[]);
}
function renderBadge(){
  const unread = ALERTS.filter(r=>!r.read_at).length;
  const b = $('#alerts-badge'); if(!b) return;
  b.textContent = unread; b.classList.toggle('hide', unread===0);
}
async function renderAlerts(){
  const box = $('#alerts-list'); if(!box) return;
  $('#alerts-count').textContent = ALERTS.length;
  if(!ALERTS.length){ box.innerHTML = '<p class="muted">Nothing yet.</p>'; renderBadge(); return; }
  const rows = [];
  for(const r of ALERTS){
    const p = (r.iv && r.payload_cipher) ? await A.decryptJSON(A.key, r.iv, r.payload_cipher) : null;
    const what = whatFor(r, p);
    rows.push(`<div class="alert-row ${r.read_at ? '' : 'unread'}">
      <div class="top"><b>${titleFor(r, p)}</b><span class="muted">${A.esc(A.fmtWhen(r.occurred_at))}</span></div>
      ${what ? `<div class="muted">${A.esc(what)}</div>` : ''}
    </div>`);
  }
  box.innerHTML = rows.join('');
  renderBadge();
}
async function loadAlerts(){
  ALERTS = await fetchAlerts(); sig = sigOf(ALERTS);
  await renderAlerts();
}
async function markAllRead(){
  const me = A.me;
  await A.api(`/families/${me.family_id}/notifications/read`,
    { method:'POST', body: JSON.stringify({ member_id: me.member_id, all: true }) });
  await loadAlerts();
}

// ---- hooks from app.js (kept tiny on purpose) ----
A.onEnter(async () => { if(A.isElder()) return; await loadSubs(); await loadAlerts(); });
A.onPoll(async () => {
  if(A.isElder()) return;
  const rows = await fetchAlerts(); const s = sigOf(rows);
  if(s === sig) return;               // nothing new: skip the redraw, avoid flicker
  sig = s; ALERTS = rows; await renderAlerts();
});
A.onTab('alerts', async () => { if(!A.isElder()) await loadAlerts(); });

// ---- wire up ----
$('#btn-subs-save').onclick = () => saveSubs().catch(e => A.toast(e.message));
$('#btn-alerts-read').onclick = () => markAllRead().catch(e => A.toast(e.message));
