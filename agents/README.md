# Agent handoff: Walidayn

Read this first if you are a fresh session or a different account picking up this repo. It carries the full story: what the project is, every decision, every change to the plan, what is built, what is verified, what is left, and the gotchas that will bite you. Written 2026-09-05.

## 0. Who and why

- Owner: Abdul Quayum Adekunle. Building for MuslimHacks 2026, Concordia University, Montreal, 5 to 6 September 2026.
- Track: Elderly Care (PPLUS challenge 01). Team was on this track when work started.
- Goal: a working MVP that demos one core workflow in 5 minutes to judges.
- Owner's hard rules that shaped everything:
  - Event-driven architecture, everything is an event. He is a solutions architect and wanted event sourcing.
  - Client data must be masked from everyone, including the operator. Only the family sees their data. Data locked with a key ("H"); if the family loses H, they get to make a new one.
  - Very small database, minimum tables, demo-able tomorrow, not a full build.
  - Stack he named: Redis as event source, Docker as container, Postgres as database.
  - Web page first, native mobile after, for MVP reasons.
  - Keep it simple to demo AND simple to use, but do not compromise quality. If doing it properly needs more than 24h, say so, do not fake it.

## 1. Session conventions you must keep

- Caveman mode is active in the owner's environment (terse replies, drop articles/filler). Code, commits, and security text stay normal. This does not change the code, only how you talk.
- Writing-lint: the owner has a global writing harness (`writing-lint`). Any social/prose deliverable for him must pass it. Technical docs like this one and the spec are fine. Avoid em-dashes, the word "shift", "here's the thing", anaphora, staccato triples, and rhetorical questions in anything you write for him.
- Diagrams: built with the `excalidraw-flowchart` skill (DSL to `.excalidraw` via `npx @swiftlysingh/excalidraw-cli`), then PNG, plus Mermaid blocks pasted into the spec. Source DSL is in `spec/diagrams/*.dsl`.
- Deliver files to the owner with the file-send tool; he may be on another device.

## 2. What the product is

A private care-handoff log for families caring for an elderly parent. Every action is an event. Every payload is encrypted in the browser with a family key H. The server, and whoever runs it, stores ciphertext only.

Core demo: Sister A logs care items, hands off to Brother B, B is notified (polling), opens the card, reads what happened and what is next, accepts. A workload bar counts who did what. Elder preferences ride on top of every card. Open the raw DB to show only ciphertext.

## 3. The plan's evolution, in order (every change we made)

This is the audit trail. Each step changed the spec or the plan.

1. Built the first spec + 5 diagrams (architecture, family key, handoff, data model, elder consent). One merged Excalidraw scene for paste.
2. Audited the spec against every question in the challenge PDF. Score 10 YES, 10 PARTIAL, 3 NO. Biggest holes: elder usability, "safer", community connection, all because the spec was written from the adult child's seat.
3. Applied five fixes: rewrote the WhatsApp answer (encryption is table stakes, not the differentiator), added appointment + transport care categories, put the preference strip on top of the card, added an elder path with no key handling (consent set once with family present + a large-text read-only today view), and set the pitch to open with the guide's three statistics and close with a real/mocked/not-built honesty slide. Rescored 16 YES, 5 PARTIAL, 2 NO.
4. Added the platform decision: web page first, mobile after, with the reasons table. Swept "phone (native app)" wording to "browser/device" across spec and diagrams.
5. Extracted requirements into `spec/REQUIREMENTS.md` (46 IDs: FR, SR, AR, PR, NR) and a build task list `spec/TASKS.md` (2 lanes, phases).
6. Round-1 audit, two agents (coverage/traceability + feasibility/risk). Findings: consent/filter cluster over-prioritized, auth has no mechanism (SR-07/SR-08 unenforceable), SSE ping cannot reach a closed tab, AES-GCM needs an IV column, FR-11 privacy claim contradicted by same-H. Proposed fixes.
7. Round-2 audit, two agents (24h delivery feasibility + simplicity/usability). Findings: full register is ~34 person-hours, does not fit 24h; polling beats SSE on stage; key H is the top usability risk (invisible, losable, leakable); elder view needs RTL; core loop was ~19 taps vs WhatsApp's 3, so chips + auto-summary are needed to actually beat WhatsApp.
8. Owner decisions after round 2: scope = **cut core**; key sharing = **QR in person**; apply mode = propose then wait.
9. Applied all fixes to REQUIREMENTS.md and TASKS.md: added D (deferred) priority, QR (FR-15/SR-04), SR-10 (random IV), SR-11 (auth stub labelled), KL-01/02/03 known limits, chips (FR-03) + auto-summary (FR-04), RTL (FR-13), repriced the consent cluster to Deferred, swapped SSE for polling (FR-05), re-baselined hours, added T7.0 venue-laptop dry run.
10. Owner said build. Built the cut core, verified it, pushed to GitHub, invited partner safio.

## 4. Scope that got BUILT (cut core)

Encrypted handoff loop: family create, member join by QR/code, preference set + strip, care log with chip presets + optional note, handoff open with auto-composed summary, poll-based notify, accept, workload bar, and the ciphertext kill-switch view.

## 5. Scope DEFERRED (roadmap, on the honesty slide, NOT built)

- Elder consent filter + audience filtering (FR-10, FR-11, SR-07). Cosmetic under same-H, and over the clock.
- Elder today view with RTL Urdu/Arabic (FR-13, PR-03). Strong pitch moment, add with buffer.
- SSE / web push (AR-05). Replaced by polling.
- 30-min reminder (FR-08).
- Key rotation (FR-17).
- Real member authentication (SR-11 stub in place).
- Scoped support-worker key (KL-01).

