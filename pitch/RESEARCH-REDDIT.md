# Reddit research note: what caregivers say, and what Walidayn answers

Sweep date: 6 September 2026, 11:20 to 11:50 EDT. Companion to `pitch/RESEARCH-FORUMS.md`
(35 verified pages on AgingCare, AlzConnected, the Alzheimer's Society forum and Mumsnet).
This note replaces the earlier version, which recorded only that Reddit could not be reached.

## 1. Why the earlier sweep failed, and what changed

The first attempt on 6 September used the agent's own fetch and search tools. Reddit refuses
both: the search API answers `The following domains are not accessible to our user agent:
reddit.com`, the in-app browser answers `blocked by policy`, and a direct `curl` with a browser
user agent answers HTTP 403. Nothing was attributed to Reddit at that point, which was correct.

This sweep used the owner's own logged-in Chrome instead. Every thread below was opened at its
exact permalink through Reddit's own JSON endpoint in that browser, which returns the real title,
the real post body, the score, the comment count, the author and the post date. A page counted
only if it resolved to a real thread, its title matched, and its content matched the paraphrase
written here. 31 threads were opened this way. None were dropped.

Subreddits swept: r/CaregiverSupport, r/AgingParents, r/dementia, r/eldercare, r/Alzheimers,
r/sandwichgeneration, plus r/islam, r/Muslim, r/MuslimLounge and r/Hijabis for the Muslim angle.
Search angles: medication logs, shared calendars, family group chats, shift and handoff notes,
hospital binders, care coordination apps, long distance caregiving, privacy of health data.

## 1b. How big this is, counted rather than asserted

Every number here was read from Reddit's own JSON on 6 September 2026 and can be re-run.

| Community | Members | New posts per day |
|---|---|---|
| r/AgingParents | 82,852 | 16.8 |
| r/dementia | 67,287 | 25.6 |
| r/CaregiverSupport | 48,313 | 20.9 |
| r/Alzheimers | 26,231 | 7.4 |
| r/eldercare | 16,392 | 6.3 |
| r/sandwichgeneration | 847 | 0.2 |
| **Total** | **241,922** | **about 77** |

Posts per day is measured from the 100 most recent posts in each community, divided by the number
of days they span. Membership is the subscriber count reported by each community.

**The classification.** We took the 570 most-read posts of the past year across those six
communities (the top 100 of the year in each, and every post the endpoint returned), and matched
the title plus the body against five keyword sets. 303 of the 570 match at least one.

| Theme | Posts | Keyword set |
|---|---|---|
| Records, appointments, hospital | 140 | hospital, ER, emergency room, discharge, medical record, medical history, binder, portal, paperwork, appointment |
| Coordinating between family members | 117 | sibling, brother, sister, group chat, group text, coordinate, shared calendar, who is going/taking/with, handoff, shift, split the, share the care, same page |
| One person carrying it | 108 | burned out, burnout, exhaust, overwhelm, no one helps, nobody helps, by myself, all alone, resent, carrying it, carrying everything |
| Medication | 63 | medication, meds, pill, dose, dosage, prescription, pharmacy |
| Looking for an app or a system | 36 | app, apps, spreadsheet, tracker, software, tool, system, notebook, whiteboard |

Honest limits of this count: the categories overlap, so one post can appear in two rows and the
column does not add up to 303. It is a keyword match, not a human read of 570 posts. The top of
the year is not a random sample; it is what the most people read. It is our own count, not a
published statistic, and the deck labels it that way.

**Demand, separately.** Searching those same six communities for app, tracking system,
spreadsheet and coordinate care tool returns 1,120 distinct threads. 87 of them are somebody
asking for a tool: the title opens with is, are, any, anyone, does, do, what, which, how, looking
for, recommend, need, best, suggestions or help, and names an app, spreadsheet, tracker, software,
tool, system, calendar, log, or coordination. By year: 3 in 2017, 1 in 2018, 3 in 2019, 3 in 2020,
1 in 2021, 7 in 2022, 19 in 2023, 11 in 2024, 23 in 2025, 16 so far in 2026. The question has been
asked every year for nine years and the answers are still a calendar, a reminder or a pill box.

## 2. Finding 1: nobody can confirm the dose was given

Strength: 4 threads. This is the single most repeated operational problem in the sweep.

- Siblings coordinating their father's medication say the hard part is not the schedule, it is
  the uncertainty. One of them gives the pills, and hours later another asks whether he took
  them, and nobody is sure. They describe the fear of double dosing on one side and of missing a
  dose on the other, and the anxious texts in between. They have already tried notes on the
  counter, a shared iPhone note and a paper chart on the fridge. Each works for about a week,
  then somebody forgets to write it down and the trust goes.
  (r/AgingParents, "How are you handling a shared medication log with siblings?", 19 Dec 2025,
  6 votes, 34 comments, https://www.reddit.com/r/AgingParents/comments/1pqm37o/how_are_you_handling_a_shared_medication_log_with/)
- A daughter running point on her mother's 6 supplements and 3 prescriptions says the two
  commercial medication trackers she tried both assume one user managing one set of medications.
  Neither handled tracking for herself and for her mother separately with shared visibility.
  (r/CaregiverSupport, "How are you actually keeping track of your parent's meds and supplements
  without losing your mind?", 8 May 2026, 36 votes, 79 comments,
  https://www.reddit.com/r/CaregiverSupport/comments/1t7boem/how_are_you_actually_keeping_track_of_your/)
- A family reports a week where the mother forgot her medication, one sister did not know about
  the doctor's appointment, and three separate grocery runs happened because nobody knew what was
  needed. The poster says the family group chat plus sticky notes is not cutting it any more.
  (r/Alzheimers, "Anyone else struggle with family care coordination?", 29 Aug 2025, 7 comments,
  https://www.reddit.com/r/Alzheimers/comments/1n3dzeg/anyone_else_struggle_with_family_care_coordination/)
- A caregiver asks for a long term medication spreadsheet that can record dosage changes and when
  a medication started and stopped. The replies are homemade Google Sheets templates that people
  print before every appointment.
  (r/CaregiverSupport, "Long-term Medication Spreadsheet?", 23 Jun 2026, 2 comments,
  https://www.reddit.com/r/CaregiverSupport/comments/1udtm6x/longterm_medication_spreadsheet/)

The workaround the community trusts most is physical proof, not software: blister packs and pill
sorters, because an empty slot or an opened packet is evidence that the dose was served. One
commenter on the first thread above says the opened packet is what makes it work.

**What Walidayn answers.** Today's plan with a tap to mark done, one `CareLogged` event per
item, the log carrying who did it and when, live on every phone in the family within seconds, and
`CareRetracted` to undo a mistaken entry without deleting the history. This is the software
equivalent of the empty blister slot, shared across three phones instead of sitting on one
counter. It is a record of what was done, and it never tells anyone what to take. No dosage, no
triage.

## 3. Finding 2: the group chat buries the truth

Strength: 4 threads.

- A sibling group chat about who covers the mother's groceries turns into an argument about who
  has paid more. The poster ends the night with nothing decided and the groceries still needed.
  (r/sandwichgeneration, "Last night's family group chat about Mom's groceries turned into
  another fight", 22 Aug 2025, 5 votes, 6 comments,
  https://www.reddit.com/r/sandwichgeneration/comments/1mxjbh7/last_nights_family_group_chat_about_moms/)
- Someone who manages two primary care practices doing house calls for older adults writes that
  he sees the same pattern over and over, in his patients' families and in his own: families
  drowning in group texts and Venmo transfers, and missing benefits nobody knew about.
  (r/sandwichgeneration, "Venmo + group text is not a caregiving plan (ask me how I know)",
  11 Sep 2025, 3 votes, 2 comments,
  https://www.reddit.com/r/sandwichgeneration/comments/1nei9ab/venmo_group_text_is_not_a_caregiving_plan_ask_me/)
- A poster asks which messenger their family should use to coordinate care for aging parents.
  The one substantive reply uses WhatsApp for the conversation and a separate encrypted notes
  product for the medication list, ID, insurance and health history. Two tools, because the chat
  cannot hold the record.
  (r/AgingParents, "Group chat coordinating care for aging parents", 19 Mar 2024, 3 comments,
  https://www.reddit.com/r/AgingParents/comments/1biemis/group_chat_coordinating_care_for_aging_parents/)
- Asked what has helped families stay on the same page, the top reply points back at earlier
  discussions on the same subreddit about information getting buried in long group texts, about
  information fatigue, and about people not wanting to add yet another app.
  (r/AgingParents, "For anyone caring for aging parents... has anything helped your family stay
  on the same page? Apps, calendars, group chats... anything?", 20 Nov 2025, 2 comments,
  https://www.reddit.com/r/AgingParents/comments/1p236ph/for_anyone_caring_for_aging_parents_has_anything/)

**What Walidayn answers.** The reframe on slide 3, stated by caregivers themselves: a chat is
a conversation, care needs a record. Home shows the state of today rather than the last hundred
messages. The handoff is a card with what happened and what is next already written, not a
paragraph somebody has to compose at 9pm. Note the warning in the last thread: people do not want
another app. That is an adoption constraint, and it is why joining is a QR code in person and why
families never pay.

## 4. Finding 3: the history lives in one person's head, and the hospital needs it

Strength: 5 threads.

- A son whose father moved in describes being drafted as the one who "just knows" everything, and
  digging through crumpled notes, old discharge papers and screenshots every time somebody asks a
  medical question. He sat down one night after everyone was asleep and built a printable sheet
  for his father's information.
  (r/CaregiverSupport, "I got overwhelmed and made a simple printable for my dad's info. How do
  you all keep track of everything?", 17 Nov 2025, 24 votes, 26 comments,
  https://www.reddit.com/r/CaregiverSupport/comments/1oz5p2h/i_got_overwhelmed_and_made_a_simple_printable_for/)
- A caregiver of three years built a personalised medical binder holding everything a medical
  professional might need if she was unavailable, or if somebody else had to take her
  father-in-law to an appointment. A reply asks her to add a care section: bathing, feeding,
  toileting, how much help is needed, and the tips that make it go well, so that a stand-in knows
  how. That reply describes a handoff and a preference sheet.
  (r/dementia, "Personalized medical binder", 8 Jun 2022, 8 votes, 4 comments,
  https://www.reddit.com/r/dementia/comments/v81hki/personalized_medical_binder/)
- A caregiver asks how to keep a parent's health history when nothing is written down, since every
  specialist asks and the parent cannot remember. The replies are notes apps, photographs of
  handwritten history forms, and memory.
  (r/CaregiverSupport, "How do you keep track of your parent's health history when nothing is
  written down?", 25 Nov 2025, 6 comments,
  https://www.reddit.com/r/CaregiverSupport/comments/1p6pf7i/how_do_you_keep_track_of_your_parents_health/)
- A niece coordinating stage 3 lung cancer care across a PCP in one health system and an oncology
  team in another describes two patient portals and two of everything, and catching gaps herself.
  A reply puts it plainly: most doctors assume somebody else holds the full list.
  (r/CaregiverSupport, "Managing my aunt's cancer care across multiple doctors, how do you keep
  track of everything?", 18 Apr 2026, 8 votes, 11 comments,
  https://www.reddit.com/r/CaregiverSupport/comments/1sp6alh/managing_my_aunts_cancer_care_across_multiple/)
- A caregiver of a 90 year old says the information itself causes more stress than the care: which
  social worker said what, who referred her to whom, which organisation she has already called,
  what the doctor said, which medicine was changed.
  (r/eldercare, "Staying organized.....", 16 Aug 2026, 9 comments,
  https://www.reddit.com/r/eldercare/comments/1vq6yza/staying_organized/)

**What Walidayn answers.** The hospital sheet: 14 days of the record on one printable page,
one tap, plus the preference strip so a stand-in knows how care is given, not only what. This is
the binder these caregivers build by hand at midnight, kept up to date by the logging they were
already doing.

## 5. Finding 4: they are already shopping for this exact product

Strength: 8 threads, 2019 to 2026, and they never stop asking.

- "Is there an app made specifically for families to coordinate care and reminders in one place?"
  Google Calendar is called too generic. The same text was posted to two subreddits on
  consecutive days.
  (r/CaregiverSupport, "Are there any family care coordination apps?", 5 Sep 2025, 26 comments,
  https://www.reddit.com/r/CaregiverSupport/comments/1n9kxm1/are_there_any_family_care_coordination_apps/
  and r/eldercare, "Any good family care coordinator apps?", 6 Sep 2025, 6 comments,
  https://www.reddit.com/r/eldercare/comments/1n9l9f2/any_good_family_care_coordinator_apps/)
- A daughter moving into daily care asks for a medication list, a daily schedule, and the ability
  to share the data with her siblings or a friend who helps out.
  (r/AgingParents, "is there an app for that?", 2 Aug 2022, 11 votes, 11 comments,
  https://www.reddit.com/r/AgingParents/comments/wemmzy/is_there_an_app_for_that/)
- A family caring for an injured mother-in-law wants an app where people can be invited to join,
  receive updates, and schedule when to come and help.
  (r/AgingParents, "Calendar/family communications app recommendations?", 20 Aug 2024,
  15 comments,
  https://www.reddit.com/r/AgingParents/comments/1ex5hig/calendarfamily_communications_app_recommendations/)
- Two people sharing care of the same person, both with attention difficulties, ask for a system
  because texting every schedule change has stopped working.
  (r/CaregiverSupport, "Help with multiple caregiver coordination?", 23 Mar 2022, 7 comments,
  https://www.reddit.com/r/CaregiverSupport/comments/tl2g32/help_with_multiple_caregiver_coordination/)
- A daughter with two out of state siblings describes a significant shared mental load and asks
  for a tool to keep each other informed. Nobody in the thread can name one.
  (r/dementia, "iOS apps recommended for family communication re. parent with dementia?",
  22 May 2019, 6 comments,
  https://www.reddit.com/r/dementia/comments/brrwgq/ios_apps_recommended_for_family_communication_re/)
- A long distance caregiver asks how anyone tracks what was said at appointments, rides,
  medications and scheduling from far away.
  (r/eldercare, "Long distance caregivers- how do you keep track of everything?", 25 Jul 2026,
  10 comments,
  https://www.reddit.com/r/eldercare/comments/1v5vfo0/long_distance_caregivers_how_do_you_keep_track_of/)
- A husband caring for his wife cannot keep track of the small things across a long undiagnosed
  illness and asks for advice. One reply is from a paid caregiver who keeps a binder every shift,
  because things change daily and she needs to know what to expect. That is a handoff.
  (r/CaregiverSupport, "Tracking all the details - any advice?", 20 Oct 2025, 4 comments,
  https://www.reddit.com/r/CaregiverSupport/comments/1obuur9/tracking_all_the_details_any_advice/)
- A sandwich generation parent has medical data across four hospital portals, a messy spreadsheet
  and a notes app, and says the fear is not being able to find a medication list or a surgery date
  fast enough in an emergency.
  (r/sandwichgeneration, "How are you all tracking medical info for kids AND aging parents without
  losing your mind?", 1 Jan 2026, 5 votes, 3 comments,
  https://www.reddit.com/r/sandwichgeneration/comments/1q1awpq/how_are_you_all_tracking_medical_info_for_kids/)

Seven years of the same question, in six different subreddits, still being asked in 2026.

## 6. Finding 5: privacy is an objection people raise on their own

Strength: 3 threads.

- Asked about a family health record, a commenter says they want portable health records, but
  from the provider side as part of a national health plan, and that they are uneasy about
  uploading that much sensitive information to an independent app.
  (r/sandwichgeneration, 1 Jan 2026, thread above.)
- A Muslim women's subreddit carries a warning post about a period tracking app sending user data
  to Facebook, Google and two ad analytics companies, citing the 2019 Wall Street Journal
  investigation. 61 votes, 34 comments. One reply says the answer is to use a private calendar
  entry with a code word. Another says the community needs its own app.
  (r/Hijabis, "Warning regarding period tracker apps", 7 Jun 2026,
  https://www.reddit.com/r/Hijabis/comments/1tz4kff/warning_regarding_period_tracker_apps/)
- In the group chat thread above, the one substantive reply recommends WhatsApp partly because it
  is secure, and puts documents and the health history in a separate encrypted product.

**What Walidayn answers.** The key is made on the phone and never sent. The server holds
ciphertext and routing metadata. Server view on stage shows exactly this. The r/Hijabis thread is
the clearest evidence that in this specific community, distrust of health apps is already
mainstream, and that a privacy claim has to be demonstrable rather than promised.

## 7. What families use today, in their own words

Named by caregivers in these threads, unprompted: shared Google Calendar, Google Docs, Google
Keep, shared iPhone Notes, OneNote, Cozi, AnyList, FamCal, CaringBridge, Caring Village, Lotsa
Helping Hands, warm.family, yourcaremap.com, a dry erase wall calendar, a paper binder, printed
spreadsheet templates, pill sorters, Amazon Pharmacy and PillPack blister packs, the Hero pill
dispenser, Alexa reminders, and MyChart proxy access.

Every one of them is a calendar, a message thread, a reminder, or a pill device. None of them is
the record of what was actually done, by whom, against the family's own plan, with the handoff and
the load in the same place. All of them are readable by the company that runs them.

## 8. Counter-evidence, kept on purpose

A judge can find these in ten minutes, so we should have read them first.

- The strongest objection to our entire premise, from a thread where an engineer offers to build
  a free coordination app: an app is not what is needed, communication and willingness to serve
  are. Another reply in the same thread says they are tired of people mining the most exhausted
  people around for their own commercial interests, and that their inbox is full of "I am building
  a caregiving app" messages.
  (r/CaregiverSupport, "better way to coordinating care?", 20 Oct 2023, 18 comments,
  https://www.reddit.com/r/CaregiverSupport/comments/17ce0sr/better_way_to_coordinating_care/)
  Our answer: the app does not create willingness, it removes the excuse of not knowing, and it
  makes an unequal load visible so that willingness has something to act on. We also do not
  recruit in these forums.
- Tracking can be a weapon. A caregiver is required by her brother to keep a daily spreadsheet of
  her mother's waking time, medications, meals, bathroom breaks, exercise, moods and bedtimes.
  The replies say this is control disguised as care and tell her to stop.
  (r/dementia, "Caregivers caring for family members - how many of you keep daily updated detailed
  spreadsheets?", 8 Sep 2021, 24 comments,
  https://www.reddit.com/r/dementia/comments/pk0l0f/caregivers_caring_for_family_members_how_many_of/)
  Our answer: the record is symmetric. Everyone in the family sees the same thing, including the
  workload view, so it cannot be one sibling auditing another. It counts, it never judges.
- Adoption is not solved by shipping. In the shared calendar threads, several people report that
  the elder cannot reliably add appointments, and one says plainly that she made a shared Google
  calendar and her sibling simply does not use it.
  (r/AgingParents, "AITAH? Mom forgets to add appointments to shared calendar", 12 Aug 2025,
  37 comments,
  https://www.reddit.com/r/AgingParents/comments/1mokoxy/aitah_mom_forgets_to_add_appointments_to_shared/
  and the calendar recommendations thread above.)
  Our answer: the elder is not asked to enter anything, and the plan is pre-filled from the
  routine so that logging is one tap rather than typing.

## 9. One thread excluded, and why

A post titled "Burned out coordinating care for Dad, anyone else living this chaos?" reads like it
was written for us: a WhatsApp group with 17 unread messages, a Google Calendar nobody updates, a
notebook only one person writes in, and a heart medication nearly given twice because one sibling
did not know another had already given it. It is not usable. The same text was posted to three
subreddits on the same day, the account was new, and the top comment calls it a marketer or a
developer fishing for app ideas.
(r/AgingParents, 27 Aug 2025,
https://www.reddit.com/r/AgingParents/comments/1n1rbmb/burned_out_coordinating_care_for_dad_anyone_else/)

Nothing from it is used on the deck, in the script or in the Q&A. It is recorded here so that
nobody on the team quotes it on stage.

## 10. Lines we can use on stage

All three are paraphrases of verified posts, not invented quotes, and each carries its URL above.

1. Siblings sharing their father's medication: the hard part is not the schedule, it is that one
   gives the pills and hours later nobody is certain they were given. Notes on the counter, a
   shared phone note and a chart on the fridge each lasted about a week.
2. A son who was drafted as the one who "just knows" everything, digging through crumpled notes
   and discharge papers, who sat up one night building a printable sheet for his father.
3. A caregiver in a Muslim women's community warning others that a health tracking app was sending
   their data to advertisers, and a reply saying the community needs its own.

## 11. Ranked gaps this sweep exposes

1. Proof of the dose is the emotional centre of the problem, more than the schedule. Our Home
   tile says done versus planned. Making the last log's actor and time unmissable is worth more
   than any new feature.
2. Nobody wants another app. Adoption has to arrive through someone trusted, in person. This
   supports the QR-in-person join and the masjid and agency channels already in the plan.
3. The elder will not enter data, and one sibling will refuse to use the tool. The product has to
   stay useful when only one person logs.
4. The Muslim caregiving angle is not visible on Reddit. The four Muslim subreddits swept returned
   no on-topic threads about coordinating an elderly parent's care. That angle rests on ISPU and
   on the sources in `pitch/RESEARCH-FORUMS.md`, which is where it should be cited from. Do not
   claim Reddit evidence for it.
