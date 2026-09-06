# Amanah Care — full working codebase (the real thing, use THIS)

This is the actual, working code. It is **vanilla JS, no build step, no React, no framework.** Do NOT rewrite it in React. Do NOT add a bundler. Edit these files in place. Run with `docker compose up --build` from `app/`.

Order: docker-compose, db schema, api, projector, web (index.html, styles.css, crypto.js, app.js, nginx.conf, Dockerfile), seed, and the anti-slop CLAUDE.md. The QR lib at `app/web/vendor/qrcode.js` is vendored third-party (qrcode-generator 1.4.4) — do not touch it, not shown here.

## app/docker-compose.yml

```yaml
# Amanah Care. One command brings up the whole stack: docker compose up.
# Cut-core scope: web, api, projector, redis, postgres. Notifications by polling,
# so no separate notifier/SSE container (see REQUIREMENTS FR-05, KL-03).
services:
  redis:
    image: redis:7-alpine
    healthcheck:
      test: ["CMD","redis-cli","ping"]
      interval: 3s
      timeout: 3s
      retries: 20

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: amanah
      POSTGRES_PASSWORD: amanah
      POSTGRES_DB: amanah
    volumes:
      - ./db/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD-SHELL","pg_isready -U amanah"]
      interval: 3s
      timeout: 3s
      retries: 20

  api:
    build: ./api
    environment:
      PORT: 4000
      DATABASE_URL: postgres://amanah:amanah@postgres:5432/amanah
      REDIS_URL: redis://redis:6379
    ports: ["4000:4000"]
    depends_on:
      redis: { condition: service_healthy }
      postgres: { condition: service_healthy }

  projector:
    build: ./projector
    environment:
      DATABASE_URL: postgres://amanah:amanah@postgres:5432/amanah
      REDIS_URL: redis://redis:6379
    depends_on:
      redis: { condition: service_healthy }
      postgres: { condition: service_healthy }

  web:
    build: ./web
    ports: ["8080:8080"]
    depends_on: [api]
```

## app/db/init.sql

```sql
-- Amanah Care schema. 4 tables + 1 view. Server holds ciphertext only.
-- Deviation note: MVP uses a single Redis stream `events` with family_id as a
-- field, not one stream per family (AR-02). One consumer group. Post-hackathon
-- change. Everything else matches REQUIREMENTS.md.

CREATE TABLE IF NOT EXISTS families (
  id           TEXT PRIMARY KEY,
  key_check    TEXT NOT NULL,          -- SHA-256 hex of raw H. Proves key, never reveals it.
  key_version  INT  NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id),
  role       TEXT NOT NULL CHECK (role IN ('elder','family','support')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Member display name is NOT here. It lives encrypted in the MemberJoined event.

CREATE TABLE IF NOT EXISTS events (
  id            TEXT PRIMARY KEY,       -- client event uuid, used for idempotent upsert
  stream_id     TEXT,                   -- redis stream id (seq)
  family_id     TEXT NOT NULL,
  type          TEXT NOT NULL,
  actor_id      TEXT,
  category      TEXT,                   -- clear routing field for CareLogged
  from_id       TEXT,
  to_id         TEXT,
  handoff_id    TEXT,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  key_version   INT NOT NULL DEFAULT 1,
  iv            TEXT,                   -- base64 96-bit nonce, unique per ciphertext (SR-10)
  payload_cipher TEXT                   -- base64 AES-GCM ciphertext. Server cannot read.
);
CREATE INDEX IF NOT EXISTS events_family_idx ON events(family_id, occurred_at);
CREATE INDEX IF NOT EXISTS events_type_idx   ON events(family_id, type);

CREATE TABLE IF NOT EXISTS handoffs (
  id            TEXT PRIMARY KEY,
  family_id     TEXT NOT NULL,
  from_id       TEXT NOT NULL,
  to_id         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged')),
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  acked_at      TIMESTAMPTZ,
  iv            TEXT,
  summary_cipher TEXT
);
CREATE INDEX IF NOT EXISTS handoffs_to_idx ON handoffs(family_id, to_id, status);

-- Workload = metadata counts only. No ciphertext touched. History, not roster.
CREATE OR REPLACE VIEW workload_view AS
SELECT family_id,
       actor_id AS member_id,
       date_trunc('day', occurred_at)::date AS day,
       count(*) FILTER (WHERE type = 'CareLogged')    AS care_count,
       count(*) FILTER (WHERE type = 'HandoffAcknowledged') AS handoff_count
FROM events
WHERE actor_id IS NOT NULL
GROUP BY family_id, actor_id, date_trunc('day', occurred_at)::date;
```

## app/api/package.json

```json
{
  "name": "amanah-api",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "express": "^4.19.2",
    "pg": "^8.12.0",
    "redis": "^4.7.0"
  }
}
```

## app/api/server.js

