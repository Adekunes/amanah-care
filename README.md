# Amanah Care

A private care-handoff log for families caring for an elderly parent. Built for MuslimHacks 2026 (Elderly Care track). Every action is an event. Every payload is encrypted with a key only the family holds, so the server, and whoever runs it, sees ciphertext only.

## What it does

The family enters the elder's routine once (meds, meals, prayers, walks, pickups, appointments, who does what). Every day becomes a checklist. Caregivers log what was done in two taps, hand off to the next person with a card composed from the record (what happened from the log, what is next from the routine), and the recipient accepts. Home is a dashboard computed on the phone: who has the elder right now, done versus planned, mood and mobility last logged, next pickup and appointment, handoffs waiting, your own part, the last seven days and who carried the week. Record shows everything, day by day. The elder's preferences ride on top of every card. Each caregiver picks which events to hear about, sees them arrive in an Alerts tab with an unread badge, and can log out when done. Open the raw database and you see only scrambled text.

## Stack

- Redis Streams: append-only event log, one consumer group.
- Postgres: durable events table plus read models (handoffs, workload view).
- Node: `api` (command handler + read-model reads), `projector` (stream to Postgres), and `notifier` (stream to per-member alerts).
- Web: one responsive page, WebCrypto AES-GCM in the browser. No build step.
- Docker Compose: the whole stack in one command.

Cut-core scope. Notifications are by polling, not push. Consent filter, elder today view, and key rotation are on the roadmap, see `spec/REQUIREMENTS.md`.

## Run it

Six containers, one command:

```bash
cd app
docker compose up --build
```

No Docker? The same api and projector run in one process on an in-memory Postgres:

```bash
cd app && npm install && node dev/stack.mjs
```

Then, with either stack up, seed a populated family:

```bash
cd app/seed && npm install && API=http://localhost:4000 node seed.js
```

Open http://localhost:8080 in as many tabs as you have family members (each tab is its own session). Log in as `sistera`, `abdullah`, `fatima` or `ammi` with password 333, or paste a printed code into the Join box. The first join is always by code (it proves you were handed the key); after that, a login and password. The elder (`ammi`) gets her own large-type view.

## Tests

```bash
cd app && npm install && npm test          # 40 tests, in-process, no Docker
npm run coverage                            # api/app.js, projector/apply.js, web/crypto.js
```

The suite loads the real `db/init.sql` into an in-memory Postgres, runs the real Express routes, records every stream append and pushes it through the real projector before checking the read models. One test asserts that a logged note never appears in any server-side row. Notifier tests cover matching kinds to events, idempotent replay, and that nobody is notified of their own action.

## Pitch

`pitch/deck.html` (arrow keys), `pitch/Amanah-Care-pitch-deck.pdf`, and `pitch/Amanah-Care-explained.pdf` (the whole project in simple English, with the judge Q&A).

## Privacy model in one paragraph

On create, the browser makes a random 256-bit key H with WebCrypto. H never leaves the device. The server stores only a SHA-256 check-value of H, enough to prove possession, never to read data. Every payload is AES-GCM with a fresh 96-bit IV. Family is added in person by scanning a QR that carries H. See `spec/SPEC.md` section 7.

## Honest limits (on the pitch honesty slide)

- Support workers hold the same H, so the consent filter hides categories in the UI only, not by cryptography. A real product gives support a scoped key.
- Login stores H wrapped under a password-derived key (PBKDF2 + AES-GCM) next to a scrypt hash of the password. The server verifies the password and cannot open the wrap, but the wrap is only as strong as the password, and the demo default is 333.
- Auth is stubbed: the caller declares its member id and the server trusts it. The privacy story (server holds only ciphertext) does not depend on this.
- Notifications are demo-grade polling. A closed tab is reached when reopened.

## Layout

```
app/
  db/init.sql          schema: 4 tables + 1 view
  api/                 command handler + read models
  projector/           Redis Streams -> Postgres
  web/                 static page: crypto.js, app.js, index.html
  seed/                populated demo family
  docker-compose.yml
spec/                  SPEC, REQUIREMENTS, TASKS, AUDIT, diagrams
```

## Verification

The full flow was run locally against Postgres + Redis: write path through the projector, all read models, accept flipping status, workload updating, the three api guards (non-member rejected, non-elder consent rejected, elder consent allowed), the kill-switch showing only ciphertext, and a key-holder decrypting while a wrong key cannot.