## 6. Architecture and important deviations

- Redis Streams event store. **Deviation from spec AR-02: MVP uses ONE global stream `events` with `family_id` as a field, not one stream per family.** Reason: a projector consuming dynamically-created per-family streams is a time sink. One consumer group. Documented in `app/db/init.sql`. Post-hackathon change.
- Postgres: 4 tables (families, members, events, handoffs) + 1 view (workload_view). Names/notes/summaries/preferences never stored in clear, only inside encrypted event payloads.
- api (Node/express): command handler (POST /events, XADD, 202) + read-model reads. Member guard + elder-only ConsentChanged guard. Auth is a trusted client-declared member_id (SR-11 stub).
- projector (Node): one consumer group, idempotent upsert by event id, builds handoffs read model and (via view) workload.
- web (static, nginx): WebCrypto AES-GCM, one-column phone-first UI, polling every 4s for the inbox.
- No notifier/SSE container in cut core (polling instead).

## 7. Privacy model (the H key)

- Browser makes a random 256-bit AES-GCM key H with WebCrypto. Never sent to the server.
- Server stores only `key_check` = SHA-256 hex of raw H. Proves possession, reveals nothing.
- Every ciphertext carries a fresh random 96-bit IV (SR-10). No nonce reuse.
- Family added in person by scanning a QR carrying H (base64url of `{f, h}`). The `#`-fragment link is kept only as a labelled fallback. UI never offers "share to WhatsApp".
- Demo/seed invite codes also pin a member (`{f,h,m,r,n}`) so the seeded handoff reaches the live window.

## 8. Honest limits (say these on the honesty slide, do not hide)

- KL-01: support workers hold the same H, so the consent filter is UI-only, not cryptographic. Real product needs a scoped key.
- KL-02: auth is stubbed; caller declares member_id and the server trusts it. The ciphertext-only privacy story does not depend on it.
- KL-03: notifications are demo-grade polling; a closed tab is reached on reopen.

## 9. Current state and how it was verified

Built and run locally on the owner's Mac (no Docker there; used brew Postgres 16 + Redis on throwaway ports 55432/56379). Verified:

- Write path: 10 seeded events flowed through the projector into Postgres + handoffs read model.
- Read models: members, handoffs, workload, preferences, care all correct.
- Accept: status open to acknowledged, workload updated (Brother B handoff count 1).
- Guards: non-member 403, non-elder ConsentChanged 403, elder ConsentChanged 202.
- Kill-switch: raw rows show ciphertext only.
- Crypto: key-holder decrypts summary/prefs/care; wrong key returns null; IV unique per call.
- Browser (real): join by seeded code, preference strip decrypted, handoff card rendered, workload bar, proof tab all work.

## 10. How to run

```bash
cd app && docker compose up --build          # brings up redis, postgres, api, projector, web
cd app/seed && npm install && API=http://localhost:4000 node seed.js
# open http://localhost:8080 in two windows, paste Sister A code in one, Brother B in the other
```

No Docker? Reproduce the manual run: brew install postgresql@16 redis, start both on any ports, load `app/db/init.sql` with psql, set DATABASE_URL and REDIS_URL, `node app/api/server.js` and `node app/projector/index.js`, serve `app/web` with any static server, then seed.

## 11. Environment notes for the next agent

- brew `postgresql@16` and `redis` were installed on this Mac only to verify (no Docker present). They are not running. The owner may remove them: `brew uninstall postgresql@16 redis`. The venue laptop should use Docker.
- Postgres needs a valid `LC_ALL` (e.g. en_US.UTF-8) or it fails with "postmaster became multithreaded during startup". This bit us once.
- QR lib is vendored at `app/web/vendor/qrcode.js` (qrcode-generator 1.4.4). No CDN.
- `gh` CLI is authed as GitHub user `Adekunes`.
- HAZARD from owner's global config: never create a git repo in the home directory. Repos live in `~/Developer/<project>/`. This repo is correctly at `~/Developer/muslimhacks-2026-elderly-care/`. A hazard-guard hook will block the home-directory case, and it also pattern-matches that phrase inside shell commands, so write docs with the Write tool, not a shell heredoc.

## 12. Git and GitHub

- Repo: https://github.com/Adekunes/amanah-care (private).
- Branch `main`. Commit attribution line used in this project: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` (was Fable 5.1 earlier in the session; follow the latest attribution reminder in your session).
- Collaborator invited: `safio` with write (push) access, invite id 331862726.

## 13. Where the docs live

```
spec/SPEC.md            the product spec, 11 sections, with Mermaid diagrams
spec/REQUIREMENTS.md    46 requirements, priorities incl. Deferred + Known Limits
spec/TASKS.md           build plan, phases, lanes, cut list, deferred block
spec/AUDIT.md           the coverage audit vs the challenge PDF + post-fix status
spec/diagrams/          DSL, .excalidraw, PNG, and merged scene
agents/README.md        this handoff
```

## 14. If you are continuing the build, likely next tasks

- Add the elder today view (FR-13) with RTL + an Urdu/Arabic webfont. Highest pitch value, low risk.
- Optional care_timeline read model (OP-01) only if the demo feels slow.
- Do the T7.0 venue-laptop dry run with Docker before judging.
- Prepare the pitch deck: stats slide first (1 in 4, 52%, 18% vs 7%), honesty slide last.
- Do NOT build the consent filter or real auth unless there is a 4h+ buffer; both are labelled roadmap.
