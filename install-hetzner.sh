#!/usr/bin/env bash
# Install Amanah Care on a fresh Hetzner Cloud server (Debian/Ubuntu, as root).
# Installs Docker, brings up the six containers, opens the two ports the app needs.
#
#   curl -fsSL -o install-hetzner.sh <raw-url> && bash install-hetzner.sh
#   SEED=1 bash install-hetzner.sh        # also load the demo family
set -euo pipefail

REPO="${REPO:-https://github.com/Adekunes/amanah-care.git}"
DIR="${DIR:-/opt/amanah-care}"
SEED="${SEED:-0}"

[ "$(id -u)" -eq 0 ] || { echo "Run as root."; exit 1; }
command -v apt-get >/dev/null || { echo "Debian or Ubuntu only."; exit 1; }

# 1. Docker engine + compose plugin, from Docker's own apt repo.
if ! command -v docker >/dev/null; then
  . /etc/os-release
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl git
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "https://download.docker.com/linux/$ID/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$ID $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
fi

# 2. Source. If this script sits in a checkout already, use it; the repo is private,
# so a clone needs credentials the server may not have.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$here/app/docker-compose.yml" ]; then
  DIR="$here"
elif [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone --depth 1 "$REPO" "$DIR"
fi

# 3. Ports. 8080 is the page; 4000 is the api, which the browser calls directly
# (app/web/app.js reads http://<hostname>:4000), so it is not an internal port.
if command -v ufw >/dev/null && ufw status | grep -q "^Status: active"; then
  ufw allow 8080/tcp
  ufw allow 4000/tcp
fi

# 4. Build and start.
cd "$DIR/app"
docker compose up -d --build

# 5. Wait for the api rather than claim it is up.
for _ in $(seq 1 60); do
  curl -fsS http://localhost:4000/health >/dev/null 2>&1 && break
  sleep 2
done
if ! curl -fsS http://localhost:4000/health >/dev/null 2>&1; then
  echo "api did not answer /health. Logs:" >&2
  docker compose logs --tail=50 api >&2
  exit 1
fi

# 6. Demo family. seed.js imports only node:crypto, so a bare node image runs it.
if [ "$SEED" = "1" ]; then
  docker run --rm --network host -v "$DIR/app/seed:/seed:ro" -w /seed \
    -e API=http://localhost:4000 node:22-alpine node seed.js
fi

ip="$(curl -fsS --max-time 5 https://ipv4.icanhazip.com 2>/dev/null || hostname -I | awk '{print $1}')"
echo
echo "Amanah Care is up:  http://$ip:8080"
echo "api:                http://$ip:4000/health"
if [ "$SEED" = "1" ]; then echo "Logins: sistera, abdullah, fatima, ammi, layla — password 333"; fi
echo
echo "Hetzner Cloud Firewall, if you attached one, needs inbound TCP 8080 and 4000 too."
