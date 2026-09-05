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

const esc = (v)=>String(v).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

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
let lastTrace = null;     // the last encrypted write, timed hop by hop
let pendingPlain = null;  // plaintext of the write in flight, for the Flow view only

async function postEvent(ev){
  const body = { id:uuid(), occurred_at:now(), ...ev };
  const t0 = performance.now();
  const res = await api('/events', { method:'POST', body: JSON.stringify(body) });
  const apiMs = Math.round(performance.now() - t0);
  if(body.iv && body.payload_cipher){
    lastTrace = { type:body.type, iv:body.iv, plain:pendingPlain,
                  stream_id:res?.stream_id, apiMs, projMs:null };
    pendingPlain = null;
    traceProjection(lastTrace);
  }
  return res;
}

// Poll the raw rows until this event lands, to measure real projector lag.
// Matched on iv, which is unique per event (SR-10).
async function traceProjection(tr){
  const t0 = performance.now();
  for(let i=0;i<50;i++){
    await new Promise(r=>setTimeout(r,120));
    const rows = await api('/debug/events').catch(()=>[]);
    if(rows.some(r=>r.iv===tr.iv)){ tr.projMs = Math.round(performance.now()-t0); break; }
  }
  if(!$('#tab-flow').classList.contains('hide')) renderFlow();
}