```javascript
// Amanah Care API. Command handler + read-model reads.
// Write path: validate member -> XADD to the events stream -> 202.
// Read path: read Postgres projections. Server never sees plaintext.
import express from 'express';
import { createClient } from 'redis';
import pg from 'pg';

const PORT = process.env.PORT || 4000;
const STREAM = 'events';

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', (e) => console.error('[api] redis', e.message));
await redis.connect();

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use((req, res, next) => { res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'content-type');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204); next(); });

const uuid = () => (globalThis.crypto?.randomUUID?.() ?? String(Date.now()) + Math.random().toString(16).slice(2));

// Events that bootstrap identity and so cannot require an existing member row.
const BOOTSTRAP = new Set(['FamilyCreated', 'MemberJoined']);
// Only the elder may change consent (SR-07, Deferred but guard kept honest).
const ELDER_ONLY = new Set(['ConsentChanged']);

async function isMember(familyId, memberId) {
  if (!familyId || !memberId) return null;
  const r = await db.query('SELECT id, role FROM members WHERE id=$1 AND family_id=$2', [memberId, familyId]);
  return r.rows[0] || null;
}

app.get('/health', (_req, res) => res.json({ ok: true }));

// Create a family. Client sends id, key_check, key_version, and the first member.
app.post('/families', async (req, res) => {
  const { family_id, key_check, key_version = 1, member } = req.body || {};
  if (!family_id || !key_check || !member?.id || !member?.role)
    return res.status(400).json({ error: 'family_id, key_check, member{id,role} required' });
  await db.query(
    'INSERT INTO families(id,key_check,key_version) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING',
    [family_id, key_check, key_version]);
  await db.query(
    'INSERT INTO members(id,family_id,role) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING',
    [member.id, family_id, member.role]);
  res.status(201).json({ family_id });
});

// Join check: prove you hold H by matching key_check, then register the member.
app.post('/families/:id/join', async (req, res) => {
  const familyId = req.params.id;
  const { key_check, member } = req.body || {};
  const fam = (await db.query('SELECT key_check, key_version FROM families WHERE id=$1', [familyId])).rows[0];
  if (!fam) return res.status(404).json({ error: 'no such family' });
  if (fam.key_check !== key_check) return res.status(403).json({ error: 'wrong key' });
  if (!member?.id || !member?.role) return res.status(400).json({ error: 'member{id,role} required' });
  await db.query('INSERT INTO members(id,family_id,role) VALUES($1,$2,$3) ON CONFLICT (id) DO NOTHING',
    [member.id, familyId, member.role]);
  res.status(201).json({ family_id: familyId, key_version: fam.key_version });
});

// Append any event. Trusted client-declared actor_id (SR-11 stub, labelled).
app.post('/events', async (req, res) => {
  const e = req.body || {};
  if (!e.family_id || !e.type) return res.status(400).json({ error: 'family_id and type required' });

  if (!BOOTSTRAP.has(e.type)) {
    const m = await isMember(e.family_id, e.actor_id);
    if (!m) return res.status(403).json({ error: 'not a member of this family' });
    if (ELDER_ONLY.has(e.type) && m.role !== 'elder')
      return res.status(403).json({ error: 'only the elder may change consent' });
  }

  const id = e.id || uuid();
  const fields = {
    id, family_id: e.family_id, type: e.type,
    actor_id: e.actor_id ?? '', category: e.category ?? '',
    from_id: e.from_id ?? '', to_id: e.to_id ?? '', handoff_id: e.handoff_id ?? '',
    key_version: String(e.key_version ?? 1),
    iv: e.iv ?? '', payload_cipher: e.payload_cipher ?? '',
    occurred_at: e.occurred_at || new Date().toISOString(),
  };
  const streamId = await redis.xAdd(STREAM, '*', fields);
  res.status(202).json({ id, stream_id: streamId });
});

// Read models -----------------------------------------------------------------

// Latest PreferenceSet event for a family (client decrypts to render the strip).
app.get('/families/:id/preferences', async (req, res) => {
  const r = await db.query(
    `SELECT id, iv, payload_cipher, key_version, occurred_at
       FROM events WHERE family_id=$1 AND type='PreferenceSet'
       ORDER BY occurred_at DESC LIMIT 1`, [req.params.id]);
  res.json(r.rows[0] || null);
});

// Care items since a given time (client decrypts).
app.get('/families/:id/care', async (req, res) => {
  const since = req.query.since || '1970-01-01';
  const r = await db.query(
    `SELECT id, actor_id, category, iv, payload_cipher, key_version, occurred_at
       FROM events WHERE family_id=$1 AND type='CareLogged' AND occurred_at >= $2
       ORDER BY occurred_at ASC`, [req.params.id, since]);
  res.json(r.rows);
});

// Handoffs, optionally filtered to a recipient. Drives the poll (FR-05).
app.get('/families/:id/handoffs', async (req, res) => {
  const { to, status } = req.query;
  const cond = ['family_id=$1']; const args = [req.params.id];
  if (to)     { args.push(to);     cond.push(`to_id=$${args.length}`); }
  if (status) { args.push(status); cond.push(`status=$${args.length}`); }
  const r = await db.query(
    `SELECT id, from_id, to_id, status, opened_at, acked_at, iv, summary_cipher
       FROM handoffs WHERE ${cond.join(' AND ')} ORDER BY opened_at DESC`, args);
  res.json(r.rows);
});

// Workload counts per member. Metadata only, no decryption (FR-09, AR-08).
app.get('/families/:id/workload', async (req, res) => {
  const r = await db.query(
    `SELECT member_id,
            sum(care_count)::int    AS care_count,
            sum(handoff_count)::int AS handoff_count
       FROM workload_view WHERE family_id=$1
       GROUP BY member_id ORDER BY care_count DESC`, [req.params.id]);
  res.json(r.rows);
});

app.get('/families/:id/members', async (req, res) => {
  const r = await db.query('SELECT id, role, joined_at FROM members WHERE family_id=$1', [req.params.id]);
  res.json(r.rows);
});

// Kill-switch view: raw rows so judges see only ciphertext (FR-18).
app.get('/debug/events', async (req, res) => {
  const r = await db.query(
    `SELECT family_id, type, actor_id, category, iv, payload_cipher, occurred_at
       FROM events ORDER BY occurred_at DESC LIMIT 50`);
  res.json(r.rows);
});

app.listen(PORT, () => console.log(`[api] listening on ${PORT}`));
```

