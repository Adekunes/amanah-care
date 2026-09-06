// Amanah Care seed (T7.1). Populates a family so the demo is not empty (NR-03).
// Members: Ammi (elder), Sister A, Abdullah, Fatima. Preferences, Ammi's
// routine, six days of history with rotating caregivers and four past handoffs,
// and today's morning already logged so the plan shows progress. Everything
// after the routine time "now minus 90 minutes" is left open for the live demo.
// All payloads are AES-GCM encrypted here, like the browser does it.
import { webcrypto as wc } from 'node:crypto';
const API = process.env.API || 'http://localhost:4000';
const subtle = wc.subtle;
const b64 = (buf)=>Buffer.from(buf).toString('base64');
const enc = (o)=>new TextEncoder().encode(JSON.stringify(o));
const uuid = ()=>wc.randomUUID();

const key = await subtle.generateKey({name:'AES-GCM',length:256}, true, ['encrypt','decrypt']);
const rawH = b64(await subtle.exportKey('raw', key));
const kcBuf = await subtle.digest('SHA-256', await subtle.exportKey('raw', key));
const keyCheck = [...new Uint8Array(kcBuf)].map(b=>b.toString(16).padStart(2,'0')).join('');

async function encJSON(o){ const iv=wc.getRandomValues(new Uint8Array(12));
  const ct=await subtle.encrypt({name:'AES-GCM',iv}, key, enc(o));
  return { iv:b64(iv), payload_cipher:b64(ct) }; }
