// Amanah Care seed (T7.1). Populates a family so the demo is not empty (NR-03).
// Members: Ammi (elder), Sister A (sender), Abdullah, Fatima. Preferences + a few
// care items. No handoff is pre-seeded; Sister A creates those live so the sender
// record fills on screen. All payloads are AES-GCM encrypted here, like the browser.
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

const FAM = uuid().slice(0,8);
const elder = uuid(), sisA = uuid(), abd = uuid(), fat = uuid();

async function ev(type, payload, clear){ const c = payload?await encJSON(payload):{iv:'',payload_cipher:''};
  return post('/events',{ id:uuid(), family_id:FAM, type, occurred_at:now(), key_version:1, ...c, ...clear }); }

await post('/families',{ family_id:FAM, key_check:keyCheck, key_version:1, member:{id:elder, role:'elder'} });
await post(`/families/${FAM}/join`,{ key_check:keyCheck, member:{id:sisA, role:'family'} });
await post(`/families/${FAM}/join`,{ key_check:keyCheck, member:{id:abd,  role:'family'} });
await post(`/families/${FAM}/join`,{ key_check:keyCheck, member:{id:fat,  role:'family'} });

await ev('MemberJoined',{name:'Ammi'},{actor_id:elder});
await ev('MemberJoined',{name:'Sister A'},{actor_id:sisA});
await ev('MemberJoined',{name:'Abdullah'},{actor_id:abd});
await ev('MemberJoined',{name:'Fatima'},{actor_id:fat});
await ev('FamilyCreated',{elder_name:'Ammi'},{actor_id:elder});
await ev('PreferenceSet',{lang:'Urdu',diet:'halal, no gelatin',prayer:'prayer times matter',modesty:'female caregiver for personal care'},{actor_id:elder});

function code(m,r,n){ return Buffer.from(JSON.stringify({f:FAM,h:rawH,m,r,n})).toString('base64').replace(/\+/g,'-').replace(/\//g,'_'); }
console.log('\n=== Amanah Care seeded ===');
console.log('family_id:', FAM);
console.log('\nSISTER_A_CODE='+code(sisA,'family','Sister A'));
console.log('ABDULLAH_CODE='+code(abd,'family','Abdullah'));
console.log('FATIMA_CODE='+code(fat,'family','Fatima'));