## app/api/Dockerfile

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
EXPOSE 4000
CMD ["node","server.js"]
```

## app/projector/package.json

```json
{
  "name": "amanah-projector",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "index.js",
  "scripts": { "start": "node index.js" },
  "dependencies": {
    "pg": "^8.12.0",
    "redis": "^4.7.0"
  }
}
```

## app/projector/index.js

```javascript
// Amanah Care projector. One consumer group on the events stream.
// Copies each event into Postgres (idempotent upsert by event id) and keeps
// the handoffs read model current. Never decrypts anything.
import { createClient } from 'redis';
import pg from 'pg';

const STREAM = 'events';
const GROUP = 'projector';
const CONSUMER = 'projector-1';

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const redis = createClient({ url: process.env.REDIS_URL });
redis.on('error', (e) => console.error('[projector] redis', e.message));
await redis.connect();

// Create the consumer group once. MKSTREAM makes the stream if absent.
try {
  await redis.xGroupCreate(STREAM, GROUP, '0', { MKSTREAM: true });
  console.log('[projector] group created');
} catch (e) {
  if (!String(e.message).includes('BUSYGROUP')) throw e;
  console.log('[projector] group exists');
}

async function applyEvent(id, f) {
  // Idempotent: same event id replays harmlessly (AR-04, crash-safe upsert).
  await db.query(
    `INSERT INTO events(id,stream_id,family_id,type,actor_id,category,from_id,to_id,handoff_id,key_version,iv,payload_cipher,occurred_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO NOTHING`,
    [f.id, id, f.family_id, f.type, f.actor_id || null, f.category || null,
     f.from_id || null, f.to_id || null, f.handoff_id || null,
     parseInt(f.key_version || '1', 10), f.iv || null, f.payload_cipher || null,
     f.occurred_at || new Date().toISOString()]);

  if (f.type === 'HandoffOpened') {
    await db.query(
      `INSERT INTO handoffs(id,family_id,from_id,to_id,status,opened_at,iv,summary_cipher)
       VALUES($1,$2,$3,$4,'open',$5,$6,$7)
       ON CONFLICT (id) DO NOTHING`,
      [f.handoff_id || f.id, f.family_id, f.from_id, f.to_id,
       f.occurred_at || new Date().toISOString(), f.iv || null, f.payload_cipher || null]);
  }

  if (f.type === 'HandoffAcknowledged') {
    await db.query(
      `UPDATE handoffs SET status='acknowledged', acked_at=$2
         WHERE id=$1 AND status='open'`,
      [f.handoff_id, f.occurred_at || new Date().toISOString()]);
  }
}

console.log('[projector] consuming...');
for (;;) {
  let resp;
  try {
    resp = await redis.xReadGroup(GROUP, CONSUMER,
      [{ key: STREAM, id: '>' }], { COUNT: 20, BLOCK: 5000 });
  } catch (e) { console.error('[projector] read', e.message); continue; }
  if (!resp) continue;
  for (const stream of resp) {
    for (const msg of stream.messages) {
      try {
        await applyEvent(msg.id, msg.message);
        await redis.xAck(STREAM, GROUP, msg.id);
      } catch (e) {
        console.error('[projector] apply failed, will retry', msg.id, e.message);
        // no ack -> stays in the pending list, retried on restart
      }
    }
  }
}
```

## app/projector/Dockerfile

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.js ./
CMD ["node","index.js"]
```