async function post(path, body){
  const r = await fetch(API+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
async function put(path, body){
  const r = await fetch(API+path,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

const FAM = uuid().slice(0,8);
const elder = uuid(), sisA = uuid(), abd = uuid(), fat = uuid(), layla = uuid();   // layla: support worker from the agency
const NAMES = { [elder]:'Ammi', [sisA]:'Sister A', [abd]:'Abdullah', [fat]:'Fatima', [layla]:'Nurse Layla' };

// k days ago at local HH:MM
function at(k, hhmm){ const [h,m]=hhmm.split(':').map(Number); const d=new Date(); d.setDate(d.getDate()-k); d.setHours(h,m,0,0); return d; }
const iso = (d)=>d.toISOString();
let count = 0;
async function ev(type, payload, clear, when){ const c = payload?await encJSON(payload):{iv:'',payload_cipher:''};
  count++;
  return post('/events',{ id:uuid(), family_id:FAM, type, occurred_at: when?iso(when):new Date().toISOString(), key_version:1, ...c, ...clear }); }

await post('/families',{ family_id:FAM, key_check:keyCheck, key_version:1, member:{id:elder, role:'elder'} });
for (const m of [sisA, abd, fat]) await post(`/families/${FAM}/join`,{ key_check:keyCheck, member:{id:m, role:'family'} });
await post(`/families/${FAM}/join`,{ key_check:keyCheck, member:{id:layla, role:'support'} });

const week = at(7,'09:00');
for (const [id,name] of Object.entries(NAMES)) await ev('MemberJoined',{name},{actor_id:id}, week);
await ev('FamilyCreated',{elder_name:'Ammi', family_name:"Ammi's family"},{actor_id:sisA}, week);
await ev('PreferenceSet',{lang:'Urdu',diet:'halal, no gelatin, soft food',prayer:'prayer times matter, help with wudu',modesty:'female caregiver for personal care',
  conditions:'type 2 diabetes, high blood pressure, sore left knee', allergies:'penicillin', doctor:'Dr. Rahman, 514 555 0100',
  contacts:'Sister A 514 555 0101\nFatima 514 555 0102\nAbdullah 514 555 0103',
  fasting:'none', care_contact:'CLSC nurse, 514 555 0199'},{actor_id:elder}, week);

// Ammi's routine. The plan the day is measured against.
const R = (id, category, label, time, days, who='') => ({ id, category, label, time, days, who });
// The five cards on the board. One per line: what, by when, who.
const ROUTINE = [
  R('meds',    'meds',          'Medication',    '08:00', 'daily'),
  R('care',    'personal care', 'Personal care', '10:00', 'daily', layla),
  R('meals',   'meal',          'Meals',         '12:30', 'daily'),
  R('prayers', 'prayer',        'Prayers',       '13:05', 'daily'),
  R('walk',    'mobility',      'Walk',          '17:15', 'daily'),
];
await ev('RoutineSet',{items:ROUTINE},{actor_id:sisA}, week);

// Six days of history. Morning / afternoon / evening shifts rotate.
const shifts = { 6:[sisA,sisA,fat], 5:[sisA,sisA,sisA], 4:[sisA,fat,sisA], 3:[sisA,sisA,abd], 2:[sisA,sisA,sisA], 1:[sisA,sisA,sisA] };  // Sister A carries the week
const who = (k, hhmm)=>{ const h=+hhmm.split(':')[0]; const s=shifts[k]; return h<12?s[0]:(h<18?s[1]:s[2]); };
const care = async (k, hhmm, category, text, routine_id, actor)=>ev('CareLogged',{ text, ...(routine_id?{routine_id}:{}) },{ actor_id: actor||who(k,hhmm), category }, at(k,hhmm));
// A card moved to Blocked: CareBlocked, reason encrypted, never counted as done.
const blocked = async (k, hhmm, card, reason, actor)=>{ const it = ROUTINE.find(i=>i.id===card);
  return ev('CareBlocked',{ text:`${it.label} not done: ${reason}`, reason, routine_id: it.id },{ actor_id: actor||who(k,hhmm), category: it.category }, at(k,hhmm)); };
for (let k=6; k>=1; k--) {
  await care(k, k===3?'09:30':'08:05','meds', k===3?'Medication (was asleep, gave at 09:30)':'Medication','meds');
  if (k===5||k===2) await care(k,'10:30','personal care','Personal care (bath, hair and nails)','care', layla);
  else await care(k,'10:15','personal care','Personal care','care');
  if (k===1||k===2) await blocked(k,'12:40','meals','refused');            // two refusals in 48 h
  else await care(k,'12:40','meal', k===4?'Meals (ate half at lunch)':'Meals','meals');
  await care(k,'13:10','prayer','Prayers','prayers');
  if (k===6||k===5||k===3) await blocked(k,'18:40','walk','agitated');      // three agitated evenings
  else if (k===4) await care(k,'17:20','mobility','Walk (short, knee sore)','walk');   // nothing for 48 h after that
}
await care(4,'10:40','appointment','Dr. Rahman follow-up (BP checked, next visit in a month)', null, fat);
await care(6,'11:10','transport','pharmacy pickup done', null, abd);
await care(2,'10:45','readings','blood pressure (128/82)', null, layla);

// Past handoffs, all accepted. Summary and next are encrypted.
async function handoff(k, hhmm, from, to, summary, next, ackMin=4){
  const hid = uuid();
  await ev('HandoffOpened',{summary,next},{actor_id:from, from_id:from, to_id:to, handoff_id:hid}, at(k,hhmm));
  const ackAt = at(k,hhmm); ackAt.setMinutes(ackAt.getMinutes()+ackMin);
  await ev('HandoffAcknowledged',null,{actor_id:to, handoff_id:hid}, ackAt);
}
await handoff(6,'12:00', sisA, fat, 'Medication, Personal care', 'Meals 12:30, Prayers 13:05, Walk 17:15, Abdullah brings the pharmacy bag');
await handoff(4,'12:00', fat, abd, 'Dr. Rahman follow-up done, BP checked, Medication, Personal care', 'Meals 12:30, Prayers, short walk only, knee sore');
await handoff(3,'18:00', abd, sisA, 'Medication (was asleep, gave at 09:30), Personal care, Meals, Prayers', 'Walk 17:15, she was restless');
await handoff(1,'12:00', fat, sisA, 'Medication, Personal care', 'Meals 12:30, Prayers 13:05, Walk 17:15');

// Alert subscriptions (NOTIFY-SPEC §1/§6). Ammi is an elder: no defaults, no Alerts tab, no PUT here.
const SUBSCRIPTIONS = {
  [sisA]: ['handoff.to_me', 'handoff.accepted', 'care.mood', 'care.meds'],
  [fat]:  ['handoff.to_me', 'handoff.accepted', 'care.meds', 'care.appointment'],
  [abd]:  ['handoff.to_me', 'handoff.accepted', 'care.transport'],
};
for (const [memberId, kinds] of Object.entries(SUBSCRIPTIONS))
  await put(`/families/${FAM}/members/${memberId}/subscriptions`, { kinds });

// Today: everything in the routine due before (now - 90 min) is already logged by Sister A.
const nowMin = new Date().getHours()*60 + new Date().getMinutes();
const DOW = ['sun','mon','tue','wed','thu','fri','sat'][new Date().getDay()];
let todayDone = 0;
for (const it of ROUTINE) {
  if (it.days!=='daily' && it.days!==DOW) continue;
  const [h,m] = it.time.split(':').map(Number);
  if (h*60+m > nowMin-90) continue;
  const t = `${String(h).padStart(2,'0')}:${String(m+5).padStart(2,'0')}`;
  if (it.id==='meals') await blocked(0, t, 'meals', 'refused', sisA);      // today's lunch refused too
  else await care(0, t, it.category, it.label, it.id, it.who || sisA);
  todayDone++;
}

// Logins for everyone, password 333, H wrapped under the password like the browser does.
async function wrapH(password){
  const salt=wc.getRandomValues(new Uint8Array(16)), iv=wc.getRandomValues(new Uint8Array(12));
  const base=await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const k=await subtle.deriveKey({name:'PBKDF2', salt, iterations:310000, hash:'SHA-256'}, base, {name:'AES-GCM',length:256}, false, ['encrypt']);
  const ct=await subtle.encrypt({name:'AES-GCM', iv}, k, await subtle.exportKey('raw', key));
  return { wrap_salt:b64(salt), wrap_iv:b64(iv), wrapped_h:b64(ct) };
}
const LOGINS = { [sisA]:'sistera', [abd]:'abdullah', [fat]:'fatima', [elder]:'ammi', [layla]:'layla' };
for (const [m,l] of Object.entries(LOGINS))
  await post('/auth/register',{ family_id:FAM, member_id:m, key_check:keyCheck, login:l, password:'333', ...(await wrapH('333')) });

// ---- a second family the same support worker serves: same login, same password ----
const key2 = await subtle.generateKey({name:'AES-GCM',length:256}, true, ['encrypt','decrypt']);
const kc2Buf = await subtle.digest('SHA-256', await subtle.exportKey('raw', key2));
const keyCheck2 = [...new Uint8Array(kc2Buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
const FAM2 = uuid().slice(0,8), nana = uuid(), yusuf = uuid(), layla2 = uuid();
async function enc2(o){ const iv=wc.getRandomValues(new Uint8Array(12)); const ct=await subtle.encrypt({name:'AES-GCM',iv}, key2, enc(o)); return { iv:b64(iv), payload_cipher:b64(ct) }; }
async function ev2(type, payload, clear, when){ const c = payload?await enc2(payload):{iv:'',payload_cipher:''}; count++;
  return post('/events',{ id:uuid(), family_id:FAM2, type, occurred_at: when?iso(when):new Date().toISOString(), key_version:1, ...c, ...clear }); }
await post('/families',{ family_id:FAM2, key_check:keyCheck2, key_version:1, member:{id:nana, role:'elder'} });
await post(`/families/${FAM2}/join`,{ key_check:keyCheck2, member:{id:yusuf, role:'family'} });
await post(`/families/${FAM2}/join`,{ key_check:keyCheck2, member:{id:layla2, role:'support'} });
for (const [id,name] of [[nana,'Nana'],[yusuf,'Yusuf'],[layla2,'Nurse Layla']]) await ev2('MemberJoined',{name},{actor_id:id}, week);
await ev2('FamilyCreated',{elder_name:'Nana', family_name:'the Khan family'},{actor_id:yusuf}, week);
await ev2('PreferenceSet',{lang:'Arabic',diet:'halal, low salt',prayer:'prayer times matter',modesty:'female caregiver for personal care',fasting:'none',care_contact:'CLSC nurse, 514 555 0199'},{actor_id:nana}, week);
await ev2('RoutineSet',{items:[R('meds','meds','Medication','08:00','daily'),R('care','personal care','Personal care','10:00','daily',layla2),R('meals','meal','Meals','12:30','daily'),R('prayers','prayer','Prayers','13:05','daily'),R('walk','mobility','Walk','16:00','daily')]},{actor_id:yusuf}, week);
for (const k of [2,1]) { await ev2('CareLogged',{text:'Medication',routine_id:'meds'},{actor_id:yusuf, category:'meds'}, at(k,'08:10'));
  await ev2('CareLogged',{text:'Personal care',routine_id:'care'},{actor_id:layla2, category:'personal care'}, at(k,'10:20'));
  await ev2('CareLogged',{text:'Walk',routine_id:'walk'},{actor_id:layla2, category:'mobility'}, at(k,'16:05')); }
async function wrapH2(password){ const salt=wc.getRandomValues(new Uint8Array(16)), iv=wc.getRandomValues(new Uint8Array(12));
  const base=await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const k=await subtle.deriveKey({name:'PBKDF2', salt, iterations:310000, hash:'SHA-256'}, base, {name:'AES-GCM',length:256}, false, ['encrypt']);
  const ct=await subtle.encrypt({name:'AES-GCM', iv}, k, await subtle.exportKey('raw', key2));
  return { wrap_salt:b64(salt), wrap_iv:b64(iv), wrapped_h:b64(ct) }; }
await post('/auth/register',{ family_id:FAM2, member_id:yusuf, key_check:keyCheck2, login:'yusuf', password:'333', ...(await wrapH2('333')) });
await post('/auth/register',{ family_id:FAM2, member_id:layla2, key_check:keyCheck2, login:'layla', password:'333', ...(await wrapH2('333')) });

function code(m,r,n){ return Buffer.from(JSON.stringify({f:FAM,h:rawH,m,r,n})).toString('base64').replace(/\+/g,'-').replace(/\//g,'_'); }
console.log('\n=== Amanah Care seeded ===');
console.log('family_id:', FAM, '| events:', count, '| today already done:', todayDone);
console.log('\nSISTER_A_CODE='+code(sisA,'family','Sister A'));
console.log('ABDULLAH_CODE='+code(abd,'family','Abdullah'));
console.log('FATIMA_CODE='+code(fat,'family','Fatima'));
console.log('AMMI_CODE='+code(elder,'elder','Ammi'));
console.log('\nLOGINS (password 333): sistera, abdullah, fatima, ammi, layla (support worker, two families), yusuf (the Khan family)');
console.log('second family:', FAM2, '(the Khan family, elder Nana)');
console.log('SUBSCRIPTIONS:', Object.entries(SUBSCRIPTIONS).map(([m, kinds]) => `${NAMES[m]}=[${kinds.join(', ')}]`).join(' | '));
