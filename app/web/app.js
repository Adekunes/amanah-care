// Amanah Care web app. Vanilla ES module. All plaintext stays in this browser.
import { makeKey, exportKeyRaw, importKeyRaw, keyCheck, encryptJSON, decryptJSON, b64 }
  from './crypto.js';

const API = (window.AMANAH_API || `http://${location.hostname}:4000`);
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

let KEY = null;                 // CryptoKey H, memory only
let ME = null;                  // { family_id, member_id, role, h, my_name }
let lastHandoffAt = null;       // to auto-compose summary from care since last handoff
const nameCache = {};           // member_id -> decrypted name (from MemberJoined events)

const CATS = [
  ['meds',        ['meds given','meds skipped','meds refused']],
  ['meal',        ['ate full','ate half','refused food']],
  ['prayer',      ['Fajr prayed','Dhuhr prayed','Asr prayed','Maghrib prayed','Isha prayed']],
  ['mobility',    ['walked','physio done','rested']],
  ['mood',        ['calm','tired','agitated','cheerful']],
  ['appointment', ['doctor','pharmacy','clinic']],
  ['transport',   ['drop-off done','pickup needed']],
  ['note',        ['note']],
];

let pick = { category: null, preset: null };

function toast(msg){ const t=document.createElement('div'); t.className='toast'; t.textContent=msg;
  document.body.appendChild(t); setTimeout(()=>t.remove(),1800); }

function save(){ localStorage.setItem('amanah', JSON.stringify(ME)); }
async function loadSession(){
  const raw = localStorage.getItem('amanah'); if(!raw) return false;
  ME = JSON.parse(raw); KEY = await importKeyRaw(ME.h); return true;
}

