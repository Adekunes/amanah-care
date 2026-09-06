# Amanah Care — full handoff for the next AI agent

Read this top to bottom before touching anything. Current as of **2026-09-05, 19:20 EDT** (hackathon day 1 evening). It supersedes `agents/README.md` where they disagree. `agents/OWNER-NOTES.md` holds the owner's verbatim directives; read it too.

---

## 0. Take over in 60 seconds

- Project: **Amanah Care**, a private care record for families caring for an elderly Muslim parent. **MuslimHacks 2026, Elderly Care track**, Concordia University, Montreal, 5–6 Sep 2026. Demo/judging is day 2 (Sun 6 Sep).
- Owner: **Abdul Quayum Adekunle** (GitHub `Adekunes`). Partner: **safio** (GitHub), write access on the repo.
- GitHub: `git@github.com:Adekunes/amanah-care.git` (private). GitHub `main` is at `48f7ee0`. **Four local commits since are NOT pushed** (see §6). Do not push without the owner saying so.
- Two machines:
  - **This one (RS work Mac, user `abdulrsmac`)**: repo at `~/code/amanah-care/`. `gh` is authed as `Rselectronic` (no access to the repo). No Docker yet (see §3). Owner chose this Mac for the live demo.
  - **Owner's other Mac**: repo at `~/Developer/muslimhacks-2026-elderly-care/`, Docker Desktop installed, `gh` authed as Adekunes. It has commit `48f7ee0`; it does NOT have the four new commits.
- Stack: **Redis Streams** (event log), **Postgres** (read models), **Node** api + projector, **vanilla JS + WebCrypto** web app, **Docker Compose**. Plus a **one-process dev stack** with no Docker.

Run it right now on this Mac (no Docker needed):
```bash
cd ~/code/amanah-care/app
npm install                                   # pg-mem for the in-memory Postgres
node dev/stack.mjs                            # api :4000 + web :8080, in memory
cd seed && API=http://localhost:4000 node seed.js   # prints SISTER_A / ABDULLAH / FATIMA / AMMI codes
# open http://localhost:8080 and http://127.0.0.1:8080, paste a different code in each Join box
```
Tests: `cd ~/code/amanah-care/app && npm test` (40 tests, ~2.5 s) and `npm run coverage`.

---

## 1. What the product is (pinned this session)

- **The elder is not the app user.** Owner: elders are not tech savvy; care happens on WhatsApp and is not trackable. The **family caregivers are the users**; the elder is the subject and owns the preferences. Do not rework the app around "elder as sender".
- The app is **the track of everything about the elder** that WhatsApp loses: the routine (meds, meals, prayers, walks, pickups/drop-offs, appointments), what was actually done and by whom, the handoff, the load per person, and the elder's preferences. All encrypted with the family key H; server stores ciphertext only.
- Owner's words: it should be **"a dashboard that makes sense, has metrics that need tracking, and feels personal to all."** Metrics are counts and last values against the family's own plan. Never judgments, never diagnosis/triage (challenge constraint).
- Pitch framing (owner): **simple**, and pitched as **"we solved a problem"**, with the **diagnosis first** and **proper evidence**, and it must **answer all the judge questions** from the rubric.

---

## 2. Challenge + judging context

`~/Downloads/MuslimHacks-2026-Challenges.pdf` (8 pages; page 3 = Elderly Care) and `~/Downloads/MuslimHacks Judging Rubric.pdf` (3 pages). Extracted text lives in the session scratchpad only; the facts you need:

- Focus areas: caregiver handoffs, workload visibility, personal preferences, elder participation (visibility + control over what is shared).
- Constraints: health info needs consent + privacy; no diagnosis/dosage/triage; "Muslim-friendly" is not one setting.
- Before-you-build questions: primary user? why better than the family WhatsApp group? who can access the data and who controls it?
- Format: one core workflow working end to end in 24 h; keep 1–2 h for the pitch.
- Rubric: Business 40% (solves problem, easy to use, sustainable cost, research), Delivery 30% (live demo works, clearly presented, convincing, follow-up answers), Technical 30% (architecture, code quality, performance, **tested with coverage metrics**, process).
- Verified stats (guide p.3, ISPU): 1 in 4 American Muslims care for an older adult vs 16% general public; 52% of Muslims 30–49 care for an elder (21% of 18–29, 31% of 50+); 18% vs 7% struggle to find culturally appropriate caregivers. Plus (web-verified this session) Statistics Canada CSS 2022: 42% of Canadians 15+ gave unpaid care, 13.4 M, 1.8 M sandwiched; Collins & Kishita 2020 meta-analysis: ~31% depression, ~49% burden among dementia family caregivers. Sources with URLs are on the deck's last slide.

---

