// Amanah Care web app. Vanilla ES module. All plaintext stays in this browser.
// The Home dashboard, the routine and the record are all computed here, on the
// phone, from decrypted events. The server only ever sorts ciphertext.
import { makeKey, exportKeyRaw, importKeyRaw, keyCheck, encryptJSON, decryptJSON as decryptReal, b64, wrapKey, unwrapKey }
  from './crypto.js';
import { COLUMNS, DEFAULT_CARDS, BLOCK_REASONS, boardFor, counts, iconFor, blockedText } from './board.js';

// Server view: one tap shows this screen the way the server sees it. Nothing is
// decrypted, names become ids, text becomes the stored ciphertext. Same data.
let SERVER_VIEW = false;
const decryptJSON = (k, iv, c) => SERVER_VIEW ? Promise.resolve(null) : decryptReal(k, iv, c);
const sealed = (cipher) => cipher ? `🔒 ${String(cipher).slice(0, 22)}…` : '🔒 (no payload)';

const API = (window.AMANAH_API || `http://${location.hostname}:4000`);
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

let KEY = null;                 // CryptoKey H, memory only
let ME = null;                  // { family_id, member_id, role, h, my_name }
let lastHandoffAt = null;       // to auto-compose summary from care since last handoff
const nameCache = {};           // member_id -> decrypted name (from MemberJoined events)
let ELDER = 'Elder';            // decrypted from FamilyCreated
let FAMILY = '';                // family name, decrypted from FamilyCreated
let ROUTINE = [];               // decrypted RoutineSet items: {id,category,label,time,days,who}
let routineDirty = false;
let WEEK = [];                  // decrypted CareLogged rows, last 7 days
let HANDOFFS = [];              // handoff read-model rows for the family
let MEMBERS = [];               // {id, role}
let PREFS = null;               // decrypted PreferenceSet

// Categories and their presets. Pick several presets at once; each becomes its
// own event, so counts and patterns stay exact. The note applies to all of them.
const CATS = [
  ['meds',          ['meds given','meds skipped','meds refused','meds given late','pharmacy called']],
  ['meal',          ['ate full','ate half','ate a little','refused food','snack','drank water','drank tea','no appetite']],
  ['prayer',        ['Fajr prayed','Dhuhr prayed','Asr prayed','Maghrib prayed','Isha prayed','prayed sitting','helped with wudu','missed a prayer']],
  ['mobility',      ['walked','walked with support','physio done','went outside','stairs done','rested','stayed in bed','slipped or fell']],
  ['mood',          ['calm','cheerful','tired','agitated','confused','sad','anxious','complained of pain']],
  ['sleep',         ['slept well','slept badly','nap taken','up at night','woke early']],
  ['personal care', ['bath done','dressed','toileting help','hair and nails','changed bedding','skin checked']],
  ['readings',      ['blood pressure','blood sugar','weight','temperature']],
  ['appointment',   ['doctor','pharmacy','clinic','blood test','physio visit','dentist','eye exam','rebooked']],
  ['transport',     ['drop-off done','pickup done','pickup needed','taxi booked','drove her']],
  ['note',          ['note','phone call','visitor came','for the next caregiver']],
];
const NOTE_HINT = { readings:'the number, e.g. 128/82, 6.4, 62 kg', meds:'e.g. with breakfast', meal:'e.g. half the rice, all the soup',
  mood:'e.g. after the visitors left', mobility:'e.g. to the mailbox and back', note:'anything the next person should know' };
const DAYS = ['sun','mon','tue','wed','thu','fri','sat'];
const DAY_LABEL = { daily:'every day', weekdays:'weekdays', mon:'Mon', tue:'Tue', wed:'Wed', thu:'Thu', fri:'Fri', sat:'Sat', sun:'Sun' };

let pick = { category: null, presets: new Set() };

const esc = (v)=>String(v ?? '').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fmtTime = (iso)=>new Date(iso).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'});
// time if today, otherwise weekday + time, so a stale handoff never reads as fresh
const fmtWhen = (iso)=>{ const d=new Date(iso); return d.toDateString()===new Date().toDateString() ? fmtTime(iso)
  : d.toLocaleString([], {weekday:'short', hour:'2-digit', minute:'2-digit'}); };
const cap = (s)=>{ s=String(s||''); return s.charAt(0).toUpperCase()+s.slice(1); };

function toast(msg){ const t=document.createElement('div'); t.className='toast'; t.textContent=msg;
  document.body.appendChild(t); setTimeout(()=>t.remove(),1800); }
// A toast with one action, for the moment right after a mistake.
function toastAction(msg, label, fn, ms=8000){
  const t=document.createElement('div'); t.className='toast action';
  t.innerHTML = `<span>${esc(msg)}</span><button type="button">${esc(label)}</button>`;
  t.querySelector('button').onclick = async ()=>{ t.remove(); try{ await fn(); }catch(e){ toast(e.message); } };
  document.body.appendChild(t); setTimeout(()=>t.remove(), ms);
}

// One browser tab is one phone: the session lives in sessionStorage, so three
// tabs on the same origin can be three family members. Survives reload, not close.
function save(){ sessionStorage.setItem('amanah', JSON.stringify(ME)); }
async function loadSession(){
  localStorage.removeItem('amanah');  // older builds kept it here; never share it across tabs
  const raw = sessionStorage.getItem('amanah'); if(!raw) return false;
  ME = JSON.parse(raw); KEY = await importKeyRaw(ME.h); return true;
}
const isElder = ()=> ME?.role === 'elder';

