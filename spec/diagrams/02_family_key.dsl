@direction TB
@spacing 60

(Family signs up) -> [Browser makes random key H with WebCrypto] -> [H stays on the device only] -> [Server gets only a check-value of H] -> [Invite link carries H after the # sign] -> [Other family devices save H] -> {Someone lost H?}
{Someone lost H?} -> "no" -> [Keep reading and writing with H] -> (Normal use)
{Someone lost H?} -> "yes" -> {Any member still has H?}
{Any member still has H?} -> "yes" -> [That member re-shares H by invite link] -> (Normal use)
{Any member still has H?} -> "no" -> [Family picks: make new key H2] -> [Event KeyRotated] -> [Old events sealed, new events use H2] -> (Fresh start)