## 3. Docker on this Mac (DONE 2026-09-05 ~22:10)

Docker Desktop 4.89 (engine 29.7.2) is installed in `/Applications/Docker.app`; CLI at `/usr/local/bin/docker` (not in the agent shell's PATH by default: `export PATH="/usr/local/bin:$PATH"`). Context `desktop-linux`, socket `~/.docker/run/docker.sock`. The owner ran the brew cask install himself (it needs sudo). The compose stack was built and verified: 5 containers, Postgres has `families, members, events, handoffs, logins` + `workload_view`, the projector consumer group `projector` reads `events`, seed produced 105 events / 4 handoffs / 4 logins, login works against real Postgres. The `web` image serves the new UI with no-store.

```bash
export PATH="/usr/local/bin:$PATH"
cd ~/code/amanah-care/app
docker compose up -d --build                      # start / rebuild
docker compose down && docker compose up -d --build   # clean reset (no named volume, data is gone)
cd seed && API=http://localhost:4000 node seed.js     # new family + logins sistera/abdullah/fatima/ammi, pw 333
docker compose ps; docker compose logs -f projector
```
`node dev/stack.mjs` stays as the fallback (same api/projector code, in-memory Postgres). Ports clash: stop one before starting the other (`pkill -f dev/stack.mjs` / `docker compose stop`).

## 4. What is BUILT (all local, committed, not pushed)

Base (from `48f7ee0`, owner + safio): family create, join by QR/code, Log (category → preset chips), preference strip, hand off with auto summary, inbox polling every 4 s, accept, workload bar, Flow tab (6 hops with timings), proof/kill-switch view, in-app Invite tab, identity bar, handoff preview, send animation, sender record, nginx no-store.

Added this session:
- **Tests + coverage** (`538d8d2`): `app/api/app.js` exports `createApp({db, redis})`; `app/api/server.js` is the wiring. `app/projector/apply.js` exports `applyEvent(db, streamId, fields)`; `index.js` is the loop. `app/test/` runs the real routes in-process on the real `db/init.sql` loaded into pg-mem, with a fake stream whose entries are pushed through the real projector. 40 tests: guards, stream fields, read models, handoff lifecycle, workload from metadata, AES-GCM round trip, tamper rejection, and a **privacy test** asserting a logged note is absent from every server-side row, stream entry and API response. Coverage on api/app.js, projector/apply.js, web/crypto.js: **100% lines, 90% branches, 100% functions**. Async route errors answer 500 JSON. The workload view uses `count(CASE ...)` (same result as `FILTER`, runs in pg-mem).
- **New read endpoints**: `GET /families/:id/routine` (latest RoutineSet), `GET /families/:id/events?type=X` (one type, ciphertext rows, replaces the 50-row `/debug/events` for names), `GET /families/:id/workload?since=YYYY-MM-DD`.
- **Home dashboard** (`b7ec6b2`, `app/web/app.js` `renderHome()`): hero with who has the elder now (from the handoff chain, day-aware time), today's plan progress; tiles: meds/meals/prayers done vs planned, mobility and mood last logged, handoffs waiting, next pickup/drop-off, next appointment; today's plan checklist (tap Done logs a `CareLogged` with `routine_id`); "your part today"; last 7 days strip; who carried the week (workload, this week only, zero rows hidden). Inbox tab badge shows open handoffs for you.
- **Routine tab**: items `{id, category, label, time 'HH:MM', days: 'daily'|'weekdays'|'mon'..'sun', who: memberId|''}` saved as ONE encrypted `RoutineSet` event (whole list each save, like PreferenceSet). Dirty flag until saved.
- **Record tab**: 30 days of `CareLogged`, grouped by day, category filter chips.
- **Hand off**: "what is next" pre-filled from routine items still open today (editable).
- **Seed** (`app/seed/seed.js`): Ammi's 15-item routine, six days of history with rotating caregivers, four accepted past handoffs, today's items before now−90 min already logged by Sister A, mood at 10:00. Prints `SISTER_A_CODE`, `ABDULLAH_CODE`, `FATIMA_CODE`, `AMMI_CODE`. Each run makes a NEW family; old codes die with the old family (and the in-memory stack forgets everything on restart).
- **Dev stack** (`app/dev/stack.mjs`), **`app/package.json`** with `test` and `coverage` scripts, devDependency `pg-mem`.
- **Login + elder view + per-tab sessions** (commit after `d8e7ac4`): `logins` table; `POST /auth/register` (needs family `key_check` + existing member; stores scrypt hash + PBKDF2/AES-GCM-wrapped H made on the phone) and `POST /auth/login` (returns wrapped material; browser unwraps with the password). `web/crypto.js` `wrapKey`/`unwrapKey`. Landing has a Log in card; create/join end on a "Set your login" screen (skippable). Seed registers `sistera`, `abdullah`, `fatima`, `ammi`, password `333`. Sessions are in `sessionStorage` (one tab = one phone; three tabs on one origin = three members). `role === 'elder'` switches to the elder view (`renderElderHome()`, tabs Today / My week / My preferences / Invite, `body.elder` styles). 46 tests.
- **Pitch** (`6034913`, `pitch/`): `deck.html` (21 slides, arrow keys, click, `#n`), `Amanah-Care-pitch-deck.pdf`, `explainer.html` + `Amanah-Care-explained.pdf` (simple English, demo commands, all judge Q&A, sources). Regenerate PDFs with headless Chrome:
  `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$PWD/Amanah-Care-pitch-deck.pdf" "file://$PWD/deck.html"` (the CVDisplayLink errors it prints are harmless).

---

## 5. DEFERRED (on the honesty slide, not built)

Elder consent filter + audience filtering (needs a scoped support key); RTL Urdu/Arabic for the elder view (the view itself is built); SSE/web push (polling instead); 30-minute reminders; key rotation; password policy, rate limiting and recovery (login exists, default password 333); native mobile; any AI. **AI decision (owner asked, agent advised, owner accepted): AI only at the edge, on the phone, opt-in per family; never on the server; nothing built tonight because a cloud model call would contradict the privacy claim on stage.** Candidate edge features: free text/voice → structured log items; plain-sentence or Urdu/Arabic summaries; "patterns, not predictions" counts. On-device route: Chrome built-in AI (Prompt/Summarizer/Translator on Gemini Nano, stable on desktop) or Apple on-device models.

---

## 6. Repo state (IMPORTANT)

```
6034913 docs(pitch): slide deck, simple-English explainer, judge Q&A, sources   <- local only
b7ec6b2 feat(web): Home dashboard, elder routine, record tab, one-process dev stack <- local only
538d8d2 test: in-process suite with coverage for api, projector and client crypto  <- local only
48f7ee0 UX pass on the handoff app + full agent handoff                             <- on GitHub main
fa042c6 Merge branch 'add-members-from-the-page'                                    <- safio's merge
```
Working tree clean. Commits are authored as the owner with the Fable co-author line. **Push only when the owner says so**; from this Mac that needs either `gh auth login` as Adekunes or Rselectronic added as a collaborator (`gh api -X PUT repos/Adekunes/amanah-care/collaborators/Rselectronic` from the other Mac, then accept the invite). Coordinate with safio so nobody clobbers `main`; safio's last work is already in `fa042c6`.

---

## 7. Architecture + deviations (unchanged in substance)

- One global Redis stream `events` with `family_id` as a field (deviation from AR-02), one consumer group. Post-hackathon: per-family streams.
- api: POST /events validates membership then XADD, 202. Guards: non-members rejected; `ConsentChanged` elder-only. Auth stubbed.
- projector: idempotent upsert by event id; builds `handoffs`; workload is a SQL view over metadata.
- web: ES module + WebCrypto; dashboard/routine/record computed client-side after decryption.
- Data model: `families`, `members`, `events`, `handoffs` + `workload_view`. Names/notes/summaries/preferences/routine live only inside encrypted payloads. Payload shapes: `CareLogged {text, routine_id?}`, `HandoffOpened {summary, next}`, `PreferenceSet {lang, diet, prayer, modesty}`, `RoutineSet {items:[...]}`, `MemberJoined {name}`, `FamilyCreated {elder_name}`.

## 8. Privacy model (unchanged)

Browser-made 256-bit AES-GCM key H, never sent; server stores `key_check` = SHA-256 hex of raw H; fresh 96-bit IV per ciphertext; join by QR in person (`{f,h}` base64url), seed codes also pin a member `{f,h,m,r,n}`; `#`-fragment link is a labelled fallback. Known limits on the honesty slide: same H for support workers, stubbed auth, polling.

---

## 9. Demo script (day 2)

1. Reset + seed (Docker: `docker compose down && docker compose up -d --build`, then seed. Dev stack: restart `node dev/stack.mjs`, then seed).
2. Three tabs on `localhost:8080`: log in as `sistera`, `fatima`, `ammi` (password 333). Each tab is its own session. Ammi's tab is the elder view.
3. A: Home. Say what the tiles mean. Tap Done on the next open item. Watch tiles move.
4. A: Hand off → Fatima. Show "what happened" and "what is next" already written. Send (animation).
5. B: Inbox badge → open card with preference strip → Accept.
6. A: Home shows "Fatima has Ammi since …". Workload bar moves.
7. Flow tab: last write hop by hop with ms. "What the database stores": scrambled rows.
8. Tests: `npm run coverage` on the terminal for the coverage table.
Fallback if Docker misbehaves on stage: `node dev/stack.mjs` (identical UI and API).

---

## 10. Browser harness notes for this Mac

- The in-app **Claude Browser** (`mcp__Claude_Browser__*`) works at `localhost:8080`. When the pane is hidden, `computer` actions (scroll/screenshot) time out; use `javascript_tool` / `get_page_text` / `read_page` instead. `localStorage.clear()` + reload to switch member.
- `app.js` is an ES module: its functions are not on `window`. Check the DOM, not globals.
- Reseeding creates a new family; a browser still holding the old session shows a blank app. Clear storage and rejoin.
- The owner's other machine used `browser-harness` (CDP). Its traps are in `agents/README.md` history: null `list_tabs()` ids, cache (fixed by no-store), heredoc quoting.

---

## 11. Bugs fixed / traps this session

- pg-mem lacks `date_trunc` (registered in `test/helpers.mjs`) and silently ignores `count(*) FILTER` (view rewritten to `count(CASE …)`).
- Names came from `/debug/events` (50 rows); with seeded history they would drop off. Now `/families/:id/events?type=MemberJoined`.
- "has Ammi since 12:04 PM" from yesterday looked fresh: `fmtWhen()` adds the weekday when not today.
- Elder appeared in the workload with zeros (MemberJoined/PreferenceSet events have actor_id): filtered client-side, and workload now `?since=` this week.
- zsh: `echo ===X` triggers `=command` expansion; quote it.
- brew cask `docker-desktop` needs sudo → cannot be installed from the agent shell.

---

## 12. Session conventions (keep)

- **Caveman mode** in the owner's environment: terse replies. Code, commits, security text normal.
- **No em-dashes** in prose deliverables; short sentences; no "shift", "here's the thing", anaphora, staccato triples, rhetorical questions (owner's writing-lint).
- **Ask big questions via the question tool, batched, before large work.** Owner answers fast and sends mid-turn messages; fold them in.
- **Comparisons as markdown tables**, short cells.
- **Never push without approval. Never hard-delete. Never create a git repo in the home directory** (repos under `~/code/` here, `~/Developer/` on the other Mac).
- Commit as the owner (`Abdul Quayum Adekunle <a.quayum@rspcbassembly.com>` on this Mac) with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## 13. Recommended next tasks (priority order)

1. Docker stack is up and seeded (§3). Run the demo script end to end (§9) once more before the pitch; `docker compose down && docker compose up -d --build` + seed for a clean start on the day.
2. **Rehearse the pitch** from `pitch/deck.html` with the demo script (§9). Time it: 5–7 min talk + demo, keep the appendix for Q&A.
3. **Push when approved**; coordinate with safio; then share `pitch/*.pdf`.
4. Optional, if time: deterministic **Quick log** (free text → category/preset, on-device, no LLM) as the seam for edge AI; a **patterns card** ("refused lunch 3 of last 5 days", counts only); elder large-print today view; README screenshots.
5. Update `spec/REQUIREMENTS.md`/`TASKS.md` status columns to reflect what shipped (not done this session).

## 14. File map

```
app/
  package.json              test + coverage scripts, devDependency pg-mem
  docker-compose.yml        web :8080, api :4000, projector, redis, postgres
  db/init.sql               4 tables + 1 view (count(CASE) form)
  api/app.js                createApp(): routes, guards, read models, 500 handler
  api/server.js             wiring: pg pool + redis client, listen
  projector/apply.js        applyEvent(): idempotent upsert + handoffs read model
  projector/index.js        consumer group loop
  web/index.html            tabs: Home, Log, Hand off, Inbox, Routine, Record, Prefs, Invite, Flow
  web/app.js                dashboard, routine, record, handoff, inbox, flow, crypto wiring
  web/crypto.js             WebCrypto AES-GCM helpers (tested in Node)
  web/styles.css            phone-first theme + dashboard/routine/record styles
  web/nginx.conf            no-store
  seed/seed.js              populated family: routine, 6-day history, handoffs, today
  dev/stack.mjs             api + inline projector on pg-mem + static web, one process
  test/helpers.mjs          pg-mem schema loader, fake stream, project(), startApp()
  test/api.test.js          routes + privacy test
  test/projector.test.js    applyEvent + workload view
  test/crypto.test.js       AES-GCM, IV, tamper, key check
pitch/
  deck.html, Amanah-Care-pitch-deck.pdf, explainer.html, Amanah-Care-explained.pdf
spec/                       SPEC, REQUIREMENTS (46 IDs), TASKS, AUDIT, diagrams
agents/                     HANDOFF.md (this), README.md (older), OWNER-NOTES.md
```
