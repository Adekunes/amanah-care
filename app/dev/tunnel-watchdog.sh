#!/bin/bash
# Keeps a Cloudflare quick tunnel alive in front of localhost:8080 and points the
# Vercel page at it. If the tunnel stops answering, it restarts it, rewrites
# app/web/vercel.json with the new hostname and redeploys Vercel. Demo-day glue.
cd "$(dirname "$0")/../web" || exit 1
LOG=${TUNNEL_LOG:-/tmp/walidayn-tunnel.log}
start() {
  pkill -f "cloudflared tunnel" 2>/dev/null; sleep 1
  nohup cloudflared tunnel --url http://localhost:8080 --no-autoupdate --protocol http2 > "$LOG" 2>&1 &
  for i in $(seq 1 45); do U=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" "$LOG" | head -1); [ -n "$U" ] && grep -q "Registered tunnel connection" "$LOG" && break; sleep 1; done
  [ -z "$U" ] && { echo "$(date) no tunnel url"; return 1; }
  echo "$(date) tunnel $U"
  sed -i '' "s#https://[a-z0-9-]*\.trycloudflare\.com#$U#" vercel.json
  npx -y vercel@latest deploy --prod --yes >/dev/null 2>&1 && echo "$(date) vercel repointed"
  echo "$U" > ../../.tunnel-url
}
ok() { U=$(cat ../../.tunnel-url 2>/dev/null); [ -n "$U" ] && curl -sf --max-time 12 "$U/api/health" | grep -q ok; }
start
fails=0
while true; do
  sleep 15
  if ok; then fails=0; else fails=$((fails+1)); echo "$(date) health fail $fails"; fi
  [ $fails -ge 2 ] && { fails=0; start; }
done
