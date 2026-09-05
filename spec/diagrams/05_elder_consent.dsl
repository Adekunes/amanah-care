@direction TB
@spacing 60

(Setup day: family member sits with elder) -> [Elder device gets H by invite link] -> [Sharing screen read aloud: meds, meals, prayer, mood, appointments, transport, notes] -> [Elder decides each toggle, family member taps] -> [Event ConsentChanged, actor = elder] -> [Projector stores rule]
[Projector stores rule] -> {Who is reading?}
{Who is reading?} -> "support worker" -> [App hides categories elder blocked] -> (Filtered handoff card)
{Who is reading?} -> "family" -> [App shows all] -> (Full handoff card)
{Who is reading?} -> "elder" -> [Today view: large text, own language, read only] -> (Who is here, who is next, what happened)
