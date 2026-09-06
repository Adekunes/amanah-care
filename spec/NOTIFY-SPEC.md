# Alerts + logout: the shared contract (2026-09-05, session 3)

Ten agents build this in parallel. Each owns the files listed in §7 and touches nothing else. Every interface below is fixed; do not rename anything. Repo: `~/code/amanah-care`. App code under `app/`. ES modules everywhere (`"type":"module"`). No new npm dependencies. Do not run docker. Do not commit.

## 1. Kinds (subscription strings)

| kind | fires on | recipients |
|---|---|---|
| `handoff.to_me` | `HandoffOpened` | only `to_id` |
| `handoff.accepted` | `HandoffAcknowledged` | only the handoff's `from_id` (look up `handoffs.from_id` by `handoff_id`) |
| `care.meds` `care.meal` `care.prayer` `care.mobility` `care.mood` `care.appointment` `care.transport` `care.note` | `CareLogged` with that `category` | every subscriber |
| `care.*` | any `CareLogged` | every subscriber |
| `prefs` | `PreferenceSet` | every subscriber |
| `routine` | `RoutineSet` | every subscriber |
| `member` | `MemberJoined` | every subscriber |
| `emergency` | `EmergencyRaised` | every member of the family, always-on (see note) |

Rules: never notify the event's own `actor_id`. One notification row per (event, member) even if several kinds match; store the first matching kind in table order above. Default kinds for a new member: `handoff.to_me`, `handoff.accepted`, `emergency`. Elder members (role `elder`) get no defaults and the UI hides the Alerts tab for them.

`emergency` is always-on and cannot be turned off: `recipients()` sends it to every member of the event's family (`extra.members`, looked up by `apply.js` from the `members` table) except the actor, regardless of what is in `subscriptions` for them. The subscriptions UI reflects this by rendering its checkbox permanently checked and disabled, and always including `'emergency'` in what it saves, but the API itself does not special-case `PUT`: a caller that omits `emergency` from the body still has it delivered, because delivery for this kind never consults `subscriptions` at all. `EmergencyRaised` carries only routing fields (`family_id`, `type`, `actor_id`, `occurred_at`); its payload may be empty or an encrypted note. It is not a bootstrap event, so the normal membership check applies to whoever raises it.

`KINDS` (the canonical ordered list) is exported from `app/api/routes/subscriptions.js` AND duplicated in `app/notifier/match.js` (no cross-imports between services).

## 2. Tables

Already in `app/db/init.sql`: `subscriptions(member_id, family_id, kind)` PK `(member_id, kind)`; `notifications(event_id, member_id, family_id, kind, type, category, from_id, handoff_id, occurred_at, created_at, read_at)` PK `(event_id, member_id)`.

## 3. Notifier service (`app/notifier/`)

- `match.js`: `export const KINDS = [...]` (order as §1). `export function kindsFor(fields)` → array of kinds this event can satisfy, e.g. CareLogged/meds → `['care.meds','care.*']`, HandoffOpened → `['handoff.to_me']`, unknown type → `[]`. `export function recipients(fields, subs, extra = {})` → array of `{ member_id, kind }` to notify. `subs` = rows `{ member_id, kind }` for the family. `extra.handoff_from_id` for `handoff.accepted`. Excludes `fields.actor_id`. `handoff.to_me` only for `fields.to_id`. One entry per member (first matching kind).
- `apply.js`: `export async function notify(db, streamId, fields)` → loads the family's subscriptions, loads `handoffs.from_id` when type is `HandoffAcknowledged`, inserts rows into `notifications` with `ON CONFLICT (event_id, member_id) DO NOTHING`, returns the number of rows attempted. `fields` are the raw stream fields (strings; empty string means null; `occurred_at` ISO string, default now).
- `index.js`: same shape as `app/projector/index.js` but group `notifier`, consumer `notifier-1`, calling `notify(db, msg.id, msg.message)`, ack on success.
- `package.json` like the projector's (deps `pg`, `redis`), `Dockerfile` like the projector's, copying `index.js apply.js match.js`.
- `docker-compose.yml`: add service `notifier` (build `./notifier`, same env and depends_on as `projector`).

## 4. API (`app/api/routes/`)

Mounted by `app/api/app.js` (already wired): `mountSubscriptions(app, ctx)` and `mountNotifications(app, ctx)` where `ctx = { db, wrap, isMember }`. `wrap` is the async-route wrapper; `isMember(familyId, memberId)` returns the member row or null.

`subscriptions.js`:
- `export const KINDS`.
- `export async function ensureDefaults(db, familyId, memberId, role)` → inserts the default kinds (none for `elder`) with `ON CONFLICT DO NOTHING`. Called by app.js on family create and join (already wired).
- `GET /families/:id/members/:mid/subscriptions` → `{ member_id, kinds: [...] }` (200, empty list if none; 403 if not a member).
- `PUT /families/:id/members/:mid/subscriptions` body `{ kinds: [...] }` → 400 if not an array or any kind unknown; 403 if not a member; replaces the whole set (DELETE then INSERT); returns `{ member_id, kinds }` in canonical order.