async function api(path, opts={}){
  const r = await fetch(API+path, { headers:{'content-type':'application/json'}, ...opts });
  if(!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.status===204 ? null : r.json();
}
async function postEvent(ev){
  return api('/events', { method:'POST', body: JSON.stringify({ id:uuid(), occurred_at:now(), ...ev }) });
}

// ---- views ----
function show(id){ ['landing','invite','app'].forEach(v=>$('#view-'+v).classList.toggle('hide', v!==id)); }
function tab(name){
  $$('.tabs button').forEach(b=>b.classList.toggle('on', b.dataset.tab===name));
  $$('.tabview').forEach(v=>v.classList.add('hide'));
  $('#tab-'+name).classList.remove('hide');
  if(name==='handoff') buildHandoff();
  if(name==='inbox') refreshInbox();
  if(name==='prefs') {}
}

// ---- create / join ----
async function createFamily(){
  const elder = $('#c-elder').value.trim() || 'Elder';
  const myName = $('#c-name').value.trim() || 'Me';
  const role = $('#c-role').value;
  KEY = await makeKey();
  const h = await exportKeyRaw(KEY);
  const kc = await keyCheck(KEY);
  const family_id = uuid().slice(0,8);
  const member_id = uuid();
  ME = { family_id, member_id, role, h, my_name: myName };
  await api('/families', { method:'POST', body: JSON.stringify({
    family_id, key_check: kc, key_version:1, member:{ id:member_id, role } }) });
  // record my name + elder name as encrypted events
  await postEncEvent('MemberJoined', { name: myName }, { actor_id: member_id });
  await postEncEvent('FamilyCreated', { elder_name: elder }, { actor_id: member_id });
  save();
  showInvite();
}

function inviteCode(){
  return b64.from(new TextEncoder().encode(JSON.stringify({ f: ME.family_id, h: ME.h })))
    .replace(/\+/g,'-').replace(/\//g,'_');
}
function showInvite(){
  const code = inviteCode();
  $('#invite-code').value = code;
  $('#qr').innerHTML='';
  const qr = qrcode(0,'M'); qr.addData(code); qr.make();
  $('#qr').innerHTML = qr.createImgTag(4,8);
  show('invite');
}

async function joinFamily(){
  let payload;
  try{
    const raw = $('#j-code').value.trim().replace(/-/g,'+').replace(/_/g,'/');
    payload = JSON.parse(new TextDecoder().decode(b64.to(raw)));
  }catch{ return toast('Bad invite code'); }
  // A demo/seed code may pin the member (m,r,n) so the seeded handoff reaches you.
  const pinned = !!payload.m;
  const name = pinned ? payload.n : ($('#j-name').value.trim() || 'Me');
  const role = pinned ? payload.r : $('#j-role').value;
  const member_id = pinned ? payload.m : uuid();
  KEY = await importKeyRaw(payload.h);
  const kc = await keyCheck(KEY);
  try{
    await api('/families/'+payload.f+'/join', { method:'POST', body: JSON.stringify({
      key_check: kc, member:{ id:member_id, role } }) });
  }catch(e){ return toast('Join failed: wrong key or no family'); }
  ME = { family_id: payload.f, member_id, role, h: payload.h, my_name: name };
  if(!pinned) await postEncEvent('MemberJoined', { name }, { actor_id: member_id });
  save();
  enterApp();
}

// encrypt a payload then post with clear routing fields
async function postEncEvent(type, payloadObj, clear={}){
  const { iv, cipher } = await encryptJSON(KEY, payloadObj);
  return postEvent({ family_id: ME.family_id, type, iv, payload_cipher: cipher, key_version:1, ...clear });
}

// ---- app boot ----
async function enterApp(){
  show('app'); tab('log');
  buildChipsets();
  await loadNames();
  await renderStrip();
  await renderCareToday();
  startPolling();
}

// ---- names ----
async function loadNames(){
  // Names live encrypted in MemberJoined events. Decrypt them once into a cache.
  const evs = await fetchEventsByType('MemberJoined');
  for(const e of evs){ const p = await decryptJSON(KEY, e.iv, e.payload_cipher); if(p?.name) nameCache[e.actor_id]=p.name; }
}
async function fetchEventsByType(type){
  // small helper endpoint reuse: /debug/events returns recent rows incl. actor_id
  const rows = await api('/debug/events').catch(()=>[]);
  return rows.filter(r=>r.type===type && r.family_id===ME.family_id);
}
function nameOf(id){ return nameCache[id] || (id===ME.member_id ? ME.my_name : id.slice(0,6)); }

// ---- preference strip ----
async function renderStrip(){
  const pref = await api(`/families/${ME.family_id}/preferences`).catch(()=>null);
  if(!pref){ $('#strip').classList.add('hide'); return; }
  const p = await decryptJSON(KEY, pref.iv, pref.payload_cipher);
  if(!p){ $('#strip').classList.add('hide'); return; }
  const bits = [p.lang && `<b>${p.lang}</b>`, p.diet, p.prayer, p.modesty].filter(Boolean);
  $('#strip').innerHTML = '🕌 ' + bits.join(' · ');
  $('#strip').classList.remove('hide');
}

// ---- chips / logging ----
function buildChipsets(){
  const box = $('#chipsets'); box.innerHTML='';
  for(const [cat,presets] of CATS){
    const h = document.createElement('div'); h.className='muted'; h.style.margin='10px 0 4px'; h.textContent=cat;
    const row = document.createElement('div'); row.className='row wrap';
    for(const pr of presets){
      const c = document.createElement('button'); c.className='chip'; c.textContent=pr;
      c.onclick=()=>{ pick={category:cat,preset:pr};
        $$('.chip').forEach(x=>x.classList.remove('on')); c.classList.add('on');
        $('#btn-log').disabled=false; };
      row.appendChild(c);
    }
    box.appendChild(h); box.appendChild(row);
  }
}
async function logItem(){
  if(!pick.preset) return;
  const note = $('#log-note').value.trim();
  const text = note ? `${pick.preset} (${note})` : pick.preset;
  await postEncEvent('CareLogged', { text }, { actor_id: ME.member_id, category: pick.category });
  $('#log-note').value=''; $$('.chip').forEach(x=>x.classList.remove('on'));
  pick={category:null,preset:null}; $('#btn-log').disabled=true;
  toast('Logged'); await renderCareToday();
}
async function careSince(since){
  const rows = await api(`/families/${ME.family_id}/care?since=${encodeURIComponent(since||'1970-01-01')}`);
  const out=[];
  for(const r of rows){ const p = await decryptJSON(KEY, r.iv, r.payload_cipher);
    out.push({ ...r, text: p?.text ?? '🔒 locked' }); }
  return out;
}
async function renderCareToday(){
  const midnight = new Date(); midnight.setHours(0,0,0,0);
  const items = await careSince(midnight.toISOString());
  const box = $('#care-today');
  if(!items.length){ box.innerHTML='<p class="muted">Nothing logged yet.</p>'; return; }
  box.innerHTML = items.map(i=>`<div class="item"><b>${i.category}</b> · ${i.text}
    <div class="muted">${nameOf(i.actor_id)} · ${new Date(i.occurred_at).toLocaleTimeString()}</div></div>`).join('');
}

// ---- handoff ----
async function buildHandoff(){
  const members = await api(`/families/${ME.family_id}/members`);
  const sel = $('#ho-member'); sel.innerHTML='';
  members.filter(m=>m.id!==ME.member_id).forEach(m=>{
    const o=document.createElement('option'); o.value=m.id; o.textContent=`${nameOf(m.id)} (${m.role})`; sel.appendChild(o); });
  const items = await careSince(lastHandoffAt || new Date(Date.now()-12*3600e3).toISOString());
  $('#ho-summary').value = items.length
    ? items.map(i=>i.text).join(', ')
    : 'No items logged this turn.';
}
async function openHandoff(){
  const to = $('#ho-member').value;
  if(!to) return toast('Pick a member');
  const handoff_id = uuid();
  const payload = { summary: $('#ho-summary').value, next: $('#ho-next').value.trim() };
  await postEncEvent('HandoffOpened', payload,
    { actor_id: ME.member_id, from_id: ME.member_id, to_id: to, handoff_id });
  lastHandoffAt = now(); $('#ho-next').value='';
  toast('Handoff sent'); tab('inbox');
}

// ---- inbox / poll (FR-05) ----
let pollTimer=null;
function startPolling(){ if(pollTimer) clearInterval(pollTimer);
  refreshInbox(); pollTimer=setInterval(refreshInbox, 4000); }
let inboxSig='';
async function refreshInbox(){
  const rows = await api(`/families/${ME.family_id}/handoffs?to=${ME.member_id}`).catch(()=>[]);
  const sig = rows.map(r=>r.id+r.status).join('|');
  if(sig!==inboxSig){ inboxSig=sig; renderInbox(rows); }
  renderWorkload();
}
async function renderInbox(rows){
  const box=$('#inbox');
  if(!rows.length){ box.innerHTML='<p class="muted">No handoffs waiting.</p>'; return; }
  const cards=[];
  for(const h of rows){
    const p = await decryptJSON(KEY, h.iv, h.summary_cipher) || {};
    const care = await careSince(new Date(new Date(h.opened_at).getTime()-12*3600e3).toISOString());
    const strip = $('#strip').innerHTML;
    cards.push(`<div class="card">
      <div class="row" style="justify-content:space-between">
        <b>From ${nameOf(h.from_id)}</b><span class="pill ${h.status}">${h.status}</span></div>
      ${strip?`<div class="strip" style="margin:10px 0">${strip}</div>`:''}
      <div class="muted" style="margin-top:6px">What happened</div>
      <div>${p.summary||'—'}</div>
      <div class="muted" style="margin-top:6px">What is next</div>
      <div>${p.next||'—'}</div>
      ${h.status==='open'
        ? `<div style="height:10px"></div><button data-ack="${h.id}">Accept handoff</button>`
        : `<div class="muted" style="margin-top:8px">Accepted ${new Date(h.acked_at).toLocaleTimeString()}</div>`}
    </div>`);
  }
  box.innerHTML=cards.join('');
  $$('[data-ack]').forEach(b=>b.onclick=()=>ack(b.dataset.ack));
}
async function ack(handoff_id){
  await postEvent({ family_id:ME.family_id, type:'HandoffAcknowledged',
    actor_id:ME.member_id, handoff_id, occurred_at:now(), id:uuid() });
  toast('Accepted'); setTimeout(refreshInbox, 600);
}
async function renderWorkload(){
  const rows = await api(`/families/${ME.family_id}/workload`).catch(()=>[]);
  const box=$('#workload');
  if(!rows.length){ box.innerHTML='<p class="muted">No activity yet.</p>'; return; }
  const max = Math.max(...rows.map(r=>r.care_count+r.handoff_count),1);
  box.innerHTML = rows.map(r=>{ const total=r.care_count+r.handoff_count;
    return `<div style="margin:8px 0"><div class="row" style="justify-content:space-between">
      <span>${nameOf(r.member_id)}</span><span class="muted">${r.care_count} logs · ${r.handoff_count} handoffs</span></div>
      <div class="bar"><span style="width:${Math.round(total/max*100)}%"></span></div></div>`; }).join('');
}

// ---- prefs ----
async function savePrefs(){
  const payload={ lang:$('#p-lang').value.trim(), diet:$('#p-diet').value.trim(),
    prayer:$('#p-prayer').value.trim(), modesty:$('#p-modesty').value.trim() };
  await postEncEvent('PreferenceSet', payload, { actor_id: ME.member_id });
  toast('Preferences saved'); await renderStrip();
}

// ---- proof / kill switch ----
async function refreshProof(){
  const rows = await api('/debug/events');
  $('#proof').textContent = rows.slice(0,20).map(r=>
    `${r.type.padEnd(20)} cat=${r.category||'-'} cipher=${(r.payload_cipher||'').slice(0,40)}...`).join('\n')
    || 'empty';
}

// ---- wire up ----
$('#btn-create').onclick = ()=>createFamily().catch(e=>toast(e.message));
$('#btn-join').onclick   = ()=>joinFamily().catch(e=>toast(e.message));
$('#btn-enter').onclick  = ()=>enterApp();
$('#btn-copy').onclick   = ()=>{ navigator.clipboard?.writeText($('#invite-code').value); toast('Copied'); };
$('#btn-log').onclick    = ()=>logItem().catch(e=>toast(e.message));
$('#btn-handoff').onclick= ()=>openHandoff().catch(e=>toast(e.message));
$('#btn-prefs').onclick  = ()=>savePrefs().catch(e=>toast(e.message));
$('#btn-proof').onclick  = ()=>refreshProof().catch(e=>toast(e.message));
$$('.tabs button').forEach(b=>b.onclick=()=>tab(b.dataset.tab));

// resume session if present
loadSession().then(ok=>{ if(ok) enterApp(); else show('landing'); });
