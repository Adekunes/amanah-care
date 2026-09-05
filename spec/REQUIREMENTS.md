# Requirements register: Amanah Care MVP

Extracted from SPEC.md, 2026-09-05. One row = one testable requirement. No code here. IDs are stable so the two audit agents can reference them.

Priority: M = must for demo, S = should, C = cut-list (drop first if behind), D = deferred to roadmap, built only as a labelled stub or shown on the honesty slide.

Scope locked 2026-09-05 after two audit rounds: cut core. Key sharing is QR in person. The consent filter, live push, elder today view, reminder, and key rotation are Deferred.

## FR: Functional requirements

| ID | Requirement | Priority | Spec source |
|---|---|---|---|
| FR-01 | A family can be created, producing a family_id, key_check, key_version | M | S6, S9 |
| FR-02 | A member can join a family with a role of elder, family, or support | M | S6 |
| FR-03 | A caregiver can log a care item in one of 8 categories: meds, meal, prayer, mobility, mood, appointment, transport, note. Each category offers quick-tap chip presets plus an optional free-text note, so a full log is a few taps, not typing | M | S3, S6 |
| FR-04 | A caregiver can open a handoff to a chosen member. The summary is auto-composed from the items already logged this turn; the caregiver types only the next steps | M | S3 |
| FR-05 | The target member is notified when a handoff opens, by the browser polling the read model every 3 to 5 seconds. SSE and web push are Deferred | M | S3, S5 |
| FR-06 | The target member sees a decrypted card: preference strip, what happened, what is next | M | S3 |
| FR-07 | The target member can accept a handoff, emitting HandoffAcknowledged | M | S3 |
| FR-08 | An unaccepted handoff stays open, A stays on duty, reminder after 30 min | D | S3 |
| FR-09 | Workload count per member is shown, sourced from event metadata only | M | S3, S9 |
| FR-10 | The elder can set per-category sharing consent; only elder member_id may emit ConsentChanged. Enforcement clause is folded here (was SR-07) | D | S8 |
| FR-11 | A support-worker reader sees a filtered card, hiding categories the elder blocked. UI-only filter, see KL-01 | D | S8 |
| FR-12 | A family reader sees the full card. Folded into FR-06 for the cut-core demo; distinct only once filtering exists | D | S8 |
| FR-13 | The elder has a read-only today view: large text, own language with right-to-left layout and an Urdu/Arabic webfont, a "call family" button, who is here, who is next, what happened | D | S8 |
| FR-14 | Preferences (language, diet, prayer, modesty, caregiver gender) can be set and render as a strip on every card | M | S3, S6 |
| FR-15 | Family is invited by scanning a QR code carrying H, shown device to device in person. The `#` invite link is kept only as a labelled fallback | M | S7 |
| FR-16 | Lost key, someone still has H: re-share by fresh invite link, no rotation | S | S7 |
| FR-17 | Lost key, nobody has H: family confirms KeyRotated, old ciphertext sealed, new events use H2, warning shown first | D | S7 |
| FR-18 | Kill-switch demo: the raw Postgres table shows only ciphertext blobs | M | S3, S7, S11 |

## SR: Security and privacy requirements

| ID | Requirement | Priority | Spec source |
|---|---|---|---|
| SR-01 | H is generated in-browser with WebCrypto, 256-bit, and never sent to the server | M | S7 |
| SR-02 | Server stores only key_check (a hash of H), never H | M | S7 |
| SR-03 | Every encrypted payload uses AES-GCM with H, stored as ciphertext plus key_version | M | S7 |
| SR-04 | H travels only by in-person QR or the `#` fragment, never inside a URL posted to a chat app. The UI offers no "share to WhatsApp" action. The `#` fragment is never transmitted to the server | M | S7 |
| SR-05 | Server-visible data limited to: family ids, member ids, roles, event types, categories, timestamps, counts | M | S7 |
| SR-06 | Server never holds readable names, preferences, care notes, or handoff summaries | M | S7 |
| SR-07 | api rejects ConsentChanged from any actor that is not the elder. Enforcement clause for FR-10, Deferred with it | D | S8 |
| SR-08 | api rejects any command from a non-member of that family | M | S5 |
| SR-09 | No advice fields exist in the event schema and no triage UI exists anywhere. No diagnosis or dosage suggestion | M | S6 |
| SR-10 | Every ciphertext stores a fresh random 96-bit IV. No IV is ever reused under H | M | round-2 audit |
| SR-11 | Demo auth is a trusted client-declared member_id, not verified. Real identity proof is out of scope and named on the honesty slide | M | round-2 audit |

