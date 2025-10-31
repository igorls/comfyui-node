export class PoolEventManager {
    pool;
    hooks = new Map();
    constructor(pool) {
        this.pool = pool;
    }
    attachHook(event, listener) {
        if (!this.hooks.has(event)) {
            this.hooks.set(event, []);
        }
        this.hooks.get(event).push(listener);
    }
    emitEvent(event) {
        const listeners = this.hooks.get(event.type);
        if (listeners) {
            for (const listener of listeners) {
                listener(event);
            }
        }
    }
    detachHook(event, listener) {
        const listeners = this.hooks.get(event);
        if (listeners) {
            this.hooks.set(event, listeners.filter(l => l !== listener));
        }
    }
}
//# sourceMappingURL=pool-event-manager.js.map