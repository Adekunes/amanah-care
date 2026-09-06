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
const elder = uuid(), sisA = uuid(), abd = uuid(), fat = uuid();
const NAMES = { [elder]:'Ammi', [sisA]:'Sister A', [abd]:'Abdullah', [fat]:'Fatima' };

// k days ago at local HH:MM
function at(k, hhmm){ const [h,m]=hhmm.split(':').map(Number); const d=new Date(); d.setDate(d.getDate()-k); d.setHours(h,m,0,0); return d; }
const iso = (d)=>d.toISOString();
let count = 0;
async function ev(type, payload, clear, when){ const c = payload?await encJSON(payload):{iv:'',payload_cipher:''};
  count++;
  return post('/events',{ id:uuid(), family_id:FAM, type, occurred_at: when?iso(when):new Date().toISOString(), key_version:1, ...c, ...clear }); }

await post('/families',{ family_id:FAM, key_check:keyCheck, key_version:1, member:{id:elder, role:'elder'} });
for (const m of [sisA, abd, fat]) await post(`/families/${FAM}/join`,{ key_check:keyCheck, member:{id:m, role:'family'} });

const week = at(7,'09:00');
for (const [id,name] of Object.entries(NAMES)) await ev('MemberJoined',{name},{actor_id:id}, week);
await ev('FamilyCreated',{elder_name:'Ammi', family_name:"Ammi's family"},{actor_id:sisA}, week);
await ev('PreferenceSet',{lang:'Urdu',diet:'halal, no gelatin, soft food',prayer:'prayer times matter, help with wudu',modesty:'female caregiver for personal care',
  conditions:'type 2 diabetes, high blood pressure, sore left knee', allergies:'penicillin', doctor:'Dr. Rahman, 514 555 0100',
  contacts:'Sister A 514 555 0101\nFatima 514 555 0102\nAbdullah 514 555 0103'},{actor_id:elder}, week);

// Ammi's routine. The plan the day is measured against.
const R = (id, category, label, time, days, who='') => ({ id, category, label, time, days, who });
const ROUTINE = [
  R('fajr',   'prayer',      'Fajr',                    '05:30', 'daily'),
  R('meds1',  'meds',        'morning meds',            '08:00', 'daily'),
  R('meal1',  'meal',        'breakfast',               '08:30', 'daily'),
  R('meds2',  'meds',        'afternoon meds',          '14:00', 'daily'),
  R('dhuhr',  'prayer',      'Dhuhr',                   '13:05', 'daily'),
  R('meal2',  'meal',        'lunch',                   '13:30', 'daily'),
  R('asr',    'prayer',      'Asr',                     '16:45', 'daily'),
  R('walk',   'mobility',    'walk after Asr',          '17:15', 'daily'),
  R('meal3',  'meal',        'dinner',                  '19:00', 'daily'),
  R('maghrib','prayer',      'Maghrib',                 '19:25', 'daily'),
  R('meds3',  'meds',        'night meds',              '21:00', 'daily', fat),
  R('isha',   'prayer',      'Isha',                    '21:15', 'daily'),
  R('pharm',  'transport',   'pharmacy pickup',         '11:00', 'sun',  abd),
  R('physio', 'mobility',    'physio at home',          '15:00', 'tue'),
  R('doc',    'appointment', 'Dr. Rahman follow-up',    '10:30', 'wed',  fat),
];
await ev('RoutineSet',{items:ROUTINE},{actor_id:sisA}, week);