## app/web/index.html

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="theme-color" content="#0b7a6b">
<title>Amanah Care</title>
<link rel="stylesheet" href="styles.css">
</head>
<body>
<div class="wrap">

  <!-- LANDING -->
  <section id="view-landing">
    <div class="group">
      <h1>Amanah Care</h1>
      <p class="muted">A private handoff log for families caring for an elder. Only your family holds the key. The server sees scrambled text.</p>
    </div>

    <div class="card">
      <div class="group">
        <h2>Start a family</h2>
        <p class="muted">Makes the key on this device. It never leaves.</p>
      </div>
      <div class="stack tight">
        <div class="field"><label for="c-elder">Elder's name</label>
          <input id="c-elder" placeholder="e.g. Ammi"></div>
        <div class="field"><label for="c-name">Your name</label>
          <input id="c-name" placeholder="e.g. Sister A"></div>
        <div class="field"><label for="c-role">Your role</label>
          <select id="c-role"><option value="family">Family</option><option value="elder">Elder</option></select></div>
      </div>
      <button id="btn-create">Create family + key</button>
    </div>

    <div class="card">
      <div class="group">
        <h2>Join your family</h2>
        <p class="muted">Scan the family QR, or paste the invite code someone gave you in person.</p>
      </div>
      <div class="stack tight">
        <div class="field"><label for="j-code">Invite code</label>
          <textarea id="j-code" placeholder="paste code"></textarea></div>
        <div class="field"><label for="j-name">Your name</label>
          <input id="j-name" placeholder="e.g. Brother B"></div>
        <div class="field"><label for="j-role">Your role</label>
          <select id="j-role"><option value="family">Family</option><option value="support">Support worker</option><option value="elder">Elder</option></select></div>
      </div>
      <button id="btn-join" class="ghost">Join with key</button>
    </div>
  </section>

  <!-- INVITE (after create) -->
  <section id="view-invite" class="hide">
    <div class="group">
      <h1>Family ready</h1>
      <p class="muted">Add the rest of your family in person.</p>
    </div>
    <div class="card">
      <div class="group">
        <h2>Show this to their phone</h2>
        <p class="muted">The key is inside the code. Share it face to face, never in a chat.</p>
      </div>
      <div id="qr"></div>
      <div class="field"><label for="invite-code">Invite code</label>
        <textarea id="invite-code" readonly></textarea></div>
      <button id="btn-copy" class="ghost small">Copy code</button>
    </div>
    <button id="btn-enter">Enter the app</button>
  </section>

  <!-- APP -->
  <section id="view-app" class="hide">
    <div id="whoami" class="whoami">
      <span class="who-dot" id="who-dot"></span>
      <span class="who-name" id="who-name">—</span>
      <span class="who-role" id="who-role"></span>
    </div>
    <nav class="tabs">
      <button data-tab="log" class="on">Log</button>
      <button data-tab="handoff">Hand off</button>
      <button data-tab="inbox">Inbox</button>
      <button data-tab="prefs">Prefs</button>
      <button data-tab="invite">Invite</button>
      <button data-tab="flow">Flow</button>
    </nav>

    <div id="strip" class="strip hide"></div>

    <!-- LOG -->
    <div id="tab-log" class="tabview">
      <div class="card">
        <div class="group">
          <h2>Log care</h2>
          <p class="muted">Pick a category, then what happened. A note is optional.</p>
        </div>
        <div class="group">
          <span class="eyebrow">Category</span>
          <div id="cat-row" class="chips"></div>
        </div>
        <div class="group">
          <span class="eyebrow" id="preset-label">What happened</span>
          <div id="preset-row" class="chips"></div>
        </div>
        <div class="field"><label for="log-note">Note (optional)</label>
          <input id="log-note" placeholder="e.g. ate half"></div>
        <button id="btn-log" disabled>Log item</button>
      </div>

      <div class="card">
        <div class="card-head"><h2>Today so far</h2><span class="pill" id="today-count">0</span></div>
        <div id="care-today"><p class="muted">Nothing logged yet.</p></div>
      </div>
    </div>

    <!-- HANDOFF -->
    <div id="tab-handoff" class="tabview hide">
      <div class="card">
        <div class="group">
          <h2>Hand off</h2>
          <p class="muted">The summary is built from what you logged. You only write what comes next.</p>
        </div>
        <div class="field"><label for="ho-member">Hand off to</label>
          <select id="ho-member"></select></div>
        <div class="field"><label for="ho-summary">What happened (auto)</label>
          <textarea id="ho-summary" readonly></textarea></div>
        <div class="field"><label for="ho-next">What is next (you write this)</label>
          <textarea id="ho-next" placeholder="e.g. Dhuhr meds at 1pm, physio at 3pm"></textarea></div>
        <div id="ho-preview" class="preview hide"></div>
        <button id="btn-handoff">Send handoff</button>
      </div>

      <div class="card">
        <div class="card-head"><h2>Your handoffs</h2><span class="pill" id="sent-count">0</span></div>
        <p class="muted">Everything you sent, and who has it now. You are the sender, so this is your record.</p>
        <div id="sent"></div>
      </div>
    </div>

    <!-- INBOX -->
    <div id="tab-inbox" class="tabview hide">
      <div class="group">
        <div class="card-head"><h2>Handoffs to you</h2><span class="muted">checks every 4s</span></div>
        <div id="inbox"></div>
      </div>
      <div class="card">
        <div class="group">
          <h2>Workload this week</h2>
          <p class="muted">Counted from event metadata. The server never reads a note to build this.</p>
        </div>
        <div id="workload"><p class="muted">Loading…</p></div>
      </div>
    </div>

    <!-- PREFS -->
    <div id="tab-prefs" class="tabview hide">
      <div class="card">
        <div class="group">
          <h2>Elder preferences</h2>
          <p class="muted">Rides on top of every handoff card. Encrypted like everything else.</p>
        </div>
        <div class="stack tight">
          <div class="field"><label for="p-lang">Language</label>
            <input id="p-lang" placeholder="e.g. Urdu"></div>
          <div class="field"><label for="p-diet">Diet</label>
            <input id="p-diet" placeholder="e.g. halal, no gelatin"></div>
          <div class="field"><label for="p-prayer">Prayer</label>
            <input id="p-prayer" placeholder="e.g. prayer times matter"></div>
          <div class="field"><label for="p-modesty">Modesty / caregiver gender</label>
            <input id="p-modesty" placeholder="e.g. female caregiver for personal care"></div>
        </div>
        <button id="btn-prefs">Save preferences</button>
      </div>
    </div>

    <!-- INVITE (in-app: add members at any time) -->
    <div id="tab-invite" class="tabview hide">
      <div class="card">
        <div class="group">
          <h2>Add someone to this family</h2>
          <p class="muted">Hold this QR up to their phone, or copy the code and hand it over in person. The family key is inside it, so never paste it into a chat.</p>
        </div>
        <div id="qr-app"></div>
        <div class="field"><label for="invite-code-app">Invite code</label>
          <textarea id="invite-code-app" readonly></textarea></div>
        <button id="btn-copy-app" class="ghost small">Copy code</button>
        <div class="warnbox">They choose their own name and role on the Join screen. A support worker holds the same key as family, so the card is not filtered for them yet.</div>
      </div>
    </div>

    <!-- FLOW -->
    <div id="tab-flow" class="tabview hide">
      <div class="card">
        <div class="group">
          <h2>Where your data goes</h2>
          <p class="muted">Every write takes the same six hops. The tag on each one says whether that hop can actually read what it is holding.</p>
        </div>
        <div class="legend">
          <span class="tag read">Readable</span>
          <span class="tag seal">Sealed · ciphertext only</span>
        </div>
      </div>

      <div class="card">
        <div class="card-head">
          <h2>Your last write</h2>
          <span class="pill" id="flow-what">nothing yet</span>
        </div>
        <div id="flow" class="flow"></div>
      </div>

      <div class="card">
        <div class="group">
          <h2>What the database actually stores</h2>
          <p class="muted">Live rows from Postgres. This is what we, the operators, can see.</p>
        </div>
        <button id="btn-proof" class="ghost small">Refresh from DB</button>
        <div id="proof" class="mono">tap refresh</div>
      </div>
    </div>

  </section>

  <div id="sendfx" class="sendfx hide">
    <div class="sendfx-inner">
      <div class="sendfx-title">Sending, sealed end to end</div>
      <div class="pipe">
        <div class="node" data-i="0">You<span>plaintext + H</span></div>
        <div class="seg"><span class="packet">🔒</span></div>
        <div class="node" data-i="1">Server<span>ciphertext only</span></div>
        <div class="seg"><span class="packet">🔒</span></div>
        <div class="node" data-i="2" id="sendfx-to">Recipient<span>decrypts with H</span></div>
      </div>
      <div class="sendfx-done hide" id="sendfx-done">Delivered. Waiting for them to accept.</div>
    </div>
  </div>

