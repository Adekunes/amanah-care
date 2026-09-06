// Live updates. A bus carries "something readable changed in family X" from
// the writer (projector, or the inline dev stack) to the API's event stream.
// LocalBus is in-process: tests and the one-process dev stack. The Redis
// version for the containers lives in redisbus.js.
import { EventEmitter } from 'node:events';

export class LocalBus {
  constructor() { this.em = new EventEmitter(); this.em.setMaxListeners(0); }
  async publish(family, msg) { this.em.emit(String(family), msg); }
  // Returns an unsubscribe function.
  async subscribe(family, fn) { this.em.on(String(family), fn); return async () => { this.em.off(String(family), fn); }; }
}
