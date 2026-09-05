# Amanah Care

A private care-handoff log for families caring for an elderly parent. Built for MuslimHacks 2026 (Elderly Care track). Every action is an event. Every payload is encrypted with a key only the family holds, so the server, and whoever runs it, sees ciphertext only.

## What it does

Sister A logs care items, hands off to Brother B, B is notified, opens the card, reads what happened and what is next, and accepts. A workload bar counts who did what. The elder's preferences ride on top of every card. Open the raw database and you see only scrambled text.

## Stack

- Redis Streams: append-only event log, one consumer group.
- Postgres: durable events table plus read models (handoffs, workload view).
- Node: `api` (command handler + read-model reads) and `projector` (stream to Postgres).
- Web: one responsive page, WebCrypto AES-GCM in the browser. No build step.
- Docker Compose: the whole stack in one command.

Cut-core scope. Notifications are by polling, not push. Consent filter, elder today view, and key rotation are on the roadmap, see `spec/REQUIREMENTS.md`.

## Run it

```bash
cd app
docker compose up --build
```

Then, with the stack up, seed a populated family:

```bash
cd app/seed && npm install && API=http://localhost:4000 node seed.js
```

Open the web app at http://localhost:8080 in two browser windows. Paste the printed Sister A code into one Join box and the Brother B code into the other. The elder code opens the today view.

## Privacy model in one paragraph

On create, the browser makes a random 256-bit key H with WebCrypto. H never leaves the device. The server stores only a SHA-256 check-value of H, enough to prove possession, never to read data. Every payload is AES-GCM with a fresh 96-bit IV. Family is added in person by scanning a QR that carries H. See `spec/SPEC.md` section 7.

## Honest limits (on the pitch honesty slide)

- Support workers hold the same H, so the consent filter hides categories in the UI only, not by cryptography. A real product gives support a scoped key.
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
