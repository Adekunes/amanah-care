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

// What each role may open. The invite carries the role, so nobody self-assigns.
// Server-side this is still client-declared (KL-02): a UI boundary, not a guard.
const TAB_LABEL = { log:'Log', handoff:'Hand off', inbox:'Inbox', prefs:'Prefs',
                    invite:'Invite', flow:'Flow' };
const ROLES = {
  family:  { label:'Family', tabs:['log','handoff','inbox','prefs','invite','flow'],
             note:'Full access: log care, hand off, and add other members.' },
  support: { label:'Support worker', tabs:['log','inbox','flow'],
             note:'Logs care and reads handoffs. Cannot change preferences or add members.' },
  elder:   { label:'Elder', tabs:['inbox','prefs','flow'],
             note:'Reads what was handed over and owns the preferences. Care is not logged about them by them.' },
};
const roleOf = (r)=> ROLES[r] ? r : 'family';

const esc = (v)=>String(v).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

function toast(msg){ const t=document.createElement('div'); t.className='toast'; t.textContent=msg;
  document.body.appendChild(t); setTimeout(()=>t.remove(),1800); }

function save(){ localStorage.setItem('amanah', JSON.stringify(ME)); }

// Who has logged in on this device. Keeping H here is what makes logging back
// in possible without a fresh invite; "Forget this device" is the one action
// that actually removes it.
const ACCOUNTS = 'amanah.accounts';
function loadAccounts(){
  try{ return JSON.parse(localStorage.getItem(ACCOUNTS)) || []; }catch{ return []; }
}
function rememberAccount(me){
  if(!me?.h) return;
  const rest = loadAccounts().filter(a=>
    !(a.family_id===me.family_id && a.member_id===me.member_id));
  const next = [{ family_id:me.family_id, member_id:me.member_id, role:me.role,
                  h:me.h, my_name:me.my_name }, ...rest].slice(0,6);
  localStorage.setItem(ACCOUNTS, JSON.stringify(next));
}
function forgetDevice(){
  localStorage.removeItem(ACCOUNTS);
  localStorage.removeItem('amanah');
}
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
function show(id){ ['landing','login','invite','app'].forEach(v=>$('#view-'+v).classList.toggle('hide', v!==id)); }
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

