# Deploying Walidayn

## Live now (demo day, 2026-09-06)

A Cloudflare quick tunnel on Abdul's Mac exposes the Docker web container:

    cloudflared tunnel --url http://localhost:8080 --no-autoupdate

The URL is printed in the tunnel log and saved in `.tunnel-url` (not committed).
The Mac and the Docker stack must stay up. A new run gives a new URL.

## One origin

The phone talks to `/api` on the same origin: nginx (`app/web/nginx.conf`)
proxies `/api/` to the api container with buffering off so server-sent
events flow. On localhost with a port, the page still uses port 4000
directly (`app/web/app.js`, `API`). The one-process stack
(`app/dev/stack.mjs`) also answers `/api` on the web port, so a single
container running `node dev/stack.mjs` is enough for a small host
(Fly, Railway, Render): data lives in memory and resets on restart.

## Reseed

    cd app && docker compose down -v && docker compose up -d && sleep 5 && cd seed && API=http://localhost:4000 node seed.js
