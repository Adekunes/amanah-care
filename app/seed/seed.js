// Amanah Care seed (T7.1). Builds a populated family so the demo does not start
// empty (NR-03): 1 family, elder + 2 caregivers, preferences, 4 care items, and
// 1 open handoff from Sister A to Brother B. All payloads are AES-GCM encrypted
// here with Node WebCrypto, exactly like the browser. Server still sees ciphertext.
//
// Prints two invite codes with pinned members. Paste one into each browser window:
//   window 1 -> Sister A, window 2 -> Brother B (the waiting handoff lands for B).
import { webcrypto as wc } from 'node:crypto';
const API = process.env.API || 'http://localhost:4000';
const subtle = wc.subtle;
const b64 = (buf)=>Buffer.from(buf).toString('base64');
const enc = (o)=>new TextEncoder().encode(JSON.stringify(o));
const uuid = ()=>wc.randomUUID();
const now = ()=>new Date().toISOString();

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
async function ev(type, payload, clear){ const c = payload?await encJSON(payload):{iv:'',payload_cipher:''};
  return post('/events',{ id:uuid(), family_id:FAM, type, occurred_at:now(), key_version:1, ...c, ...clear }); }

const FAM = uuid().slice(0,8);
const elder = uuid(), sisA = uuid(), broB = uuid();

// family + elder as first member
await post('/families',{ family_id:FAM, key_check:keyCheck, key_version:1, member:{id:elder, role:'elder'} });
// register the two caregivers
await post(`/families/${FAM}/join`,{ key_check:keyCheck, member:{id:sisA, role:'family'} });
await post(`/families/${FAM}/join`,{ key_check:keyCheck, member:{id:broB, role:'family'} });

// names (encrypted)
await ev('MemberJoined',{name:'Ammi'},{actor_id:elder});
await ev('MemberJoined',{name:'Sister A'},{actor_id:sisA});
await ev('MemberJoined',{name:'Brother B'},{actor_id:broB});
await ev('FamilyCreated',{elder_name:'Ammi'},{actor_id:elder});

// elder preferences (drives the strip)
await ev('PreferenceSet',{lang:'Urdu',diet:'halal, no gelatin',prayer:'prayer times matter',modesty:'female caregiver for personal care'},{actor_id:elder});

// 4 care items from Sister A
await ev('CareLogged',{text:'Fajr prayed'},{actor_id:sisA, category:'prayer'});
await ev('CareLogged',{text:'meds given (8am)'},{actor_id:sisA, category:'meds'});
await ev('CareLogged',{text:'ate half'},{actor_id:sisA, category:'meal'});
await ev('CareLogged',{text:'tired'},{actor_id:sisA, category:'mood'});

// 1 open handoff Sister A -> Brother B
const handoff_id = uuid();
await ev('HandoffOpened',
  { summary:'Fajr prayed, meds given (8am), ate half, tired', next:'Dhuhr meds at 1pm, physio at 3pm' },
  { actor_id:sisA, from_id:sisA, to_id:broB, handoff_id });

function code(m,r,n){ const o={f:FAM,h:rawH,m,r,n};
  return Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g,'-').replace(/\//g,'_'); }

console.log('\n=== Amanah Care seeded ===');
console.log('family_id:', FAM);
console.log('\nWindow 1 (Sister A) invite code:\n'+code(sisA,'family','Sister A'));
console.log('\nWindow 2 (Brother B) invite code:\n'+code(broB,'family','Brother B'));
console.log('\nElder (today view) invite code:\n'+code(elder,'elder','Ammi'));
console.log('\nPaste a code into the Join box in each browser window.\n');
