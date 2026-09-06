# Build task list: Walidayn MVP

Derived from REQUIREMENTS.md. This is the plan only. Nothing built, nothing deployed. Each task names the requirements it satisfies, an estimate, a dependency, and a done-check. Owner column left blank for you to assign.

Scope locked 2026-09-05 after two audit rounds: cut core, built well. QR-in-person key sharing. Notifications by polling, not SSE. Consent filter, elder today view, reminder, and key rotation are Deferred, shown as labelled stubs or on the honesty slide.

Two lanes so two people work in parallel: Lane A owns the server and event plumbing, Lane B owns the web page and crypto. They meet at the contract in T0.3. Start the two long poles, T2.1 crypto and T1.3 projector, at hour 0.

## Phase 0: foundation (hours 0 to 2)

| Task | Satisfies | Est | Depends on | Done when | Owner |
|---|---|---|---|---|---|
| T0.1 Repo + Docker Compose skeleton: redis, postgres, api, web, projector, notifier | AR-09 | 1.5h | none | `docker compose up` brings all six containers to healthy | |
| T0.2 Postgres schema: families, members, events, handoffs, workload_view | AR-06, AR-07, AR-08 | 1h | T0.1 | tables exist, view returns empty | |
| T0.3 Freeze the API + event contract: JSON shape of each of the 8 events, clear vs cipher fields, the IV-with-ciphertext format (SR-10), and the trusted member_id stub (SR-11) | AR-01, FR-01..FR-07, SR-10, SR-11 | 1h | none | one doc both lanes agree on, pinned in repo README |

## Phase 1: event pipeline (hours 2 to 5, Lane A)

| Task | Satisfies | Est | Depends on | Done when | Owner |
|---|---|---|---|---|---|
| T1.1 api POST /events: member check, append XADD, return 202 | AR-03, SR-08 | 1.5h | T0.3 | curl posts an event, 202 back | |
| T1.2 api member guard: reject non-member. Trusted member_id stub, labelled (SR-11) | SR-08, SR-11 | 1h | T1.1 | non-member rejected by hand | |
| T1.3 projector consumer group: read stream, idempotent upsert by event id into events table | AR-02, AR-04 | 2h | T1.1, T0.2 | posted event appears once in Postgres, replay-safe | |
| T1.4 handoffs read model: projector builds open/acknowledged rows | AR-07, FR-04, FR-07 | 1.5h | T1.3 | HandoffOpened then Acknowledged flips status | |

## Phase 2: crypto + web shell (hours 5 to 9, Lane B)

| Task | Satisfies | Est | Depends on | Done when | Owner |
|---|---|---|---|---|---|
| T2.1 WebCrypto helpers: make H (256-bit), AES-GCM encrypt/decrypt with a fresh random 96-bit IV per message, key_check hash | SR-01, SR-02, SR-03, SR-10 | 2h | T0.3 | round-trip encrypt then decrypt in console, IV differs each call | |
| T2.2 QR carrying H, scan-to-join saves H to local storage. `#` link kept as labelled fallback | FR-15, SR-04 | 1.5h | T2.1 | second browser scans QR, holds same H, nothing secret in server logs | |
| T2.3 One-column responsive shell, phone-width first, no hover | PR-01, PR-02 | 1h | none | shell renders on a phone-width viewport | |
| T2.4 Family create + member join screens (FamilyCreated, MemberJoined) | FR-01, FR-02 | 1.5h | T2.1, T1.1 | family row + member row created via UI | |

## Phase 3: core handoff loop (hours 9 to 13)

| Task | Satisfies | Est | Depends on | Done when | Owner |
|---|---|---|---|---|---|
| T3.1 PreferenceSet form + preference strip component | FR-14 | 1.5h | T2.4 | strip renders decrypted on a card | |
| T3.2 CareLogged form, 8 categories, quick-tap chip presets + optional note | FR-03 | 1h | T2.4 | tapping a chip stores a CareLogged event, note optional | |
| T3.3 HandoffOpened form: pick member, summary auto-composed from logged items, caregiver types only next steps | FR-04 | 1h | T3.2 | handoff event posted with auto summary | |
| T3.4 Handoff card render: pull read model, decrypt, show strip + what happened + next | FR-06, FR-12 | 2.5h | T1.4, T3.1 | Sister A flow works end to end (NR-01) | |