## AR: Architecture and data requirements

| ID | Requirement | Priority | Spec source |
|---|---|---|---|
| AR-01 | Every state change is an append-only event; 8 event types defined in S6 | M | S5, S6 |
| AR-02 | Redis Streams is the event store, one stream per family: `family:{id}:events` | M | S5 |
| AR-03 | api appends to the stream via XADD and returns 202 | M | S5 |
| AR-04 | projector consumes the stream via a consumer group, writes events into Postgres | M | S5 |
| AR-05 | notifier consumes the stream via a second consumer group, pings on HandoffOpened. Deferred: cut-core uses browser polling (FR-05), one consumer group | D | S5 |
| AR-06 | Postgres holds exactly: families, members, events, handoffs, plus workload_view | M | S9 |
| AR-07 | handoffs is a projector-built read model with status open or acknowledged | M | S9 |
| AR-08 | workload_view is a SQL view over event metadata, touching no ciphertext | M | S9 |
| AR-09 | All services run under one Docker Compose: web, api, projector, notifier, redis, postgres | M | S5 |
| AR-10 | Fallback: notifier may merge into projector if time-short, keeping two consumer groups | C | S5 |

## PR: Platform and UX requirements

| ID | Requirement | Priority | Spec source |
|---|---|---|---|
| PR-01 | MVP is a responsive web page in the phone browser; native mobile is out of scope | M | S4 |
| PR-02 | Every screen is one column, minimum 44px touch targets, no hover states, phone width first | M | S4 |
| PR-03 | Elder today view runs in a tablet browser, kiosk mode, large text, right-to-left when the language needs it | D | S4, S8 |
| PR-04 | Demo runs as two browser windows on one laptop | M | S3, S4 |

## NR: Non-functional and demo requirements

| ID | Requirement | Priority | Spec source |
|---|---|---|---|
| NR-01 | Sister A full flow works end to end (log, hand off) | M | S10 |
| NR-02 | Brother B full flow works end to end (ping, open, accept, workload) | M | S10 |
| NR-03 | Seed data present: 1 family, 3 members (elder, Sister A, Brother B), 4 care items, 1 open handoff | S | S10 |
| NR-04 | Dry run passes twice before pitch | M | S10 |
| NR-05 | Pitch deck: slide 1 carries the three figures (1 in 4 vs 16%, 52%, 18% vs 7%). Honesty slide last, listing what works, what is mocked, and the KL-01 same-H limit and the SR-11 auth stub as not-built | M | S11 |

## KL: Known limitations, stated on the honesty slide

| ID | Limitation | Priority | Spec source |
|---|---|---|---|
| KL-01 | Support workers hold the same H, so the consent filter hides categories in the UI only, not by cryptography. A real product gives support a separate scoped key | M | S8 |
| KL-02 | Auth is stubbed: the caller declares member_id and the server trusts it. Anyone who knows the ids could forge events. The privacy story (server holds only ciphertext) does not depend on this | M | SR-11 |
| KL-03 | Notifications are demo-grade polling, not push. A closed tab is not reached until reopened | M | FR-05 |

## Optional read model

| ID | Item | Priority | Spec source |
|---|---|---|---|
| OP-01 | care_timeline read model, add only if the demo feels slow | C | S9 |