// ---- views ----
function show(id){ ['landing','invite','app'].forEach(v=>$('#view-'+v).classList.toggle('hide', v!==id)); }
function tab(name){
  $$('.tabs button').forEach(b=>b.classList.toggle('on', b.dataset.tab===name));
  $$('.tabview').forEach(v=>v.classList.add('hide'));
  $('#tab-'+name).classList.remove('hide');
  if(name==='handoff') buildHandoff();
  if(name==='inbox') refreshInbox();
  if(name==='invite') renderInviteTab();
  if(name==='flow') renderFlow();
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
function renderQR(el, code){
  el.innerHTML='';
  const qr = qrcode(0,'M'); qr.addData(code); qr.make();
  el.innerHTML = qr.createImgTag(4,8);
}
function showInvite(){
  const code = inviteCode();
  $('#invite-code').value = code;
  renderQR($('#qr'), code);
  show('invite');
}
// Same code, reachable from inside the app so a family can grow after day one.
// H is already in memory for whoever is signed in, so no re-entry of the key.
function renderInviteTab(){
  const code = inviteCode();
  $('#invite-code-app').value = code;
  renderQR($('#qr-app'), code);
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
  pendingPlain = payloadObj;
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
  const bits = [['Language',p.lang],['Diet',p.diet],['Prayer',p.prayer],['Modesty',p.modesty]]
    .filter(([,v])=>v);
  $('#strip').innerHTML = bits.map(([k,v])=>
    `<span class="sbit"><i>${k}</i><b>${esc(v)}</b></span>`).join('');
  $('#strip').classList.remove('hide');
}

// ---- chips / logging ----
// Two steps beat one wall of 25 chips: pick the category, then the preset.
function buildChipsets(){
  const row = $('#cat-row'); row.innerHTML='';
  for(const [cat] of CATS){
    const b = document.createElement('button'); b.className='chip'; b.textContent=cat;
    b.onclick = ()=>selectCategory(cat, b);
    row.appendChild(b);
  }
  selectCategory(CATS[0][0], row.firstElementChild);
}
function selectCategory(cat, el){
  pick = { category:cat, preset:null };
  $$('#cat-row .chip').forEach(x=>x.classList.remove('on'));
  el?.classList.add('on');
  const presets = (CATS.find(c=>c[0]===cat) || [,[]])[1];
  const row = $('#preset-row'); row.innerHTML='';
  for(const pr of presets){
    const b = document.createElement('button'); b.className='chip'; b.textContent=pr;
    b.onclick = ()=>{ pick.preset = pr;
      $$('#preset-row .chip').forEach(x=>x.classList.remove('on')); b.classList.add('on');
      $('#btn-log').disabled = false; };
    row.appendChild(b);
  }
  $('#btn-log').disabled = true;
}
async function logItem(){
  if(!pick.preset) return;
  const note = $('#log-note').value.trim();
  const text = note ? `${pick.preset} (${note})` : pick.preset;
  await postEncEvent('CareLogged', { text }, { actor_id: ME.member_id, category: pick.category });
  $('#log-note').value='';
  $$('#preset-row .chip').forEach(x=>x.classList.remove('on'));
  pick.preset=null; $('#btn-log').disabled=true;
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
  $('#today-count').textContent = items.length;
  if(!items.length){ box.innerHTML='<p class="muted">Nothing logged yet.</p>'; return; }
  box.innerHTML = items.map(i=>`<div class="item">
    <div class="top"><b>${esc(i.text)}</b><span class="pill">${esc(i.category)}</span></div>
    <div class="muted">${esc(nameOf(i.actor_id))} · ${new Date(i.occurred_at).toLocaleTimeString()}</div>
  </div>`).join('');
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
let inboxSig=null;
async function refreshInbox(){
  const rows = await api(`/families/${ME.family_id}/handoffs?to=${ME.member_id}`).catch(()=>[]);
  const sig = rows.map(r=>r.id+r.status).join('|');
  if(sig!==inboxSig){ inboxSig=sig; renderInbox(rows); }
  renderWorkload();
}
async function renderInbox(rows){
  const box=$('#inbox');
  if(!rows.length){
    box.innerHTML='<div class="card flat"><p class="muted">No handoffs waiting for you.</p></div>';
    return; }
  const cards=[];
  for(const h of rows){
    const p = await decryptJSON(KEY, h.iv, h.summary_cipher) || {};
    const care = await careSince(new Date(new Date(h.opened_at).getTime()-12*3600e3).toISOString());
    const strip = $('#strip').innerHTML;
    cards.push(`<div class="card">
      <div class="card-head"><h2>From ${esc(nameOf(h.from_id))}</h2>
        <span class="pill ${h.status}">${h.status}</span></div>
      ${strip?`<div class="strip">${strip}</div>`:''}
      <div class="group"><span class="eyebrow">What happened</span>
        <div>${esc(p.summary||'—')}</div></div>
      <div class="group"><span class="eyebrow">What is next</span>
        <div>${esc(p.next||'—')}</div></div>
      ${h.status==='open'
        ? `<button data-ack="${h.id}">Accept handoff</button>`
        : `<p class="muted">Accepted ${new Date(h.acked_at).toLocaleTimeString()}</p>`}
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
    return `<div class="wl">
      <div class="top"><b>${esc(nameOf(r.member_id))}</b>
        <span class="muted tnum">${r.care_count} logs · ${r.handoff_count} accepted</span></div>
      <div class="bar"><span style="width:${Math.round(total/max*100)}%"></span></div>
    </div>`; }).join('');
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
  const rows = (await api('/debug/events')).filter(r=>r.family_id===ME.family_id).slice(0,14);
  $('#proof').innerHTML = rows.length ? rows.map(r=>
    `<div class="prow">
       <div class="clear"><span class="k">${esc(r.type)}</span>${
         r.category ? `<span class="cat">category=${esc(r.category)}</span>` : ''}</div>
       <div class="seal">${esc((r.payload_cipher||'(no payload)').slice(0,56))}…</div>
     </div>`).join('') : 'empty';
}

// ---- flow: the six hops a write takes ----
function hop(n, cls, name, where, holds, tags){
  return `<div class="hop ${cls}">
    <div class="rail"><div class="dot">${n}</div><div class="line"></div></div>
    <div class="body">
      <div class="name">${name}${tags}</div>
      <div class="where">${where}</div>
      <div class="holds">${holds}</div>
    </div></div>`;
}
async function renderFlow(){
  const box = $('#flow'), t = lastTrace;
  $('#flow-what').textContent = t ? t.type : 'nothing yet';
  if(!t){
    box.innerHTML = `<p class="muted">Log an item, save preferences, or open a handoff. Your write is traced here hop by hop, with the real timings.</p>`;
    return;
  }
  const members = await api(`/families/${ME.family_id}/members`).catch(()=>[]);
  const read = '<span class="tag read">readable</span>';
  const seal = '<span class="tag seal">sealed</span>';
  const ms = (v)=> v==null ? '<span class="tag ms">…</span>' : `<span class="tag ms">${v} ms</span>`;
  const plain = t.plain ? Object.values(t.plain).filter(Boolean).join(' · ') : '—';
  box.innerHTML = [
    hop(1,'readable','This phone','browser memory',
      `<b>${esc(plain)}</b> in the clear, plus the family key H. H is never sent anywhere.`, read),
    hop(2,'sealed','Over the wire','POST /events',
      `AES-GCM ciphertext under a fresh IV. Only routing stays clear: type, actor, category, time.`, seal+ms(t.apiMs)),
    hop(3,'sealed','api container','membership check, then append',
      `Confirms you belong to this family and appends. It has no key, so it never decrypts.`, seal),
    hop(4,'sealed','Redis stream','events',
      `Appended at <b>${esc(t.stream_id||'—')}</b>. Append-only and replayable.`, seal),
    hop(5,'sealed','projector','writes Postgres events + read models',
      `Copies the row, then updates handoffs and workload from metadata alone.`, seal+ms(t.projMs)),
    hop(6,'readable','Family phones','decrypt with H',
      `${members.length} member${members.length===1?'':'s'} hold H and can read this. Nobody else can.`, read),
  ].join('');
}

// ---- wire up ----
$('#btn-create').onclick = ()=>createFamily().catch(e=>toast(e.message));
$('#btn-join').onclick   = ()=>joinFamily().catch(e=>toast(e.message));
$('#btn-enter').onclick  = ()=>enterApp();
$('#btn-copy').onclick   = ()=>{ navigator.clipboard?.writeText($('#invite-code').value); toast('Copied'); };
$('#btn-copy-app').onclick = ()=>{ navigator.clipboard?.writeText($('#invite-code-app').value); toast('Copied'); };
$('#btn-log').onclick    = ()=>logItem().catch(e=>toast(e.message));
$('#btn-handoff').onclick= ()=>openHandoff().catch(e=>toast(e.message));
$('#btn-prefs').onclick  = ()=>savePrefs().catch(e=>toast(e.message));
$('#btn-proof').onclick  = ()=>refreshProof().catch(e=>toast(e.message));
$$('.tabs button').forEach(b=>b.onclick=()=>tab(b.dataset.tab));

// resume session if present
loadSession().then(ok=>{ if(ok) enterApp(); else show('landing'); });