</div>
<script src="vendor/qrcode.js"></script>
<script type="module" src="app.js"></script>
</body>
</html>
```

## app/web/styles.css

```css
/* Amanah Care. Phone-first, one column, 44px targets (PR-02).
   System font stack on purpose: the demo must render with no network. */
:root{
  --bg:#f2f5f4; --card:#ffffff;
  --ink:#14201d; --ink-2:#4a5a56; --muted:#77857f;
  --line:#e0e7e4; --line-2:#cbd8d3;
  --brand:#0b7a6b; --brand-ink:#063f38; --brand-soft:#e4f0ed;
  --warn:#b4451f; --warn-soft:#fdeede;
  --seal:#8a5713; --seal-soft:#f7ecd9;
  --r:14px; --r-sm:10px;
  --shadow:0 1px 2px rgba(6,63,56,.05), 0 10px 24px -18px rgba(6,63,56,.35);
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);
  font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:480px;margin:0 auto;padding:20px 16px 48px;min-height:100vh}

/* ---- type ---- */
h1{font-size:24px;line-height:1.2;letter-spacing:-.02em;margin:4px 0 8px}
h2{font-size:15px;line-height:1.3;letter-spacing:-.01em;margin:0 0 4px}
.muted{color:var(--muted);font-size:13.5px;line-height:1.5}
.eyebrow{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;
  color:var(--muted)}

/* ---- rhythm: layout owns spacing, not inline spacers ---- */
.stack{display:flex;flex-direction:column;gap:14px}
.stack.tight{gap:8px}
.field{display:flex;flex-direction:column;gap:5px}
section,.tabview{display:flex;flex-direction:column;gap:18px}
.group{display:flex;flex-direction:column;gap:10px}

/* ---- controls ---- */
button{min-height:46px;border:0;border-radius:var(--r);padding:0 18px;font-size:15px;
  font-weight:600;background:var(--brand);color:#fff;cursor:pointer;width:100%;
  font-family:inherit;transition:background .12s,border-color .12s}
