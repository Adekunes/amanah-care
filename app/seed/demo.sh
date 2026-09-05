#!/usr/bin/env sh
# Reset the demo family to a clean week of care. Run as often as you like.
#
#   ./seed/demo.sh                 from app/, with the stack up
#
# Rewrites family 734c7c75 only: other families are untouched. Timestamps are
# relative, so it always seeds the last seven days.
set -e
cd "$(dirname "$0")/.."
docker compose exec -T postgres psql -U amanah -d amanah -v ON_ERROR_STOP=1 < db/seed-demo.sql
echo "demo family reseeded: 4 members, 63 events, 3 handoffs (one still open)"
