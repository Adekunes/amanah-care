# Audit: did the spec answer every question in the challenge guide?

Source: MuslimHacks 2026 Challenge Guide, page 2 (how to win) and page 3 (Elderly Care). Scored against SPEC.md and the 5 diagrams. No design, no build. Verdict only.

Legend: YES = answered in spec. PARTIAL = answered in words, thin or unproven. NO = not addressed.

## A. Questions the guide asks directly

| # | Guide question | Verdict | Where in spec | Gap or note |
|---|---|---|---|---|
| A1 | Who is your primary user? | YES | Section 2 | Adult child ending a care turn. Clear. |
| A2 | Why is this better than the family WhatsApp group? | PARTIAL | Section 2 | Weak point. WhatsApp is also end to end encrypted, so "encryption" is not the difference. Real difference: structured card, accept step, elder-controlled filter, workload count, nothing buried in scroll. Rewrite the pitch line around those four. |
| A3 | Who can access the data, and who controls that access? | YES | Sections 6, 7, diagrams 3 and 4 | Support worker holds same key H in MVP. Spec admits it. Keep admitting it. |

## B. "Where to focus" bullets

| # | Focus | Verdict | Where in spec | Gap or note |
|---|---|---|---|---|
| B1 | Caregiver handoffs: what happened, what next | YES | Section 3, diagram 1 | Core workflow. Strongest part. |
| B2 | Workload visibility: how responsibilities divide across family | PARTIAL | Section 8 workload_view | Counts past turns only. Says nothing about who is on next. Acceptable for MVP, say "history, not roster" out loud. |
| B3 | Personal preferences: language, diet, prayer, modesty, caregiver gender | PARTIAL | Section 5 PreferenceSet event | Event exists. No screen in the build order, and preferences never appear on the handoff card. Cheap fix: a preference strip at the top of every card. |
| B4 | Elder participation: visibility and control over what is shared | PARTIAL | Section 7, diagram 4 | Control: yes, consent events. Visibility: yes, elder holds H. Usability by an elder: not addressed at all. See D1. |

## C. Constraints

| # | Constraint | Verdict | Where in spec | Gap or note |
|---|---|---|---|---|
| C1 | Health info needs consent and privacy protection | YES | Sections 6, 7 | Strong. Add one line naming Quebec Law 25 and PIPEDA since the guide cites them. |
| C2 | No diagnosis, dosage recommendations, triage | YES | Section 5 rules | Explicit. Events record human actions only. |
| C3 | "Muslim-friendly" is not one setting, preferences individual | YES | Section 5, section 10 | Per elder, per family, encrypted. |

## D. Words in the problem statement we did not cover

The brief names more than handoffs. Each row is something a judge can point at.

| # | Brief says | Verdict | Gap or note |
|---|---|---|---|
| D1 | Elder as a real user | NO | Spec assumes the elder runs a phone app and holds a crypto key. Nothing covers large text, voice, an Urdu or Arabic interface, or a path for an elder who does not touch phones. Biggest hole for the "dignity and independence" line. |
| D2 | Doctors, pharmacists, support workers in the loop | PARTIAL | Support worker role exists. Doctors and pharmacists: nothing. Say out of scope on purpose. |
| D3 | Medication, appointments, meals, transport, personal care | PARTIAL | Categories cover meds, meal, prayer, mobility, mood, note. Appointments and transport missing. Two words to add to the category list. |
| D4 | Language | PARTIAL | Stored as a preference. App language itself not addressed. |
| D5 | Safer care | NO | Only safety feature is the 30 minute handoff reminder. Do not claim "safer" in the pitch. Claim "nothing gets lost between turns". |
| D6 | Connection to community | NO | Nothing. Cheapest honest framing: the support role can be a masjid volunteer, not only a paid worker. Framing, not a feature. |
| D7 | Independence | PARTIAL | Elder consent toggles are the only expression of it. |

## E. "How to win" page

| # | Guide says | Verdict | Gap or note |
|---|---|---|---|
| E1 | Pick the right challenge and MVP | YES | Handoff is the first focus bullet and the one that shows events best. |
| E2 | One core workflow, convincing start to finish | YES | Section 3 demo script, section 9 build order, cut list. |
| E3 | Working MVP, not a big unfinished product | YES on paper | 4 tables, 6 containers, one flow. Risk is the crypto plus event plumbing eating hours 0 to 9. Cut list covers it. |
| E4 | Prepare the pitch, 1 to 2 hours | YES | Hours 22 to 24 reserved. |
| E5 | Show clearly what works versus what is mocked | PARTIAL | Cut list exists. Add one slide: real, mocked, not built. |
| E6 | Prove the problem with evidence | PARTIAL | Guide hands us numbers we never used: 1 in 4 American Muslims care for an older adult versus 16% general public; 52% of Muslims aged 30 to 49 care for an elder; 18% versus 7% report difficulty finding culturally appropriate caregivers. Put them on slide 1. No user interviews done. |

## F. Your three questions

These are the questions you asked me to settle, answered as plainly as I can.

| Topic | Answer |
|---|---|
| Usability for caregivers and family | Yes. Log, hand off, accept, see workload. Flow is short and the card is the product. |
| Usability for elders | Not yet. Elder has power on paper and no realistic way to use it. One low-tech path fixes most of this: elder sets consent once with a family member present, then only receives, never operates. Or a large-text read-only "today" view. |
| Usability for support workers | Partly. They read a filtered card, but they hold the full key. Honest MVP limit. |
| Problem solved | We solved one: information lost between two family caregivers, with privacy the family owns. We did not solve the wider coordination problem the brief describes (doctors, pharmacists, transport, community). That is fine for a 24 hour MVP as long as the pitch says which one we picked and why. |

## G. Score

Across the 23 scored rows: 10 YES, 10 PARTIAL, 3 NO. The three NO rows (elder usability, safer, community) share one root: the spec is written from the adult child's seat. Judges will read the brief's headline and ask about the elder first.

## H. Five fixes that cost minutes, not hours

1. Rewrite the WhatsApp answer around structure, accept step, elder filter, workload. Drop encryption as the headline difference.
2. Add appointment and transport to the CareLogged categories.
3. Put the preference strip on top of the handoff card so preferences are visible, not only stored.
4. Add an elder path that needs no key handling: consent set once with a family member, plus a large-text read-only "today" view.
5. Open the pitch with the three guide statistics, close with the real versus mocked slide.

## I. Status after applying the five fixes (2026-09-05)

| Row | Before | After | What changed in SPEC.md |
|---|---|---|---|
| A2 WhatsApp | PARTIAL | YES | Answer rebuilt around card, accept step, elder filter, workload. Encryption named as table stakes |
| B3 Preferences | PARTIAL | YES | Preference strip on top of every card, PreferenceSet form in hours 9 to 13 |
| B4 Elder participation | PARTIAL | YES | Consent set once with a family member present, elder never handles the key alone |
| C1 Consent + privacy | YES | YES | Law 25 and PIPEDA named |
| D1 Elder as real user | NO | PARTIAL | Today view: large text, elder's language, read only. Still no voice path |
| D3 Appointments, transport | PARTIAL | YES | Two categories added to CareLogged |
| E5 Real versus mocked | PARTIAL | YES | Honesty slide closes the deck |
| E6 Evidence | PARTIAL | YES | Three guide statistics open the deck |

New count across 23 rows: 16 YES, 5 PARTIAL, 2 NO. The two NO rows stay safer and community, both out of scope on purpose.
