# Amanah Care — full handoff for the next AI agent

Read this top to bottom before touching anything. It is the current, complete state as of 2026-09-05, and it supersedes the older `agents/README.md` where they disagree. `agents/OWNER-NOTES.md` still holds the owner's verbatim directives and preferences; read that too.

---

## 0. Take over in 60 seconds

- Project: **Amanah Care**, a private care-handoff web app for families caring for an elderly Muslim parent. Built for **MuslimHacks 2026, Elderly Care track**, Concordia University, Montreal, 5–6 Sep 2026.
- Owner: **Abdul Quayum Adekunle**. Partner/collaborator: **safio** (GitHub), write access on the repo.
- Repo: `~/Developer/muslimhacks-2026-elderly-care/`, GitHub `git@github.com:Adekunes/amanah-care.git` (private).
- The app is built and **runs on Docker**. Everything since the partner merge is **local and uncommitted**. **Do not push without the owner saying so.**
- Stack the owner mandated: **Redis Streams** (event log), **Postgres** (read models), **Docker Compose**, a **web page with WebCrypto** client-side AES-GCM encryption. Web first, native mobile later.

To run it right now:
```bash
cd ~/Developer/muslimhacks-2026-elderly-care/app
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"   # if `docker` not on PATH
docker compose up -d --build
cd seed && npm install && API=http://localhost:4000 node seed.js      # prints join codes
# open http://localhost:8080 in two browser windows, paste a code into each Join box
```

---

## 1. What the product is

Care for an elder is shared across relatives. Today it lives in WhatsApp, memory, and separate calendars, and nothing keeps the next caregiver informed or gives the elder control. Amanah Care is a **structured handoff log** where:

- Every action is an **event** (event sourcing, the owner is a solutions architect and required this).
- Every payload is **encrypted in the browser** with a family key `H`. The server, and whoever operates it, stores **ciphertext only**.
- The core loop: a caregiver **logs care**, **hands off** to another member, that member is **notified** (polling), **opens the card**, reads what happened and what is next, and **accepts**. A **workload bar** counts who did what. The elder's **preferences** ride on top of every card.

One-line pitch: a private, event-sourced care-handoff log where only the family can read the data.

---

## 2. Challenge + judging context (from the two PDFs in ~/Downloads)

`MuslimHacks-2026-Challenges.pdf` (track 01 Elderly Care) and `MuslimHacks Judging Rubric.pdf`.

**Hard constraints (must not break):**
- Health info needs consent + privacy protection. (Met: family-held key, ciphertext-only server.)
- No diagnosis, no dosage advice, no medical triage. (Met: events record human actions, no advice paths.)
- "Muslim-friendly" is not one setting; preferences are individual. (Met: per-elder encrypted prefs.)

**Format rules:** deliver a working MVP of ONE core workflow in 24h; do not try to solve the whole problem; reserve 1–2h for the pitch.

**Judging weights (each line 1–5):** Business 40% (solves problem, easy to use, sustainable cost, research), Delivery 30% (live demo works, clear presentation, convincing pitch, follow-up answers), Technical 30% (architecture discernible + appropriate, code quality, performance, **tested with coverage metrics**, explain the process).

**Biggest rubric gap:** no automated tests / coverage numbers. Everything else is strong. Prepare to either add a test suite or answer honestly and pivot to the demo.

**Follow-up questions** judges draw from live are grouped as Technical, Impact & Users, Demo & Functionality, Business & Scalability, Team & Process, Data & Privacy, Future, Closing. The full list is in the rubric PDF. Two we answer very well: Data & Privacy ("key made in browser, never sent, server sees ciphertext, no LLM in core") and Tradeoffs ("cut consent filter, live push, key rotation to ship the handoff loop at quality; all on the honesty slide").

---

## 3. Current running state

- Docker Desktop 4.89 is installed (via `brew install --cask docker`). `docker` CLI is at `/Applications/Docker.app/Contents/Resources/bin/docker`; add it to PATH if needed.
- Six containers via `app/docker-compose.yml`: `web` (8080), `api` (4000), `projector`, `redis`, `postgres`. In cut-core there is no separate notifier container (polling instead).
- The DB currently holds test residue (e.g. a handoff to Ammi with next="s3rd" and an accumulated summary) from manual testing. Reset for a clean demo (see §9).

