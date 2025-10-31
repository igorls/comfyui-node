import { MultiWorkflowPool } from "src/multipool/multi-workflow-pool.js";
import { PoolEvent } from "src/multipool/interfaces.js";

export class PoolEventManager {

  pool: MultiWorkflowPool;

  hooks: Map<string, Array<Function>> = new Map();

  constructor(pool: MultiWorkflowPool) {
    this.pool = pool;
  }

  attachHook(event: string, listener: (e: PoolEvent) => void) {
    if (!this.hooks.has(event)) {
      this.hooks.set(event, []);
    }
    this.hooks.get(event)!.push(listener);
  }

  emitEvent(event: PoolEvent) {
    const listeners = this.hooks.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }
  }

  detachHook(event: string, listener: (e: PoolEvent) => void) {
    const listeners = this.hooks.get(event);
    if (listeners) {
      this.hooks.set(event, listeners.filter(l => l !== listener));
    }
  }
}