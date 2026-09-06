// Amanah Care, whole backend in one process. No Docker, no Redis, no Postgres.
//   node dev/stack.mjs          -> api on :4000 (in-memory Postgres via pg-mem,
//                                  projector and notifier applied inline), web on :8080
// Same api/app.js, projector/apply.js and notifier/apply.js the containers run.
// Stage fallback and local development. Data lives in memory and is gone when
// the process exits.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../api/app.js';
import { applyEvent } from '../projector/apply.js';
import { notify } from '../notifier/apply.js';
import { makeDb } from '../test/helpers.mjs';
import { LocalBus } from '../api/bus.js';
import { announcement } from '../projector/apply.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(here, '..', 'web');
const API_PORT = +(process.env.PORT || 4000);
const WEB_PORT = +(process.env.WEB_PORT || 8080);

const db = makeDb();
const bus = new LocalBus();
let n = 0;
// Fake stream: every XADD is projected on the spot, so reads are immediate.
const redis = { async xAdd(_stream, _id, fields) { const id = `${Date.now()}-${n++}`; await applyEvent(db, id, fields); await notify(db, id, fields); await bus.publish(fields.family_id, announcement(fields)); return id; } };
createApp({ db, redis, bus }).listen(API_PORT, () => console.log(`[stack] api http://localhost:${API_PORT} (in-memory postgres, inline projector)`));

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml' };
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(WEB, p));
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  // On a non-default api port, tell the page where the api is (a second stack next to the Docker one).
  if (p === '/index.html' && API_PORT !== 4000)
    return res.end(fs.readFileSync(file, 'utf8').replace('<script src="vendor/qrcode.js">', `<script>window.AMANAH_API='http://'+location.hostname+':${API_PORT}'</script>\n<script src="vendor/qrcode.js">`));
  fs.createReadStream(file).pipe(res);
}).listen(WEB_PORT, () => console.log(`[stack] web http://localhost:${WEB_PORT}`));