// Wipe every trace of this session from this tab and drop back to the landing card.
function logout(){
  document.body.classList.remove('support');
  $('#emg-banner').classList.add('hide');
  if(SERVER_VIEW){ SERVER_VIEW=false; document.body.classList.remove('serverview'); $('#sv-banner').classList.add('hide'); $('#btn-serverview').textContent='Server view'; }
  stopLive();
  clearInterval(pollTimer); pollTimer = null;
  sessionStorage.removeItem('amanah');
  KEY = null; ME = null;
  for(const k of Object.keys(nameCache)) delete nameCache[k];
  ELDER = 'Elder'; FAMILY=''; { const fn=$('#fam-name'); if(fn) fn.textContent='—'; }
  ROUTINE = []; routineDirty = false;
  WEEK = []; HANDOFFS = []; MEMBERS = []; PREFS = null;
  lastHandoffAt = null; homeSig = null; inboxSig = null; lastTrace = null;
  document.body.classList.remove('elder');
  const ORIG_TABS = { home:'Home', record:'Record', prefs:'Prefs' };  // undo ELDER_TABS renames
  $$('.tabs button').forEach(b=>{
    b.classList.remove('hide');
    if(ORIG_TABS[b.dataset.tab]) b.firstChild.nodeValue = ORIG_TABS[b.dataset.tab];
  });
  $('#l-login').value = ''; $('#l-pass').value = '333';
  document.title = 'Amanah Care';
  show('landing');
  toast('Logged out');
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
function show(id){ ['landing','setlogin','invite','app','sheet'].forEach(v=>$('#view-'+v).classList.toggle('hide', v!==id)); }
function tab(name){
  $$('.tabs button').forEach(b=>b.classList.toggle('on', b.dataset.tab===name));
  $$('.tabview').forEach(v=>v.classList.add('hide'));
  $('#tab-'+name).classList.remove('hide');
  if(name==='home' || name==='patterns') refreshHome(true);
  if(name==='log') renderCareToday();
  if(name==='handoff') buildHandoff();
  if(name==='inbox') refreshInbox();
  if(name==='routine') renderRoutine();
  if(name==='record') renderRecord();
  if(name==='invite') renderInviteTab();
  if(name==='flow') renderFlow();
  if(tabHooks[name]) runHooks(tabHooks[name]);
}

// ---- create / join ----
async function createFamily(){
  const elder = $('#c-elder').value.trim() || 'Elder';
  const familyName = $('#c-family').value.trim() || `${elder}'s family`;
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
  await postEncEvent('FamilyCreated', { elder_name: elder, family_name: familyName }, { actor_id: member_id });
  await postEncEvent('RoutineSet', { items: DEFAULT_CARDS.map(({ icon, ...it }) => it) }, { actor_id: member_id });
  save();
  afterLogin = 'invite'; showSetLogin();
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
  afterLogin = 'app'; showSetLogin();
}

// ---- login: code once, then email/login + password ----
let afterLogin = 'app';           // where to go once the login is saved or skipped
function showSetLogin(){ $('#s-login').value = ME.login || ''; $('#s-pass').value = '333'; show('setlogin'); }
function afterSetLogin(){ if(afterLogin==='invite') showInvite(); else enterApp(); }
async function saveLogin(){
  const login = $('#s-login').value.trim(); const password = $('#s-pass').value;
  if(!login) return toast('Choose an email or a login');
  if(!password) return toast('Choose a password');
  const wrapped = await wrapKey(ME.h, password);          // H locked with the password, on this phone
  const kc = await keyCheck(KEY);
  try{
    const r = await api('/auth/register', { method:'POST', body: JSON.stringify({
      family_id: ME.family_id, member_id: ME.member_id, key_check: kc, login, password, ...wrapped }) });
    ME.login = r.login; save();
  }catch(e){ return toast(e.message.startsWith('409') ? 'That login is taken' : 'Could not save the login'); }
  toast('Login saved'); afterSetLogin();
}
async function loginWithPassword(){
  const login = $('#l-login').value.trim(); const password = $('#l-pass').value;
  if(!login || !password) return toast('Login and password, please');
  let r;
  try{ r = await api('/auth/login', { method:'POST', body: JSON.stringify({ login, password }) }); }
  catch{ return toast('Wrong login or password'); }
  // One login may open several families (a support worker). Unwrap each family key
  // with the password, name each family from its own encrypted record, then pick.
  const fams = Array.isArray(r.families) && r.families.length ? r.families : [r];
  const unlocked = [];
  for(const f of fams){ const h = await unwrapKey(f, password); if(h) unlocked.push({ family_id:f.family_id, member_id:f.member_id, role:f.role, h, name:'' }); }
  if(!unlocked.length) return toast('Could not unlock the family key');
  for(const f of unlocked){
    try{ const k = await importKeyRaw(f.h);
      for(const e of await api(`/families/${f.family_id}/events?type=FamilyCreated`)){ const p = await decryptReal(k, e.iv, e.payload_cipher);
        if(p?.family_name) f.name = p.family_name; else if(p?.elder_name) f.name = `${p.elder_name}'s family`; } }catch{}
    if(!f.name) f.name = `family ${f.family_id}`;
  }
  if(unlocked.length === 1) return enterFamily(unlocked[0], login, unlocked);
  showFamilyPicker(unlocked, login);
}
async function enterFamily(f, login, families){
  KEY = await importKeyRaw(f.h);
  ME = { family_id: f.family_id, member_id: f.member_id, role: f.role, h: f.h, my_name: '', login, families };
  await loadNames();
  ME.my_name = nameCache[ME.member_id] || login;
  save(); enterApp();
}
function showFamilyPicker(families, login){
  const box = $('#fam-pick'), list = $('#fam-pick-list'); list.innerHTML='';
  for(const f of families){ const b=document.createElement('button'); b.type='button'; b.className='ghost';
    b.textContent = `${f.name} · ${f.role==='support' ? 'support worker' : f.role}`;
    b.onclick = ()=>{ box.classList.add('hide'); enterFamily(f, login, families).catch(e=>toast(e.message)); };
    list.appendChild(b); }
  box.classList.remove('hide'); show('landing'); box.scrollIntoView({ block:'center' });
}
// Leave the current family without forgetting the others: same reset as logout, keys kept.
function switchFamily(){
  const families = ME?.families || [], login = ME?.login || '';
  if(families.length < 2) return;
  if(pollTimer){ clearInterval(pollTimer); pollTimer=null; }
  stopLive();
  for(const k of Object.keys(nameCache)) delete nameCache[k];
  KEY=null; ME=null; ELDER='Elder'; FAMILY=''; ROUTINE=[]; routineDirty=false; WEEK=[]; HANDOFFS=[]; MEMBERS=[]; PREFS=null;
  lastHandoffAt=null; homeSig=null; inboxSig=null; lastTrace=null; LOG_ITEMS=[]; lastLogCount=-1;
  document.body.classList.remove('elder','support','serverview'); SERVER_VIEW=false;
  $('#sv-banner').classList.add('hide'); $('#emg-banner').classList.add('hide'); $('#btn-serverview').textContent='Server view';
  showFamilyPicker(families, login);
}

// encrypt a payload then post with clear routing fields
async function postEncEvent(type, payloadObj, clear={}){
  const { iv, cipher } = await encryptJSON(KEY, payloadObj);
  pendingPlain = payloadObj;
  return postEvent({ family_id: ME.family_id, type, iv, payload_cipher: cipher, key_version:1, ...clear });
}

// ---- app boot ----
// Show who is signed in on THIS window (tabs otherwise look identical).
function renderWhoAmI(){
  if(!ME) return;
  const name = SERVER_VIEW ? 'member ' + ME.member_id.slice(0,6) : (ME.my_name || 'Me');
  const role = ME.role || '';
  const el = document.getElementById('who-name'); if(el) el.textContent = name;
  const rl = document.getElementById('who-role'); if(rl) rl.textContent = role==='support' ? 'support worker' : role;
  const dot = document.getElementById('who-dot');
  let hsh=0; for(const c of name) hsh=(hsh*31 + c.charCodeAt(0))>>>0;
  if(dot) dot.style.background = `hsl(${hsh % 360} 60% 45%)`;
  document.title = `${name} · Amanah Care`;
  const sw = $('#btn-switch'); if(sw) sw.classList.toggle('hide', !(ME.families && ME.families.length > 1));
}
// The elder gets a different app: Today, My week, My preferences, Invite. Big type, read-only.
const ELDER_TABS = { home:'Today', record:'My week', prefs:'My preferences', invite:'Invite' };
const SUPPORT_HIDE = new Set(['invite']);   // a support worker never invites into the family
function setTabsForRole(){
  document.body.classList.toggle('elder', isElder());
  document.body.classList.toggle('support', ME?.role==='support');
  $$('.tabs button').forEach(b=>{
    const t=b.dataset.tab;
    if(isElder()){ b.classList.toggle('hide', !(t in ELDER_TABS)); if(ELDER_TABS[t]) b.firstChild.nodeValue = ELDER_TABS[t]; }
    else b.classList.toggle('hide', ME?.role==='support' && SUPPORT_HIDE.has(t));
  });
}
async function enterApp(){
  show('app'); renderWhoAmI(); setTabsForRole();
  buildChipsets(); buildRoutineForm();
  await loadMembers();
  await loadNames();
  await loadElder();
  await renderStrip();
  await loadRoutine();
  await loadWeek();
  tab('home');
  startPolling();
  startLive();
  await runHooks(enterHooks);
}

// ---- members / names ----
async function loadMembers(){ MEMBERS = await api(`/families/${ME.family_id}/members`).catch(()=>[]); }
async function fetchEventsByType(type){
  return api(`/families/${ME.family_id}/events?type=${encodeURIComponent(type)}`).catch(()=>[]);
}
async function loadNames(){
  // Names live encrypted in MemberJoined events. Decrypt them once into a cache.
  const evs = await fetchEventsByType('MemberJoined');
  for(const e of evs){ const p = await decryptJSON(KEY, e.iv, e.payload_cipher); if(p?.name) nameCache[e.actor_id]=p.name; }
}
async function loadElder(){
  const evs = await fetchEventsByType('FamilyCreated');
  for(const e of evs){ const p = await decryptJSON(KEY, e.iv, e.payload_cipher);
    if(p?.elder_name) ELDER=p.elder_name; if(p?.family_name) FAMILY=p.family_name; }
  if(!FAMILY) FAMILY = SERVER_VIEW ? `family ${ME.family_id}` : `${ELDER}'s family`;
  if(SERVER_VIEW) ELDER = `elder of ${ME.family_id}`;
  $('#fam-name').textContent = FAMILY;
  document.title = `${SERVER_VIEW ? 'server view' : (ME.my_name || 'Me')} · ${FAMILY}`;
  $('#routine-title').textContent = `${ELDER}'s routine`;
  $('#record-title').textContent = `${ELDER}'s record`;
}
function nameOf(id){ if(!id) return 'anyone'; if(SERVER_VIEW) return 'member ' + id.slice(0,6); return nameCache[id] || (id===ME.member_id ? ME.my_name : id.slice(0,6)); }

// ---- preference strip ----
async function renderStrip(){
  const pref = await api(`/families/${ME.family_id}/preferences`).catch(()=>null);
  if(!pref){ $('#strip').classList.add('hide'); return; }
  const p = await decryptJSON(KEY, pref.iv, pref.payload_cipher);
  if(!p){ $('#strip').classList.add('hide'); return; }
  PREFS = p;
  $('#p-lang').value = p.lang||''; $('#p-diet').value = p.diet||'';
  $('#p-prayer').value = p.prayer||''; $('#p-modesty').value = p.modesty||'';
  $('#p-conditions').value = p.conditions||''; $('#p-allergies').value = p.allergies||'';
  $('#p-doctor').value = p.doctor||''; $('#p-contacts').value = p.contacts||'';
  $('#p-fasting').value = p.fasting||''; $('#p-carecontact').value = p.care_contact||'';
  const bits = [['Language',p.lang],['Diet',p.diet],['Prayer',p.prayer],['Modesty',p.modesty]]
    .filter(([,v])=>v);
  $('#strip').innerHTML = bits.map(([k,v])=>
    `<span class="sbit"><i>${k}</i><b>${esc(v)}</b></span>`).join('');
  $('#strip').classList.remove('hide');
}

// ---- care data (decrypted, cached for the week) ----
// Retracted items are dropped unless `all` is set (the log and record show them struck through).
async function careSince(since, all=false){
  const rows = await api(`/families/${ME.family_id}/care?since=${encodeURIComponent(since||'1970-01-01')}`);
  const out=[];
  for(const r of rows){ if(r.retracted && !all) continue;
    const p = await decryptJSON(KEY, r.iv, r.payload_cipher);
    out.push({ ...r, blocked: r.type === 'CareBlocked', reason: p?.reason || null,
      text: p?.text ?? (SERVER_VIEW ? sealed(r.payload_cipher) : '🔒 locked'), routine_id: p?.routine_id || null }); }
  return out;
}
async function loadWeek(){
  const since = new Date(Date.now()-6*86400e3); since.setHours(0,0,0,0);
  WEEK = await careSince(since.toISOString()).catch(()=>WEEK);
}
function midnight(){ const m=new Date(); m.setHours(0,0,0,0); return m; }
function todayItems(){ const m=midnight(); return WEEK.filter(c=>new Date(c.occurred_at)>=m); }

// ---- routine (the plan) ----
const hm = (t)=>{ const [h,m]=String(t||'0:0').split(':').map(Number); return (h||0)*60+(m||0); };
const nowMin = ()=>{ const d=new Date(); return d.getHours()*60+d.getMinutes(); };
function isOnDay(item, d=new Date()){
  const ds = item.days; const day = DAYS[d.getDay()];
  if(!ds || ds==='daily') return true;
  if(ds==='weekdays') return d.getDay()>=1 && d.getDay()<=5;
  return Array.isArray(ds) ? ds.includes(day) : ds===day;
}
function planFor(d=new Date()){ return ROUTINE.filter(i=>isOnDay(i,d)).sort((a,b)=>hm(a.time)-hm(b.time)); }
// A routine item is done today if something was logged against it (routine_id),
// or a same-category log starts with its label (logged from the Log tab).
function doneFor(item, items){
  return items.find(c => !c.blocked && (c.routine_id===item.id ||
    (c.category===item.category && item.label && String(c.text).toLowerCase().startsWith(item.label.toLowerCase()))));
}
function planRows(){
  const today = todayItems(); const nm = nowMin();
  return planFor().map(it=>{ const d=doneFor(it,today); const t=hm(it.time);
    const st = d ? 'done' : (t<=nm ? (nm-t>60 ? 'overdue' : 'due') : 'later');
    return { it, d, st }; });
}
async function loadRoutine(){
  const ev = await api(`/families/${ME.family_id}/routine`).catch(()=>null);
  const p = ev ? await decryptJSON(KEY, ev.iv, ev.payload_cipher) : null;
  if(!routineDirty) ROUTINE = Array.isArray(p?.items) ? p.items : [];
  return ev?.id || null;
}
async function saveRoutine(){
  await postEncEvent('RoutineSet', { items: ROUTINE }, { actor_id: ME.member_id });
  routineDirty=false; $('#routine-dirty').classList.add('hide');
  toast('Routine saved'); renderRoutine();
}
function buildRoutineForm(){
  const cat=$('#r-cat'); cat.innerHTML='';
  for(const [c] of CATS){ const o=document.createElement('option'); o.value=c; o.textContent=c; cat.appendChild(o); }
}
function renderRoutine(){
  const who=$('#r-who'); const cur=who.value; who.innerHTML='<option value="">Anyone</option>';
  for(const m of MEMBERS){ const o=document.createElement('option'); o.value=m.id; o.textContent=`${nameOf(m.id)} (${m.role})`; who.appendChild(o); }
  who.value=cur;
  const box=$('#routine-list');
  const items=[...ROUTINE].sort((a,b)=>hm(a.time)-hm(b.time));
  if(!items.length){ box.innerHTML=`<p class="muted">No routine yet. Add ${esc(ELDER)}'s meds, meals, prayers, walks and pickups below.</p>`; return; }
  box.innerHTML = items.map(it=>`<div class="r-item">
      <div class="rt">${esc(it.time)}</div>
      <div class="rb"><b>${esc(it.label)}</b><span>${esc(it.category)} · ${esc(DAY_LABEL[it.days]||(Array.isArray(it.days)?it.days.join(', '):it.days))} · ${esc(nameOf(it.who))}</span></div>
      <button data-rm="${esc(it.id)}" title="Remove">×</button>
    </div>`).join('');
  $$('[data-rm]').forEach(b=>b.onclick=()=>{ ROUTINE=ROUTINE.filter(i=>i.id!==b.dataset.rm); markDirty(); renderRoutine(); });
}
function markDirty(){ routineDirty=true; $('#routine-dirty').classList.remove('hide'); }
function addRoutineItem(){
  const label=$('#r-label').value.trim(); if(!label) return toast('Say what it is');
  ROUTINE.push({ id: uuid().slice(0,8), category: $('#r-cat').value, label,
    time: $('#r-time').value || '08:00', days: $('#r-days').value, who: $('#r-who').value });
  $('#r-label').value=''; markDirty(); renderRoutine();
}
// Tap "Done" on the plan: logs a CareLogged tied to the routine item.
async function logRoutineItem(id){
  const it = ROUTINE.find(i=>i.id===id); if(!it) return;
  await postEncEvent('CareLogged', { text: it.label, routine_id: it.id }, { actor_id: ME.member_id, category: it.category });
  toast(`Logged: ${it.label}`);
  await refreshHome(true);
}

// ---- HOME dashboard ----
let homeSig = null;
async function refreshHome(force){
  if(!force && $('#tab-home').classList.contains('hide') && $('#tab-patterns').classList.contains('hide')) return;
  await loadWeek();
  await loadLog();                                   // patterns count over the record, not just the week
  HANDOFFS = await api(`/families/${ME.family_id}/handoffs`).catch(()=>HANDOFFS);
  await loadRoutine();
  const sig = [WEEK.length, WEEK.at(-1)?.id, HANDOFFS.map(h=>h.id+h.status).join(','), JSON.stringify(ROUTINE), Math.floor(nowMin()/5)].join('|');
  if(sig===homeSig && !force) return;
  homeSig = sig;
  renderHome();
  renderWorkload();
  runHooks(homeHooks);
}
function nextOf(cat, rows){
  const nm=nowMin();
  const t = rows.find(r=>r.it.category===cat && !r.d && hm(r.it.time)>=nm-60);
  if(t) return { label:t.it.label, when:`today ${t.it.time}`, who:t.it.who };
  for(let k=1;k<=7;k++){
    const d=new Date(Date.now()+k*86400e3);
    const f=planFor(d).find(i=>i.category===cat);
    if(f) return { label:f.label, when:`${d.toLocaleDateString([], {weekday:'short'})} ${f.time}`, who:f.who };
  }
  return null;
}
function renderHome(){
  if(isElder()) return renderElderHome();
  const today = todayItems();
  const rows = planRows();
  const board = boardFor(planFor(), WEEK);
  const c = counts(board);
  const open = HANDOFFS.filter(h=>h.status==='open').sort((a,b)=>new Date(b.opened_at)-new Date(a.opened_at));
  const acked = HANDOFFS.filter(h=>h.status==='acknowledged').sort((a,b)=>new Date(b.acked_at)-new Date(a.acked_at))[0];
  const last = today.at(-1);

  // who has the elder right now, from the handoff chain
  let duty, wait=false;
  if(acked && (!last || new Date(acked.acked_at) > new Date(last.occurred_at) || acked.to_id===last.actor_id))
    duty = `<b>${esc(nameOf(acked.to_id))}</b> has ${esc(ELDER)} since ${fmtWhen(acked.acked_at)}`;
  else if(last) duty = `<b>${esc(nameOf(last.actor_id))}</b> moved a card last, ${fmtWhen(last.occurred_at)}`;
  else duty = `No card moved for ${esc(ELDER)} yet today`;
  if(open.length){ wait=true; duty += ` · handoff ${esc(nameOf(open[0].from_id))} → <b>${esc(nameOf(open[0].to_id))}</b> waiting`; }

  const myWaiting = open.filter(h=>h.to_id===ME.member_id).length;
  const badge=$('#inbox-badge'); badge.textContent=myWaiting; badge.classList.toggle('hide', !myWaiting);

  // the week in one line: items done, who carried it
  const weekDone = WEEK.filter(x=>!x.blocked);
  const byActor = {}; for(const x of weekDone) byActor[x.actor_id]=(byActor[x.actor_id]||0)+1;
  const top = Object.entries(byActor).sort((a,b)=>b[1]-a[1])[0];
  const share = top && weekDone.length ? Math.round(top[1]/weekDone.length*100) : 0;

  const EMPTY = { todo: c.done+c.blocked===board.length && board.length ? 'Everything decided for today.' : 'Nothing left here.',
                  done: 'Nothing done yet. Move a card here when it is.', blocked: 'Nothing blocked today.' };
  const cols = COLUMNS.map(([key,lab])=>`<section class="col ${key}" data-col="${key}">
      <header><h2>${lab}</h2><span class="count tnum">${c[key]}</span></header>
      <div class="cards">${board.filter(b=>b.state===key).map(cardHtml).join('') || `<p class="empty">${EMPTY[key]}</p>`}</div>
    </section>`).join('');

  $('#home').innerHTML = `
    <div class="hero compact">
      <div class="hero-row">
        <div>
          <div class="date">${new Date().toLocaleDateString([], {weekday:'long', month:'long', day:'numeric'})}</div>
          <h1>${ME.role==='support' ? `Your shift with ${esc(ELDER)}` : `${esc(ELDER)}'s day`}</h1>
        </div>
        <div class="hero-actions"><button class="emg-btn" data-emg type="button">Emergency</button><button class="ghost" data-sheet type="button">Hospital sheet</button></div>
      </div>
      <div class="duty ${wait?'wait':''}"><span class="dd"></span><span>${duty}</span></div>
      <div class="progress"><div class="top"><span>Today</span><b class="tnum">${c.done} of ${board.length} done${c.blocked?` · ${c.blocked} blocked`:''}</b></div>
        <div class="bar"><span style="width:${board.length?Math.round(c.done/board.length*100):0}%"></span></div></div>
    </div>
    ${board.length ? `<div class="board">${cols}</div>` : `<div class="card"><p class="muted">${SERVER_VIEW ? 'The cards are inside the encrypted routine. The server cannot show them.' : `No cards yet. Set ${esc(ELDER)}'s five cards in the Routine tab.`}</p></div>`}
    <div class="board-foot">
      <span><b class="tnum">${c.done}/${board.length}</b> done today</span>
      <span><b class="tnum">${c.blocked}</b> blocked</span>
      <span><b class="tnum">${weekDone.length}</b> done in 7 days</span>
      <span>${top ? `<b>${esc(nameOf(top[0]))}</b> carried ${share}%` : 'nobody carried the week yet'}</span>
      <a href="#" data-gopatterns>Patterns and recommendations →</a>
    </div>`;
  wireBoard();
  wireEmergencyButtons();
  $('#home').querySelector('[data-gopatterns]').onclick = (e)=>{ e.preventDefault(); tab('patterns'); };
  renderPatternsTab(rows, today, weekDone);
}

// One card on the board. Meta line: who and when (Done), the reason (Blocked), the target time (To do).
function cardHtml({card, state, ev}){
  const meta = state==='done' ? `✓ ${esc(nameOf(ev.actor_id))} · ${fmtTime(ev.occurred_at)}`
    : state==='blocked' ? `${esc(cap(ev.reason || ev.text))} · ${esc(nameOf(ev.actor_id))} ${fmtTime(ev.occurred_at)}`
    : `${card.who ? `${esc(nameOf(card.who))} · ` : ''}by ${esc(card.time)}`;
  const acts = state==='todo'
    ? `<button data-move="done" data-card="${esc(card.id)}" type="button">Done</button><button class="ghost" data-move="blocked" data-card="${esc(card.id)}" type="button">Blocked</button>`
    : `<button class="ghost" data-move="todo" data-card="${esc(card.id)}" type="button" title="Back to To do">↩ To do</button>`;
  return `<article class="kcard ${state}" draggable="true" data-card="${esc(card.id)}">
      <div class="k-top"><span class="k-icon">${iconFor(card)}</span><b>${esc(card.label)}</b><span class="k-time tnum">${esc(card.time)}</span></div>
      <div class="k-meta">${meta}</div>
      <div class="k-acts">${acts}</div>
    </article>`;
}

// Drag on desktop, buttons everywhere. The card jumps first, the events follow.
function wireBoard(){
  const home = $('#home');
  home.querySelectorAll('[data-move]').forEach(b=>b.onclick=()=>moveCard(b.dataset.card, b.dataset.move).catch(e=>{ toast(e.message); refreshHome(true); }));
  home.querySelectorAll('.kcard').forEach(k=>{
    k.addEventListener('dragstart', (e)=>{ e.dataTransfer.setData('text/plain', k.dataset.card); e.dataTransfer.effectAllowed='move'; k.classList.add('dragging'); });
    k.addEventListener('dragend', ()=>k.classList.remove('dragging'));
  });
  home.querySelectorAll('.col').forEach(col=>{
    col.addEventListener('dragover', (e)=>{ e.preventDefault(); e.dataTransfer.dropEffect='move'; col.classList.add('over'); });
    col.addEventListener('dragleave', ()=>col.classList.remove('over'));
    col.addEventListener('drop', (e)=>{ e.preventDefault(); col.classList.remove('over');
      const id = e.dataTransfer.getData('text/plain'); if(id) moveCard(id, col.dataset.col).catch(err=>{ toast(err.message); refreshHome(true); }); });
  });
}
function jumpCard(id, to){
  const k = $('#home').querySelector(`.kcard[data-card="${CSS.escape(id)}"]`); const col = $('#home').querySelector(`.col[data-col="${to}"] .cards`);
  if(!k || !col) return; col.querySelector('.empty')?.remove(); k.className = `kcard ${to} landed`; col.prepend(k);
}
// Move one card. Leaving Done or Blocked retracts the deciding event (the record keeps it,
// struck through); landing on Done is a CareLogged, on Blocked a CareBlocked with the reason.
let moving = false;
async function moveCard(id, to){
  if(moving) return; 
  const card = ROUTINE.find(i=>i.id===id); if(!card) return;
  const cur = boardFor([card], WEEK)[0];
  if(cur.state===to) return;
  let reason = null;
  if(to==='blocked'){ reason = await askReason(card); if(!reason) return; }
  moving = true;
  try{
    jumpCard(id, to);
    if(cur.ev) await postEvent({ family_id: ME.family_id, type:'CareRetracted', actor_id: ME.member_id, handoff_id: cur.ev.id, occurred_at: now(), id: uuid() });
    let r = null;
    if(to==='done') r = await postEncEvent('CareLogged', { text: card.label, routine_id: card.id }, { actor_id: ME.member_id, category: card.category });
    if(to==='blocked') r = await postEncEvent('CareBlocked', { text: blockedText(card, reason), reason, routine_id: card.id }, { actor_id: ME.member_id, category: card.category });
    if(navigator.vibrate) navigator.vibrate(30);
    if(r?.id) toastAction(`${card.label}: ${to==='done'?'done':`blocked, ${reason}`}`, 'Undo', async ()=>{ await retractCare(r.id, false); toast('Back to To do'); await refreshAll(); });
    else toast(`${card.label} back to To do`);
  } finally { moving = false; }
  await refreshHome(true);
}
// Why is it blocked? Four quick reasons or a few words. Resolves null when cancelled.
function askReason(card){
  return new Promise(res=>{
    const box=$('#blocksheet'); $('#bs-title').textContent = `${card.label}: why not?`;
    const chips=$('#bs-reasons'); chips.innerHTML='';
    const other=$('#bs-other'); other.value=''; other.classList.add('hide');
    let picked=null;
    for(const r of BLOCK_REASONS){ const b=document.createElement('button'); b.type='button'; b.className='chip'; b.textContent=r;
      b.onclick=()=>{ picked=r; chips.querySelectorAll('.chip').forEach(x=>x.classList.toggle('on', x===b));
        other.classList.toggle('hide', r!=='other'); if(r==='other') other.focus(); };
      chips.appendChild(b); }
    const done=(v)=>{ box.classList.add('hide'); $('#bs-ok').onclick=null; $('#bs-cancel').onclick=null; res(v); };
    $('#bs-ok').onclick=()=>{ if(!picked) return toast('Pick a reason'); const v = picked==='other' ? (other.value.trim() || 'other') : picked; done(v); };
    $('#bs-cancel').onclick=()=>done(null);
    box.classList.remove('hide');
  });
}

// ---- PATTERNS tab: counts over the week, your part, the last 7 days, who carried it ----
function renderPatternsTab(rows, today, weekDone){
  const days=[]; for(let k=6;k>=0;k--){ const d=midnight(); d.setDate(d.getDate()-k); const e=new Date(d); e.setDate(e.getDate()+1);
    days.push({ d, n: weekDone.filter(c=>{ const t=new Date(c.occurred_at); return t>=d && t<e; }).length }); }
  const max = Math.max(...days.map(x=>x.n), 1);
  const weekHtml = days.map((x,i)=>`<div class="day ${i===6?'today':''}">
      <span class="dn">${x.n}</span>
      <div class="col" style="height:${Math.max(4, Math.round(x.n/max*44))}px"><i style="height:100%"></i></div>
      <span class="dl">${x.d.toLocaleDateString([], {weekday:'narrow'})}</span>
    </div>`).join('');
  const people = new Set(weekDone.map(c=>c.actor_id)).size;
  const mine = today.filter(c=>c.actor_id===ME.member_id).length;
  const myNext = rows.find(r=>!r.d && r.it.who===ME.member_id && hm(r.it.time)>=nowMin()-60);
  const myWaiting = HANDOFFS.filter(h=>h.status==='open' && h.to_id===ME.member_id).length;
  $('#home-mid').innerHTML = `
    <div class="card h-patterns"><div class="card-head"><h2>Patterns, not predictions</h2><span class="muted">last 7 days</span></div>
      ${patternsHtml(7)}
      <p class="muted" style="font-size:var(--fs-1)">Counted from the record. The family and the doctor decide what it means.</p></div>
    <div class="card h-mine"><div class="card-head"><h2>${ME.role==='support' ? 'Your visit today' : 'Your part today'}</h2><span class="muted">${esc(ME.my_name)}</span></div>
      <div class="mine">
        <div><b>${mine}</b><span>cards you moved</span></div>
        <div><b>${myNext?esc(myNext.it.time):'—'}</b><span>${myNext?esc(myNext.it.label):'nothing assigned to you next'}</span></div>
        <div><b>${myWaiting}</b><span>handoff${myWaiting===1?'':'s'} waiting for you</span></div>
      </div></div>
    <div class="card h-week"><div class="card-head"><h2>Last 7 days</h2><span class="muted">${weekDone.length} done · ${people} ${people===1?'person':'people'}</span></div>
      <div class="days">${weekHtml}</div></div>`;
}

// ---- ELDER view: what Ammi needs to know, in large type, nothing to operate ----
function renderElderHome(){
  const today = todayItems();
  const rows = planRows();
  const open = HANDOFFS.filter(h=>h.status==='open').sort((a,b)=>new Date(b.opened_at)-new Date(a.opened_at));
  const acked = HANDOFFS.filter(h=>h.status==='acknowledged').sort((a,b)=>new Date(b.acked_at)-new Date(a.acked_at))[0];
  const last = today.at(-1);
  let withNow = null;
  if(acked && (!last || new Date(acked.acked_at) > new Date(last.occurred_at) || acked.to_id===last.actor_id)) withNow = nameOf(acked.to_id);
  else if(last) withNow = nameOf(last.actor_id);
  const board = boardFor(planFor(), WEEK);
  const done = board.filter(b=>b.state==='done');
  const tr = nextOf('transport', rows), ap = nextOf('appointment', rows);
  const family = MEMBERS.filter(m=>m.id!==ME.member_id).map(m=>nameOf(m.id));
  const erow = (b)=>`<div class="erow ${b.state}"><span class="etime">${b.state==='done'?'✓':(b.state==='blocked'?'✕':esc(b.card.time))}</span><span class="elabel">${iconFor(b.card)} ${esc(cap(b.card.label))}</span><span class="ewho">${b.state==='done'?`${esc(nameOf(b.ev.actor_id))} ✓`:(b.state==='blocked'?'not today':esc(b.card.who?nameOf(b.card.who):''))}</span></div>`;
  $('#home').innerHTML = `
    <div class="ehero">
      <div class="edate">${new Date().toLocaleDateString([], {weekday:'long', month:'long', day:'numeric'})}</div>
      <h1>Assalamu alaykum, ${esc(ME.my_name)}</h1>
      <div class="ewith">${withNow?`<b>${esc(withNow)}</b> is looking after you today.`:'Your family is here for you today.'}${open.length?` <b>${esc(nameOf(open[0].to_id))}</b> is coming next.`:''}</div>
      <div class="hero-actions" style="flex-direction:column"><button class="emg-btn big" data-emg type="button">I need help</button><button class="ghost" data-sheet type="button">Hospital sheet, for the ambulance</button></div>
    </div>
    <div class="ecard"><h2>Your day</h2><p class="ebig">${done.length}<span class="of"> of ${board.length} done</span></p>
      <div>${board.length ? board.map(erow).join('') : '<p class="elabel" style="margin:0">Nothing planned. Rest well.</p>'}</div></div>
    <div class="ecard"><h2>Next visit and pickup</h2>
      <div class="erow"><span class="etime">${ap?esc(ap.when.split(' ')[0]):'—'}</span><span class="elabel">${ap?esc(cap(ap.label)):'No appointment planned'}</span><span class="ewho">${ap?esc(nameOf(ap.who)):''}</span></div>
      <div class="erow"><span class="etime">${tr?esc(tr.when.split(' ')[0]):'—'}</span><span class="elabel">${tr?esc(cap(tr.label)):'No pickup planned'}</span><span class="ewho">${tr?esc(nameOf(tr.who)):''}</span></div></div>
    <div class="ecard"><h2>What your family knows about you</h2>
      ${PREFS ? `<div class="eprefs">${[['Language',PREFS.lang],['Food',PREFS.diet],['Prayer',PREFS.prayer],['Personal care',PREFS.modesty],['Fasting',PREFS.fasting]].filter(([,v])=>v).map(([k,v])=>`<div><span>${k}</span><br>${esc(v)}</div>`).join('')}</div><p class="muted">Shown to whoever looks after you, on every handoff.</p>` : '<p class="muted">Nothing recorded yet.</p>'}</div>
    <div class="ecard"><h2>Who can read your record</h2><p class="efam">${family.length?esc(family.join(', ')):'Only you'}</p>
      <p class="muted">They hold your family key. Nobody else can read it, not even the people who run this app.</p></div>`;
  wireEmergencyButtons();
}

// ---- patterns, not predictions: counts over the record, shown as facts ----
const has = (c, w) => String(c.text || '').toLowerCase().includes(w);
const daysOf = (list) => new Set(list.map(c => new Date(c.occurred_at).toDateString())).size;
function computePatterns(days = 7){
  const since = midnight(); since.setDate(since.getDate() - (days - 1));
  const items = LOG_ITEMS.filter(c => !c.retracted && new Date(c.occurred_at) >= since);
  const lines = [];
  for(const w of ['agitated', 'confused', 'tired', 'cheerful', 'calm']){
    const m = items.filter(c => (c.category === 'mood' || c.blocked) && has(c, w)); const d = daysOf(m);
    if(d >= 2){
      const evening = m.every(c => new Date(c.occurred_at).getHours() >= 18);
      const morning = m.every(c => new Date(c.occurred_at).getHours() < 12);
      lines.push(`${cap(w)} on ${d} of the last ${days} days${evening ? ', every time after 18:00' : (morning ? ', every time before noon' : '')}.`);
    }
  }
  const refused = items.filter(c => c.category === 'meal' && has(c, 'refus'));
  if(refused.length) lines.push(`Refused food on ${daysOf(refused)} of the last ${days} days (${refused.length} meal${refused.length > 1 ? 's' : ''}).`);
  const half = items.filter(c => c.category === 'meal' && has(c, 'half'));
  if(daysOf(half) >= 2) lines.push(`Ate half on ${daysOf(half)} of the last ${days} days.`);
  const missed = items.filter(c => c.category === 'meds' && (has(c, 'skipped') || has(c, 'refused')));
  if(missed.length) lines.push(`Meds skipped or refused ${missed.length} time${missed.length > 1 ? 's' : ''} in the last ${days} days.`);
  const walks = items.filter(c => c.category === 'mobility' && (has(c, 'walk') || has(c, 'physio')));
  if(items.some(c => c.category === 'mobility')) lines.push(`Walked or did physio on ${daysOf(walks)} of the last ${days} days.`);
  const rested = items.filter(c => c.category === 'mobility' && has(c, 'rested'));
  if(daysOf(rested) >= 2) lines.push(`Rested instead of walking on ${daysOf(rested)} days.`);
  return lines;
}
function patternsHtml(days){
  const lines = computePatterns(days);
  return lines.length ? `<ul class="patterns">${lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`
    : `<p class="muted">Nothing repeated enough to mention in the last ${days} days.</p>`;
}

// ---- hospital sheet: the last 14 days, decrypted here, printable ----
async function openSheet(){
  await loadLog(); await loadMembers(); await loadNames(); await loadRoutine();
  HANDOFFS = await api(`/families/${ME.family_id}/handoffs`).catch(()=>HANDOFFS);
  const since = midnight(); since.setDate(since.getDate() - 13);
  const items = LOG_ITEMS.filter(c => !c.retracted && new Date(c.occurred_at) >= since);
  const byDay = {};
  for(const c of items){ const k = new Date(c.occurred_at).toDateString(); (byDay[k] = byDay[k] || []).push(c); }
  const days = Object.keys(byDay).sort((a, b) => new Date(b) - new Date(a));
  const dlab = (k) => new Date(k).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const cell = (k, cat) => (byDay[k] || []).filter(c => c.category === cat)
    .map(c => { const flag = /refused|skipped|agitated|confused|fall|fell/i.test(c.text); return `<span class="${flag ? 'flag' : ''}">${fmtTime(c.occurred_at)} ${esc(c.text)}</span>`; }).join('<br>') || '<span class="muted">—</span>';
  const table = (title, cats) => `<section><h2>${title}, last 14 days</h2><table><tr><th>Day</th>${cats.map(c => `<th>${c}</th>`).join('')}</tr>
    ${days.map(k => `<tr><td class="d">${dlab(k)}</td>${cats.map(c => `<td>${cell(k, c)}</td>`).join('')}</tr>`).join('')}</table></section>`;
  const p = PREFS || {};
  const contacts = String(p.contacts || '').split('\n').map(l => l.trim()).filter(Boolean)
    .map(l => { const m = l.match(/(\+?\d[\d\s().-]{6,})/); return m ? `${esc(l.replace(m[1], '').trim())} <a href="tel:${m[1].replace(/[^\d+]/g, '')}">${esc(m[1].trim())}</a>` : esc(l); });
  const recent = [...HANDOFFS].sort((a, b) => new Date(b.opened_at) - new Date(a.opened_at)).slice(0, 3);
  const hos = [];
  for(const h of recent){ const d = await decryptJSON(KEY, h.iv, h.summary_cipher) || {};
    hos.push(`<tr><td class="d">${new Date(h.opened_at).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</td><td>${esc(nameOf(h.from_id))} → ${esc(nameOf(h.to_id))}</td><td>${esc(d.summary || '—')}</td><td>${esc(d.next || '—')}</td></tr>`); }
  const upcoming = [];
  for(let k = 0; k <= 14; k++){ const d = new Date(); d.setDate(d.getDate() + k);
    for(const it of planFor(d).filter(i => i.category === 'appointment')) upcoming.push(`${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })} ${it.time} ${esc(it.label)}${it.who ? ` (${esc(nameOf(it.who))})` : ''}`); }
  const meds = ROUTINE.filter(i => i.category === 'meds').sort((a, b) => hm(a.time) - hm(b.time)).map(i => `${i.time} ${esc(i.label)}`);
  $('#sheet').innerHTML = `
    <header><h1>Hospital sheet · ${esc(ELDER)}</h1>
      <div class="meta">Generated ${new Date().toLocaleString([], { weekday: 'long', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} by ${esc(ME.my_name)} · ${esc(FAMILY)} · Amanah Care</div></header>
    <section><h2>About ${esc(ELDER)}</h2><div class="kv">
      <b>Language</b><span>${esc(p.lang || '—')}</span><b>Diet</b><span>${esc(p.diet || '—')}</span>
      <b>Prayer</b><span>${esc(p.prayer || '—')}</span><b>Personal care</b><span>${esc(p.modesty || '—')}</span>
      <b>Conditions</b><span>${esc(p.conditions || 'not recorded')}</span><b>Allergies</b><span>${esc(p.allergies || 'not recorded')}</span>
      <b>Doctor</b><span>${esc(p.doctor || 'not recorded')}</span>
      <b>Usual meds times</b><span>${meds.length ? meds.join(' · ') : 'no routine recorded'}</span></div></section>
    <section><h2>Family contacts</h2>${contacts.length ? `<ul>${contacts.map(c => `<li>${c}</li>`).join('')}</ul>` : `<p class="muted">Not recorded. Members: ${esc(MEMBERS.map(m => nameOf(m.id)).join(', '))}</p>`}</section>
    <section><h2>Patterns, last 7 days (counts, not conclusions)</h2>${patternsHtml(7)}</section>
    ${table('Medication', ['meds'])}
    ${table('Meals', ['meal'])}
    ${table('Mood and mobility', ['mood', 'mobility'])}
    <section><h2>Appointments</h2>
      <p><b>Logged, last 14 days:</b> ${items.filter(c => c.category === 'appointment').map(c => `${dlab(new Date(c.occurred_at).toDateString())} ${esc(c.text)}`).join(' · ') || '—'}</p>
      <p><b>Upcoming, next 14 days:</b> ${upcoming.join(' · ') || '—'}</p></section>
    <section><h2>Last handoffs</h2><table><tr><th>When</th><th>Who</th><th>What happened</th><th>What was next</th></tr>${hos.join('') || '<tr><td colspan="4">—</td></tr>'}</table></section>
    <div class="foot">Generated on the family's phone from the family's own record. Not a medical record and not medical advice. Nothing is inferred: every line was written by a family member at the time shown. The server holds only ciphertext.</div>`;
  show('sheet'); window.scrollTo(0, 0);
}

// ---- emergency: one tap alerts every phone in the family, then opens the sheet ----
async function raiseEmergency(){
  const ask = isElder() ? 'Tell your family you need help now?' : `Alert everyone in ${FAMILY} now?`;
  if(!confirm(ask)) return;
  await postEvent({ family_id: ME.family_id, type: 'EmergencyRaised', actor_id: ME.member_id, occurred_at: now(), id: uuid() });
  toast(isElder() ? 'Your family has been told' : 'Family alerted');
  if(navigator.vibrate) navigator.vibrate(200);
  await openSheet();
}
function showEmergencyBanner(ev){
  const who = ev.actor_id;
  const elderRaised = MEMBERS.find(m => m.id === who)?.role === 'elder';
  $('#emg-text').textContent = (elderRaised ? `${ELDER} pressed "I need help"` : `${nameOf(who)} needs help with ${ELDER}`) + ` · ${fmtTime(ev.occurred_at)}`;
  $('#emg-banner').classList.remove('hide');
  if(navigator.vibrate) navigator.vibrate([200, 100, 200]);
  window.scrollTo(0, 0);
}
function wireEmergencyButtons(){
  $$('[data-emg]').forEach(b => b.onclick = () => raiseEmergency().catch(e => toast(e.message)));
  $$('[data-sheet]').forEach(b => b.onclick = () => openSheet().catch(e => toast(e.message)));
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
  pick = { category:cat, presets:new Set() };
  $$('#cat-row .chip').forEach(x=>x.classList.remove('on'));
  el?.classList.add('on');
  const presets = (CATS.find(c=>c[0]===cat) || [,[]])[1];
  const row = $('#preset-row'); row.innerHTML='';
  for(const pr of presets){
    const b = document.createElement('button'); b.className='chip'; b.textContent=pr; b.type='button';
    b.onclick = ()=>{ if(pick.presets.has(pr)) pick.presets.delete(pr); else pick.presets.add(pr);
      b.classList.toggle('on', pick.presets.has(pr)); updateLogButton(); };
    row.appendChild(b);
  }
  $('#log-note').placeholder = NOTE_HINT[cat] || 'optional';
  updateLogButton();
}
function updateLogButton(){
  const n = pick.presets.size; const b = $('#btn-log');
  b.disabled = n===0; b.textContent = n<=1 ? 'Log item' : `Log ${n} items`;
}
async function logItem(){
  if(!pick.presets.size) return;
  const note = $('#log-note').value.trim();
  const ids = [];
  for(const preset of pick.presets){
    const text = note ? `${preset} (${note})` : preset;
    const r = await postEncEvent('CareLogged', { text }, { actor_id: ME.member_id, category: pick.category });
    if(r?.id) ids.push(r.id);
  }
  $('#log-note').value='';
  $$('#preset-row .chip').forEach(x=>x.classList.remove('on'));
  pick.presets = new Set(); updateLogButton();
  toastAction(ids.length>1 ? `Logged ${ids.length} items` : 'Logged', 'Undo', async ()=>{ for(const id of ids) await retractCare(id, false); toast('Undone'); await refreshAll(); });
  await renderCareToday();
}
// A mistake is not deleted; it is retracted by a second event that points at it.
// Counts and patterns drop it, the record shows it struck through.
async function retractCare(id, refresh=true){
  await postEvent({ family_id: ME.family_id, type:'CareRetracted', actor_id: ME.member_id, handoff_id: id, occurred_at: now(), id: uuid() });
  if(refresh){ toast('Undone'); await refreshAll(); }
}
// ---- the care log, grouped: day / week / month, each group foldable ----
// Shared by the Log page and the Record tab. Re-rendered on every live
// announcement, so a row logged on another phone appears at once and flashes.
let LOG_ITEMS = [];                                          // last 90 days, decrypted, oldest first
const logView = { by: 'day', collapsed: new Set(), allCollapsed: false };
async function loadLog(){ const since = new Date(Date.now()-90*86400e3); since.setHours(0,0,0,0);
  LOG_ITEMS = await careSince(since.toISOString(), true).catch(()=>LOG_ITEMS); }
function mondayOf(d){ const x=new Date(d); x.setHours(0,0,0,0); x.setDate(x.getDate()-((x.getDay()+6)%7)); return x; }
function groupKey(iso){ const d=new Date(iso);
  if(logView.by==='week') return mondayOf(d).toISOString().slice(0,10);
  if(logView.by==='month') return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
  return d.toDateString(); }
function groupLabel(key){
  if(logView.by==='week'){ const m=new Date(key+'T00:00:00'); const weeks=Math.round((mondayOf(new Date())-m)/(7*86400e3));
    const end=new Date(m); end.setDate(end.getDate()+6);
    const span=`${m.toLocaleDateString([], {month:'short', day:'numeric'})} to ${end.toLocaleDateString([], {month:'short', day:'numeric'})}`;
    return weeks===0?`This week · ${span}`:(weeks===1?`Last week · ${span}`:`Week of ${span}`); }
  if(logView.by==='month'){ const [y,mo]=key.split('-').map(Number); const d=new Date(y,mo-1,1), now=new Date();
    const lab=d.toLocaleDateString([], {month:'long', year:'numeric'});
    return (y===now.getFullYear()&&mo===now.getMonth()+1)?`This month · ${lab}`:lab; }
  const today=new Date().toDateString(), yday=new Date(Date.now()-86400e3).toDateString();
  return key===today?'Today':(key===yday?'Yesterday':new Date(key).toLocaleDateString([], {weekday:'long', month:'short', day:'numeric'}));
}
function renderGrouped(box, items, flashFirst){
  if(!items.length){ box.innerHTML='<p class="muted">Nothing logged yet.</p>'; return; }
  const groups=[], idx={};
  for(const c of items){ const k=groupKey(c.occurred_at);
    if(!(k in idx)){ idx[k]=groups.length; groups.push({k, list:[]}); if(logView.allCollapsed) logView.collapsed.add(k); }
    groups[idx[k]].list.push(c); }
  let first=true;
  const when=(i)=> logView.by==='day' ? fmtTime(i.occurred_at)
    : new Date(i.occurred_at).toLocaleString([], {weekday:'short', day:'numeric', hour:'2-digit', minute:'2-digit'});
  box.innerHTML = groups.map(({k,list})=>{ const closed=logView.collapsed.has(k);
    const rows=list.map(i=>{ const cls=(first&&flashFirst?' flash':'')+(i.retracted?' retracted':''); first=false;
      const mine = i.actor_id===ME.member_id && !i.retracted && Date.now()-new Date(i.occurred_at) < 24*3600e3;
      return `<div class="item${cls}${i.blocked?' blocked':''}">
        <div class="top"><b>${esc(i.text)}</b><span class="pill">${i.retracted?'retracted':(i.blocked?'blocked':esc(i.category))}</span></div>
        <div class="muted">${esc(nameOf(i.actor_id))} · ${when(i)}${i.retracted?` · undone by ${esc(nameOf(i.retracted_by))}`:''}${mine?` · <a href="#" data-undo="${esc(i.id)}">undo</a>`:''}</div></div>`; }).join('');
    return `<div class="grp${closed?' closed':''}"><div class="rec-day grp-head" data-toggle="${esc(k)}"><b><i class="chev">${closed?'▸':'▾'}</i>${esc(groupLabel(k))}</b><span class="muted">${list.length} item${list.length===1?'':'s'}</span></div><div class="grp-body${closed?' hide':''}">${rows}</div></div>`; }).join('');
  box.querySelectorAll('[data-undo]').forEach(a=>a.onclick=(e)=>{ e.preventDefault(); if(confirm('Undo this entry? It stays in the record, marked as undone.')) retractCare(a.dataset.undo).catch(err=>toast(err.message)); });
  box.querySelectorAll('[data-toggle]').forEach(h=>h.onclick=()=>{ const k=h.dataset.toggle;
    if(logView.collapsed.has(k)) logView.collapsed.delete(k); else logView.collapsed.add(k);
    logView.allCollapsed=false; rerenderLogs(); });
}
function renderLogControls(){
  $$('.logview').forEach(box=>{
    box.innerHTML = ['day','week','month'].map(b=>`<button class="chip ${logView.by===b?'on':''}" data-by="${b}">${b[0].toUpperCase()+b.slice(1)}</button>`).join('')
      + `<button class="chip" data-collapse="1">Collapse all</button><button class="chip" data-collapse="0">Expand all</button>`;
    box.querySelectorAll('[data-by]').forEach(b=>b.onclick=()=>{ logView.by=b.dataset.by; logView.collapsed.clear(); logView.allCollapsed=false; rerenderLogs(); });
    box.querySelectorAll('[data-collapse]').forEach(b=>b.onclick=()=>{ const on=b.dataset.collapse==='1'; logView.allCollapsed=on; logView.collapsed.clear();
      if(on) for(const c of LOG_ITEMS) logView.collapsed.add(groupKey(c.occurred_at)); rerenderLogs(); });
  });
}
function rerenderLogs(){
  if(!$('#tab-log').classList.contains('hide')) renderCareToday(false).catch(()=>{});
  if(!$('#tab-record').classList.contains('hide')) renderRecord(false).catch(()=>{});
}
let lastLogCount = -1;
async function renderCareToday(reload=true){
  if(reload) await loadLog();
  const items = [...LOG_ITEMS].reverse();
  $('#today-count').textContent = LOG_ITEMS.filter(c=>!c.retracted && new Date(c.occurred_at)>=midnight()).length;
  const grew = lastLogCount >= 0 && items.length > lastLogCount; lastLogCount = items.length;
  renderLogControls();
  renderGrouped($('#care-today'), items, grew);
}

// ---- RECORD: everything, filtered by category, same grouping ----
let recFilter = 'all';
async function renderRecord(reload=true){
  if(reload) await loadLog();
  const all = [...LOG_ITEMS];
  const cats = ['all', ...new Set(all.map(c=>c.category).filter(Boolean))];
  $('#rec-filter').innerHTML = cats.map(c=>`<button class="chip ${c===recFilter?'on':''}" data-rf="${esc(c)}">${esc(c)}</button>`).join('');
  $$('[data-rf]').forEach(b=>b.onclick=()=>{ recFilter=b.dataset.rf; renderRecord(false); });
  renderLogControls();
  const items = all.filter(c=>recFilter==='all' || c.category===recFilter).reverse();
  $('#rec-count').textContent = items.length;
  renderGrouped($('#record'), items, false);
}

// ---- handoff ----
async function buildHandoff(){
  await loadNames().catch(()=>{});
  await loadMembers();
  const sel = $('#ho-member'); sel.innerHTML='';
  MEMBERS.filter(m=>m.id!==ME.member_id).forEach(m=>{
    const o=document.createElement('option'); o.value=m.id; o.textContent=`${nameOf(m.id)} (${m.role})`; sel.appendChild(o); });
  $('#ho-summary').value = 'composing…';
  const items = await careSince(lastHandoffAt || new Date(Date.now()-12*3600e3).toISOString());
  $('#ho-summary').value = items.length
    ? items.map(i=>i.text).join(', ')
    : 'Nothing new since your last handoff.';
  // What is next comes from the routine: everything still open today, in order.
  if(!$('#ho-next').value.trim()){
    await loadWeek();
    const rest = planRows().filter(r=>!r.d && hm(r.it.time)>=nowMin()-60)
      .map(r=>`${r.it.label} ${r.it.time}${r.it.who?` (${nameOf(r.it.who)})`:''}`);
    $('#ho-next').value = rest.join(', ');
  }
  updateHandoffPreview();
  await renderSent(false);
}
async function openHandoff(){
  const to = $('#ho-member').value;
  if(!to) return toast('Pick a member');
  const handoff_id = uuid();
  let summary = $('#ho-summary').value.trim();
  if(!summary || summary === 'composing…'){
    const items = await careSince(lastHandoffAt || new Date(Date.now()-12*3600e3).toISOString());
    summary = items.length ? items.map(i=>i.text).join(', ') : 'Nothing new since your last handoff.';
  }
  const payload = { summary, next: $('#ho-next').value.trim() };
  await sendAnimation(nameOf(to));   // show the data moving
  await postEncEvent('HandoffOpened', payload,
    { actor_id: ME.member_id, from_id: ME.member_id, to_id: to, handoff_id });
  lastHandoffAt = now(); $('#ho-next').value=''; $('#ho-preview').classList.add('hide');
  toast('Handoff sent to ' + nameOf(to));
  await renderSent(true);            // land in the sender's record, highlighted
}

// live preview of what will be sent, so it is never a mystery
function updateHandoffPreview(){
  const sel=$('#ho-member'); const to=sel.value;
  const toName = to ? (sel.options[sel.selectedIndex]?.textContent || nameOf(to)) : '—';
  const summ=$('#ho-summary').value, next=$('#ho-next').value.trim();
  const p=$('#ho-preview');
  p.innerHTML = `<div class="pv-row"><span>To</span><b>${esc(toName)}</b></div>
    <div class="pv-row"><span>What happened</span><b>${esc(summ||'—')}</b></div>
    <div class="pv-row"><span>What is next</span><b>${esc(next||'—')}</b></div>`;
  p.classList.remove('hide');
}

// the data-movement overlay: You -> Server -> Recipient
function sendAnimation(toName){
  return new Promise(res=>{
    const fx=$('#sendfx'); $('#sendfx-to').childNodes[0].nodeValue = toName;
    $('#sendfx-done').classList.add('hide');
    fx.classList.remove('hide');
    const nodes=[...fx.querySelectorAll('.node')], segs=[...fx.querySelectorAll('.seg')];
    nodes.forEach(n=>n.classList.remove('on')); segs.forEach(s=>s.classList.remove('go'));
    let i=0;
    nodes[0].classList.add('on');
    const step=()=>{
      if(i<segs.length){ segs[i].classList.add('go');
        setTimeout(()=>{ nodes[i+1].classList.add('on'); i++; step(); }, 700); }
      else { $('#sendfx-done').classList.remove('hide');
        setTimeout(()=>{ fx.classList.add('hide'); res(); }, 900); }
    };
    setTimeout(step, 350);
  });
}

// ---- sender record: handoffs I sent, grouped by recipient ----
async function renderSent(flash){
  const box=$('#sent'); if(!box) return;
  await loadNames().catch(()=>{});
  const rows = await api(`/families/${ME.family_id}/handoffs`).catch(()=>[]);
  const mine = rows.filter(h=>h.from_id===ME.member_id);
  $('#sent-count').textContent = mine.length;
  if(!mine.length){ box.innerHTML='<p class="muted">You have not sent any handoffs yet.</p>'; return; }
  const byTo={};
  for(const h of mine){ (byTo[h.to_id]=byTo[h.to_id]||[]).push(h); }
  const groups=[];
  for(const to of Object.keys(byTo)){
    const list = byTo[to].sort((a,b)=>new Date(b.opened_at)-new Date(a.opened_at));
    const rowsHtml=[];
    for(const h of list){
      const p = await decryptJSON(KEY, h.iv, h.summary_cipher) || {};
      const when=new Date(h.opened_at).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
      rowsHtml.push(`<div class="sent-row ${flash&&h===list[0]?'flash':''}">
        <div class="sent-top"><span class="pill ${h.status}">${h.status==='acknowledged'?'accepted':'delivered'}</span>
          <span class="muted">${when}</span></div>
        <div class="sent-what"><b>Sent:</b> ${esc(p.summary||(SERVER_VIEW?sealed(h.summary_cipher):'—'))}</div>
        <div class="sent-what"><b>Next:</b> ${esc(p.next||(SERVER_VIEW?'sealed in the same payload':'—'))}</div>
      </div>`);
    }
    groups.push(`<div class="sent-group">
      <div class="sent-head">To <b>${esc(nameOf(to))}</b><span class="muted"> · ${list.length} handoff${list.length>1?'s':''}</span></div>
      ${rowsHtml.join('')}
    </div>`);
  }
  box.innerHTML=groups.join('');
}

// ---- live updates: one server-sent-events stream per family ----
// The projector announces an event once its read models are written; every
// open tab refetches what it is showing. The 4 s poll below stays as the net.
let live = null, liveTimer = null, liveQueue = [];
const liveHooks = [];
const VERB = { EmergencyRaised:'raised an EMERGENCY', HandoffOpened:'sent a handoff', HandoffAcknowledged:'accepted a handoff', PreferenceSet:'updated the preferences',
               RoutineSet:'changed the routine', MemberJoined:'joined', CareLogged:'moved a card to Done', CareBlocked:'moved a card to Blocked', CareRetracted:'moved a card back' };
function startLive(){
  stopLive();
  if(!('EventSource' in window) || !ME) return;
  live = new EventSource(`${API}/families/${ME.family_id}/live`);
  live.onmessage = (m)=>{ let ev; try{ ev = JSON.parse(m.data); }catch{ return; } if(!ev?.type) return;
    liveQueue.push(ev); clearTimeout(liveTimer); liveTimer = setTimeout(()=>flushLive().catch(()=>{}), 150); };
  live.onerror = ()=>{};   // EventSource reconnects by itself; polling covers the gap
}
function stopLive(){ if(live){ live.close(); live=null; } clearTimeout(liveTimer); liveQueue=[]; }
async function flushLive(){
  const evs = liveQueue.splice(0);
  const others = evs.filter(e=>e.actor_id && e.actor_id!==ME?.member_id);
  const emg = others.find(e=>e.type==='EmergencyRaised'); if(emg) showEmergencyBanner(emg);
  if(others.length){ const e = others.at(-1);
    const what = e.type==='CareLogged' ? `did ${e.category||'care'}` : (e.type==='CareBlocked' ? `blocked ${e.category||'care'}` : (VERB[e.type]||e.type));
    toast(`${nameOf(e.actor_id)} ${what}${others.length>1?` · +${others.length-1} more`:''}`); }
  await refreshAll();
  setTimeout(()=>refreshAll().catch(()=>{}), 900);   // rows written by a second consumer (alerts) land a beat later
}
async function refreshAll(){
  if(!ME) return;
  const vis = (id)=>!$(id).classList.contains('hide');
  if(vis('#tab-home')) await refreshHome(true);
  if(vis('#tab-log')) await renderCareToday();
  if(vis('#tab-record')) await renderRecord();
  if(vis('#tab-handoff')) await renderSent(false);
  await refreshInbox();                       // inbox, badge, and the poll hooks (alerts)
  for(const fn of liveHooks){ try{ await fn(); }catch{} }
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
  const waiting = rows.filter(r=>r.status==='open').length;
  const badge=$('#inbox-badge'); badge.textContent=waiting; badge.classList.toggle('hide', !waiting);
  await refreshHome(false).catch(()=>{});
  if(!$('#tab-handoff').classList.contains('hide')) await renderSent(false).catch(()=>{});
  await runHooks(pollHooks);
}
async function renderInbox(rows){
  const box=$('#inbox');
  if(!rows.length){
    box.innerHTML='<div class="card flat"><p class="muted">No handoffs waiting for you.</p></div>';
    return; }
  const cards=[];
  for(const h of rows){
    const p = await decryptJSON(KEY, h.iv, h.summary_cipher) || {};
    const strip = $('#strip').innerHTML;
    cards.push(`<div class="card">
      <div class="card-head"><h2>From ${esc(nameOf(h.from_id))}</h2>
        <span class="pill ${h.status}">${h.status}</span></div>
      ${strip?`<div class="strip">${strip}</div>`:''}
      <div class="group"><span class="eyebrow">What happened</span>
        <div>${esc(p.summary||(SERVER_VIEW?sealed(h.summary_cipher):'—'))}</div></div>
      <div class="group"><span class="eyebrow">What is next</span>
        <div>${esc(p.next||(SERVER_VIEW?'sealed in the same payload':'—'))}</div></div>
      ${h.status==='open'
        ? `<button data-ack="${h.id}">Accept handoff</button>`
        : `<p class="muted">Accepted ${fmtTime(h.acked_at)}</p>`}
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
  const since = new Date(Date.now()-6*86400e3); since.setHours(0,0,0,0);
  const rows = (await api(`/families/${ME.family_id}/workload?since=${since.toISOString().slice(0,10)}`).catch(()=>[]))
    .filter(r=>r.care_count+r.handoff_count>0);
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
    prayer:$('#p-prayer').value.trim(), modesty:$('#p-modesty').value.trim(),
    conditions:$('#p-conditions').value.trim(), allergies:$('#p-allergies').value.trim(),
    doctor:$('#p-doctor').value.trim(), contacts:$('#p-contacts').value.trim(),
    fasting:$('#p-fasting').value.trim(), care_contact:$('#p-carecontact').value.trim() };
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
function animateHops(){
  const hops=[...document.querySelectorAll('#flow .hop')];
  hops.forEach(h=>h.classList.remove('lit'));
  let i=0; const tick=()=>{ if(i>=hops.length) return;
    hops[i].classList.add('lit'); i++; setTimeout(tick, 260); };
  tick();
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
  const plain = t.plain ? Object.values(t.plain).filter(Boolean).map(v=>typeof v==='string'?v:JSON.stringify(v)).join(' · ') : '—';
  box.innerHTML = [
    hop(1,'readable','This phone','browser memory',
      `<b>${esc(plain.slice(0,160))}</b> in the clear, plus the family key H. H is never sent anywhere.`, read),
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
  animateHops();
}

// ---- server view toggle ----
async function toggleServerView(){
  SERVER_VIEW = !SERVER_VIEW;
  document.body.classList.toggle('serverview', SERVER_VIEW);
  $('#sv-banner').classList.toggle('hide', !SERVER_VIEW);
  $('#btn-serverview').textContent = SERVER_VIEW ? 'Family view' : 'Server view';
  for(const k of Object.keys(nameCache)) delete nameCache[k];
  ELDER='Elder'; FAMILY=''; PREFS=null; if(!routineDirty) ROUTINE=[]; lastLogCount=-1; homeSig=null; inboxSig=null;
  renderWhoAmI();
  await loadNames(); await loadElder(); await renderStrip(); await loadRoutine();
  await refreshAll();
  toast(SERVER_VIEW ? 'What the server sees' : 'Back to your family view');
}

// ---- hooks for sibling modules (alerts.js). Kept tiny on purpose. ----
const enterHooks=[], pollHooks=[], tabHooks={}, homeHooks=[];
window.amanah = {
  get me(){ return ME; }, get key(){ return KEY; },
  api, decryptJSON, nameOf, toast, esc, fmtWhen, isElder, tab,
  onEnter(fn){ enterHooks.push(fn); },
  onPoll(fn){ pollHooks.push(fn); },
  onTab(name, fn){ (tabHooks[name]=tabHooks[name]||[]).push(fn); },
  onLive(fn){ liveHooks.push(fn); },
  onHome(fn){ homeHooks.push(fn); },
  get prefs(){ return PREFS; }, get routine(){ return ROUTINE; }, get weekItems(){ return WEEK; },
  get handoffs(){ return HANDOFFS; }, get members(){ return MEMBERS; }, get elderName(){ return ELDER; },
  planFor, doneFor, isServerView: ()=>SERVER_VIEW, postEncEvent,
};
async function runHooks(list){ for(const fn of list){ try{ await fn(); }catch(e){ console.warn('[hook]', e.message); } } }

// ---- wire up ----
$('#btn-create').onclick = ()=>createFamily().catch(e=>toast(e.message));
$('#btn-join').onclick   = ()=>joinFamily().catch(e=>toast(e.message));
$('#btn-enter').onclick  = ()=>enterApp();
$('#btn-login').onclick  = ()=>loginWithPassword().catch(e=>toast(e.message));
$('#l-pass').onkeydown   = (e)=>{ if(e.key==='Enter') loginWithPassword().catch(e=>toast(e.message)); };
$('#btn-setlogin').onclick = ()=>saveLogin().catch(e=>toast(e.message));
$('#btn-serverview').onclick = ()=>toggleServerView().catch(e=>toast(e.message));
$('#btn-switch').onclick = switchFamily;
$('#btn-sheet-back').onclick = ()=>show('app');
$('#btn-sheet-print').onclick = ()=>window.print();
$('#emg-sheet').onclick = ()=>openSheet().catch(e=>toast(e.message));
$('#emg-dismiss').onclick = ()=>$('#emg-banner').classList.add('hide');
$('#btn-skiplogin').onclick = afterSetLogin;
$('#btn-copy').onclick   = ()=>{ navigator.clipboard?.writeText($('#invite-code').value); toast('Copied'); };
$('#btn-copy-app').onclick = ()=>{ navigator.clipboard?.writeText($('#invite-code-app').value); toast('Copied'); };
$('#btn-log').onclick    = ()=>logItem().catch(e=>toast(e.message));
$('#btn-handoff').onclick= ()=>openHandoff().catch(e=>toast(e.message));
$('#ho-member').onchange = updateHandoffPreview;
$('#ho-next').oninput    = updateHandoffPreview;
$('#btn-prefs').onclick  = ()=>savePrefs().catch(e=>toast(e.message));
$('#btn-proof').onclick  = ()=>refreshProof().catch(e=>toast(e.message));
$('#btn-r-add').onclick  = addRoutineItem;
$('#btn-r-save').onclick = ()=>saveRoutine().catch(e=>toast(e.message));
$$('.tabs button').forEach(b=>b.onclick=()=>tab(b.dataset.tab));
{ const b=$('#btn-logout'); if(b) b.onclick=logout; }

// ---- auth page: one card, three modes ----
function authMode(mode){
  $$('#view-landing [data-pane]').forEach(p=>p.classList.toggle('hide', p.dataset.pane!==mode));
  $$('#view-landing .auth-tabs button').forEach(b=>b.classList.toggle('on', b.dataset.auth===mode));
  const first = $(`#view-landing [data-pane="${mode}"] input, #view-landing [data-pane="${mode}"] textarea`); if(first && window.innerWidth>=960) first.focus();
}
$$('#view-landing [data-auth]').forEach(el=>el.addEventListener('click', (e)=>{ e.preventDefault(); authMode(el.dataset.auth); }));

// resume session if present
loadSession().then(ok=>{ if(ok) enterApp(); else show('landing'); });