// Six days of history. Morning / afternoon / evening shifts rotate.
const shifts = { 6:[sisA,sisA,fat], 5:[sisA,sisA,sisA], 4:[sisA,fat,sisA], 3:[sisA,sisA,abd], 2:[sisA,sisA,sisA], 1:[sisA,sisA,sisA] };  // Sister A carries the week
const who = (k, hhmm)=>{ const h=+hhmm.split(':')[0]; const s=shifts[k]; return h<12?s[0]:(h<18?s[1]:s[2]); };
const care = async (k, hhmm, category, text, routine_id, actor)=>ev('CareLogged',{ text, ...(routine_id?{routine_id}:{}) },{ actor_id: actor||who(k,hhmm), category }, at(k,hhmm));
const MOODS = { 6:'calm', 5:'cheerful', 4:'tired (slept badly)', 3:'calm', 2:'agitated (missed her nap)', 1:'calm' };
for (let k=6; k>=1; k--) {
  await care(k,'05:40','prayer','Fajr','fajr');
  await care(k,'08:05','meds', k===3?'meds skipped (was asleep, gave at 09:30)':'morning meds','meds1');
  await care(k,'08:35','meal', k===4?'breakfast (ate half)':'breakfast','meal1');
  await care(k,'10:00','mood', MOODS[k]);
  await care(k,'13:10','prayer','Dhuhr','dhuhr');
  await care(k,'13:35','meal', (k===1||k===2)?'lunch (refused food, had tea and dates)':'lunch','meal2');
  if (k===5||k===3||k===1) await care(k,'18:40','mood','agitated (restless before Maghrib, settled after)');
  await care(k,'14:05','meds','afternoon meds','meds2');
  if (k!==5) await care(k,'16:50','prayer','Asr','asr');
  if (k>2) await care(k,'17:20','mobility', k===4?'walk after Asr (short, knee sore)':'walk after Asr','walk');   // nothing logged for 48 h
  await care(k,'19:05','meal','dinner','meal3');
  await care(k,'19:30','prayer','Maghrib','maghrib');
  await care(k,'21:05','meds','night meds','meds3');
  if (k!==6) await care(k,'21:20','prayer','Isha','isha');
}
await care(4,'10:40','appointment','Dr. Rahman follow-up (BP checked, next visit in a month)','doc', fat);
await care(6,'11:10','transport','pharmacy pickup done','pharm', abd);
await care(3,'15:10','mobility','physio at home (20 min, went well)','physio', abd);

// Past handoffs, all accepted. Summary and next are encrypted.
async function handoff(k, hhmm, from, to, summary, next, ackMin=4){
  const hid = uuid();
  await ev('HandoffOpened',{summary,next},{actor_id:from, from_id:from, to_id:to, handoff_id:hid}, at(k,hhmm));
  const ackAt = at(k,hhmm); ackAt.setMinutes(ackAt.getMinutes()+ackMin);
  await ev('HandoffAcknowledged',null,{actor_id:to, handoff_id:hid}, ackAt);
}
await handoff(6,'12:00', sisA, fat, 'Fajr, morning meds, breakfast, calm', 'Dhuhr 13:05, lunch, afternoon meds 14:00, Abdullah brings the pharmacy bag');
await handoff(4,'12:00', fat, abd, 'Dr. Rahman follow-up done, BP checked, ate half at breakfast, tired', 'lunch 13:30, afternoon meds 14:00, short walk only, knee sore');
await handoff(3,'18:00', abd, sisA, 'physio went well, meds given late at 09:30, calm all day', 'dinner 19:00, Maghrib, night meds 21:00');
await handoff(1,'12:00', fat, sisA, 'Fajr, morning meds, breakfast, calm', 'lunch 13:30, afternoon meds 14:00, walk after Asr');

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
  await care(0, t, it.category, it.label, it.id, it.who || sisA);
  todayDone++;
}
if (nowMin > 10*60) await care(0,'10:00','mood','calm', null, sisA);

// Logins for everyone, password 333, H wrapped under the password like the browser does.
async function wrapH(password){
  const salt=wc.getRandomValues(new Uint8Array(16)), iv=wc.getRandomValues(new Uint8Array(12));
  const base=await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const k=await subtle.deriveKey({name:'PBKDF2', salt, iterations:310000, hash:'SHA-256'}, base, {name:'AES-GCM',length:256}, false, ['encrypt']);
  const ct=await subtle.encrypt({name:'AES-GCM', iv}, k, await subtle.exportKey('raw', key));
  return { wrap_salt:b64(salt), wrap_iv:b64(iv), wrapped_h:b64(ct) };
}
const LOGINS = { [sisA]:'sistera', [abd]:'abdullah', [fat]:'fatima', [elder]:'ammi' };
for (const [m,l] of Object.entries(LOGINS))
  await post('/auth/register',{ family_id:FAM, member_id:m, key_check:keyCheck, login:l, password:'333', ...(await wrapH('333')) });

function code(m,r,n){ return Buffer.from(JSON.stringify({f:FAM,h:rawH,m,r,n})).toString('base64').replace(/\+/g,'-').replace(/\//g,'_'); }
console.log('\n=== Amanah Care seeded ===');
console.log('family_id:', FAM, '| events:', count, '| today already done:', todayDone);
console.log('\nSISTER_A_CODE='+code(sisA,'family','Sister A'));
console.log('ABDULLAH_CODE='+code(abd,'family','Abdullah'));
console.log('FATIMA_CODE='+code(fat,'family','Fatima'));
console.log('AMMI_CODE='+code(elder,'elder','Ammi'));
console.log('\nLOGINS (password 333): sistera, abdullah, fatima, ammi');
console.log('SUBSCRIPTIONS:', Object.entries(SUBSCRIPTIONS).map(([m, kinds]) => `${NAMES[m]}=[${kinds.join(', ')}]`).join(' | '));
