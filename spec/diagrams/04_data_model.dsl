@direction LR
@spacing 70

[[families: id, key_check, key_version]] -> [[members: id, family_id, name, role]]
[[families: id, key_check, key_version]] -> [[events: id, family_id, seq, type, actor_id, at, cipher, key_version]]
[[events: id, family_id, seq, type, actor_id, at, cipher, key_version]] -> "projector builds" -> [[handoffs: id, family_id, from, to, status, cipher]]
[[events: id, family_id, seq, type, actor_id, at, cipher, key_version]] -> "SQL view, metadata only" -> [[workload_view: member, day, count]]
