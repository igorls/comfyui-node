export class MemoryQueueAdapter {
    waiting = [];
    inFlight = new Map();
    failed = new Map();
    async enqueue(payload, opts) {
        const priority = opts?.priority ?? 0;
        const availableAt = opts?.delayMs ? Date.now() + opts.delayMs : Date.now();
        const existingFlight = this.inFlight.get(payload.jobId);
        if (existingFlight) {
            // If job is re-enqueued while still marked in-flight, treat as retry (replace entry)
            this.inFlight.delete(payload.jobId);
        }
        const entry = {
            payload,
            attempt: payload.attempts,
            priority,
            availableAt
        };
        this.waiting.push(entry);
        this.waiting.sort((a, b) => {
            if (a.priority === b.priority) {
                return a.availableAt - b.availableAt;
            }
            return b.priority - a.priority;
        });
    }
    async reserve() {
        const now = Date.now();
        const idx = this.waiting.findIndex((entry) => entry.availableAt <= now);
        if (idx === -1) {
            return null;
        }
        const [entry] = this.waiting.splice(idx, 1);
        this.inFlight.set(entry.payload.jobId, entry);
        return {
            reservationId: entry.payload.jobId,
            payload: entry.payload,
            attempt: entry.payload.attempts,
            availableAt: entry.availableAt
        };
    }
    async commit(reservationId) {
        this.inFlight.delete(reservationId);
        this.failed.delete(reservationId);
    }
    async retry(reservationId, opts) {
        const entry = this.inFlight.get(reservationId);
        if (!entry) {
            return;
        }
        this.inFlight.delete(reservationId);
        entry.payload.attempts += 1;
        entry.attempt = entry.payload.attempts;
        entry.availableAt = opts?.delayMs ? Date.now() + opts.delayMs : Date.now();
        this.waiting.push(entry);
        this.waiting.sort((a, b) => {
            if (a.priority === b.priority) {
                return a.availableAt - b.availableAt;
            }
            return b.priority - a.priority;
        });
    }
    async discard(reservationId, reason) {
        const entry = this.inFlight.get(reservationId);
        if (!entry) {
            return;
        }
        this.inFlight.delete(reservationId);
        this.failed.set(reservationId, { entry, reason });
    }
    async remove(jobId) {
        const waitingIdx = this.waiting.findIndex((entry) => entry.payload.jobId === jobId);
        if (waitingIdx !== -1) {
            this.waiting.splice(waitingIdx, 1);
            return true;
        }
        if (this.inFlight.has(jobId)) {
            return false;
        }
        return this.failed.delete(jobId);
    }
    async stats() {
        return {
            waiting: this.waiting.length,
            inFlight: this.inFlight.size,
            delayed: this.waiting.filter((entry) => entry.availableAt > Date.now()).length,
            failed: this.failed.size
        };
    }
    async shutdown() {
        this.waiting = [];
        this.inFlight.clear();
        this.failed.clear();
    }
}
//# sourceMappingURL=memory.js.map