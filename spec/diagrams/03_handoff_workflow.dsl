@direction TB
@spacing 60

(Turn ends: Sister A) -> [Log care items: meds, meal, prayer, appointment, mood] -> [Event CareLogged x N] -> [Tap Hand off to Brother B] -> [Write 2-line summary] -> [Event HandoffOpened] -> [Notifier pings B]
[Notifier pings B] -> [B opens app] -> [App pulls read model + decrypts with H] -> [B sees: preference strip, what happened, what is next] -> {B accepts?}
{B accepts?} -> "yes" -> [Event HandoffAcknowledged] -> [Workload counter +1 for B] -> (Handoff done)
{B accepts?} -> "not yet" -> [Handoff stays open, A still on duty] -> [Reminder after 30 min] -> [B opens app]