button:hover{background:#0a6b5e}
button:active{transform:translateY(1px)}
button:disabled{background:var(--line);color:var(--muted);cursor:not-allowed;transform:none}
button.ghost{background:#fff;color:var(--brand-ink);border:1.5px solid var(--line-2)}
button.ghost:hover{background:var(--brand-soft);border-color:var(--brand)}
button.small{width:auto;min-height:40px;padding:0 14px;font-size:13.5px}
:focus-visible{outline:2.5px solid var(--brand);outline-offset:2px}

input,select,textarea{width:100%;min-height:46px;border:1.5px solid var(--line-2);
  border-radius:var(--r);padding:11px 13px;font-size:16px;background:#fff;
  font-family:inherit;color:var(--ink)}
input:focus,select:focus,textarea:focus{border-color:var(--brand);outline:none}
textarea{min-height:76px;resize:vertical;line-height:1.5}
textarea[readonly]{background:#f7faf9;color:var(--ink-2)}
label{font-size:12.5px;font-weight:600;color:var(--ink-2)}

/* ---- cards ---- */
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--r);
  padding:16px;box-shadow:var(--shadow);display:flex;flex-direction:column;gap:12px}
.card.flat{box-shadow:none}
.card-head{display:flex;justify-content:space-between;align-items:center;gap:10px}

/* ---- tabs: one row, scrolls instead of wrapping ---- */
.tabs{display:flex;gap:6px;margin:-20px -16px 0;padding:14px 16px;position:sticky;top:0;
  background:var(--bg);border-bottom:1px solid var(--line);z-index:5;
  overflow-x:auto;scrollbar-width:none;scroll-snap-type:x proximity;scroll-padding:0 16px}
.tabs::-webkit-scrollbar{display:none}
.tabs button{width:auto;flex:0 0 auto;min-height:38px;padding:0 14px;font-size:13.5px;
  border-radius:999px;background:#fff;color:var(--ink-2);border:1.5px solid var(--line);
  scroll-snap-align:start}
.tabs button.on{background:var(--brand-ink);color:#fff;border-color:var(--brand-ink)}

/* ---- chips ---- */
.chips{display:flex;flex-wrap:wrap;gap:7px}
.chip{background:#fff;color:var(--ink-2);border:1.5px solid var(--line-2);
  border-radius:999px;padding:0 14px;font-size:13.5px;font-weight:600;cursor:pointer;
  min-height:40px;width:auto}
#cat-row .chip{text-transform:capitalize}
.chip:hover{background:var(--brand-soft);border-color:var(--brand)}
.chip.on{background:var(--brand);border-color:var(--brand);color:#fff}
.chip.on:hover{background:#0a6b5e}

/* ---- preference strip ---- */
.strip{background:var(--brand-ink);color:#dff0ec;border-radius:var(--r);padding:12px 14px;
  display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13px}
.sbit{display:flex;flex-direction:column;gap:1px;min-width:0}
.sbit i{font-style:normal;font-size:10px;font-weight:700;letter-spacing:.09em;
  text-transform:uppercase;color:#7fc3b6}
.sbit b{font-weight:600;color:#fff}

/* ---- pills, bars, items ---- */
.pill{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;
  padding:4px 10px;border-radius:999px;background:var(--brand-soft);color:var(--brand-ink);
  white-space:nowrap}
.pill.open{background:var(--warn-soft);color:var(--warn)}
.pill.acknowledged{background:var(--brand-soft);color:var(--brand)}
.bar{height:8px;background:var(--line);border-radius:999px;overflow:hidden}
.bar>span{display:block;height:100%;background:var(--brand);border-radius:999px}
.item{display:flex;flex-direction:column;gap:2px;padding:10px 0;
  border-bottom:1px solid var(--line)}
.item:first-child{padding-top:0}
.item:last-child{padding-bottom:0;border-bottom:0}
.item .top{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
.wl{display:flex;flex-direction:column;gap:5px}
.wl .top{display:flex;justify-content:space-between;gap:10px;font-size:13.5px}
.tnum{font-variant-numeric:tabular-nums}

/* ---- flow ---- */
.flow{display:flex;flex-direction:column;gap:0}
.hop{display:grid;grid-template-columns:26px 1fr;gap:0 12px;position:relative}
.hop .rail{display:flex;flex-direction:column;align-items:center;gap:0}
.hop .dot{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;
  font-size:11px;font-weight:700;background:#fff;border:2px solid var(--line-2);
  color:var(--muted);flex:0 0 auto;font-variant-numeric:tabular-nums}
.hop.readable .dot{border-color:var(--brand);color:var(--brand);background:var(--brand-soft)}
.hop.sealed .dot{border-color:var(--seal);color:var(--seal);background:var(--seal-soft)}
.hop .line{width:2px;flex:1;background:var(--line-2);min-height:14px}
.hop:last-child .line{background:transparent}
.hop .body{padding:0 0 16px;display:flex;flex-direction:column;gap:6px;min-width:0}
.hop .name{font-size:14.5px;font-weight:700;letter-spacing:-.01em;display:flex;
  flex-wrap:wrap;gap:8px;align-items:center}
.hop .where{font-size:11.5px;color:var(--muted);font-family:ui-monospace,Menlo,monospace}
.hop .holds{font-size:13px;color:var(--ink-2)}
.tag{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  padding:3px 8px;border-radius:999px;white-space:nowrap}
.tag.read{background:var(--brand-soft);color:var(--brand)}
.tag.seal{background:var(--seal-soft);color:var(--seal)}
.tag.ms{background:var(--line);color:var(--ink-2);font-variant-numeric:tabular-nums}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;
  line-height:1.5;background:#0e1b18;color:#7fe3cd;padding:6px 12px;
  border-radius:var(--r-sm);max-height:230px;overflow:auto;
  -webkit-overflow-scrolling:touch}
.prow{display:flex;flex-direction:column;gap:2px;padding:8px 0;
  border-bottom:1px solid rgba(127,227,205,.12)}
.prow:last-child{border-bottom:0}
.prow .clear{display:flex;gap:8px;flex-wrap:wrap}
.prow .k{color:#8ff0d4;font-weight:600}
.prow .cat{color:#6b8f88}
.prow .seal{color:#e0a951;word-break:break-all}
.legend{display:flex;flex-wrap:wrap;gap:8px}

/* ---- misc ---- */
.warnbox{background:var(--warn-soft);border:1px solid #f0c7ad;color:#8f3616;
  border-radius:var(--r);padding:12px 14px;font-size:13px;line-height:1.5}
.notebox{background:var(--brand-soft);border:1px solid #bcdcd4;color:var(--brand-ink);
  border-radius:var(--r);padding:12px 14px;font-size:13px;line-height:1.5}
.hide{display:none !important}
#qr,#qr-app{display:flex;justify-content:center;padding:14px;background:#fff;
  border:1px solid var(--line);border-radius:var(--r)}
#qr img,#qr-app img{width:190px;height:190px;image-rendering:pixelated}
.toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);
  background:var(--brand-ink);color:#fff;padding:11px 20px;border-radius:999px;
  font-size:14px;font-weight:600;z-index:50;box-shadow:0 8px 24px -8px rgba(6,63,56,.5)}
@media (prefers-reduced-motion:reduce){*{transition:none !important}}
#invite-code,#invite-code-app,#j-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-size:12px;line-height:1.5;min-height:96px}

/* ---- handoff preview ---- */
.preview{background:var(--chip,#eef4f2);border:1.5px solid var(--line);border-radius:12px;
  padding:10px 12px;margin:8px 0}
.pv-row{display:flex;gap:10px;font-size:14px;padding:2px 0}
.pv-row span{color:var(--muted);min-width:110px}
.pv-row b{flex:1}

/* ---- sender record: sent handoffs ---- */
.sent-group{border:1.5px solid var(--line);border-radius:12px;padding:10px 12px;margin:10px 0}
.sent-head{font-size:15px;margin-bottom:6px}
.sent-row{border-top:1px solid var(--line);padding:8px 0}
.sent-row:first-of-type{border-top:0}
.sent-top{display:flex;gap:8px;align-items:center;margin-bottom:4px}
.sent-what{font-size:14px;line-height:1.4}
.sent-row.flash{animation:flash 1.4s ease}
@keyframes flash{0%{background:#dff0ec}100%{background:transparent}}
.pill.acknowledged{background:#dff0ec;color:var(--ok,#0b7a6b)}
.pill.open{background:#fdeede;color:var(--warn,#b4451f)}

/* ---- send animation overlay ---- */
.sendfx{position:fixed;inset:0;background:rgba(10,20,18,.55);display:flex;
  align-items:center;justify-content:center;z-index:60;backdrop-filter:blur(2px)}
.sendfx-inner{background:#fff;border-radius:18px;padding:22px 20px;max-width:420px;width:90%;
  box-shadow:0 20px 60px rgba(0,0,0,.3)}
.sendfx-title{font-weight:700;text-align:center;margin-bottom:18px}
.pipe{display:flex;align-items:center;gap:6px}
.node{flex:1;text-align:center;font-weight:700;font-size:13px;color:#9aa;
  border:2px solid var(--line);border-radius:12px;padding:10px 4px;transition:.3s}
.node span{display:block;font-weight:500;font-size:11px;color:#bbb;margin-top:3px}
.node.on{color:var(--brand-ink,#063f38);border-color:var(--brand,#0b7a6b);background:#eef7f4}
.node.on span{color:var(--muted,#6b6b6b)}
.seg{position:relative;flex:0 0 42px;height:3px;background:var(--line)}
.seg .packet{position:absolute;top:-11px;left:-6px;font-size:16px;opacity:0}
.seg.go{background:linear-gradient(90deg,var(--brand) 0%,var(--line) 100%)}
.seg.go .packet{animation:travel .7s ease forwards}
@keyframes travel{0%{left:-6px;opacity:1}100%{left:calc(100% - 8px);opacity:1}}
.sendfx-done{text-align:center;margin-top:16px;color:var(--ok,#0b7a6b);font-weight:600}

/* ---- flow hops light up in sequence ---- */
#flow .hop{opacity:.35;transition:opacity .3s, transform .3s}
#flow .hop.lit{opacity:1}
#flow .hop.lit .dot{box-shadow:0 0 0 4px rgba(11,122,107,.18)}

/* who is signed in on this window */
.whoami{display:flex;align-items:center;gap:8px;padding:8px 12px;margin-bottom:6px;
  background:var(--card,#fff);border:1.5px solid var(--line);border-radius:12px;position:sticky;top:0;z-index:6}
.who-dot{width:14px;height:14px;border-radius:50%;background:#999;flex:0 0 auto}
.who-name{font-weight:800;font-size:15px}
.who-role{font-size:12px;color:var(--muted,#6b6b6b);text-transform:uppercase;letter-spacing:.04em;
  background:var(--chip,#eef4f2);padding:2px 8px;border-radius:999px}
```

## app/web/crypto.js

```javascript
// Amanah Care client crypto. All plaintext lives and dies in the browser.
// H is a 256-bit AES-GCM key made with WebCrypto. Never sent to the server.
// Every ciphertext carries a fresh random 96-bit IV (SR-10). key_check is the
// SHA-256 of the raw key bytes, hex (SR-02): proves possession, reveals nothing.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64 = {
  from: (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))),
  to:   (s)   => Uint8Array.from(atob(s), c => c.charCodeAt(0)),
};

export async function makeKey() {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportKeyRaw(key) {
  return b64.from(await crypto.subtle.exportKey('raw', key)); // base64 of 32 bytes
}

export async function importKeyRaw(b64raw) {
  const raw = b64.to(b64raw);
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
}

export async function keyCheck(key) {
  const raw = await crypto.subtle.exportKey('raw', key);
  const hash = await crypto.subtle.digest('SHA-256', raw);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}

// Returns { iv, cipher } both base64. New IV every call.
export async function encryptJSON(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit nonce
  const data = enc.encode(JSON.stringify(obj));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  return { iv: b64.from(iv), cipher: b64.from(ct) };
}

export async function decryptJSON(key, ivB64, cipherB64) {
  if (!cipherB64) return null;
  try {
    const iv = b64.to(ivB64);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, b64.to(cipherB64));
    return JSON.parse(dec.decode(pt));
  } catch { return null; } // wrong key or tampered -> null, caller shows a lock
}
```

## app/web/app.js

```javascript
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
// Show who is signed in on THIS window (tabs otherwise look identical).
function renderWhoAmI(){
  if(!ME) return;
  const name = ME.my_name || 'Me';
  const role = ME.role || '';
  const el = document.getElementById('who-name'); if(el) el.textContent = name;
  const rl = document.getElementById('who-role'); if(rl) rl.textContent = role;
  const dot = document.getElementById('who-dot');
  let hsh=0; for(const c of name) hsh=(hsh*31 + c.charCodeAt(0))>>>0;
  if(dot) dot.style.background = `hsl(${hsh % 360} 60% 45%)`;
  document.title = `${name} \u00b7 Amanah Care`;
}
async function enterApp(){
  show('app'); renderWhoAmI(); tab('log');
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
  await loadNames().catch(()=>{});
  const members = await api(`/families/${ME.family_id}/members`);
  const sel = $('#ho-member'); sel.innerHTML='';
  members.filter(m=>m.id!==ME.member_id).forEach(m=>{
    const o=document.createElement('option'); o.value=m.id; o.textContent=`${nameOf(m.id)} (${m.role})`; sel.appendChild(o); });
  $('#ho-summary').value = 'composing…';
  const items = await careSince(lastHandoffAt || new Date(Date.now()-12*3600e3).toISOString());
  $('#ho-summary').value = items.length
    ? items.map(i=>i.text).join(', ')
    : 'Nothing new since your last handoff.';
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
  // group by recipient
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
        <div class="sent-what"><b>Sent:</b> ${esc(p.summary||'—')}</div>
        <div class="sent-what"><b>Next:</b> ${esc(p.next||'—')}</div>
      </div>`);
    }
    groups.push(`<div class="sent-group">
      <div class="sent-head">To <b>${esc(nameOf(to))}</b><span class="muted"> · ${list.length} handoff${list.length>1?'s':''}</span></div>
      ${rowsHtml.join('')}
    </div>`);
  }
  box.innerHTML=groups.join('');
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
  try{ if(typeof renderSent==='function') await renderSent(false); }catch(e){}
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
  animateHops();
}

// ---- wire up ----
$('#btn-create').onclick = ()=>createFamily().catch(e=>toast(e.message));
$('#btn-join').onclick   = ()=>joinFamily().catch(e=>toast(e.message));
$('#btn-enter').onclick  = ()=>enterApp();
$('#btn-copy').onclick   = ()=>{ navigator.clipboard?.writeText($('#invite-code').value); toast('Copied'); };
$('#btn-copy-app').onclick = ()=>{ navigator.clipboard?.writeText($('#invite-code-app').value); toast('Copied'); };
$('#btn-log').onclick    = ()=>logItem().catch(e=>toast(e.message));
$('#btn-handoff').onclick= ()=>openHandoff().catch(e=>toast(e.message));
$('#ho-member').onchange = updateHandoffPreview;
$('#ho-next').oninput    = updateHandoffPreview;
$('#btn-prefs').onclick  = ()=>savePrefs().catch(e=>toast(e.message));
$('#btn-proof').onclick  = ()=>refreshProof().catch(e=>toast(e.message));
$$('.tabs button').forEach(b=>b.onclick=()=>tab(b.dataset.tab));

// resume session if present
loadSession().then(ok=>{ if(ok) enterApp(); else show('landing'); });
```

## app/web/nginx.conf

```
server {
  listen 8080;
  root /usr/share/nginx/html;
  index index.html;
  # Demo app: never cache, so a rebuild is always what the browser gets.
  add_header Cache-Control "no-store, no-cache, must-revalidate, max-age=0" always;
  location / { try_files $uri $uri/ /index.html; }
}
```

## app/web/Dockerfile

```dockerfile
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html
EXPOSE 8080
```

## app/seed/package.json

```json
{ "name":"amanah-seed","version":"0.1.0","private":true,"type":"module","main":"seed.js",
  "scripts":{"start":"node seed.js"} }
```

## app/seed/seed.js

```javascript
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
```

## CLAUDE.md

```markdown
# Amanah Care — coding rules for AI agents (anti-slop)

This file loads automatically when you work in this repo. Follow it exactly. Read `agents/HANDOFF.md` before touching code.

## Scope (the #1 cause of slop)
- Do ONLY what was asked. Nothing extra.
- No new files, features, dependencies, or refactors unless the task names them.
- Do not widen, narrow, or "improve" the task on your own.
- If two readings are possible, ask ONE question, then proceed. Do not guess and build.
- Smallest diff that solves it. Change the fewest lines.

## No slop
- No placeholder, fake, or mocked code passed off as working. If it is a stub, say "stub".
- No dead code, no commented-out blocks, no leftover TODOs, no console.log spam.
- Do not reinvent what exists. Search first: `esc()`, `api()`, `postEvent()`, `encryptJSON()`, `decryptJSON()`, `nameOf()`, `renderSent()` already exist in `app/web/app.js` and `crypto.js`.
- No new abstraction for a single use. No new library or framework unless asked.
- No emoji in code. No decorative comments. Comment only the non-obvious "why", not the "what".
- Do not write long READMEs or docs unless asked. Match the length of the task.

## Match this codebase (do not change its shape)
- Web is vanilla ES modules, no build step, served by nginx. Keep it that way.
- Crypto only through `crypto.js`. Never roll your own. Never send H or plaintext to the server. Never log secrets.
- Server stores ciphertext only. Clear fields are routing metadata only (type, actor_id, category, ids, timestamps).
- One global Redis stream `events`, one consumer group. Do not change the architecture without being asked.
- One column, phone-first UI, 44px touch targets, no hover-only controls.

## Verify before you say "done" (the other #1 cause of slop)
- Rebuild and load the page. Check the browser console for errors first: one top-level syntax error blanks the entire app (a duplicate `esc` did exactly this once).
- Rebuild the web container after web edits: `docker compose up -d --build web`. nginx has no-store headers, but hard-reload with `?v=<timestamp>` when testing.
- Exercise the real flow, not just "it compiles". Say exactly what you ran and what you saw.
- Do not claim a test passed or a coverage number you did not actually produce.

## Honesty
- Report failures with the real error text. Never say "done" if it is not.
- Do not invent APIs, fields, or file paths. Confirm they exist before using them.
- State your assumptions in one line.

## Before you finish
- Re-read your own diff. Delete anything not required by the task.
- Run `/code-review` (or the `simplify` skill) on your change and fix what it flags.
- Do not push to GitHub unless the owner explicitly says so.

## If you catch yourself doing any of these, stop
- Adding "while I'm here" changes.
- Creating a file nobody asked for.
- Writing a paragraph where one line works.
- Building the deferred/roadmap items (see `agents/HANDOFF.md` §5) without being asked.
- Explaining instead of doing, or doing instead of asking when it is genuinely ambiguous.
```