## Phase 4: notify, accept, workload (hours 13 to 16)

| Task | Satisfies | Est | Depends on | Done when | Owner |
|---|---|---|---|---|---|
| T4.1p Browser polls the read model every 3 to 5 seconds, shows the new handoff | FR-05 | 1h | T1.4, T3.4 | B's browser shows the handoff within 5s, no open socket needed | |
| T4.2 Accept button -> HandoffAcknowledged, card flips to done | FR-07 | 45m | T3.4 | accept flips status live | |
| T4.3 workload_view + on-card bar per member | FR-09, AR-08 | 1h | T1.3 | bar shows A and B counts (NR-02) | |

## Phase 5: polish + demo (hours 16 to 24)

| Task | Satisfies | Est | Depends on | Done when | Owner |
|---|---|---|---|---|---|
| T7.0 Run the whole stack once on the venue laptop, keep a recorded backup run | NR-04 | 1h | all M tasks | full flow runs on the real laptop, recording saved | |
| Load seed data so the demo starts populated (T7.1) | NR-03 | 45m | T3.4 | fresh boot shows a populated family | |
| Kill-switch view, raw Postgres showing ciphertext (T7.2) | FR-18 | 30m | T1.3 | ciphertext visible on projector | |
| Run the two-window dry run twice, fixing what breaks (T7.3) | NR-04 | 1.5h | all M tasks | two clean runs | |
| Pitch deck, stats slide first and honesty slide last (T7.4) | NR-05 | 1.5h | none | deck done, real/mocked/not-built filled | |

## Deferred, built only as a labelled stub or shown on the honesty slide

| Task | Was | Why deferred |
|---|---|---|
| Elder Sharing screen + audience filter | T5.1, T5.2 (FR-10, FR-11) | Cosmetic under same-H, and over the clock. Show as a mock on the honesty slide |
| Elder today view, RTL Urdu/Arabic | T5.3 (FR-13, PR-03) | Strong pitch moment but non-core. Add back only with 4h+ buffer |
| SSE / web push ping | T4.1 (AR-05) | Fragile on stage. Replaced by polling (T4.1p) |
| 30-min reminder | T4.4 (FR-08) | Non-core |
| Key rotation | T6.1 (FR-17) | Edge case touching every crypto path |
| Real member auth | (SR-07, SR-11) | 1-2 days to do properly. Stub for demo, honesty slide |
| Scoped support key | (KL-01) | 1-2 days. Roadmap |

## Cut list if still behind after the deferred block

Drop the reminder logic first. Then fall back from polling to a manual refresh button. Last, trim the seed data to one member each side.

## Rough totals

Re-baselined to the audit numbers.

| Lane | Must-have hours | Notes |
|---|---|---|
| A (server, events) | ~9h | Phases 0, 1, T4.3 |
| B (web, crypto) | ~11h | Phases 2, 3, T4.1p, T4.2 |
| Shared | ~5h | Phase 5 polish, dry runs, deck |

About 18 to 20 build hours for the cut core, plus ~5h sleep and 2h pitch. Fits 24h with a thin buffer. Lane B is the critical path through T2.1 and T3.4. Start T2.1 crypto and T1.3 projector at hour 0.

## The two-agent audit (what we ran)

Two agents, each read SPEC.md + REQUIREMENTS.md, no code:

- Agent 1, coverage and traceability: does the register capture the whole spec, any missing / orphan / ambiguous / mis-prioritized / duplicate requirements.
- Agent 2, feasibility and risk: contradictions, 24h infeasibility, crypto holes, hidden dependencies, demo-day failure modes.

Findings are pasted into chat, not built on. Decision to proceed is yours.
