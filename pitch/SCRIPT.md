# Amanah Care · five-minute pitch script (six boxes)

**0:00 · Box 1 · The line.** (slide 1)
"We help a daughter sharing her mother's care with her brother and sister, who never knows what was given this morning, who has Ammi this afternoon, or what the doctor said on Wednesday, by giving the three of them one private record that writes the handoff for them."

**0:20 · Box 2 · The person.** (slide 2)
"Ammi is 78. Fatima is one of three. Three phones, one group chat. Read it: 'did she take the morning ones?' 'who has her this afternoon?' 'scroll up.' Calls, WhatsApp, calendars, memory. The mental load lands on one or two people, on top of their own lives."

(Optional in Box 2, in their words: on Mumsnet, a daughter with her own disability handles every appointment while her brother will not pick up the phone; on the Alzheimer's Society forum, a caregiver built her own handoff pack from scratch because nobody else ever saw the routine.)

**1:00 · Box 3 · The reframe.** (slide 3)
"Sixteen teams built a care app this weekend. Here is what we understood differently. One: a chat is a conversation; care needs a record, the plan, what was done, the handoff, who carried the week. Two: the elder is the reason, not the user; Ammi does not tap, her children do, and she gets her own screen. Three: people only write the truth where nobody else can read it. So our server cannot read the record. Privacy is not a feature here, it is what makes the record honest."

**1:30 · Box 4 · The cost.** (slide 4)
"One in four American Muslims already care for an older adult, twice the general public. One in four caregivers say they cannot coordinate. Half of dementia caregivers report burden. What changes with a record: a missed dose is seen the same day, the load becomes visible before someone burns out, and the ER gets fourteen days on one page. And it is not only the surveys. We counted it ourselves this morning. Six caregiving communities on Reddit, two hundred and forty thousand members between them. We classified the five hundred and seventy most-read posts of the past year: three hundred and three describe a problem this record answers. Eighty-seven separate threads ask for exactly this tool, every year since two thousand seventeen, and every answer is a calendar, a reminder or a pill box. We will measure adherence, time to accept a handoff, and the share carried by the busiest person, in a five-family pilot starting Monday."

**2:00 · Box 5 · The demo.** (slide 5, then the app, two full minutes)
1. Sister A, Home: the board. Five cards, three columns. Two done, three to do, who has her. Drag Meals to Done. Press Blocked on Walk, "agitated". Undo one. It stays in the record, struck through.
2. Patterns: refused twice, agitated evenings, no walk in 48 hours, Sister A carries 80%. Counts, not conclusions.
3. Hand off to Fatima. Already written. Send.
4. Fatima's phone: alert, card with preferences on top. Accept.
5. Ammi's screen: "Fatima is looking after you today." I need help. Red on every phone. Hospital sheet.
6. Server view. "This is what we see. Not one word."
(If time: Nurse Layla, blue, one login, two families.)

**4:00 · Box 6 · After Sunday.** (slide 6)
"Monday: five Montreal families for a month. We pull in a geriatric nurse to review every recommendation, one EÉSAD home-care agency for a worker-login pilot, masjid welfare committees as the family channel, and CLSC and Islamic Relief Canada's network once the pilot has numbers. It pays for itself without touching families: agencies at eight to fifteen dollars per elder a month; eighty-four elders cover the server. Care was already happening. Now it has a record. And only the family can read it. We ask for introductions, five families, and one agency."

Backup slides (press End): how it works (diagram), packages, her screen, the verse, judge Q&A, sources.

---

## Pitch day prep (added 6 Sep 2026, 11:35, from the judges' workshop that morning)

### The clock, box by box

| Box | Slide | Time | Ends at |
|---|---|---|---|
| 1 The line | 1 | 20 s | 0:20 |
| 2 The person | 2 | 40 s | 1:00 |
| 3 The reframe | 3 | 30 s | 1:30 |
| 4 The cost | 4 | 30 s | 2:00 |
| 5 The demo | 5 then the app | 2 min | 4:00 |
| 6 After Sunday | 6 | 60 s | 5:00 |

If the demo runs long, cut demo steps 6 and 7 (Server view, Nurse Layla), not box 6. Box 6 is
where the judges hear the business model, and business is 40% of the rubric.

### Who says what

Decide this before you go up and write the two names in here.

| Part | Speaker |
|---|---|
| Boxes 1 to 4 | |
| The demo, driving the phones | |
| Box 6 | |
| Technical questions (architecture, crypto, tests) | |
| Product and demo questions | |
| Business and pricing questions | |

One person drives the laptop for the whole demo. The other narrates. Do not swap mid-demo.

### Before you walk up

1. Clean reset and reseed so today's plan is full: `docker compose down && docker compose up -d --build`, then `cd seed && API=http://localhost:4000 node seed.js`.
2. Log in the tabs in advance: sistera, fatima, ammi, and layla for the second family. Password 333.
3. Open `pitch/deck.html` full screen in its own window. Backups are after slide 6, End key.
4. Have `pitch/Amanah-Care-pitch-deck.pdf` and `pitch/Amanah-Care-judge-QA.pdf` open as the fallback if the browser dies.
5. Record a screen capture of the full demo beforehand and keep it on the desktop. The workshop
   said this explicitly: present live, but have the recording ready if the network or the machine
   fails. A live demo scores higher, a dead demo scores nothing.
6. Terminal ready on a second window with `npm run coverage` already run, so the coverage table is
   on screen without waiting.

### The five questions to rehearse out loud

These are the ones that can actually hurt, drawn from what caregivers say about products like
ours (`pitch/RESEARCH-REDDIT.md`). Full answers are on the Objections slide of
`pitch/Amanah-Care-judge-QA.pdf`, page 6.

1. Why is an app the answer at all, when the real problem is a sibling who will not help?
2. Does this turn into one sibling surveilling another?
3. Nobody wants another app. How does a family actually start using it?
4. What if only one person in the family logs anything?
5. Why should anyone believe the server cannot read it?

### What breaks first

Say it before a judge finds it. The key. There is no rotation and no recovery today, so a family
that loses every device loses the record. Key recovery is the first thing built after Sunday.
Everything else on the honesty slide is a known limit with a known fix. This one is the assumption
we have not de-risked.
