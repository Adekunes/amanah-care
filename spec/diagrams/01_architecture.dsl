@direction LR
@spacing 70

(Caregiver, phone browser) -> [Web page: encrypt with family key H] -> [API: check + append event] -> [[Redis Stream: event log]]
[[Redis Stream: event log]] -> [Projector: read events] -> [[Postgres: events + read models]]
[[Redis Stream: event log]] -> [Notifier: ping next caregiver] -> (Next caregiver, phone browser)
[[Postgres: events + read models]] -> [Web page: decrypt with H] -> (Next caregiver, phone browser)