`notifications.js`:
- `GET /families/:id/notifications?member=<mid>&unread=1&limit=50` → 400 without `member`; rows newest first: `{ event_id, kind, type, category, from_id, handoff_id, occurred_at, read_at, iv, payload_cipher }` joined from `events` on `event_id = events.id` (LEFT JOIN so a row still returns if the projector is behind). `unread=1` filters `read_at IS NULL`. `limit` default 50, max 200.
- `POST /families/:id/notifications/read` body `{ member_id, event_ids: [...] }` or `{ member_id, all: true }` → 400 without member_id or without ids/all; sets `read_at = now()` where `read_at IS NULL`; returns `{ updated: <int> }`.

## 5. Web (`app/web/`)

`app.js` exposes (already wired) `window.amanah = { get me(), get key(), api, decryptJSON, nameOf, toast, esc, fmtWhen, isElder, tab, onEnter(fn), onPoll(fn), onTab(name, fn) }`. `onEnter` runs once after the app is entered (after names/members are loaded). `onPoll` runs every poll cycle (4 s). `onTab('alerts', fn)` runs when the Alerts tab is opened. `api(path, opts)` returns parsed JSON and throws on non-2xx. `decryptJSON(key, iv, cipher)` → object or null.

`alerts.js` (loaded after app.js by `index.html`, already wired) implements the Alerts tab using only `window.amanah`:
- Subscriptions editor: one checkbox per kind in `#alerts-subs` with human labels ("Handoffs to me", "My handoff accepted", "Meds logged", …, "Any care logged", "Preferences changed", "Routine changed", "Someone joined"), loaded from GET, saved by `#btn-subs-save` via PUT, toast on save.
- Alert list in `#alerts-list`: newest first; each row shows who (`nameOf(from_id)`), what (decrypted `text`/`summary` from the event payload when present, else a label from type/category), when (`fmtWhen`), unread rows highlighted; `#btn-alerts-read` marks all read.
- Badge `#alerts-badge` on the tab button = unread count, updated on every poll; hidden when 0.
- Nothing for elder members (`isElder()` → do nothing; the tab is hidden for them).

`index.html` gets: nav button `<button data-tab="alerts">Alerts<span id="alerts-badge" class="badge hide">0</span></button>` after Inbox; `<div id="tab-alerts" class="tabview hide">` with two cards: subscriptions (`#alerts-subs`, `#btn-subs-save`) and alerts (`#alerts-list`, `#btn-alerts-read`); and in the identity bar `<button id="btn-logout" class="ghost small" type="button">Log out</button>`. `styles.css` gets the matching styles (`.alert-row`, `.alert-row.unread`, `.subs` grid) in the existing visual language.

Logout (`app.js`, function `logout()` wired to `#btn-logout`): stop the poll timer, clear `sessionStorage`, set `KEY = null; ME = null`, reset caches, remove `body.elder`, show the landing view with the login card, toast "Logged out".

## 6. Seed, dev stack, tests, docs

- `seed/seed.js`: after history and before today's items, PUT subscriptions: Sister A `handoff.to_me, handoff.accepted, care.mood, care.meds`; Fatima `handoff.to_me, handoff.accepted, care.meds, care.appointment`; Abdullah `handoff.to_me, handoff.accepted, care.transport`; Ammi none. Print one line listing them.
- `dev/stack.mjs`: after `applyEvent`, call `notify(db, id, fields)` from `../notifier/apply.js`.
- Tests (`app/test/`): `notifier.test.js` (match + notify on pg-mem, replay idempotent, no self-notify, handoff recipients), `subscriptions.test.js` (routes above, defaults on create/join, read marking). `helpers.mjs` `project()` must also run `notify` after `applyEvent`. `package.json` coverage script adds `--test-coverage-include='api/routes/*.js' --test-coverage-include='notifier/match.js' --test-coverage-include='notifier/apply.js'`.
- Docs: README (Alerts, logout, notifier container), `agents/HANDOFF.md` §4 and file map, `pitch/deck.html` + `pitch/explainer.html` (honesty slide "real" column: alerts with per-member subscriptions and a notifier on the stream; architecture card mentions the notifier; roadmap loses "reminders"? no, keep), regenerate the two PDFs with the headless Chrome command in HANDOFF §4.

## 7. Ownership (one owner per file)

| Agent | Files |
|---|---|
| A1 notifier-core | `app/notifier/match.js`, `app/notifier/apply.js` |
| A2 notifier-service | `app/notifier/index.js`, `app/notifier/package.json`, `app/notifier/Dockerfile`, `app/docker-compose.yml` |
| A3 api-subscriptions | `app/api/routes/subscriptions.js` |
| A4 api-notifications | `app/api/routes/notifications.js` |
| A5 web-markup | `app/web/index.html`, `app/web/styles.css` |
| A6 web-alerts | `app/web/alerts.js` |
| A7 web-logout | `app/web/app.js` (only `logout()` and its wiring; hooks already exist) |
| A8 tests | `app/test/notifier.test.js`, `app/test/subscriptions.test.js`, `app/test/helpers.mjs`, `app/package.json` |
| A9 seed-devstack | `app/seed/seed.js`, `app/dev/stack.mjs` |
| A10 docs | `README.md`, `agents/HANDOFF.md`, `pitch/deck.html`, `pitch/explainer.html`, the two PDFs |