function inviteCode(role){
  return b64.from(new TextEncoder().encode(
      JSON.stringify({ f: ME.family_id, h: ME.h, r: roleOf(role) })))
    .replace(/\+/g,'-').replace(/\//g,'_');
}
const loginLink = (code)=> location.origin + location.pathname + '#' + code;

// Accepts a bare code or a full login link, so pasting either works.
function decodeInvite(raw){
  try{
    const s = String(raw).trim().replace(/^.*#/,'').replace(/-/g,'+').replace(/_/g,'/');
    const p = JSON.parse(new TextDecoder().decode(b64.to(s)));
    return (p && p.f && p.h) ? p : null;
  }catch{ return null; }
}
function renderQR(el, code){
  el.innerHTML='';
  const qr = qrcode(0,'M'); qr.addData(code); qr.make();
  el.innerHTML = qr.createImgTag(4,8);
}
function showInvite(){
  const code = inviteCode('family');
  $('#invite-code').value = code;
  renderQR($('#qr'), loginLink(code));
  show('invite');
}
// Same code, reachable from inside the app so a family can grow after day one.
// H is already in memory for whoever is signed in, so no re-entry of the key.
function renderInviteTab(){
  const role = roleOf($('#inv-role').value);
  const code = inviteCode(role);
  $('#invite-code-app').value = code;
  renderQR($('#qr-app'), loginLink(code));   // scanning opens the login page
  $('#inv-can').innerHTML = ROLES[role].tabs
    .map(t=>`<span class="chip static">${TAB_LABEL[t]}</span>`).join('');
}

// ---- login ----
let pendingInvite = null;

// Mode A: people who have logged in on this device before.
function showAccounts(){
  const accts = loadAccounts();
  if(!accts.length) return show('landing');
  $('#login-title').textContent = 'Log in';
  $('#login-sub').textContent = 'Choose who you are on this device.';
  $('#login-accounts').classList.remove('hide');
  $('#login-invite').classList.add('hide');
  $('#btn-login-back').classList.add('hide');
  $('#account-list').innerHTML = accts.map((a,i)=>{
    const role = roleOf(a.role);
    return `<div class="card">
      <div class="card-head">
        <div class="who-id"><b>${esc(a.my_name)}</b>
          <span class="pill role-${role}">${ROLES[role].label}</span></div>
      </div>
      <p class="muted">Family ${esc(a.family_id)} · opens ${
        ROLES[role].tabs.map(t=>TAB_LABEL[t]).join(', ')}</p>
      <button data-acct="${i}">Log in as ${esc(a.my_name)}</button>
    </div>`;
  }).join('');
  $$('[data-acct]').forEach(b=>
    b.onclick = ()=>continueAs(accts[+b.dataset.acct]).catch(e=>toast(e.message)));
  show('login');
}

// Re-enter as a remembered member. The join call is idempotent and re-proves
// the key, so this also recovers if the database was reset underneath us.
async function continueAs(a){
  KEY = await importKeyRaw(a.h);
  const kc = await keyCheck(KEY);
  try{
    await api('/families/'+a.family_id+'/join', { method:'POST', body: JSON.stringify({
      key_check: kc, member:{ id:a.member_id, role:a.role } }) });
  }catch{ return toast('That family is no longer reachable'); }
  ME = { family_id:a.family_id, member_id:a.member_id, role:a.role,
         h:a.h, my_name:a.my_name };
  save(); rememberAccount(ME);
  enterApp();
}

// Mode B: an invite code (pasted, or in the # fragment) opens the login page.
function showLogin(p){
  $('#login-accounts').classList.add('hide');
  $('#login-invite').classList.remove('hide');
  $('#btn-login-back').classList.remove('hide');
  $('#login-title').textContent = 'Log in';
  $('#login-sub').textContent = 'You have been invited to a family on this device.';
  pendingInvite = p;
  const role = roleOf(p.r);
  $('#login-family').textContent = p.f;
  $('#login-role-pill').textContent = ROLES[role].label;
  $('#login-role-pill').className = 'pill role-' + role;
  $('#login-role-name').textContent = ROLES[role].label;
  $('#login-role-note').textContent = ROLES[role].note;
  $('#login-can').innerHTML = ROLES[role].tabs
    .map(t=>`<span class="chip static">${TAB_LABEL[t]}</span>`).join('');
  $('#l-name').value = p.n || '';
  show('login');
  $('#l-name').focus();
}

// Step 2: prove possession of H to the server, then enter with the invited role.
async function doLogin(){
  const p = pendingInvite; if(!p) return;
  const role = roleOf(p.r);
  const pinned = !!p.m;                       // seed codes pin an existing member
  const name = ($('#l-name').value.trim() || p.n || '').trim();
  if(!name) return toast('Enter your name');
  const member_id = pinned ? p.m : uuid();
  KEY = await importKeyRaw(p.h);
  const kc = await keyCheck(KEY);
  try{
    await api('/families/'+p.f+'/join', { method:'POST', body: JSON.stringify({
      key_check: kc, member:{ id:member_id, role } }) });
  }catch{ return toast('Login failed: wrong key, or no such family'); }
  ME = { family_id:p.f, member_id, role, h:p.h, my_name:name };
  if(!pinned) await postEncEvent('MemberJoined', { name }, { actor_id: member_id });
  save(); rememberAccount(ME);
  // Keep H out of the address bar and out of history once we are in.
  history.replaceState(null, '', location.pathname);
  pendingInvite = null;
  enterApp();
}

function logout(){
  if(pollTimer) clearInterval(pollTimer);
  rememberAccount(ME);              // so the login page can offer a way back
  localStorage.removeItem('amanah');
  ME = null; KEY = null;
  history.replaceState(null, '', location.pathname);
  location.reload();
}

// encrypt a payload then post with clear routing fields
async function postEncEvent(type, payloadObj, clear={}){
  const { iv, cipher } = await encryptJSON(KEY, payloadObj);
  pendingPlain = payloadObj;
  return postEvent({ family_id: ME.family_id, type, iv, payload_cipher: cipher, key_version:1, ...clear });
}

// ---- app boot ----
function applyRole(){
  const cfg = ROLES[roleOf(ME.role)];
  $$('.tabs button').forEach(b=>
    b.classList.toggle('hide', !cfg.tabs.includes(b.dataset.tab)));
  $('#who-name').textContent = ME.my_name;
  $('#who-role').textContent = cfg.label;
  $('#who-role').className = 'pill role-' + roleOf(ME.role);
  return cfg;
}

async function enterApp(){
  show('app');
  const cfg = applyRole();
  tab(cfg.tabs[0]);
  buildChipsets();
  await loadNames();
  await renderStrip();
  await renderCareLog();
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
  toast('Logged'); await renderCareLog();
}
async function careSince(since){
  const rows = await api(`/families/${ME.family_id}/care?since=${encodeURIComponent(since||'1970-01-01')}`);
  const out=[];
  for(const r of rows){ const p = await decryptJSON(KEY, r.iv, r.payload_cipher);
    out.push({ ...r, text: p?.text ?? '🔒 locked' }); }
  return out;
}
const DAY_MS = 86400000;
const LOG_DAYS = 30;                      // how far back the grouped log reaches

const dayKey = (d)=>{ const x = new Date(d); x.setHours(0,0,0,0); return x.getTime(); };

function dayLabel(ts){
  const today = dayKey(Date.now());
  if(ts === today) return 'Today';
  if(ts === today - DAY_MS) return 'Yesterday';
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, d.getFullYear() === new Date().getFullYear()
    ? { weekday:'short', day:'numeric', month:'short' }
    : { weekday:'short', day:'numeric', month:'short', year:'numeric' });
}

// One section per day, newest day first, newest entry first inside each day.
async function renderCareLog(){
  const from = new Date(Date.now() - (LOG_DAYS-1)*DAY_MS); from.setHours(0,0,0,0);
  const items = await careSince(from.toISOString());
  const box = $('#care-log');
  $('#log-count').textContent = items.length;
  if(!items.length){ box.innerHTML = '<p class="muted">Nothing logged yet.</p>'; return; }

  const byDay = new Map();
  for(const i of items){
    const k = dayKey(i.occurred_at);
    if(!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(i);
  }

  box.innerHTML = [...byDay.keys()].sort((a,b)=>b-a).map(k=>{
    const rows = byDay.get(k).slice().reverse();
    return `<section class="day">
      <div class="day-head">
        <span class="day-name">${dayLabel(k)}</span>
        <span class="day-count tnum">${rows.length} ${rows.length===1?'entry':'entries'}</span>
      </div>
      ${rows.map(i=>`<div class="item">
        <div class="top"><b>${esc(i.text)}</b><span class="pill">${esc(i.category)}</span></div>
        <div class="muted">${esc(nameOf(i.actor_id))} · ${new Date(i.occurred_at).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'})}</div>
      </div>`).join('')}
    </section>`;
  }).join('');
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
// One missing element used to throw here and silently skip every handler after
// it, so a stale cached build could render a button that did nothing.
function on(sel, fn){
  const el = $(sel);
  if(!el) return console.warn('[amanah] no element for', sel);
  el.onclick = fn;
}

on('#btn-create',     ()=>createFamily().catch(e=>toast(e.message)));
on('#btn-join',       ()=>{
  const p = decodeInvite($('#j-code').value);
  p ? showLogin(p) : toast('That code is not readable');
});
on('#btn-login',      ()=>doLogin().catch(e=>toast(e.message)));
on('#btn-login-back', ()=>{ pendingInvite=null;
  loadAccounts().length ? showAccounts() : show('landing'); });
on('#btn-use-code',   ()=>show('landing'));
on('#btn-forget',     ()=>{ forgetDevice(); location.reload(); });
on('#btn-logout',     ()=>logout());
on('#btn-enter',      ()=>enterApp());
on('#btn-copy',       ()=>{ navigator.clipboard?.writeText($('#invite-code').value); toast('Copied'); });
on('#btn-copy-app',   ()=>{ navigator.clipboard?.writeText($('#invite-code-app').value); toast('Copied'); });
on('#btn-log',        ()=>logItem().catch(e=>toast(e.message)));
on('#btn-handoff',    ()=>openHandoff().catch(e=>toast(e.message)));
on('#btn-prefs',      ()=>savePrefs().catch(e=>toast(e.message)));
on('#btn-proof',      ()=>refreshProof().catch(e=>toast(e.message)));
$('#inv-role')?.addEventListener('change', ()=>renderInviteTab());
$$('.tabs button').forEach(b=>b.onclick=()=>tab(b.dataset.tab));

// resume session if present
loadSession().then(ok=>{
  if(ok) return enterApp();
  const p = location.hash.length > 1 && decodeInvite(location.hash);
  if(p) return showLogin(p);              // an invite always wins
  if(loadAccounts().length) return showAccounts();
  show('landing');
});
