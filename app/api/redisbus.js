// Redis pub/sub bus for the containers: the projector publishes on
// family:<id>, every API event stream subscribes on its own connection
// (a subscribing Redis connection cannot run other commands).
export class RedisBus {
  constructor(client) { this.client = client; }
  async publish(family, msg) { await this.client.publish(`family:${family}`, JSON.stringify(msg)); }
  async subscribe(family, fn) {
    const sub = this.client.duplicate();
    sub.on('error', (e) => console.error('[bus] redis', e.message));
    await sub.connect();
    await sub.subscribe(`family:${family}`, (m) => { try { fn(JSON.parse(m)); } catch { /* ignore bad payloads */ } });
    return async () => { try { await sub.unsubscribe(`family:${family}`); await sub.quit(); } catch { /* already gone */ } };
  }
}