---

## 4. What is BUILT (cut-core scope + UX additions)

Base workflow (mine + partner safio's, merged):
- Family create from scratch; member join by **QR or invite code**.
- **Log care**: two-step chips (category → preset) + optional note. 8 categories: meds, meal, prayer, mobility, mood, appointment, transport, note.
- **Preference strip** on top of every card (language, diet, prayer, modesty), encrypted.
- **Hand off**: recipient picker, summary **auto-composed** from logged items, you type only "what is next".
- **Notify by polling** every 4s (FR-05). No SSE/push in cut core.
- **Accept** flips status open → acknowledged.
- **Workload bar** per member from event metadata (no decryption).
- **Flow tab**: traces a real write through 6 hops (browser → wire → api → redis → projector → family phones), tags each hop readable vs sealed, shows real timings, hops light up in sequence.
- **Proof/kill-switch**: live Postgres rows showing ciphertext only.
- **In-app Invite tab** (partner) to add members from inside the app.

UX added this session (all local, uncommitted):
- **Identity bar** at the top of the app: colored dot + name + role (e.g. "Ammi · ELDER"), and the **browser tab title** is set to the person's name, so multiple test windows are distinguishable. Function `renderWhoAmI()` in `app/web/app.js`.
- **Handoff preview** before sending: shows To / What happened / What is next (`#ho-preview`, `updateHandoffPreview()`).
- **Send animation** overlay: You (plaintext + H) → 🔒 → Server (ciphertext only) → 🔒 → Recipient (decrypts with H), a lock packet travels each segment (`sendAnimation()`, `#sendfx`).
- **Sender record** ("Your handoffs") under the Hand off tab, **grouped by recipient**, showing what you sent each person and status delivered/accepted (`renderSent()`). This answers the owner's ask: "what did I send Fatima, what did I send Abdullah."
- Clearer empty-summary wording ("Nothing new since your last handoff").
- **nginx no-store headers** so rebuilds are never served stale.

---

## 5. What is DEFERRED (roadmap, on the honesty slide, NOT built)

- Elder consent filter + audience filtering (cosmetic under same-H; needs a scoped support key).
- Elder read-only "today view" with RTL Urdu/Arabic.
- SSE / web push (replaced by polling).
- 30-minute reminder on open handoffs.
- Key rotation (lost-key → new H).
- Real member authentication (currently a trusted client-declared member_id stub).

---

## 6. Repo state (IMPORTANT)

- GitHub `main` = partner safio's merge `fa042c6` ("Merge branch add-members-from-the-page"), which built on my earlier commit `d0baa41`. safio added the in-app Invite tab, an interface cleanup, and their own Flow view.
- Local `main` was fast-forwarded to `fa042c6`, then I made **uncommitted working-tree changes** to `app/web/app.js`, `app/web/index.html`, `app/web/styles.css`, `app/web/nginx.conf`, `app/seed/seed.js` (the UX work in §4).
- My earlier uncommitted flow-tab attempt is in `git stash` ("my-local-flow-and-nginx"); it is superseded by safio's flow view — you can drop it.
- **Nothing since the merge is committed or pushed.** When the owner approves, commit the working tree and push. Commit attribution line for this project:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

## 7. Architecture + deviations

- **Redis Streams** event store. **Deviation from the spec (AR-02):** the MVP uses ONE global stream `events` with `family_id` as a field, not one stream per family. Reason: a projector consuming dynamically-created per-family streams is a time sink. One consumer group. Documented in `app/db/init.sql`. Post-hackathon change.
- **api** (Node/Express, `app/api/server.js`): POST /events validates membership then `XADD`, returns 202. Read endpoints for members, preferences, care, handoffs, workload, and `/debug/events` (kill-switch). Guards: rejects non-members; rejects ConsentChanged from non-elder. **Auth is stubbed** (caller declares `actor_id`, trusted).
- **projector** (`app/projector/index.js`): one consumer group, idempotent upsert by event id, builds the `handoffs` read model; workload is a SQL view.
- **web** (`app/web/`, served by nginx): vanilla ES module + WebCrypto. One-column, phone-first.
- Write path: browser encrypts → api → XADD → projector → Postgres. Read path: browser fetches read model → decrypts with H.

---

## 8. Privacy model (the family key H)

- Browser makes a random 256-bit AES-GCM key `H` with WebCrypto. **Never sent to the server.**
- Server stores only `key_check` = SHA-256 hex of raw H (proves possession, reveals nothing).
- Every ciphertext carries a fresh random 96-bit IV. No nonce reuse.
- Members join in person by scanning a **QR** carrying H (base64url of `{f, h}`), or pasting the invite code. The `#`-fragment link is a labelled fallback. The UI never offers "share to WhatsApp".
- **Seed/demo codes also pin a member** (`{f, h, m, r, n}`) so a seeded handoff reaches the intended window.
- **Known limits (say on the honesty slide):** support workers hold the same H so the consent filter is UI-only; auth is stubbed; notifications are polling not push.

Data model: 4 tables (`families`, `members`, `events`, `handoffs`) + 1 view (`workload_view`). Names/notes/summaries/preferences live only inside encrypted event payloads. Schema in `app/db/init.sql`.

---

## 9. How to run, reset, seed

```bash
export PATH="/Applications/Docker.app/Contents/Resources/bin:$PATH"
cd ~/Developer/muslimhacks-2026-elderly-care/app

docker compose up -d --build          # start everything
docker compose ps                     # check health

# clean reset (drops DB, re-inits schema; no named volume so `down` wipes data)
docker compose down && docker compose up -d

# seed a populated family (Ammi elder, Sister A, Abdullah, Fatima; prefs; no pre-logged care)
cd seed && API=http://localhost:4000 node seed.js
# prints SISTER_A_CODE / ABDULLAH_CODE / FATIMA_CODE. The elder (Ammi) code is not
# printed by seed; build it by decoding any code for {f,h}, querying
# /families/<f>/members for the role=elder id, then base64url({f,h,m:elderId,r:'elder',n:'Ammi'}).
```

Open http://localhost:8080 in two windows. To keep separate browser storage per window on one machine, use **two origins**: `localhost:8080` for one member and `127.0.0.1:8080` for another (they hit the same backend; api CORS is `*`). Paste a different code into each Join box.

---

## 10. How to test with the browser harness (and the traps I hit)

The owner wants testing via **browser-harness** (`browser-harness <<'PY' ... PY`, drives his agent Chrome via CDP). It works, but:

- **Multi-tab switching is flaky.** `list_tabs()` returns `null` ids; keep the id returned by `new_tab(url)`. After `switch_tab(id)`, VERIFY with `js("location.href")` before acting (I use a `use(tid, expect)` guard that retries). Close leftover tabs first via `cdp("Target.getTargets")` + `cdp("Target.closeTarget", targetId=...)`.
- **Cache bit me hard.** Chrome served a stale pre-build `index.html`/`app.js`. Fixed by nginx `no-store` headers (already in `app/web/nginx.conf`) plus loading with a `?v=<timestamp>` query.
- **Heredoc quoting:** use a quoted `<<'PY'` and pass values via `os.environ`; unquoted heredocs mangle regex/backslashes. Avoid nested quotes in `js()` — use unquoted CSS attribute selectors like `[data-tab=flow]`, or Python `%r` injection.
- **Screenshot helper is `capture_screenshot(path)`**, not `screenshot`.
- For quick, reliable checks (console errors, single-tab flows) the **in-app Claude Browser** (`mcp__Claude_Browser__*`) is more reliable than browser-harness and gives console access. Use it to debug, use browser-harness for the owner-facing demo.
- The app.js is an **ES module**, so its top-level functions are NOT on `window`; `typeof renderSent` from the page console is `undefined` even when it works. Check DOM/behavior, not globals.

---

## 11. Bugs I found and fixed this session (so you don't re-chase them)

- **Duplicate `esc` declaration** (partner had `const esc`, I added `function esc`) → SyntaxError broke the ENTIRE app. Fixed. If the whole app goes blank, check the console for a top-level SyntaxError first.
- **Empty handoff summary race:** opening the handoff before the auto-compose finished sent a blank summary. `openHandoff()` now recomputes if empty.
- **Stale name cache:** a recipient showed as an id, not their name, when they joined after the sender loaded. Fixed by refreshing `loadNames()` at the start of `renderSent()` and `buildHandoff()`.
- **Postgres `LC_ALL`:** running a local (non-Docker) Postgres fails with "postmaster became multithreaded during startup" unless `LC_ALL` is a valid locale (e.g. en_US.UTF-8). Only relevant if you run PG outside Docker.

---

## 12. Environment + hazards

- brew `postgresql@16` and `redis` were installed earlier only to verify before Docker existed. They are not running. The owner may remove them: `brew uninstall postgresql@16 redis`. Use Docker for everything now.
- `gh` CLI is authed as GitHub user **Adekunes**.
- **HAZARD (owner's global rule):** never create a git repo in the home directory. Repos live in `~/Developer/<project>/`. A hazard-guard hook blocks the home-dir case and also pattern-matches that phrase inside shell commands, so **write docs with the Write tool, not a `cat` heredoc**.
- The owner deleted 25 videos from `~/Downloads` this session (moved to Trash, recoverable). Unrelated to this project.

---

## 13. Session conventions (keep these)

- **Caveman mode** is active in the owner's environment: terse replies, drop articles/filler. Code, commits, and security text stay normal.
- **writing-lint**: the owner has a global writing harness. Any prose deliverable for him (posts, emails, scripts) must pass it. Technical docs like this are fine. Avoid em-dashes, "shift", "here's the thing", anaphora, staccato triples, rhetorical questions.
- **Ask big questions via the question tool**, batched, before large work.
- **Comparisons as markdown tables**, short cells.
- **Do not push to GitHub** until the owner explicitly approves.

---

## 14. Recommended next tasks (in priority order)

1. **Decide the elder's role in the pitch story.** Owner leans "elder is the sender/owner of handoffs" ("what did I send Fatima/Abdullah"), but the app currently models caregivers as senders and the elder as subject/recipient. Pin this; it changes the demo narrative and maybe the seed.
2. **Reset to clean seed data** before any demo (current DB has "s3rd" residue).
3. **Add a minimal automated test suite + coverage number** — the one clear rubric gap (Technical: "tested with coverage metrics"). Even a handful of api/projector/crypto tests with a printed coverage % helps.
4. **Optional: build the elder today view** (large text, RTL Urdu/Arabic, read-only) — highest pitch value of the deferred items, low risk.
5. **Pitch deck**: open with the guide's stats (1 in 4 Muslims care for an elder vs 16% general; 52% of Muslims 30–49; 18% vs 7% struggle to find culturally fitting caregivers); close with the real/mocked/not-built honesty slide.
6. When approved, **commit the working tree and push**; coordinate with safio to avoid clobbering their main.

---

## 15. File map

```
app/
  docker-compose.yml        six services, one command
  db/init.sql               4 tables + 1 view (+ the single-stream deviation note)
  api/server.js             command handler + read models + /debug kill-switch
  projector/index.js        Redis Streams consumer group -> Postgres
  web/
    index.html              all views + tabs (Log, Hand off, Inbox, Prefs, Invite, Flow) + whoami bar + sendfx overlay
    app.js                  ES module: crypto wiring, flows, renderSent, sendAnimation, renderWhoAmI, flow
    crypto.js               WebCrypto: makeKey, export/import, keyCheck, encryptJSON/decryptJSON
    styles.css              one-column phone-first theme + animations
    nginx.conf              no-store headers
    vendor/qrcode.js        vendored QR lib (qrcode-generator 1.4.4), no CDN
  seed/seed.js              populated demo family + printed join codes
spec/                       SPEC, REQUIREMENTS, TASKS, AUDIT, diagrams (the planning + two audit rounds)
agents/
  HANDOFF.md                this file (current master)
  README.md                 earlier handoff (pre app-build), still useful for the plan history
  OWNER-NOTES.md            owner's verbatim directives + standing preferences
```

---

## 16. All the no's — rejected paths, dead ends, and deferrals (read before restarting)

If you restart, do not re-litigate these. Each was decided with a reason.

**Scope no's**
- NO to the full requirement register in 24h. Two audits showed ~34 person-hours of must-haves vs ~22 planned. Chose "cut core": the handoff loop, built well, rest labelled roadmap.
- NO to the elder consent filter for the MVP. Under the same-H model it is cosmetic (support holds the same key, so hiding categories is UI-only, not cryptographic). Deferred; needs a scoped support key (1–2 days).
- NO to key rotation in the MVP. Edge case that touches every crypto path. Deferred.
- NO to a 30-minute reminder for the MVP. Non-core. Deferred.
- NO to real member authentication in the MVP. Proper identity proof is 1–2 days. Stubbed (trusted client-declared member_id), labelled on the honesty slide. The privacy story does not depend on it.

**Delivery/transport no's**
- NO to SSE / web push for notifications. SSE only reaches an already-open tab and is fragile on stage; web push needs a service worker + VAPID, a time sink. Chose polling every 4s (honest, robust). Push is post-hackathon.

**Key-sharing no's**
- NO to the invite-link-with-H-in-`#` as the PRIMARY path. It leaks H if pasted into a chat app (the exact third party families avoid). Kept only as a labelled fallback. Chose QR in person.
- NO to passphrase-derived H (Argon2) despite better recovery UX. It weakens `key_check` to offline brute force unless Argon2 cost is high + an HMAC verifier, and it touches every crypto path (+2–3h). Better as a real-product change, worse hackathon choice.

**Architecture no's**
- NO to one Redis stream per family for the MVP. A projector consuming dynamically-created per-family streams is a time sink. Chose a single global `events` stream with `family_id` as a field, one consumer group. Per-family isolation is post-hackathon.

**Unresolved (decide on restart)**
- The elder's role: SENDER (owner leans this: "what did I send Fatima/Abdullah") vs RECIPIENT/subject (current app models caregivers as senders, elder as subject). Not yet pinned. This shapes the whole narrative and the seed. Decide first if you restart.

**Testing no**
- NO automated tests exist yet. Only manual end-to-end verification. This is the single clear rubric gap (Technical: "tested with coverage metrics"). Add a small suite if you can.

**Process no's (owner's standing rules)**
- Do NOT push to GitHub without explicit approval.
- Do NOT hard-delete files; use Trash and confirm the target first.
- Do NOT create a git repo in the home directory.
- Do NOT write prose deliverables that fail `writing-lint` (no em-dashes, no "shift", no "here's the thing", no anaphora/staccato/rhetorical-question patterns).
- Caveman replies (terse); code/commits/security stay normal.

**Harness no's (what wasted time)**
- Do NOT trust `list_tabs()` ids (they are null); keep `new_tab` return ids and verify the focused tab with `location.href`.
- Do NOT assume rebuilt web assets reach the browser; the HTTP cache served stale files until no-store headers + `?v=` cache-busting.
- Do NOT use unquoted heredocs or nested quotes in `js()`; they mangle regex/quotes.

---

## 17. If you restart from scratch — what to reuse vs rebuild

**Reuse as-is (these are good and paid for):**
- The whole `spec/` folder: SPEC, REQUIREMENTS (46 IDs), TASKS, AUDIT, diagrams. Two audit rounds already done.
- The privacy model and `crypto.js` (WebCrypto AES-GCM, per-message IV, key_check). Verified.
- The event catalogue and 4-table + 1-view data model (`app/db/init.sql`).
- The cut-core scope decision and the deferred list.
- This handoff and OWNER-NOTES.

**Rebuild only if you change direction:**
- If the elder becomes the primary sender, rework the handoff UI and seed around that.
- If you want real privacy for support workers, design scoped keys (not same-H).
- If you want reliable notifications, add push properly (out of a 24h budget).

Starting point either way: `docker compose up --build`, then iterate on `app/web/` (no build step, just rebuild the `web` container or bind-mount for live edits).
